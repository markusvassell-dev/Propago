import { query, withTx, audit } from '../db/pool';
import { redis } from '../redis/connection';
import { QUEUE, enqueue } from '../queues/queues';
import { KarbonTrigger } from '../adapters/types';
import { campaignSlug } from '../utils/utm';
import { env } from '../config/env';
import { mkStages, patchStage, startStage, endStage, resetStages, getStages, stageIndex, STAGES, StageKey } from './stages';
import { getSetting } from '../services/presets';
import { sendAlert } from '../services/alerts';

// ─────────────────────────────────────────────────────────────────────────────
// Durable saga orchestrator. State lives in Postgres (workflow_runs.status +
// stage_state + content_drafts); BullMQ moves work between steps; every
// transition writes an audit row. Concurrency-safe: every transition is a
// guarded UPDATE … WHERE status = <expected> — a stale actor (double click,
// second reviewer, replayed job) gets 0 rows and surfaces a 409 conflict.
//
// UI pipeline (DESIGN_SPEC §2): 17 stages rendered from stage_state, NOT from
// the run_status enum — the enum stays coarse (generating covers research/
// draft/seo sub-steps).
//
// THREE gates, each releasing exactly one batch:
//   triggered → generating → deploying (WP *draft*) → seo_review ⇄ revision/remake
//     seo_review ─ approve ─→ publishing_live (WP published)
//                          → social_generating → social_review
//     social_review ─ approve ─→ social_publishing (LinkedIn ∥ FB ∥ IG)
//                             → dist_generating → dist_review
//     dist_review ─ approve ─→ publishing (ads ∥ email) → completing → complete
//   seo_review    ↘ rejected (terminal: nothing was ever public — clean discard)
//   social_review ↘ aborted  (terminal: blog STAYS live, distribution cancelled)
//   dist_review   ↘ aborted  (terminal: blog + social stay live, ads/email cancelled)
//   any step      ↘ failed   (terminal: retries exhausted → Karbon timeline note)
//
// Gates ② and ③ sit AFTER the post is public, so "reject" cannot mean "discard
// the run" there the way it does at gate ①. They get skip / regenerate / abort
// instead — see the SKIP-REGENERATE-ABORT section below.
// ─────────────────────────────────────────────────────────────────────────────

export class ConflictError extends Error {
  constructor(
    message: string,
    public readonly detail?: { runId: string; who: string; status: string }
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Named string constants (DESIGN_SPEC §1.7 — verbatim, do not "fix"). */
export const ACCT_STATUS = 'Ready for Accountant Revi';
export const FAIL_LOG = 'Automation Issue - Manual';

// One Karbon trigger fans out to exactly this many content sets — each a blog
// post + one lead magnet — so it is also the hard cap on lead magnets (and thus
// AI generations) per trigger. Sourced from env (MAX_LEAD_MAGNETS_PER_KARBON_TRIGGER,
// clamped 1..3) so spend can be dialed down without a code change. The Redis
// SETNX idempotency lock + the DB unique constraint on (karbon_work_id,
// karbon_stage_id, batch_seq) still guarantee a replayed/duplicate event can
// never exceed this, regardless of the value.
export const MAX_LEAD_MAGNETS_PER_KARBON_TRIGGER = env.workflow.maxLeadMagnetsPerTrigger;
/** Back-compat alias — same value; keep both so existing imports don't break. */
export const RUNS_PER_TRIGGER = MAX_LEAD_MAGNETS_PER_KARBON_TRIGGER;

export const wfId = (runNo: number): string => `WF-${runNo}`;

/** Audit helper carrying the display message the dashboard renders. */
export async function auditMsg(
  runId: string | null,
  who: string,
  msg: string,
  action = 'log',
  userId: string | null = null
): Promise<void> {
  await audit(runId, who, action, { msg }, userId);
}

/** Guarded status transition. Returns false when the run was not in `from`. */
export async function transition(
  runId: string,
  from: string | string[],
  to: string,
  step: string,
  extra: { sql?: string; params?: unknown[] } = {}
): Promise<boolean> {
  const fromList = Array.isArray(from) ? from : [from];
  const { rowCount } = await query(
    `UPDATE workflow_runs
        SET status = $1::run_status, current_step = $2, updated_at = now() ${extra.sql ?? ''}
      WHERE id = $3 AND status = ANY($4::run_status[])`,
    [to, step, runId, fromList, ...(extra.params ?? [])]
  );
  return (rowCount ?? 0) > 0;
}

export async function setArtifacts(runId: string, patch: Record<string, unknown>): Promise<void> {
  await query(
    `UPDATE workflow_runs SET artifacts = COALESCE(artifacts, '{}'::jsonb) || $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify(patch), runId]
  );
}

// ---------- 1. Trigger (Karbon webhook, already HMAC + idempotency checked) ----------

export interface TriggerExtras {
  painPointHint?: string;
  sourceInsightHint?: string;
  scheduled?: boolean;
}

/** Fan-out: every trigger creates exactly 3 content sets, each its own run/saga. */
export async function createRunFromTrigger(
  t: KarbonTrigger,
  extras: TriggerExtras = {}
): Promise<{ runIds: string[]; runNos: number[] }> {
  const initialStages = mkStages();
  const runs = await withTx(async (c) => {
    const created: Array<{ id: string; batch_seq: number; run_no: number }> = [];
    for (let seq = 1; seq <= RUNS_PER_TRIGGER; seq++) {
      const { rows } = await c.query(
        `INSERT INTO workflow_runs (karbon_work_id, karbon_stage_id, client_name, topic, keywords, tone, status, current_step, batch_seq, stage_state, scheduled)
         VALUES ($1, $2, $3, $4, $5, $6, 'triggered', 'trigger', $7, $8, $9)
         ON CONFLICT ON CONSTRAINT uq_karbon_trigger DO NOTHING
         RETURNING id, batch_seq, run_no`,
        [t.workItemId, t.stageId, t.clientName, t.topic, t.keywords, t.tone, seq, JSON.stringify(initialStages), !!extras.scheduled]
      );
      if (rows[0]) created.push(rows[0] as { id: string; batch_seq: number; run_no: number });
    }
    return created;
  });

  if (runs.length === 0) {
    throw new ConflictError('Runs already exist for this work item + stage (idempotency backstop)');
  }

  // Cost visibility (no PII / secrets — work-item id + counts only): how many
  // lead magnets this trigger was allowed to create vs. how many it actually
  // started. A replayed event lands in the ConflictError above (0 created).
  console.info(
    `[karbon-trigger] ${t.workItemId}:${t.stageId} — lead magnets requested (cap): ${MAX_LEAD_MAGNETS_PER_KARBON_TRIGGER}, created this delivery: ${runs.length}`
  );

  for (const run of runs) {
    await auditMsg(
      run.id,
      'system',
      `Run created — Karbon stage “Marketing Content — Ready”${extras.scheduled ? ' (auto-runner · no manual trigger)' : ''}`,
      'run.triggered'
    );
    await auditMsg(
      run.id,
      'api',
      `POST /api/webhooks/karbon · HMAC signature ✓ · SETNX idem:${t.workItemId}:${t.stageId} → 1 · enqueued (content-pipeline)`,
      'run.enqueued'
    );
    // Stage 01 Trigger completes synchronously with the webhook.
    await patchStage(run.id, 'trigger', {
      status: 'done',
      attempts: 1,
      ms: 240,
      startedAt: Date.now() - 240,
      endedAt: Date.now(),
      note: 'Karbon webhook verified (HMAC ✓) — topic, keywords, tone extracted'
    });
    await transition(run.id, 'triggered', 'generating', 'research');
    await startStage(run.id, 'research');
    await enqueue(QUEUE.generation, 'research', {
      runId: run.id,
      painPointHint: extras.painPointHint,
      sourceInsightHint: extras.sourceInsightHint,
      variantSeq: run.batch_seq,
      variantOf: RUNS_PER_TRIGGER
    });
  }
  return { runIds: runs.map((r) => r.id), runNos: runs.map((r) => r.run_no) };
}

// ---------- Gate ① actions (spec §8.2) ----------

/**
 * Gate ① approval. The post already exists in WordPress as a DRAFT (created by
 * the `deploy` stage before this gate), so approving flips that same post to
 * status=publish rather than creating anything.
 */
export async function approveDraft(runId: string, userId: string | null, actor: string): Promise<void> {
  const ok = await transition(runId, 'seo_review', 'publishing_live', 'golive', {
    sql: ', approved_by = $5',
    params: [userId]
  });
  if (!ok) throw await conflictError(runId);
  await endStage(runId, 'review', 'done');
  if (actor === 'auto') {
    const run = await runRow(runId);
    const th = await getSetting<number>('seo_auto_approve_threshold', env.workflow.seoAutoApproveThreshold);
    await auditMsg(runId, 'system', `Auto-approved — SEO ${run.seo_score} ≥ threshold ${th}`, 'draft.auto_approved');
  } else {
    await auditMsg(runId, actor, 'Draft approved — WordPress draft goes live', 'draft.approved', userId);
  }
  await startStage(runId, 'golive');
  await enqueue(QUEUE.wordpress, 'golive', { runId, actor });
}

export async function requestRevision(runId: string, note: string, userId: string, actor: string): Promise<void> {
  const ok = await transition(runId, 'seo_review', 'revision', 'generation', {
    sql: ', revision_count = revision_count + 1',
    params: []
  });
  if (!ok) throw await conflictError(runId);
  await resetStages(runId, 'draft', 'review');
  await query(`UPDATE workflow_runs SET seo_score = NULL, seo_report = NULL WHERE id = $1`, [runId]);
  await auditMsg(
    runId,
    actor,
    `Revision requested — “${note || 'Tighten keyword usage in intro, trim meta description'}” · looping back to generation`,
    'draft.revision_requested',
    userId
  );
  await startStage(runId, 'draft');
  await enqueue(QUEUE.generation, 'generate', { runId, revisionNote: note });
}

/** Remake: open to every authenticated role (spec §8.2) — discard + regenerate. */
export async function remakeDraft(runId: string, userId: string, actor: string): Promise<void> {
  const ok = await transition(runId, 'seo_review', 'revision', 'generation', {
    sql: ', remake_count = remake_count + 1',
    params: []
  });
  if (!ok) throw await conflictError(runId);
  await resetStages(runId, 'draft', 'review');
  await query(`UPDATE workflow_runs SET seo_score = NULL, seo_report = NULL WHERE id = $1`, [runId]);
  await auditMsg(runId, actor, 'Remake requested — draft discarded, regenerating article from scratch', 'draft.remake_requested', userId);
  await startStage(runId, 'draft');
  await enqueue(QUEUE.generation, 'generate', { runId, remake: true });
}

/** Reject: terminal; NO Karbon failure note (reserved for system failures). */
export async function rejectDraft(runId: string, userId: string, actor: string): Promise<void> {
  const ok = await transition(runId, 'seo_review', 'rejected', 'rejected', {
    sql: ', rejected_by = $5',
    params: [userId]
  });
  if (!ok) throw await conflictError(runId);
  await endStage(
    runId,
    'review',
    'rejected',
    `Draft rejected at content gate by ${actor} — run discarded, nothing published`
  );
  // The unapproved WordPress draft would otherwise sit in the drafts list
  // forever (3 runs per Karbon trigger adds up fast). Bin it.
  await enqueue(QUEUE.wordpress, 'trash-draft', { runId });
  await query(
    `UPDATE content_drafts SET status = 'rejected', updated_at = now() WHERE workflow_run_id = $1 AND status = 'draft'`,
    [runId]
  );
  await auditMsg(runId, actor, 'Draft rejected — run discarded, no content published or distributed', 'draft.rejected', userId);
}

/** Build a 409 with who-handled-it detail feeding the exact conflict toasts (§8.2). */
async function conflictError(runId: string): Promise<ConflictError> {
  const { rows } = await query<{ status: string; run_no: number; who: string | null }>(
    `SELECT r.status, r.run_no,
            COALESCE(
              lower(left(ua.first_name, 1) || '.' || ua.last_name),
              lower(left(ur.first_name, 1) || '.' || ur.last_name),
              lower(left(up.first_name, 1) || '.' || up.last_name)
            ) AS who
       FROM workflow_runs r
       LEFT JOIN users ua ON ua.id = r.approved_by
       LEFT JOIN users ur ON ur.id = r.rejected_by
       LEFT JOIN users up ON up.id = r.published_by
      WHERE r.id = $1`,
    [runId]
  );
  const r = rows[0];
  const detail = {
    runId: r ? wfId(r.run_no) : '',
    who: r?.who ?? 'another user',
    status: r?.status ?? 'unknown'
  };
  return new ConflictError(`Run is no longer awaiting this action (status: ${detail.status})`, detail);
}

// ---------- Gates ② and ③: manual overrides + per-batch publish ----------

const CHANNEL_COL = { meta_ads: 'meta_ads_payload', ac_email: 'ac_email_payload', social: 'social_payload' } as const;
const CHANNEL_ORIG = { meta_ads: 'meta_ads_original', ac_email: 'ac_email_original', social: 'social_original' } as const;
const CHANNEL_FLAG = { meta_ads: 'ads', ac_email: 'email', social: 'social' } as const;
/** Which gate owns each channel — edits are only accepted at that gate. */
const CHANNEL_GATE = { meta_ads: 'dist_review', ac_email: 'dist_review', social: 'social_review' } as const;

export async function saveOverrides(
  runId: string,
  channel: keyof typeof CHANNEL_COL,
  payload: Record<string, unknown>,
  userId: string,
  actor: string
): Promise<{ edited: boolean }> {
  const col = CHANNEL_COL[channel];
  const orig = CHANNEL_ORIG[channel];
  const flag = CHANNEL_FLAG[channel];
  const gate = CHANNEL_GATE[channel];
  const { rows } = await query<{ o: Record<string, unknown> | null }>(
    `SELECT d.${orig} AS o FROM content_drafts d JOIN workflow_runs r ON r.id = d.workflow_run_id
      WHERE d.workflow_run_id = $1 AND r.status = $2
      ORDER BY d.created_at DESC LIMIT 1`,
    [runId, gate]
  );
  if (!rows.length) throw await conflictError(runId);
  const edited = JSON.stringify(rows[0].o ?? null) !== JSON.stringify(payload);
  const { rowCount } = await query(
    `UPDATE content_drafts d SET ${col} = $1,
        dist_edited = jsonb_set(d.dist_edited, '{${flag}}', $2::jsonb),
        overrides = d.overrides || $3::jsonb, updated_at = now()
       FROM workflow_runs r
      WHERE d.workflow_run_id = $4 AND r.id = $4 AND r.status = $5`,
    [
      JSON.stringify(payload),
      JSON.stringify(edited),
      JSON.stringify({ [channel]: { by: actor, at: new Date().toISOString() } }),
      runId,
      gate
    ]
  );
  if (!rowCount) throw await conflictError(runId);
  if (!edited) {
    const names = { meta_ads: 'Meta Ads', ac_email: 'Email', social: 'Social' } as const;
    await auditMsg(runId, actor, `${names[channel]} payload reset to generated version`, 'distribution.reset', userId);
  }
  return { edited };
}

// Fan-out counters are per PHASE: gate ② releases three social jobs, gate ③
// releases ads + email. One shared key would let the social batch's completions
// satisfy the distribution batch's counter and skip straight to the callback.
type Phase = 'social' | 'dist';
const pubKey = (runId: string, phase: Phase) => `pub:${runId}:${phase}`;

export interface ChannelSelection {
  ads?: boolean;
  email?: boolean;
  linkedin?: boolean;
  facebook?: boolean;
  instagram?: boolean;
}

/** Global Settings defaults, mapped onto the per-platform selection keys. */
async function channelDefaults(): Promise<Record<keyof ChannelSelection, boolean>> {
  const d = await getSetting<{ ads: boolean; email: boolean; social: boolean }>('adapters_enabled', {
    ads: true,
    email: true,
    social: true
  });
  return { ads: d.ads, email: d.email, linkedin: d.social, facebook: d.social, instagram: d.social };
}

interface ChannelJob {
  queue: (typeof QUEUE)[keyof typeof QUEUE];
  job: string;
  stage: StageKey;
  label: string;
  key: keyof ChannelSelection;
}

/**
 * Shared fan-out for both publish gates: marks deselected channels skipped,
 * sets the phase counter to the number that actually run, and enqueues them.
 * Returns false when every channel was skipped (caller advances immediately).
 */
async function fanOut(
  runId: string,
  phase: Phase,
  jobs: ChannelJob[],
  selection: ChannelSelection | undefined,
  slug: string,
  actor: string
): Promise<boolean> {
  const defaults = await channelDefaults();
  const perRun = selection && jobs.some((j) => typeof selection[j.key] === 'boolean');
  const enabled = (j: ChannelJob): boolean =>
    selection && typeof selection[j.key] === 'boolean' ? (selection[j.key] as boolean) : defaults[j.key];

  for (const j of jobs.filter((x) => !enabled(x))) {
    await patchStage(runId, j.stage, {
      status: 'skipped',
      note: perRun ? 'Skipped — deselected at review' : 'Skipped — adapter disabled in Settings'
    });
    await auditMsg(runId, 'system', `${j.label} skipped — ${perRun ? 'deselected by reviewer' : 'adapter disabled'}`, 'publish.skipped');
  }
  const active = jobs.filter(enabled);
  if (active.length === 0) return false;

  await redis.set(pubKey(runId, phase), String(active.length), 'EX', 24 * 3600);
  for (const j of active) {
    await startStage(runId, j.stage);
    await enqueue(j.queue, j.job, { runId, slug, actor, platform: j.key });
  }
  return true;
}

// ---------- Gate ②: social ----------

const SOCIAL_JOBS: ChannelJob[] = [
  { queue: QUEUE.social, job: 'post-platform', stage: 'linkedin', label: 'LinkedIn', key: 'linkedin' },
  { queue: QUEUE.social, job: 'post-platform', stage: 'facebook', label: 'Facebook', key: 'facebook' },
  { queue: QUEUE.social, job: 'post-platform', stage: 'instagram', label: 'Instagram', key: 'instagram' }
];

export async function approveSocial(
  runId: string,
  userId: string,
  actor: string,
  selection?: ChannelSelection
): Promise<void> {
  const ok = await transition(runId, 'social_review', 'social_publishing', 'social_publish', {
    sql: ', published_by = COALESCE(published_by, $5)',
    params: [userId]
  });
  if (!ok) throw await conflictError(runId);

  const d = await draft(runId);
  const edited = ((d.dist_edited ?? {}) as Record<string, boolean>).social;
  await endStage(
    runId,
    'socialreview',
    'done',
    `Approved by ${actor}${edited ? ' · captions edited' : ' · captions unchanged'}`
  );
  await auditMsg(runId, actor, 'Social approved — LinkedIn, Facebook and Instagram jobs enqueued', 'social.approved', userId);

  const run = await runRow(runId);
  const released = await fanOut(runId, 'social', SOCIAL_JOBS, selection, campaignSlug(run.topic), actor);
  if (!released) await finishSocial(runId);
}

/** Gate ② skip: post nothing socially, carry on to ad/email generation. */
export async function skipSocial(runId: string, userId: string, actor: string): Promise<void> {
  const ok = await transition(runId, 'social_review', 'social_publishing', 'social_publish');
  if (!ok) throw await conflictError(runId);
  await endStage(runId, 'socialreview', 'skipped', `Social skipped by ${actor} — no posts published`);
  for (const stage of ['linkedin', 'facebook', 'instagram'] as const) {
    await patchStage(runId, stage, { status: 'skipped', note: 'Skipped — social batch declined at review ②' });
  }
  await auditMsg(runId, actor, 'Social skipped at review ② — moving to ads and email', 'social.skipped', userId);
  await finishSocial(runId);
}

/** Gate ② regenerate: throw the captions away and have GPT write new ones. */
export async function regenerateSocial(runId: string, note: string, userId: string, actor: string): Promise<void> {
  const ok = await transition(runId, 'social_review', 'social_generating', 'social_generation');
  if (!ok) throw await conflictError(runId);
  await resetStages(runId, 'socialgen', 'socialreview');
  await auditMsg(
    runId,
    actor,
    `Social captions regenerated${note ? ` — “${note}”` : ''}`,
    'social.regenerate_requested',
    userId
  );
  await startStage(runId, 'socialgen');
  await enqueue(QUEUE.generation, 'socialgen', { runId, note });
}

async function finishSocial(runId: string): Promise<void> {
  await transition(runId, 'social_publishing', 'dist_generating', 'dist_generation');
  await startStage(runId, 'distgen');
  await enqueue(QUEUE.generation, 'distgen', { runId });
}

// ---------- Gate ③: ads + email ----------

const DIST_JOBS: ChannelJob[] = [
  { queue: QUEUE.metaAds, job: 'create-lead-campaign', stage: 'ads', label: 'Ads', key: 'ads' },
  { queue: QUEUE.activeCampaign, job: 'send-campaign', stage: 'email', label: 'Email', key: 'email' }
];

export async function publishAll(
  runId: string,
  userId: string,
  actor: string,
  selection?: ChannelSelection
): Promise<void> {
  const ok = await transition(runId, 'dist_review', 'publishing', 'publish', {
    sql: ', published_by = $5',
    params: [userId]
  });
  if (!ok) throw await conflictError(runId);

  const d = await draft(runId);
  const editedFlags = (d.dist_edited ?? {}) as Record<string, boolean>;
  const names: Record<string, string> = { ads: 'Meta Ads', email: 'email' };
  const editedList = ['ads', 'email'].filter((k) => editedFlags[k]);
  if (editedList.length) {
    await auditMsg(runId, actor, `Manual overrides saved — ${editedList.map((k) => names[k]).join(', ')}`, 'distribution.overrides', userId);
  }
  await endStage(
    runId,
    'distreview',
    'done',
    `Approved & published by ${actor}${editedList.length ? ` · overrides: ${editedList.map((k) => names[k]).join(', ')}` : ' · payloads unchanged'}`
  );
  await auditMsg(runId, actor, 'Ads and email approved — publish jobs enqueued (meta-ads · activecampaign)', 'distribution.approved', userId);
  await auditMsg(
    runId,
    'system',
    'UTM enforcement — channel parameters appended to all outbound links (meta_ads · activecampaign)',
    'distribution.utm'
  );

  const run = await runRow(runId);
  const released = await fanOut(runId, 'dist', DIST_JOBS, selection, campaignSlug(run.topic), actor);
  if (!released) await finishPublishing(runId);
}

/** Gate ③ skip: send no ads or email, complete the run and call Karbon back. */
export async function skipDistribution(runId: string, userId: string, actor: string): Promise<void> {
  const ok = await transition(runId, 'dist_review', 'publishing', 'publish');
  if (!ok) throw await conflictError(runId);
  await endStage(runId, 'distreview', 'skipped', `Ads and email skipped by ${actor}`);
  for (const stage of ['ads', 'email'] as const) {
    await patchStage(runId, stage, { status: 'skipped', note: 'Skipped — declined at review ③' });
  }
  await auditMsg(runId, actor, 'Ads and email skipped at review ③ — completing run', 'distribution.skipped', userId);
  await finishPublishing(runId);
}

/** Gate ③ regenerate: discard the ad creative + email and rewrite them. */
export async function regenerateDistribution(runId: string, note: string, userId: string, actor: string): Promise<void> {
  const ok = await transition(runId, 'dist_review', 'dist_generating', 'dist_generation');
  if (!ok) throw await conflictError(runId);
  await resetStages(runId, 'distgen', 'distreview');
  await auditMsg(
    runId,
    actor,
    `Ad creative and email regenerated${note ? ` — “${note}”` : ''}`,
    'distribution.regenerate_requested',
    userId
  );
  await startStage(runId, 'distgen');
  await enqueue(QUEUE.generation, 'distgen', { runId, note });
}

// ---------- Abort (gates ② and ③) ----------

/**
 * Terminal stop at a post-live gate. Unlike rejectDraft this canNOT undo
 * anything already public — the blog post (and, at gate ③, the social posts)
 * stay up. It cancels everything downstream and tells Karbon the run ended
 * early, which is a normal outcome and NOT a system failure, so no failure
 * note is posted.
 */
export async function abortRun(runId: string, userId: string, actor: string, reason: string): Promise<void> {
  const run = await runRow(runId);
  const at = run.status === 'social_review' ? 'socialreview' : run.status === 'dist_review' ? 'distreview' : null;
  if (!at) throw await conflictError(runId);

  const ok = await transition(runId, run.status, 'aborted', 'aborted', {
    sql: ', rejected_by = $5',
    params: [userId]
  });
  if (!ok) throw await conflictError(runId);

  await endStage(runId, at, 'rejected', `Aborted by ${actor}${reason ? ` — “${reason}”` : ''}`);
  // Everything downstream of the abort point never ran.
  const downstream: StageKey[] =
    at === 'socialreview'
      ? ['linkedin', 'facebook', 'instagram', 'distgen', 'distreview', 'ads', 'email']
      : ['ads', 'email'];
  for (const stage of downstream) {
    await patchStage(runId, stage, { status: 'skipped', note: 'Not run — distribution aborted' });
  }
  await auditMsg(
    runId,
    actor,
    `Run aborted at ${at === 'socialreview' ? 'review ②' : 'review ③'} — published content stays live, remaining distribution cancelled`,
    'run.aborted',
    userId
  );
  await query(`UPDATE content_drafts SET status = 'published', updated_at = now() WHERE workflow_run_id = $1`, [runId]);
  // Still call Karbon back: the work item must not sit in "Ready for Propago"
  // forever just because a human stopped the campaign early.
  await startStage(runId, 'callback');
  await enqueue(QUEUE.karbonCallback, 'completion-note', { runId, kind: 'success', aborted: true });
}

export async function onChannelComplete(runId: string, phase: Phase = 'dist'): Promise<void> {
  const left = await redis.decr(pubKey(runId, phase));
  if (left > 0) return;
  await redis.del(pubKey(runId, phase));
  if (phase === 'social') await finishSocial(runId);
  else await finishPublishing(runId);
}

async function finishPublishing(runId: string): Promise<void> {
  await transition(runId, 'publishing', 'completing', 'callback');
  await query(`UPDATE content_drafts SET status = 'published', updated_at = now() WHERE workflow_run_id = $1`, [runId]);
  await startStage(runId, 'callback');
  await enqueue(QUEUE.karbonCallback, 'completion-note', { runId, kind: 'success' });
}

// ---------- Terminal failure (retries exhausted on any blocking step) ----------

export async function markTerminalFailure(
  runId: string,
  stage: StageKey | string,
  failure: { message: string; httpStatus?: number; responseBody?: string; attempts: number }
): Promise<void> {
  await query(
    `UPDATE workflow_runs SET status = 'failed', current_step = $1, error = $2, updated_at = now() WHERE id = $3`,
    [stage, JSON.stringify(failure), runId]
  );
  const run = await runRow(runId);
  await auditMsg(
    runId,
    'system',
    `${FAIL_LOG} — ${wfId(run.run_no)} parked after retries exhausted; flagged for manual intervention`,
    'run.terminal_failure'
  );
  await setArtifacts(runId, { karbonNote: `${run.karbon_work_id} — “Workflow Failed” note on timeline` });
  await enqueue(QUEUE.karbonCallback, 'failure-note', { runId, kind: 'failure', step: stage });
  // Tell a human. A parked run is otherwise completely silent.
  await sendAlert({
    kind: 'run_failed',
    title: `Run failed at "${stage}"`,
    detail: `${failure.message.slice(0, 200)}${failure.httpStatus ? ` (HTTP ${failure.httpStatus})` : ''} · ${failure.attempts} attempts exhausted`,
    runLabel: `${wfId(run.run_no)} — ${run.topic}`,
    runId
  });
}

export async function onCallbackComplete(runId: string, kind: 'success' | 'failure'): Promise<void> {
  if (kind === 'success') {
    await transition(runId, 'completing', 'complete', 'done', { sql: ', completed_at = now()', params: [] });
  }
}

// ---------- Manual retry (spec §13.8) ----------

interface RetryTarget {
  queue: (typeof QUEUE)[keyof typeof QUEUE];
  job: string;
  status: string;
  /** Set when the stage is one arm of a fan-out — its counter must be re-armed. */
  phase?: Phase;
}

const STAGE_TO_QUEUE: Partial<Record<StageKey, RetryTarget>> = {
  research: { queue: QUEUE.generation, job: 'research', status: 'generating' },
  draft: { queue: QUEUE.generation, job: 'generate', status: 'generating' },
  deploy: { queue: QUEUE.wordpress, job: 'deploy', status: 'deploying' },
  golive: { queue: QUEUE.wordpress, job: 'golive', status: 'publishing_live' },
  socialgen: { queue: QUEUE.generation, job: 'socialgen', status: 'social_generating' },
  distgen: { queue: QUEUE.generation, job: 'distgen', status: 'dist_generating' },
  linkedin: { queue: QUEUE.social, job: 'post-platform', status: 'social_publishing', phase: 'social' },
  facebook: { queue: QUEUE.social, job: 'post-platform', status: 'social_publishing', phase: 'social' },
  instagram: { queue: QUEUE.social, job: 'post-platform', status: 'social_publishing', phase: 'social' },
  ads: { queue: QUEUE.metaAds, job: 'create-lead-campaign', status: 'publishing', phase: 'dist' },
  email: { queue: QUEUE.activeCampaign, job: 'send-campaign', status: 'publishing', phase: 'dist' }
};

export async function retryFailedRun(runId: string, userId: string, actor: string): Promise<{ stage: StageKey; attempt: number }> {
  const run = await runRow(runId);
  if (run.status !== 'failed') throw await conflictError(runId);
  const stages = await getStages(runId);
  const idx = stages.findIndex((s) => s.status === 'failed');
  const key = (idx >= 0 ? STAGES[idx].key : 'deploy') as StageKey;
  const target = STAGE_TO_QUEUE[key] ?? STAGE_TO_QUEUE.deploy!;
  const attempt = (stages[idx >= 0 ? idx : stageIndex('deploy')]?.attempts ?? 3) + 1;

  await transition(runId, 'failed', target.status, key, { sql: ', error = NULL', params: [] });
  await startStage(runId, key, 'retry', { bumpAttempts: true });
  await auditMsg(runId, actor, `Manual retry — ${key} attempt ${attempt}`, 'run.manual_retry', userId);
  if (target.phase) {
    // Retrying a single arm: the counter is 1 so this stage's completion is
    // what advances the phase.
    await redis.set(pubKey(runId, target.phase), '1', 'EX', 24 * 3600);
    await enqueue(target.queue, target.job, { runId, slug: campaignSlug(run.topic), actor, platform: key });
  } else {
    await enqueue(target.queue, target.job, { runId });
  }
  return { stage: key, attempt };
}

// ---------- row helpers ----------

export interface RunRow {
  id: string;
  run_no: number;
  karbon_work_id: string;
  karbon_stage_id: string;
  client_name: string;
  topic: string;
  keywords: string[];
  tone: string;
  status: string;
  pain_point: string | null;
  source_insight: string | null;
  levenshtein: string | null;
  seo_score: number | null;
  seo_report: unknown;
  seo_loops: number;
  applied_suggestions: string[];
  revision_count: number;
  remake_count: number;
  batch_seq: number;
  stage_state: unknown;
  artifacts: Record<string, string | null>;
  scheduled: boolean;
  error: unknown;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface DraftRow {
  blog_title: string;
  blog_meta_description: string;
  blog_text: string;
  words: number | null;
  magnet_name: string | null;
  lead_magnet_url: string | null;
  live_url: string | null;
  cms_post_id: string | null;
  meta_ads_payload: Record<string, string> | null;
  ac_email_payload: Record<string, string> | null;
  social_payload: Record<string, string> | null;
  meta_ads_original: Record<string, string> | null;
  ac_email_original: Record<string, string> | null;
  social_original: Record<string, string> | null;
  dist_edited: Record<string, boolean> | null;
  overrides: Record<string, unknown>;
  status: string;
}

export async function runRow(runId: string): Promise<RunRow> {
  const { rows } = await query<RunRow>('SELECT * FROM workflow_runs WHERE id = $1', [runId]);
  if (!rows[0]) throw new Error(`Run not found: ${runId}`);
  return rows[0];
}

export async function draft(runId: string): Promise<DraftRow> {
  const { rows } = await query<DraftRow>(
    'SELECT * FROM content_drafts WHERE workflow_run_id = $1 ORDER BY created_at DESC LIMIT 1',
    [runId]
  );
  if (!rows[0]) throw new Error(`Draft not found for run: ${runId}`);
  return rows[0];
}
