import 'dotenv/config';
import { clampInt } from '../utils/num';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  return v ? parseInt(v, 10) : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  return v === undefined ? fallback : v === 'true' || v === '1';
}

const port = int('PORT', 3000);

// Public base URL for links this app mints itself (lead-magnet PDFs).
// Railway injects RAILWAY_PUBLIC_DOMAIN (bare domain, no scheme) on any
// service with a public domain; APP_PUBLIC_URL overrides it (custom domain).
const publicBaseUrl = (
  process.env.APP_PUBLIC_URL ??
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`)
).replace(/\/+$/, '');

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',

  // Railway assigns PORT dynamically. NEVER hardcode a port or bind localhost —
  // the health check hits 0.0.0.0:$PORT and a hardcoded localhost:3000 fails it.
  port,
  host: '0.0.0.0',
  publicBaseUrl,

  databaseUrl: required('DATABASE_URL'),
  databaseSsl: bool('DATABASE_SSL', false),
  redisUrl: required('REDIS_URL'),

  jwtSecret: required('JWT_SECRET'),
  sessionTtlHours: int('SESSION_TTL_HOURS', 72),
  masterEncryptionKey: required('MASTER_ENCRYPTION_KEY'),

  karbon: {
    webhookSecret: required('KARBON_WEBHOOK_SECRET'),
    apiBase: process.env.KARBON_API_BASE ?? 'https://api.karbonhq.com/v3',
    // KARBON_AUTH_TOKEN is the name in Karbon's own docs; KARBON_BEARER_TOKEN is
    // the historical name here — accept either so existing deploys keep working.
    bearerToken: process.env.KARBON_AUTH_TOKEN ?? process.env.KARBON_BEARER_TOKEN ?? '',
    accessKey: process.env.KARBON_ACCESS_KEY ?? '',
    // Native Work-webhook signing key (Karbon signs the raw body HMAC-SHA256).
    // Empty ⇒ signature verification is skipped (dev / before you set it up).
    webhookSigningKey: process.env.KARBON_WEBHOOK_SIGNING_KEY ?? '',
    // Work Item status that ARMS a Propago run, and the status set when Propago
    // finishes. The handler only triggers on the activation status — never on
    // the completion/error status — so the completion update can't loop.
    triggerStatus: process.env.PROPAGO_TRIGGER_STATUS ?? 'Ready for Propago',
    completeStatus: process.env.PROPAGO_COMPLETE_STATUS ?? 'Propago Complete',
    // Optional: status set when every run in the batch failed (blank ⇒ leave the
    // work item as-is and rely on the Timeline failure note).
    errorStatus: process.env.PROPAGO_ERROR_STATUS ?? ''
  },

  // Web search / news for the research stage (SerpAPI). Optional: with no key
  // (or a placeholder) the research stage falls back to today's GPT-only
  // behaviour — see `serpapiStub` below. `engine` picks the SerpAPI engine:
  // 'google' (evergreen web results) or 'google_news' (timely/news results).
  serpapi: {
    apiKey: process.env.SERPAPI_KEY ?? '',
    engine: process.env.SERPAPI_ENGINE ?? 'google',
    resultCount: int('SERPAPI_RESULTS', 5),
    timeoutMs: int('SERPAPI_TIMEOUT_MS', 12_000)
  },
  // No real SerpAPI key configured ⇒ skip the live search and let the research
  // stage run GPT-only (mirrors `openaiStub`). A real key switches it on.
  serpapiStub:
    !(process.env.SERPAPI_KEY ?? '').trim() ||
    /set-me|change-?me|placeholder|xxxx/i.test(process.env.SERPAPI_KEY ?? ''),

  // Content generation — direct OpenAI (ChatGPT API). The Replit offload is
  // retired (CLAUDE.md rule 6): REPLIT_GENERATOR_APP_URL / REPLIT_SERVICE_SECRET
  // are gone and OPENAI_API_KEY is now required (blog generation + GPT-4o
  // distribution copy both use it).
  openaiApiKey: required('OPENAI_API_KEY'),
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o',
  generationTimeoutMs: int('GENERATION_TIMEOUT_MS', 120_000),
  // Structural stub mode: OPENAI_API_KEY is still required (fail-fast on a
  // missing var), but an obvious placeholder (docker-compose local dev / CI)
  // switches the OpenAI adapters to deterministic stub output so the whole
  // saga is exercisable end-to-end without spending tokens. A real key is
  // always used for real calls.
  openaiStub:
    /set-me|change-?me|placeholder|xxxx/i.test(process.env.OPENAI_API_KEY ?? '') ||
    (process.env.OPENAI_API_KEY ?? '').length < 24,

  wordpress: {
    baseUrl: process.env.WORDPRESS_BASE_URL ?? '',
    username: process.env.WORDPRESS_USERNAME ?? '',
    appPassword: process.env.WORDPRESS_APP_PASSWORD ?? ''
  },

  meta: {
    accessToken: process.env.META_ACCESS_TOKEN ?? '',
    adAccountId: process.env.META_AD_ACCOUNT_ID ?? '',
    pageId: process.env.META_PAGE_ID ?? '',
    sandbox: bool('META_SANDBOX_MODE', true)
  },

  activeCampaign: {
    apiUrl: process.env.AC_API_URL ?? '',
    apiKey: process.env.AC_API_KEY ?? '',
    listId: process.env.AC_LIST_ID ?? '1',
    signupFormUrl: process.env.AC_SIGNUP_FORM_URL ?? '',
    fromEmail: process.env.AC_FROM_EMAIL ?? 'team@elementaccounting.ca',
    fromName: process.env.AC_FROM_NAME ?? 'Element Accounting'
  },

  social: {
    linkedinToken: process.env.LINKEDIN_ACCESS_TOKEN ?? '',
    linkedinOrgUrn: process.env.LINKEDIN_ORG_URN ?? '',
    fbPageToken: process.env.FB_PAGE_ACCESS_TOKEN ?? '',
    fbPageId: process.env.FB_PAGE_ID ?? '',
    igToken: process.env.IG_ACCESS_TOKEN ?? '',
    igUserId: process.env.IG_USER_ID ?? ''
  },

  workflow: {
    seoAutoApproveThreshold: int('SEO_AUTO_APPROVE_THRESHOLD', 80),
    autoApproveEnabled: bool('AUTO_APPROVE_ENABLED', false),
    maxJobAttempts: int('MAX_JOB_ATTEMPTS', 3),

    // ---- AI-usage / spend controls (one Karbon trigger => this many content
    // sets, each one blog post + one lead magnet). Clamped to 1..3: the design
    // and the DB idempotency constraint (karbon_work_id, karbon_stage_id,
    // batch_seq) guarantee a replayed event can never add a 4th. Lower it to
    // spend less per trigger. ----
    maxLeadMagnetsPerTrigger: clampInt(process.env.MAX_LEAD_MAGNETS_PER_KARBON_TRIGGER, 1, 3, 3),

    // Max auto-SEO regeneration loops per run before it goes to the human gate
    // regardless of score. Each loop is one extra OpenAI generation call, so
    // lowering this trims spend. Clamped 0..3. ----
    seoMaxAutoLoops: clampInt(process.env.SEO_MAX_AUTOLOOPS, 0, 3, 3)
  }
};
