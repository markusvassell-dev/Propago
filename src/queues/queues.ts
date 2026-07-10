import { Queue, JobsOptions } from 'bullmq';
import { bullConnection } from '../redis/connection';
import { env } from '../config/env';

// BullMQ queue layer. One queue per external system so rate limits, retries
// and failure semantics are isolated per provider (CLAUDE.md rule 3).

export const QUEUE = {
  generation: 'content-pipeline', // research + generate + distgen (direct OpenAI — Replit offload retired)
  wordpress: 'wordpress-publisher',
  metaAds: 'meta-ads',
  activeCampaign: 'activecampaign',
  social: 'social-publish',
  karbonCallback: 'karbon-callback',
  scheduler: 'scheduler' // bi-weekly auto-runner repeatable job (spec §8.3)
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

// Worker-side rate limiters (applied in workers/index.ts):
//   meta-ads        → 10 requests / 10 s   (Meta Marketing API burst ceiling)
//   activecampaign  →  5 requests / 1 s    (AC hard limit — prevents HTTP 429)
export const RATE_LIMITS: Partial<Record<QueueName, { max: number; duration: number }>> = {
  [QUEUE.metaAds]: { max: 10, duration: 10_000 },
  [QUEUE.activeCampaign]: { max: 5, duration: 1_000 }
};

// Retry policy (original spec): 3 attempts, exponential 2s → 4s → 8s.
// After the final failure the worker's 'failed' handler transitions the saga
// to its terminal failure state and posts "Workflow Failed" to Karbon.
export const defaultJobOptions: JobsOptions = {
  attempts: env.workflow.maxJobAttempts,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1_000 } // kept for the audit-trail modal's job history
};

function mkQueue(name: QueueName): Queue {
  return new Queue(name, { connection: bullConnection, defaultJobOptions });
}

export const queues: Record<QueueName, Queue> = {
  [QUEUE.generation]: mkQueue(QUEUE.generation),
  [QUEUE.wordpress]: mkQueue(QUEUE.wordpress),
  [QUEUE.metaAds]: mkQueue(QUEUE.metaAds),
  [QUEUE.activeCampaign]: mkQueue(QUEUE.activeCampaign),
  [QUEUE.social]: mkQueue(QUEUE.social),
  [QUEUE.karbonCallback]: mkQueue(QUEUE.karbonCallback),
  [QUEUE.scheduler]: mkQueue(QUEUE.scheduler)
};

// ---- Bi-weekly auto-runner (spec §8.3 / §12): a BullMQ repeatable job. ----
const SCHED_JOB = 'auto-runner';
export const SCHED_EVERY_MS = 14 * 24 * 3600 * 1000; // every 2 weeks

export async function configureScheduler(enabled: boolean): Promise<void> {
  const q = queues[QUEUE.scheduler];
  const existing = await q.getRepeatableJobs();
  for (const j of existing) {
    if (j.name === SCHED_JOB) await q.removeRepeatableByKey(j.key);
  }
  if (enabled) {
    await q.add(SCHED_JOB, {}, { repeat: { every: SCHED_EVERY_MS } });
  }
}

/** Next firing timestamp of the auto-runner repeatable job (null when off). */
export async function schedulerNextRun(): Promise<number | null> {
  const q = queues[QUEUE.scheduler];
  const jobs = await q.getRepeatableJobs();
  const j = jobs.find((x) => x.name === SCHED_JOB);
  return j?.next ?? null;
}

/** Enqueue helper — every job carries runId + the acting user for audit stamping. */
export async function enqueue(
  name: QueueName,
  jobName: string,
  data: Record<string, unknown>,
  opts: JobsOptions = {}
): Promise<string> {
  const job = await queues[name].add(jobName, data, opts);
  return job.id as string;
}

export async function closeQueues(): Promise<void> {
  await Promise.all(Object.values(queues).map((q) => q.close()));
}
