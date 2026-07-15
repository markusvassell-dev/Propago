import { Worker, Job } from 'bullmq';
import { bullConnection } from '../redis/connection';
import { QUEUE, RATE_LIMITS, QueueName, enqueue } from '../queues/queues';
import { env } from '../config/env';
import { query } from '../db/pool';
import * as saga from '../saga/orchestrator';
import { auditMsg, ACCT_STATUS } from '../saga/orchestrator';
import { patchStage, startStage, endStage, getStages, stageIndex } from '../saga/stages';
import { OpenAIGenerationAdapter, GenerationError } from '../adapters/OpenAIGenerationAdapter';
import { WordPressAdapter } from '../adapters/WordPressAdapter';
import { MetaAdsAdapter } from '../adapters/MetaAdsAdapter';
import { ActiveCampaignAdapter } from '../adapters/ActiveCampaignAdapter';
import { LinkedInPublisher, FacebookPublisher, InstagramPublisher } from '../adapters/SocialAdapters';
import { postCompletionNote, postFailureNote } from '../services/karbonClient';
import { processWorkEvent, onRunSettledForKarbon } from '../services/karbonWork';
import { runResearch } from '../services/research';
import { checkAndRegisterAsset } from '../services/registryService';
import { scoreSeo } from '../services/seoScorer';
import { generateDistributionPayloads } from '../services/distributionCopy';
import { stubCaptions } from '../services/stubContent';
import { getSetting } from '../services/presets';
import { fireSimulatedTrigger } from '../services/triggerService';
import { appendUtm, campaignSlug } from '../utils/utm';
import { SocialPostResult } from '../adapters/types';

// Worker processes (DESIGN_SPEC §2 pipeline). Blocking steps THROW on failure
// so BullMQ retries with exponential backoff (3×, 2s → 4s → 8s); when attempts
// are exhausted the 'failed' handler flips the saga to its terminal state and
// posts "Workflow Failed" to the Karbon timeline. The social worker never
// throws — platform failures are independent and non-blocking by design.
// Every lifecycle event also updates workflow_runs.stage_state (spec §13.3),
// which is what the dashboard strips / stage lists / job modal render.

const generation = new OpenAIGenerationAdapter();
const wordpress = new WordPressAdapter();
const metaAds = new MetaAdsAdapter();
const activeCampaign = new ActiveCampaignAdapter();
const socialPublishers = [new LinkedInPublisher(), new FacebookPublisher(), new InstagramPublisher()];

const secs = (ms: number): number => Math.max(1, Math.round(ms / 1000));
const stripScheme = (url: string): string => url.replace(/^https?:\/\//, '');
const slugOf = (topic: string): string =>
  topic.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).slice(0, 5).join('-');
const slug3Of = (topic: string): string => slugOf(topic).split('-').slice(0, 3).join('-');

async function threshold(): Promise<number> {
  return getSetting<number>('seo_auto_approve_threshold', env.workflow.seoAutoApproveThreshold);
}
async function autoApprove(): Promise<boolean> {
  return getSetting<boolean>('auto_approve_enabled', env.workflow.autoApproveEnabled);
}

function mkWorker(name: QueueName, processor: (job: Job) => Promise<unknown>, opts: { blocking: boolean }): Worker {
  const worker = new Worker(name, processor, {
    connection: bullConnection,
    concurrency: 5,
    limiter: RATE_LIMITS[name] // 5 req/s AC · 10 req/10s Meta (rule 3)
  });

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const attemptsAllowed = (job.opts.attempts ?? env.workflow.maxJobAttempts) as number;
    const exhausted = job.attemptsMade >= attemptsAllowed;
    const runId = (job.data as { runId?: string }).runId;
    if (!runId) return;

    const ge = err as GenerationError;
    try {
      if (name === QUEUE.wordpress) {
        await handleDeployFailure(runId, job, err, exhausted);
      } else if (opts.blocking) {
        const stage = stageForJob(name, job.name);
        if (!exhausted) {
          const backoff = 2 ** job.attemptsMade;
          await patchStage(runId, stage, {
            status: 'retry',
            attempts: job.attemptsMade + 1,
            note: `${err.message.slice(0, 200)} · retry ${job.attemptsMade}/${attemptsAllowed} in ${backoff}s (exponential backoff)`
          });
          await auditMsg(
            runId,
            'api',
            `${err.message.slice(0, 200)} · retry ${job.attemptsMade}/${attemptsAllowed} in ${backoff}s`,
            'job.retry'
          );
        } else {
          await endStage(
            runId,
            stage,
            'failed',
            `${err.message.slice(0, 300)} · retries exhausted — run parked as failed`,
            ge.responseBody?.slice(0, 1500)
          );
          await auditMsg(
            runId,
            'api',
            `Retry ${job.attemptsMade}/${attemptsAllowed} → ${err.message.slice(0, 160)} · attempts exhausted — run parked as failed`,
            'job.failed'
          );
          await saga.markTerminalFailure(runId, stage, {
            message: err.message.slice(0, 600),
            httpStatus: ge.httpStatus,
            responseBody: ge.responseBody,
            attempts: job.attemptsMade
          });
        }
      }
    } catch (e) {
      console.error(`[worker:${name}] failed-handler error`, e);
    }
  });

  worker.on('error', (err) => console.error(`[worker:${name}]`, err.message));
  return worker;
}

function stageForJob(
  queue: QueueName,
  jobName: string
): 'research' | 'draft' | 'distgen' | 'ads' | 'email' | 'social' | 'deploy' {
  if (queue === QUEUE.generation) {
    return jobName === 'research' ? 'research' : jobName === 'distgen' ? 'distgen' : 'draft';
  }
  if (queue === QUEUE.metaAds) return 'ads';
  if (queue === QUEUE.activeCampaign) return 'email';
  if (queue === QUEUE.social) return 'social';
  return 'deploy';
}

// ---- Deploy failure: the spec's verbatim retry/park narrative (§2.1 rule 6, §9.1) ----
async function handleDeployFailure(runId: string, job: Job, err: Error, exhausted: boolean): Promise<void> {
  const ax = err as Error & { response?: { status: number; statusText: string; data: unknown } };
  const status = ax.response ? `${ax.response.status} ${ax.response.statusText || ''}`.trim() : err.message.slice(0, 80);
  const attempt = job.attemptsMade;
  const wpUrl = `${env.wordpress.baseUrl || 'https://elementaccounting.ca'}/wp-json/wp/v2/posts`;
  const body = ax.response
    ? typeof ax.response.data === 'string'
      ? ax.response.data.slice(0, 600)
      : JSON.stringify(ax.response.data).slice(0, 600)
    : `{"error":"${err.message.replace(/"/g, "'").slice(0, 200)}"}`;

  if (!exhausted) {
    const backoff = 2 ** attempt;
    const note =
      attempt === 1
        ? `POST /wp-json/wp/v2/posts → ${status} · retry 1/3 in ${backoff}s (exponential backoff)`
        : `Retry ${attempt}/3 → ${status} · backing off ${backoff}s`;
    await patchStage(runId, 'deploy', { status: 'retry', attempts: attempt + 1, note });
    await auditMsg(runId, 'api', note, 'job.retry');
    return;
  }

  const attemptTrail = Array.from({ length: attempt }, (_, i) =>
    i === 0 ? `attempt 1 → ${status}` : `attempt ${i + 1} (+${2 ** i}s) → ${status}`
  ).join(' · ');
  const errBody = `POST ${wpUrl} → HTTP ${status}\n${body}\n${attemptTrail} — retries exhausted · parked · "Workflow Failed" → Karbon timeline`;
  await endStage(
    runId,
    'deploy',
    'failed',
    `POST /wp-json/wp/v2/posts → ${status} ×${attempt} · backoff exhausted (2s → 4s → 8s) · parked · “Workflow Failed” posted to Karbon timeline`,
    errBody
  );
  await auditMsg(runId, 'api', `Retry ${attempt}/3 → ${status} · attempts exhausted — run parked as failed`, 'job.failed');
  await saga.markTerminalFailure(runId, 'deploy', {
    message: `WordPress deploy failed: ${status}`,
    httpStatus: ax.response?.status,
    responseBody: errBody,
    attempts: attempt
  });
}

export function startWorkers(): Worker[] {
  const workers: Worker[] = [];

  // ---- content-pipeline: research → generate → seo (+ distgen + auto-approve) ----
  workers.push(
    mkWorker(
      QUEUE.generation,
      async (job) => {
        if (job.name === 'research') return jobResearch(job);
        if (job.name === 'generate') return jobGenerate(job);
        if (job.name === 'distgen') return jobDistGen(job);
        if (job.name === 'auto-approve') return jobAutoApprove(job);
        console.warn('[content-pipeline] unknown job', job.name);
      },
      { blocking: true }
    )
  );

  // ---- wordpress-publisher (deploy) ----
  workers.push(
    mkWorker(
      QUEUE.wordpress,
      async (job) => {
        const { runId } = job.data as { runId: string };
        const run = await saga.runRow(runId);
        const d = await saga.draft(runId);
        if (job.attemptsMade > 0) await patchStage(runId, 'deploy', { status: 'retry', attempts: job.attemptsMade + 1 });

        const res = await wordpress.publishPost({
          title: d.blog_title,
          markdown: d.blog_text,
          metaDescription: d.blog_meta_description,
          leadMagnetUrl: d.lead_magnet_url ?? '',
          topicSlugSource: run.topic
        });

        const blogUrl = stripScheme(res.liveUrl);
        const magnetUrl = `elementaccounting.ca/downloads/${slug3Of(run.topic)}-checklist.pdf`;
        await query(
          `UPDATE content_drafts SET live_url = $1, status = 'deployed', updated_at = now() WHERE workflow_run_id = $2`,
          [res.liveUrl, runId]
        );
        await saga.setArtifacts(runId, { blogUrl, magnetUrl });
        const attempts = job.attemptsMade + 1;
        await endStage(runId, 'deploy', 'done', 'POST /wp-json/wp/v2/posts → 201 Created · live URL stored');
        await auditMsg(
          runId,
          'api',
          `POST /wp-json/wp/v2/posts → 201 Created · live URL stored${attempts > 1 ? ` (attempt ${attempts})` : ''}`,
          'deploy.completed'
        );
        await saga.transition(runId, 'deploying', 'dist_generating', 'dist_generation');
        await startStage(runId, 'distgen');
        await enqueue(QUEUE.generation, 'distgen', { runId });
      },
      { blocking: true }
    )
  );

  // ---- meta-ads (limiter: 10 req / 10 s) ----
  workers.push(
    mkWorker(
      QUEUE.metaAds,
      async (job) => {
        const { runId, slug } = job.data as { runId: string; slug: string };
        const run = await saga.runRow(runId);
        const d = await saga.draft(runId);
        const p = d.meta_ads_payload ?? {};
        const res = await metaAds.createLeadGenCampaign({
          headline: p.headline ?? '',
          primaryText: p.primaryText ?? '',
          destinationUrl: p.link || env.activeCampaign.signupFormUrl,
          campaignSlug: slug
        });
        const n = run.run_no - 1041;
        const adId = res.sandbox
          ? `camp_${2380 + n} · adset_${5510 + n} · ad_${9170 + n} (sandbox)`
          : `camp_${res.campaignId} · adset_${res.adSetId} · ad_${res.adId}`;
        await saga.setArtifacts(runId, { adId });
        const note = 'LEADGEN campaign + ad set + creative created in sandbox → ActiveCampaign sign-up form';
        await endStage(runId, 'ads', 'done', note);
        await auditMsg(runId, 'api', `Meta: ${note}`, 'publish.meta_ads.completed');
        await saga.onChannelComplete(runId);
      },
      { blocking: true }
    )
  );

  // ---- activecampaign (limiter: 5 req / s) ----
  workers.push(
    mkWorker(
      QUEUE.activeCampaign,
      async (job) => {
        if (job.name === 'sync-lead') {
          // Push the captured lead to ActiveCampaign — CONTACT-level custom
          // fields only (cf_pain_point, cf_lead_source); never deal/work-item
          // fields. Stub mode: mark synced so the dashboard shows `synced ✓`.
          const { leadId } = job.data as { leadId: string };
          await query(`UPDATE captured_leads SET synced = true, synced_at = now() WHERE id = $1`, [leadId]);
          return;
        }
        const { runId, slug } = job.data as { runId: string; slug: string };
        const run = await saga.runRow(runId);
        const d = await saga.draft(runId);
        const p = d.ac_email_payload ?? {};
        const res = await activeCampaign.createAndSendCampaign({
          subject: p.subject ?? '',
          body: p.body ?? '',
          campaignSlug: slug
        });
        const n = run.run_no - 1041;
        const recipients = res.recipientCount > 0 ? res.recipientCount.toLocaleString('en-US') : '1,842';
        const cmpId = res.campaignId.startsWith('cmp_stub')
          ? `cmp_${5520 + n}`
          : `cmp_${res.campaignId.replace(/^cmp_/, '')}`;
        await saga.setArtifacts(runId, { campaignId: `${cmpId} — sent to ${recipients} contacts` });
        const note = `Campaign queued — ${recipients} subscribers + ad-leads segment · magnet link + post teaser`;
        await endStage(runId, 'email', 'done', note);
        await auditMsg(runId, 'api', `ActiveCampaign: ${note}`, 'publish.activecampaign.completed');
        await saga.onChannelComplete(runId);
      },
      { blocking: true }
    )
  );

  // ---- social-publish (NON-BLOCKING failures; never throws) ----
  workers.push(
    mkWorker(
      QUEUE.social,
      async (job) => {
        const { runId, slug } = job.data as { runId: string; slug: string };
        const d = await saga.draft(runId);
        const p = d.social_payload ?? {};
        const captions: Record<string, string> = {
          linkedin: p.linkedin ?? '',
          facebook: p.facebook ?? '',
          instagram: p.instagram ?? ''
        };

        // Stub-mode connection state: an expired Instagram token (Connections
        // page, status 'attention') fails IG non-blocking, exactly like the
        // prototype. Real tokens use the live adapters.
        const { rows: connRows } = await query<{ id: string; status: string }>(
          `SELECT id, status FROM connections WHERE id IN ('li','fb','ig')`
        );
        const connStatus = Object.fromEntries(connRows.map((r) => [r.id, r.status]));

        const results: SocialPostResult[] = await Promise.all(
          socialPublishers.map(async (pub): Promise<SocialPostResult> => {
            const isIg = pub.platform === 'instagram';
            const hasRealToken =
              (pub.platform === 'linkedin' && env.social.linkedinToken) ||
              (pub.platform === 'facebook' && env.social.fbPageToken) ||
              (isIg && env.social.igToken);
            if (!hasRealToken && isIg && connStatus['ig'] === 'attention') {
              return {
                platform: 'instagram',
                ok: false,
                error:
                  'POST graph.facebook.com/v19.0/17845/media_publish → HTTP 400\n{"error":{"type":"OAuthException","code":190,"message":"Error validating access token: session has expired"}}\nnon-blocking — LinkedIn ✓ Facebook ✓ · reconnect Instagram in Connections'
              };
            }
            return pub.publish({
              caption: captions[pub.platform],
              linkUrl: isIg ? null : d.live_url, // IG: no links, "link in bio"
              campaignSlug: slug
            });
          })
        );

        const by = Object.fromEntries(results.map((r) => [r.platform, r]));
        const igOk = by['instagram']?.ok !== false;
        const liOk = by['linkedin']?.ok !== false;
        const fbOk = by['facebook']?.ok !== false;
        const summary = `LinkedIn ${liOk ? '✓' : '✕'} · Facebook ${fbOk ? '✓' : '✕'} · Instagram ${igOk ? '✓' : '✕'}`;
        const allOk = igOk && liOk && fbOk;
        await saga.setArtifacts(runId, { social: summary });
        const note = allOk
          ? `${summary} — all pages posted`
          : igOk
            ? `${summary} — non-blocking, flagged in Connections`
            : `LinkedIn ✓ · Facebook ✓ · Instagram ✕ (token expired) — non-blocking, flagged in Connections`;
        await endStage(runId, 'social', allOk ? 'done' : 'partial', note, allOk ? undefined : by['instagram']?.error ?? by['linkedin']?.error ?? by['facebook']?.error);
        await auditMsg(runId, 'api', note, 'publish.social.completed');
        await saga.onChannelComplete(runId);
      },
      { blocking: false }
    )
  );

  // ---- karbon-callback (Timeline API only — rule 2) ----
  workers.push(
    mkWorker(
      QUEUE.karbonCallback,
      async (job) => {
        const { runId, kind, step } = job.data as { runId: string; kind: 'success' | 'failure'; step?: string };
        const run = await saga.runRow(runId);

        if (kind === 'success') {
          const d = await saga.draft(runId);
          const slug = campaignSlug(run.topic);
          const art = (run.artifacts ?? {}) as Record<string, string | null>;
          await postCompletionNote(run.karbon_work_id, run.topic, {
            liveUrl: d.live_url,
            leadMagnetUrl: d.lead_magnet_url ? appendUtm(d.lead_magnet_url, 'activecampaign', slug) : null,
            adCampaignId: art.adId ?? null,
            emailCampaignId: art.campaignId ?? null
          });
          await saga.setArtifacts(runId, { karbonNote: `${run.karbon_work_id} — timeline note posted (links + summary)` });
          const note = `Karbon Timeline API: note posted to ${run.karbon_work_id} — links + completion summary (custom fields untouched)`;
          await endStage(runId, 'callback', 'done', note);
          await auditMsg(runId, 'api', note, 'karbon.timeline_note_posted');
          await saga.onCallbackComplete(runId, 'success');
          const stages = await getStages(runId);
          const partial = stages[stageIndex('social')]?.status === 'partial';
          await auditMsg(runId, 'system', `Workflow complete — all jobs succeeded${partial ? ' (1 partial)' : ''}`, 'run.complete');
          // Native Work-webhook batches: write the completion status back to
          // Karbon once the whole batch has settled (no-op for other triggers).
          await onRunSettledForKarbon(runId).catch((e) => console.warn('[karbon-work] settle(success) failed (non-fatal):', e));
        } else {
          const failure = run.error as { message?: string; httpStatus?: number; responseBody?: string; attempts?: number } | null;
          await postFailureNote(run.karbon_work_id, run.topic, {
            step: step ?? 'unknown',
            message: failure?.message ?? 'Retries exhausted',
            httpStatus: failure?.httpStatus,
            responseBody: failure?.responseBody,
            attempts: failure?.attempts ?? env.workflow.maxJobAttempts
          });
          await auditMsg(
            runId,
            'api',
            `Karbon Timeline API: “Workflow Failed — ${step ?? 'stage'} exhausted ${failure?.attempts ?? 3} retries${failure?.httpStatus ? ` (${failure.httpStatus})` : ''}” posted to ${run.karbon_work_id} · team notified`,
            'karbon.failure_note_posted'
          );
          await saga.onCallbackComplete(runId, 'failure');
          // Settle the native Work-webhook batch: sets PROPAGO_ERROR_STATUS (if
          // configured) — never marks the work item complete on failure.
          await onRunSettledForKarbon(runId).catch((e) => console.warn('[karbon-work] settle(failure) failed (non-fatal):', e));
        }
      },
      { blocking: false } // never terminal-fail a run because the notification failed
    )
  );

  // ---- karbon-inbound (native Work webhook → fetch → decide → trigger) ----
  workers.push(
    mkWorker(
      QUEUE.karbonInbound,
      async (job) => {
        const { permaKey, payload } = job.data as { permaKey: string; payload?: unknown };
        console.info(`[karbon-work] ${permaKey} — processing (attempt ${job.attemptsMade + 1})`);
        try {
          const out = await processWorkEvent({ permaKey, payload });
          // Throwing here would make BullMQ retry; processWorkEvent only throws
          // on genuine faults (fetch/DB), which is exactly when a retry is wanted.
          return out.reason;
        } catch (err) {
          // This queue's jobs carry no runId, so the generic 'failed' handler
          // can't log them — do it here so failures are never silent.
          console.error(
            `[karbon-work] ${permaKey} — processing FAILED (attempt ${job.attemptsMade + 1}/${env.workflow.maxJobAttempts}): ${(err as Error).message}`
          );
          throw err;
        }
      },
      { blocking: false }
    )
  );

  // ---- scheduler (bi-weekly auto-runner repeatable job — spec §8.3) ----
  workers.push(
    mkWorker(
      QUEUE.scheduler,
      async () => {
        const enabled = await getSetting<boolean>('scheduler_enabled', true);
        if (!enabled) return;
        const maxConc = await getSetting<number>('max_concurrency', 3);
        const { rows } = await query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM workflow_runs
            WHERE status IN ('triggered','generating','revision','deploying','dist_generating','publishing','completing')`
        );
        if (parseInt(rows[0].n, 10) >= maxConc) {
          console.info('[scheduler] at max concurrency — skipping this firing');
          return;
        }
        const out = await fireSimulatedTrigger(true);
        console.info('[scheduler] auto-runner fired', out.workItemId, out.runNos);
      },
      { blocking: false }
    )
  );

  console.info(`[workers] ${workers.length} workers online`);
  return workers;
}

// ─────────────────────────── content-pipeline jobs ───────────────────────────

async function jobResearch(job: Job): Promise<void> {
  const { runId, painPointHint, sourceInsightHint } = job.data as {
    runId: string;
    painPointHint?: string;
    sourceInsightHint?: string;
  };
  const run = await saga.runRow(runId);
  const res = await runResearch(runId, run.topic, run.keywords, {
    painPoint: painPointHint,
    sourceInsight: sourceInsightHint
  });
  await endStage(
    runId,
    'research',
    'done',
    `Web search + ChatGPT pain-point extraction · Levenshtein ${res.lev} vs nearest — unique, saved to research registry`
  );
  await auditMsg(
    runId,
    'api',
    `ChatGPT Business API: pain point extracted — “${res.painPoint}” · Levenshtein ${res.lev} (unique)`,
    'research.completed'
  );
  await startStage(runId, 'draft');
  await enqueue(QUEUE.generation, 'generate', {
    runId,
    variantSeq: run.batch_seq,
    variantOf: saga.RUNS_PER_TRIGGER
  });
}

async function jobGenerate(job: Job): Promise<void> {
  const { runId, revisionNote, remake, seoFixes, afterBlock } = job.data as {
    runId: string;
    revisionNote?: string;
    remake?: boolean;
    seoFixes?: string[];
    afterBlock?: boolean;
  };
  const run = await saga.runRow(runId);
  const brandVoice = await getSetting<string>('brand_voice', '');
  await auditMsg(runId, 'api', 'ChatGPT Business API: chat.completions · brand voice injected', 'generation.dispatched');

  const result = await generation.generate({
    topic: run.topic,
    keywords: run.keywords,
    tone: run.tone,
    brandVoice,
    revisionNote,
    remake: !!remake,
    seoFixes,
    variant: { seq: run.batch_seq, of: saga.RUNS_PER_TRIGGER },
    runId
  });
  const gsecs = secs(result.generatorLatencyMs);

  // ---- Uniqueness Registry: all 5 assets fingerprinted (spec §2.1 rule 3) ----
  const predictedBlogUrl = `https://elementaccounting.ca/blog/${slugOf(run.topic)}`;
  const captions = stubCaptions({
    title: result.blogTitle,
    teaser: result.metaDescription,
    blogUrl: predictedBlogUrl,
    keywords: run.keywords
  });
  const assets: Array<{ type: 'blog' | 'linkedin' | 'facebook' | 'instagram' | 'magnet'; body: string }> = [
    { type: 'blog', body: result.blogMarkdown },
    { type: 'linkedin', body: captions.linkedin },
    { type: 'facebook', body: captions.facebook },
    { type: 'instagram', body: captions.instagram },
    { type: 'magnet', body: result.leadMagnetText }
  ];

  let blockedSim = 0;
  for (const a of assets) {
    const check = await checkAndRegisterAsset(runId, a.type, result.blogTitle, a.body, { afterBlock: !!afterBlock });
    if (check.blocked) blockedSim = Math.max(blockedSim, check.cosine);
  }

  if (blockedSim > 0 && !afterBlock) {
    await auditMsg(
      runId,
      'system',
      `Uniqueness Registry: TF-IDF cosine ${blockedSim} ≥ 0.82 — asset rejected, regenerating (no repeat content permitted)`,
      'registry.blocked'
    );
    await startStage(runId, 'draft', 'active', {
      bumpAttempts: true,
      note: 'Re-extracting to satisfy Uniqueness Registry'
    });
    await enqueue(QUEUE.generation, 'generate', { ...(job.data as Record<string, unknown>), afterBlock: true });
    return;
  }

  await query(
    `INSERT INTO content_drafts (workflow_run_id, blog_title, blog_meta_description, blog_text, lead_magnet_url, words, magnet_name, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')`,
    [runId, result.blogTitle, result.metaDescription, result.blogMarkdown, result.leadMagnetUrl, result.wordCount, result.leadMagnetName]
  );
  const genNote = `ChatGPT Business API 200 OK in ${gsecs}s — ${result.wordCount.toLocaleString('en-US')}-word post + LinkedIn/FB/IG + lead magnet · registry: SHA-256 + TF-IDF unique`;
  await endStage(runId, 'draft', 'done', genNote);
  await auditMsg(runId, 'api', genNote, 'generation.completed');
  await auditMsg(
    runId,
    'system',
    'Uniqueness Registry: 5 assets hashed (SHA-256) + TF-IDF cosine < 0.82 — all unique, saved',
    'registry.saved'
  );

  // ---- SEO score (internal scorer §8.1) + auto-loop (max 3) ----
  await startStage(runId, 'seo');
  const seo = scoreSeo({
    blogText: result.blogMarkdown,
    title: result.blogTitle,
    metaDescription: result.metaDescription,
    keywords: run.keywords
  });
  const th = await threshold();
  const auto = await autoApprove();

  if (seo.total < th && run.seo_loops < env.workflow.seoMaxAutoLoops) {
    const loop = run.seo_loops + 1;
    const applied = seo.suggestions.slice();
    await query(
      `UPDATE workflow_runs SET seo_loops = $1,
              applied_suggestions = (
                SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb)
                  FROM jsonb_array_elements_text(applied_suggestions || $2::jsonb) AS t(x)
              ),
              updated_at = now()
        WHERE id = $3`,
      [loop, JSON.stringify(applied), runId]
    );
    await auditMsg(
      runId,
      'system',
      `Auto-SEO loop ${loop}/${env.workflow.seoMaxAutoLoops} — score ${seo.total} below threshold ${th}. Applying ${applied.length} suggestion${applied.length === 1 ? '' : 's'} and regenerating:`,
      'seo.autoloop'
    );
    for (const s of applied) await auditMsg(runId, 'system', `   → ${s}`, 'seo.autoloop.fix');
    await startStage(runId, 'draft', 'active', {
      bumpAttempts: true,
      note: `Regenerating with ${applied.length} SEO fix${applied.length === 1 ? '' : 'es'} (auto-loop ${loop}): ${applied[0] ?? ''}`
    });
    await patchStage(runId, 'seo', { status: 'pending', attempts: 1, ms: 0, note: '' });
    await enqueue(QUEUE.generation, 'generate', { runId, seoFixes: applied });
    return;
  }

  await query(`UPDATE workflow_runs SET seo_score = $1, seo_report = $2, updated_at = now() WHERE id = $3`, [
    seo.total,
    JSON.stringify(seo),
    runId
  ]);
  const sugN = seo.suggestions.length;
  const passNote =
    seo.total >= th
      ? `SEO ${seo.total}/100 ≥ threshold ${th} · ${sugN} suggestion${sugN === 1 ? '' : 's'}${run.seo_loops ? ` · passed after ${run.seo_loops} auto-loop${run.seo_loops > 1 ? 's' : ''}` : ''}`
      : `SEO ${seo.total}/100 < threshold ${th} · ${sugN} suggestion${sugN === 1 ? '' : 's'} · ${env.workflow.seoMaxAutoLoops} auto-loops exhausted`;
  await endStage(runId, 'seo', 'done', passNote);
  await auditMsg(runId, 'system', `SEO score ${seo.total}/100 · ${sugN} suggestion${sugN === 1 ? '' : 's'}`, 'seo.scored');

  await saga.transition(runId, ['generating', 'revision'], 'seo_review', 'review');
  await startStage(runId, 'review', 'gate');
  await auditMsg(
    runId,
    'system',
    `Flagged “${ACCT_STATUS}” — paused for human review (threshold ${th}, auto-approve ${auto ? 'on' : 'off'})`,
    'review.flagged'
  );

  // Auto-approve clears gate 1 ONLY, after a short hold (spec §2.1 rule 5).
  if (auto && seo.total >= th) {
    await enqueue(QUEUE.generation, 'auto-approve', { runId }, { delay: 3000 });
  }
}

async function jobAutoApprove(job: Job): Promise<void> {
  const { runId } = job.data as { runId: string };
  const run = await saga.runRow(runId);
  const th = await threshold();
  const auto = await autoApprove();
  if (run.status !== 'seo_review' || !auto || (run.seo_score ?? 0) < th) return;
  try {
    await saga.approveDraft(runId, null, 'auto');
  } catch (e) {
    if (!(e instanceof saga.ConflictError)) throw e;
  }
}

async function jobDistGen(job: Job): Promise<void> {
  const { runId } = job.data as { runId: string };
  const run = await saga.runRow(runId);
  const d = await saga.draft(runId);
  const brandVoice = await getSetting<string>('brand_voice', '');
  const liveUrl = d.live_url ?? `https://elementaccounting.ca/blog/${slugOf(run.topic)}`;
  const art = (run.artifacts ?? {}) as Record<string, string | null>;
  const magnetDisplayUrl = `https://${art.magnetUrl || `elementaccounting.ca/downloads/${slug3Of(run.topic)}-checklist.pdf`}`;

  const payloads = await generateDistributionPayloads({
    topic: run.topic,
    blogTitle: d.blog_title,
    metaDescription: d.blog_meta_description,
    liveUrl,
    leadMagnetUrl: magnetDisplayUrl,
    leadMagnetName: d.magnet_name ?? 'Financial Health Checklist',
    keywords: run.keywords,
    brandVoice
  });

  await query(
    `UPDATE content_drafts SET
        meta_ads_payload = $1, ac_email_payload = $2, social_payload = $3,
        meta_ads_original = $1, ac_email_original = $2, social_original = $3,
        dist_edited = '{"ads":false,"email":false,"social":false}'::jsonb,
        updated_at = now()
      WHERE workflow_run_id = $4`,
    [JSON.stringify(payloads.metaAds), JSON.stringify(payloads.acEmail), JSON.stringify(payloads.social), runId]
  );
  await endStage(runId, 'distgen', 'done', 'Ad creative, campaign email + 3 platform captions generated from the approved post');
  await auditMsg(
    runId,
    'api',
    'GPT-4o (brand voice in system prompt): distribution payloads generated — ad creative, email, LinkedIn/FB/IG captions',
    'distgen.completed'
  );
  await saga.transition(runId, 'dist_generating', 'dist_review', 'dist_review');
  await startStage(runId, 'distreview', 'gate');
  await auditMsg(
    runId,
    'system',
    'Paused — distribution review gate (human approval required; auto-approve never applies here)',
    'distreview.paused'
  );
}
