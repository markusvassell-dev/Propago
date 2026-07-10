import { StageEntry, mkStages, STAGES } from '../saga/stages';

// Row → API payload shaping (spec §13.7): everything §5–§6 render, in the
// vocabulary the dashboard uses (ui status, WF-/KB- ids, seo {kw,read,head,meta}).

export type UiStatus = 'running' | 'review' | 'distreview' | 'failed' | 'complete' | 'rejected';

export function uiStatus(dbStatus: string): UiStatus {
  switch (dbStatus) {
    case 'seo_review':
      return 'review';
    case 'dist_review':
      return 'distreview';
    case 'complete':
      return 'complete';
    case 'failed':
      return 'failed';
    case 'rejected':
      return 'rejected';
    default:
      return 'running'; // triggered · generating · revision · deploying · dist_generating · publishing · completing
  }
}

interface SeoReportRow {
  total: number;
  breakdown?: { keywordDensity: number; readability: number; headingStructure: number; metaTags: number };
  suggestions?: string[];
  // demo-seed rows may already be stored in UI shape:
  kw?: number;
  read?: number;
  head?: number;
  meta?: number;
  sugs?: string[];
}

export function mapSeo(report: SeoReportRow | null): {
  total: number;
  kw: number;
  read: number;
  head: number;
  meta: number;
  sugs: string[];
} | null {
  if (!report) return null;
  return {
    total: report.total,
    kw: report.kw ?? report.breakdown?.keywordDensity ?? 0,
    read: report.read ?? report.breakdown?.readability ?? 0,
    head: report.head ?? report.breakdown?.headingStructure ?? 0,
    meta: report.meta ?? report.breakdown?.metaTags ?? 0,
    sugs: report.sugs ?? report.suggestions ?? []
  };
}

const epoch = (v: string | Date | null): number | null => (v ? new Date(v).getTime() : null);

/** UI dist payload names: ads.primary (not primaryText). */
const mapAds = (p: Record<string, string> | null) =>
  p ? { headline: p.headline ?? '', primary: p.primary ?? p.primaryText ?? '', link: p.link ?? '' } : null;

export interface RunApiRow {
  id: string;
  run_no: number;
  karbon_work_id: string;
  client_name: string;
  topic: string;
  keywords: string[];
  tone: string;
  status: string;
  pain_point: string | null;
  source_insight: string | null;
  levenshtein: string | null;
  seo_score: number | null;
  seo_report: SeoReportRow | null;
  seo_loops: number;
  applied_suggestions: string[] | null;
  revision_count: number;
  remake_count: number;
  batch_seq: number;
  stage_state: StageEntry[] | null;
  artifacts: Record<string, string | null> | null;
  scheduled: boolean;
  error: unknown;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  approved_handle?: string | null;
  rejected_handle?: string | null;
  published_handle?: string | null;
  // joined latest draft:
  blog_title?: string | null;
  blog_meta_description?: string | null;
  blog_text?: string | null;
  words?: number | null;
  magnet_name?: string | null;
  lead_magnet_url?: string | null;
  live_url?: string | null;
  meta_ads_payload?: Record<string, string> | null;
  ac_email_payload?: Record<string, string> | null;
  social_payload?: Record<string, string> | null;
  meta_ads_original?: Record<string, string> | null;
  ac_email_original?: Record<string, string> | null;
  social_original?: Record<string, string> | null;
  dist_edited?: Record<string, boolean> | null;
  draft_status?: string | null;
}

export function mapRun(r: RunApiRow, opts: { includeBody?: boolean } = {}): Record<string, unknown> {
  const stages =
    Array.isArray(r.stage_state) && r.stage_state.length === STAGES.length ? r.stage_state : mkStages();
  return {
    id: r.id,
    wf: `WF-${r.run_no}`,
    runNo: r.run_no,
    karbon: r.karbon_work_id,
    topic: r.topic,
    client: r.client_name,
    tone: r.tone,
    keywords: r.keywords,
    painPoint: r.pain_point,
    source: r.source_insight,
    lev: r.levenshtein != null ? Number(r.levenshtein) : null,
    status: uiStatus(r.status),
    dbStatus: r.status,
    seo: mapSeo(r.seo_report),
    seoLoops: r.seo_loops ?? 0,
    appliedSugs: r.applied_suggestions ?? [],
    revisions: r.revision_count ?? 0,
    remakes: r.remake_count ?? 0,
    batchSeq: r.batch_seq,
    scheduled: r.scheduled,
    stages,
    artifacts: {
      blogUrl: r.artifacts?.blogUrl ?? null,
      magnetUrl: r.artifacts?.magnetUrl ?? null,
      adId: r.artifacts?.adId ?? null,
      campaignId: r.artifacts?.campaignId ?? null,
      social: r.artifacts?.social ?? null,
      karbonNote: r.artifacts?.karbonNote ?? null
    },
    error: r.error ?? null,
    approvedBy: r.approved_handle ?? null,
    rejectedBy: r.rejected_handle ?? null,
    publishedBy: r.published_handle ?? null,
    createdAt: epoch(r.created_at),
    updatedAt: epoch(r.updated_at),
    completedAt: epoch(r.completed_at),
    draft: r.blog_title
      ? {
          title: r.blog_title,
          meta: r.blog_meta_description ?? '',
          magnet: r.magnet_name ?? '',
          words: r.words ?? null,
          magnetUrl: r.lead_magnet_url ?? null,
          liveUrl: r.live_url ?? null,
          status: r.draft_status ?? 'draft',
          ...(opts.includeBody ? { body: r.blog_text ?? '' } : {})
        }
      : null,
    dist: r.meta_ads_payload
      ? {
          ads: mapAds(r.meta_ads_payload ?? null),
          email: r.ac_email_payload ?? null,
          social: r.social_payload ?? null
        }
      : null,
    distOrig: r.meta_ads_original
      ? {
          ads: mapAds(r.meta_ads_original ?? null),
          email: r.ac_email_original ?? null,
          social: r.social_original ?? null
        }
      : null,
    distEdited: r.dist_edited ?? { ads: false, email: false, social: false }
  };
}

/** The list/detail SELECT with the latest draft + actor handles joined in. */
export const RUN_SELECT = `
  SELECT r.*,
         lower(left(ua.first_name,1) || '.' || ua.last_name) AS approved_handle,
         lower(left(ur.first_name,1) || '.' || ur.last_name) AS rejected_handle,
         lower(left(up.first_name,1) || '.' || up.last_name) AS published_handle,
         d.blog_title, d.blog_meta_description, d.blog_text, d.words, d.magnet_name,
         d.lead_magnet_url, d.live_url,
         d.meta_ads_payload, d.ac_email_payload, d.social_payload,
         d.meta_ads_original, d.ac_email_original, d.social_original,
         d.dist_edited, d.status AS draft_status
    FROM workflow_runs r
    LEFT JOIN users ua ON ua.id = r.approved_by
    LEFT JOIN users ur ON ur.id = r.rejected_by
    LEFT JOIN users up ON up.id = r.published_by
    LEFT JOIN LATERAL (
      SELECT * FROM content_drafts cd WHERE cd.workflow_run_id = r.id ORDER BY cd.created_at DESC LIMIT 1
    ) d ON true`;
