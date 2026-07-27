// Shared vocabulary mirroring the backend mappers + DESIGN_SPEC §1.5/§1.6/§2.

export type UiStatus =
  | 'running'
  | 'review'
  | 'socialreview'
  | 'distreview'
  | 'failed'
  | 'complete'
  | 'rejected'
  | 'aborted';
export type StageStatus = 'pending' | 'active' | 'retry' | 'gate' | 'done' | 'failed' | 'partial' | 'skipped' | 'rejected';

export interface StageEntry {
  status: StageStatus;
  attempts: number;
  ms: number;
  note: string;
  err?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface Seo {
  total: number;
  kw: number;
  read: number;
  head: number;
  meta: number;
  sugs: string[];
}

export interface AdsPayload { headline: string; primary: string; link: string; }
export interface EmailPayload { subject: string; body: string; }
export interface SocialPayload { linkedin: string; facebook: string; instagram: string; }

export interface Run {
  id: string;
  wf: string;
  runNo: number;
  karbon: string;
  topic: string;
  client: string;
  tone: string;
  keywords: string[];
  painPoint: string | null;
  source: string | null;
  lev: number | null;
  status: UiStatus;
  dbStatus: string;
  seo: Seo | null;
  seoLoops: number;
  appliedSugs: string[];
  revisions: number;
  remakes: number;
  batchSeq: number;
  scheduled: boolean;
  stages: StageEntry[];
  artifacts: {
    blogUrl: string | null;
    magnetUrl: string | null;
    adId: string | null;
    campaignId: string | null;
    social: string | null;
    karbonNote: string | null;
  };
  error: unknown;
  approvedBy: string | null;
  rejectedBy: string | null;
  publishedBy: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  draft: {
    title: string;
    meta: string;
    magnet: string;
    words: number | null;
    magnetUrl: string | null;
    liveUrl: string | null;
    status: string;
    body?: string;
  } | null;
  dist: { ads: AdsPayload | null; email: EmailPayload | null; social: SocialPayload | null } | null;
  distOrig: { ads: AdsPayload | null; email: EmailPayload | null; social: SocialPayload | null } | null;
  distEdited: { ads: boolean; email: boolean; social: boolean };
  viewers?: string[];
}

export interface AuditRow { t: number; who: string; msg: string; }

// §2 — the fixed 17-stage pipeline. Three human gates, each releasing one
// batch: blog (①) → social (②) → ads + email (③). Must stay in the same order
// as STAGES in src/saga/stages.ts — stage_state is positional.
export const STAGES = [
  { key: 'trigger', label: 'Trigger', strip: 'TRG', sys: 'Karbon webhook', queue: 'content-pipeline' },
  { key: 'research', label: 'Research', strip: 'RES', sys: 'Web search + ChatGPT extract', queue: 'content-pipeline' },
  { key: 'draft', label: 'Generate', strip: 'GEN', sys: 'ChatGPT Business API · 90s', queue: 'content-pipeline' },
  { key: 'seo', label: 'SEO score', strip: 'SEO', sys: 'Internal scorer', queue: 'content-pipeline' },
  { key: 'deploy', label: 'WP draft', strip: 'DFT', sys: 'WordPress REST · status=draft', queue: 'wordpress' },
  { key: 'review', label: 'Review ①', strip: 'REV', sys: 'Human gate · blog post', queue: 'human-gate' },
  { key: 'golive', label: 'Publish live', strip: 'PUB', sys: 'WordPress REST · status=publish', queue: 'wordpress' },
  { key: 'socialgen', label: 'Social gen', strip: 'SGN', sys: 'OpenAI GPT-4o · 3 captions', queue: 'content-pipeline' },
  { key: 'socialreview', label: 'Review ②', strip: 'SRV', sys: 'Human gate · social', queue: 'human-gate' },
  { key: 'linkedin', label: 'LinkedIn', strip: 'LI', sys: 'LinkedIn UGC Posts API', queue: 'social' },
  { key: 'facebook', label: 'Facebook', strip: 'FB', sys: 'Meta Graph · page feed', queue: 'social' },
  { key: 'instagram', label: 'Instagram', strip: 'IG', sys: 'Meta Graph · media publish', queue: 'social' },
  { key: 'distgen', label: 'Ads/email gen', strip: 'DGN', sys: 'OpenAI GPT-4o', queue: 'content-pipeline' },
  { key: 'distreview', label: 'Review ③', strip: 'DRV', sys: 'Human gate · ads + email', queue: 'human-gate' },
  { key: 'ads', label: 'Ads', strip: 'ADS', sys: 'Meta Marketing API', queue: 'meta-ads · 10 req/10s' },
  { key: 'email', label: 'Email', strip: 'EML', sys: 'ActiveCampaign', queue: 'activecampaign · 5 req/s' },
  { key: 'callback', label: 'Callback', strip: 'CBK', sys: 'Karbon Timeline API', queue: 'karbon' }
] as const;

// §1.5 — run-level status vocabulary.
export const STATUS_META: Record<UiStatus, { label: string; c: string; bg: string }> = {
  running: { label: 'Running', c: 'var(--amb)', bg: 'rgba(180,83,9,.11)' },
  review: { label: 'Review ①', c: 'var(--vio)', bg: 'rgba(91,79,194,.11)' },
  socialreview: { label: 'Review ② social', c: 'var(--vio)', bg: 'rgba(91,79,194,.11)' },
  distreview: { label: 'Review ③ ads/email', c: 'var(--cyn)', bg: 'rgba(14,116,144,.11)' },
  failed: { label: 'Failed', c: 'var(--red)', bg: 'rgba(179,38,30,.09)' },
  complete: { label: 'Complete', c: 'var(--grn)', bg: 'rgba(19,122,91,.11)' },
  rejected: { label: 'Rejected', c: 'var(--tx3)', bg: 'rgba(130,130,140,.12)' },
  aborted: { label: 'Aborted', c: 'var(--tx3)', bg: 'rgba(130,130,140,.12)' }
};

// §1.6 — stage-status colors + badge tints + labels.
export const STAGE_COLOR: Record<StageStatus, string> = {
  done: 'var(--grn)',
  active: 'var(--ambH)',
  retry: 'var(--ambH)',
  gate: 'var(--vio)',
  pending: 'var(--seg)',
  failed: 'var(--red)',
  partial: 'var(--amb2)',
  skipped: 'var(--skip)',
  rejected: 'var(--tx3)'
};
export const STAGE_TINT: Record<StageStatus, string> = {
  done: 'rgba(19,122,91,.12)',
  active: 'rgba(217,119,6,.14)',
  retry: 'rgba(217,119,6,.14)',
  gate: 'rgba(91,79,194,.14)',
  pending: 'var(--bg5)',
  failed: 'rgba(179,38,30,.12)',
  partial: 'rgba(161,98,7,.14)',
  skipped: 'rgba(128,133,128,.14)',
  rejected: 'rgba(130,130,140,.16)'
};
export const STAGE_LABEL: Record<StageStatus, string> = {
  done: 'Done',
  active: 'Running',
  retry: 'Retrying',
  gate: 'In review',
  pending: 'Pending',
  failed: 'Failed',
  partial: 'Partial',
  skipped: 'Skipped',
  rejected: 'Rejected'
};

// §1.7 — named string constants (verbatim; do not "fix" spelling).
export const ACCT_STATUS = 'Ready for Accountant Revi';

// Sort order for the runs list — anything waiting on a human first, in gate
// order, so the oldest blocker is always at the top.
export const RUN_STATUS_ORDER: Record<UiStatus, number> = {
  review: 0,
  socialreview: 1,
  distreview: 2,
  running: 3,
  failed: 4,
  complete: 5,
  rejected: 6,
  aborted: 7
};
