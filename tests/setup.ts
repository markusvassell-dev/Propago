// Provide safe placeholder values for the required env vars so importing modules
// that call config/env.ts never throws during tests. Real values (when present)
// are respected. OPENAI_API_KEY stays a placeholder so generation runs in stub
// mode — tests never spend tokens.
const D: Record<string, string> = {
  DATABASE_URL: 'postgres://propago:propago@127.0.0.1:5432/propago',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
  MASTER_ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
  KARBON_WEBHOOK_SECRET: 'whk_test',
  OPENAI_API_KEY: 'sk-set-me-for-tests',
  NODE_ENV: 'test'
};
for (const [k, v] of Object.entries(D)) if (!process.env[k]) process.env[k] = v;
