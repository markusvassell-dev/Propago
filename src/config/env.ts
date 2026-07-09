import 'dotenv/config';

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
    bearerToken: process.env.KARBON_BEARER_TOKEN ?? '',
    accessKey: process.env.KARBON_ACCESS_KEY ?? ''
  },

  // Content generation — direct OpenAI (ChatGPT API). The Replit offload is
  // retired (CLAUDE.md rule 6): REPLIT_GENERATOR_APP_URL / REPLIT_SERVICE_SECRET
  // are gone and OPENAI_API_KEY is now required (blog generation + GPT-4o
  // distribution copy both use it).
  openaiApiKey: required('OPENAI_API_KEY'),
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o',
  generationTimeoutMs: int('GENERATION_TIMEOUT_MS', 120_000),

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
    signupFormUrl: process.env.AC_SIGNUP_FORM_URL ?? ''
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
    maxJobAttempts: int('MAX_JOB_ATTEMPTS', 3)
  }
};
