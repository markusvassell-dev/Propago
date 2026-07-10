// Shared vocabulary mirroring the backend mappers + DESIGN_SPEC §1.5/§1.6/§2.

export type UiStatus = 'running' | 'review' | 'distreview' | 'failed' | 'complete' | 'rejected';
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

// §2 — the fixed 12-stage pipeline.
export const STAGES = [
  { key: 'trigger', label: 'Trigger', strip: 'TRG', sys: 'Karbon webhook', queue: 'content-pipeline' },
  { key: 'research', label: 'Research', strip: 'RES', sys: 'Web search + ChatGPT extract', queue: 'content-pipeline' },
  { key: 'draft', label: 'Generate', strip: 'GEN', sys: 'ChatGPT Business API · 90s', queue: 'content-pipeline' },
  { key: 'seo', label: 'SEO score', strip: 'SEO', sys: 'Internal scorer', queue: 'content-pipeline' },
  { key: 'review', label: 'Review', strip: 'REV', sys: 'Human gate', queue: 'human-gate' },
  { key: 'deploy', label: 'Deploy', strip: 'DEP', sys: 'WordPress REST', queue: 'wordpress' },
  { key: 'distgen', label: 'Dist. gen', strip: 'GEN', sys: 'OpenAI GPT-4o', queue: 'content-pipeline' },
  { key: 'distreview', label: 'Dist. review', strip: 'DRV', sys: 'Human gate', queue: 'human-gate' },
  { key: 'ads', label: 'Ads', strip: 'ADS', sys: 'Meta Marketing API', queue: 'meta-ads · 10 req/10s' },
  { key: 'email', label: 'Email', strip: 'EML', sys: 'ActiveCampaign', queue: 'activecampaign · 5 req/s' },
  { key: 'social', label: 'Social', strip: 'SOC', sys: 'LinkedIn · FB · IG', queue: 'social' },
  { key: 'callback', label: 'Callback', strip: 'CBK', sys: 'Karbon Timeline API', queue: 'karbon' }
] as const;

// §1.5 — run-level status vocabulary.
export const STATUS_META: Record<UiStatus, { label: string; c: string; bg: string }> = {
  running: { label: 'Running', c: 'var(--amb)', bg: 'rgba(180,83,9,.11)' },
  review: { label: 'In review', c: 'var(--vio)', bg: 'rgba(91,79,194,.11)' },
  distreview: { label: 'Dist. review', c: 'var(--cyn)', bg: 'rgba(14,116,144,.11)' },
  failed: { label: 'Failed', c: 'var(--red)', bg: 'rgba(179,38,30,.09)' },
  complete: { label: 'Complete', c: 'var(--grn)', bg: 'rgba(19,122,91,.11)' },
  rejected: { label: 'Rejected', c: 'var(--tx3)', bg: 'rgba(130,130,140,.12)' }
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

export const RUN_STATUS_ORDER: Record<UiStatus, number> = {
  review: 0,
  distreview: 1,
  running: 2,
  failed: 3,
  complete: 4,
  rejected: 5
};
