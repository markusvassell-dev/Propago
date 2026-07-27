import { PoolClient } from 'pg';
import { query, withTx } from '../db/pool';

// The fixed 17-stage pipeline every WorkflowRun renders as (DESIGN_SPEC §2).
// `stage_state` on workflow_runs is the 17-element JSONB array powering the
// pipeline strips, the Saga-stages card and the job-log modal (§13.3).
//
// Three human gates, each releasing exactly one batch:
//   … seo → deploy (WP *draft*) → REVIEW ① → golive (WP published)
//         → socialgen → REVIEW ② → linkedin ∥ facebook ∥ instagram
//         → distgen  → REVIEW ③ → ads ∥ email → callback
// The post is written to WordPress as a draft BEFORE gate ① so the reviewer
// previews it inside the real theme; approving flips status to `publish`.
// Nothing is publicly visible until a human approves.

export interface StageEntry {
  status: 'pending' | 'active' | 'retry' | 'gate' | 'done' | 'failed' | 'partial' | 'skipped' | 'rejected';
  attempts: number;
  ms: number;
  note: string;
  err?: string;
  startedAt?: number; // epoch ms
  endedAt?: number;
}

export const STAGES = [
  { key: 'trigger',      label: 'Trigger',       strip: 'TRG', sys: 'Karbon webhook',               queue: 'content-pipeline' },
  { key: 'research',     label: 'Research',      strip: 'RES', sys: 'Web search + ChatGPT extract', queue: 'content-pipeline' },
  { key: 'draft',        label: 'Generate',      strip: 'GEN', sys: 'ChatGPT Business API · 90s',   queue: 'content-pipeline' },
  { key: 'seo',          label: 'SEO score',     strip: 'SEO', sys: 'Internal scorer',              queue: 'content-pipeline' },
  { key: 'deploy',       label: 'WP draft',      strip: 'DFT', sys: 'WordPress REST · status=draft', queue: 'wordpress' },
  { key: 'review',       label: 'Review ①',      strip: 'REV', sys: 'Human gate · blog post',       queue: 'human-gate' },
  { key: 'golive',       label: 'Publish live',  strip: 'PUB', sys: 'WordPress REST · status=publish', queue: 'wordpress' },
  { key: 'socialgen',    label: 'Social gen',    strip: 'SGN', sys: 'OpenAI GPT-4o · 3 captions',   queue: 'content-pipeline' },
  { key: 'socialreview', label: 'Review ②',      strip: 'SRV', sys: 'Human gate · social',          queue: 'human-gate' },
  { key: 'linkedin',     label: 'LinkedIn',      strip: 'LI',  sys: 'LinkedIn UGC Posts API',       queue: 'social' },
  { key: 'facebook',     label: 'Facebook',      strip: 'FB',  sys: 'Meta Graph · page feed',       queue: 'social' },
  { key: 'instagram',    label: 'Instagram',     strip: 'IG',  sys: 'Meta Graph · media publish',   queue: 'social' },
  { key: 'distgen',      label: 'Ads/email gen', strip: 'DGN', sys: 'OpenAI GPT-4o',                queue: 'content-pipeline' },
  { key: 'distreview',   label: 'Review ③',      strip: 'DRV', sys: 'Human gate · ads + email',     queue: 'human-gate' },
  { key: 'ads',          label: 'Ads',           strip: 'ADS', sys: 'Meta Marketing API',           queue: 'meta-ads · 10 req/10s' },
  { key: 'email',        label: 'Email',         strip: 'EML', sys: 'ActiveCampaign',               queue: 'activecampaign · 5 req/s' },
  { key: 'callback',     label: 'Callback',      strip: 'CBK', sys: 'Karbon Timeline API',          queue: 'karbon' }
] as const;

/** The three social stages, in strip order — fan-out target for gate ②. */
export const SOCIAL_STAGES = ['linkedin', 'facebook', 'instagram'] as const;
export type SocialStageKey = (typeof SOCIAL_STAGES)[number];

export type StageKey = (typeof STAGES)[number]['key'];

export const stageIndex = (key: StageKey): number => STAGES.findIndex((s) => s.key === key);

export function mkStages(): StageEntry[] {
  return STAGES.map(() => ({ status: 'pending', attempts: 1, ms: 0, note: '' }));
}

export async function getStages(runId: string, client?: PoolClient): Promise<StageEntry[]> {
  const q = client ? client.query.bind(client) : query;
  const { rows } = await q('SELECT stage_state FROM workflow_runs WHERE id = $1', [runId]);
  const st = rows[0]?.stage_state;
  return Array.isArray(st) && st.length === STAGES.length ? st : mkStages();
}

/**
 * Atomic read-modify-write of the stage array. Publish-channel workers (ads /
 * email / social) finish concurrently — without SELECT … FOR UPDATE their
 * whole-array writes race and clobber each other's stage patches.
 */
async function mutateStages(
  runId: string,
  fn: (stages: StageEntry[]) => void,
  client?: PoolClient
): Promise<StageEntry[]> {
  const run = async (c: PoolClient): Promise<StageEntry[]> => {
    const { rows } = await c.query('SELECT stage_state FROM workflow_runs WHERE id = $1 FOR UPDATE', [runId]);
    const st = rows[0]?.stage_state;
    const stages: StageEntry[] = Array.isArray(st) && st.length === STAGES.length ? st : mkStages();
    fn(stages);
    await c.query('UPDATE workflow_runs SET stage_state = $1, updated_at = now() WHERE id = $2', [
      JSON.stringify(stages),
      runId
    ]);
    return stages;
  };
  if (client) return run(client);
  return withTx(run);
}

/** Patch one stage in place (read-modify-write; workers run one job per run at a time). */
export async function patchStage(
  runId: string,
  key: StageKey,
  patch: Partial<StageEntry>,
  client?: PoolClient
): Promise<StageEntry[]> {
  const i = stageIndex(key);
  return mutateStages(runId, (stages) => {
    stages[i] = { ...stages[i], ...patch };
  }, client);
}

/** Mark a stage done (or another terminal status) and compute ms from startedAt. */
export async function endStage(
  runId: string,
  key: StageKey,
  status: StageEntry['status'],
  note?: string,
  err?: string,
  client?: PoolClient
): Promise<void> {
  const i = stageIndex(key);
  await mutateStages(runId, (stages) => {
    const s = stages[i];
    const endedAt = Date.now();
    const ms = s.startedAt ? endedAt - s.startedAt : s.ms;
    stages[i] = { ...s, status, ms, endedAt, ...(note !== undefined ? { note } : {}), ...(err !== undefined ? { err } : {}) };
  }, client);
}

/** Mark a stage active/gate with a fresh startedAt (keeps attempts unless bumped). */
export async function startStage(
  runId: string,
  key: StageKey,
  status: 'active' | 'gate' | 'retry' = 'active',
  opts: { bumpAttempts?: boolean; note?: string } = {},
  client?: PoolClient
): Promise<void> {
  const i = stageIndex(key);
  await mutateStages(runId, (stages) => {
    const s = stages[i];
    stages[i] = {
      ...s,
      status,
      startedAt: s.startedAt && status === 'retry' ? s.startedAt : Date.now(),
      attempts: opts.bumpAttempts ? (s.attempts || 1) + 1 : s.attempts || 1,
      ...(opts.note !== undefined ? { note: opts.note } : {})
    };
  }, client);
}

/** Reset a span of stages to pending (revision/remake loops: generate..review). */
export async function resetStages(runId: string, fromKey: StageKey, toKey: StageKey, client?: PoolClient): Promise<void> {
  await mutateStages(runId, (stages) => {
    for (let i = stageIndex(fromKey); i <= stageIndex(toKey); i++) {
      stages[i] = { status: 'pending', attempts: 1, ms: 0, note: '' };
    }
  }, client);
}
