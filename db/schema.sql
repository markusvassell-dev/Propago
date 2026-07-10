-- Propago — PostgreSQL schema (single-file migration)
-- Apply with: npm run db:migrate  (or psql "$DATABASE_URL" -f db/schema.sql)

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ---------- Enums ----------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'reviewer', 'editor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE run_status AS ENUM (
    'triggered',        -- webhook accepted, generation queued
    'generating',       -- OpenAI generation in flight
    'seo_review',       -- gate 1: human review of draft (+ SEO score)
    'revision',         -- looped back to generation with reviewer note
    'deploying',        -- WordPress publish in flight
    'dist_generating',  -- GPT-4o distribution payloads in flight
    'dist_review',      -- gate 2: human review of ads/email/social payloads
    'publishing',       -- fan-out to meta-ads / activecampaign / social queues
    'completing',       -- Karbon timeline callback in flight
    'complete',
    'rejected',         -- terminal: human rejected the draft at gate 1 — run discarded, nothing published
    'failed'            -- terminal: retries exhausted, "Workflow Failed" posted to Karbon
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE draft_status AS ENUM ('draft', 'approved', 'deployed', 'published', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'reviewer',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessions live primarily in Redis (sess:{jti} keys, TTL-bound). This table is the
-- durable audit copy so active logins survive a Redis flush and can be revoked in bulk.
CREATE TABLE IF NOT EXISTS sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- = JWT jti
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at DESC);

-- ---------- workflow_runs ----------
CREATE TABLE IF NOT EXISTS workflow_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  karbon_work_id   TEXT NOT NULL,
  karbon_stage_id  TEXT NOT NULL,
  client_name      TEXT NOT NULL DEFAULT '',
  topic            TEXT NOT NULL,
  keywords         TEXT[] NOT NULL DEFAULT '{}',
  tone             TEXT NOT NULL DEFAULT '',
  status           run_status NOT NULL DEFAULT 'triggered',
  current_step     TEXT NOT NULL DEFAULT 'trigger',
  seo_score        INTEGER,
  seo_report       JSONB,
  revision_count   INTEGER NOT NULL DEFAULT 0,
  remake_count     INTEGER NOT NULL DEFAULT 0,
  batch_seq        SMALLINT NOT NULL DEFAULT 1,  -- position within the trigger's fan-out (1..3)
  approved_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  rejected_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  published_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  error            JSONB,          -- terminal failure detail {step, message, httpStatus, body}
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  -- Idempotency backstop: Redis SETNX is the fast path; this constraint is the
  -- durable guarantee that one Karbon stage change == one batch of exactly 3
  -- workflow runs (batch_seq 1..3) — a replayed delivery can never add a 4th.
  CONSTRAINT uq_karbon_trigger UNIQUE (karbon_work_id, karbon_stage_id, batch_seq)
);
CREATE INDEX IF NOT EXISTS idx_runs_status ON workflow_runs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_created ON workflow_runs(created_at DESC);

-- ---------- content_drafts ----------
CREATE TABLE IF NOT EXISTS content_drafts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id       UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  blog_title            TEXT NOT NULL DEFAULT '',
  blog_meta_description TEXT NOT NULL DEFAULT '',
  blog_text             TEXT NOT NULL DEFAULT '',      -- full markdown from the generator (direct OpenAI)
  lead_magnet_url       TEXT,                          -- public PDF URL returned by the generator
  live_url              TEXT,                          -- WordPress URL after deploy
  meta_ads_payload      JSONB,  -- {headline, primaryText, link}
  ac_email_payload      JSONB,  -- {subject, body}
  social_payload        JSONB,  -- {linkedin, facebook, instagram}
  overrides             JSONB NOT NULL DEFAULT '{}',   -- {channel: {field: {by, at}}} manual-edit log
  status                draft_status NOT NULL DEFAULT 'draft',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drafts_run ON content_drafts(workflow_run_id, created_at DESC);

-- ---------- audit_trails ----------
CREATE TABLE IF NOT EXISTS audit_trails (
  id              BIGSERIAL PRIMARY KEY,
  workflow_run_id UUID REFERENCES workflow_runs(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL = system/api actor
  actor           TEXT NOT NULL DEFAULT 'system',               -- 'system' | 'api' | user handle
  action          TEXT NOT NULL,                                -- e.g. 'draft.approved', 'job.failed'
  payload         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_run  ON audit_trails(workflow_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_trails(user_id, created_at DESC);

-- ---------- connected_accounts (OAuth/API credentials, encrypted at rest) ----------
CREATE TABLE IF NOT EXISTS connected_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL UNIQUE, -- 'karbon'|'openai'|'wordpress'|'meta'|'activecampaign'|'linkedin'|'facebook'|'instagram'
  encrypted_token TEXT NOT NULL,        -- AES-256-GCM: iv.tag.ciphertext (base64), key from MASTER_ENCRYPTION_KEY
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  meta            JSONB NOT NULL DEFAULT '{}',
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- app_settings (workflow gates, adapter toggles, brand voice) ----------
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value) VALUES
  ('seo_auto_approve_threshold', '80'),
  ('auto_approve_enabled', 'false'),
  ('adapters_enabled', '{"ads": true, "email": true, "social": true}'),
  ('brand_voice', '"Write for owner-managers of health & safety businesses. Lead with financial mechanics — figures, thresholds, deadlines. Plain UK English. No hype, no filler, no exclamation marks. Every paragraph must help the reader price, plan or claim something; cut anything that does not."')
ON CONFLICT (key) DO NOTHING;

-- Seed users (bcrypt hash of 'change-me' — rotate immediately):
-- $2a$10$2NRdVw1FTSzsWIkxE1olh.e9GHGl3L7lcA7otoAtWS3H1ROiM1Jg.
INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES
  ('jmercer@elementaccounting.ca', '$2a$10$2NRdVw1FTSzsWIkxE1olh.e9GHGl3L7lcA7otoAtWS3H1ROiM1Jg.', 'Jude',   'Mercer', 'admin'),
  ('dokafor@elementaccounting.ca', '$2a$10$2NRdVw1FTSzsWIkxE1olh.e9GHGl3L7lcA7otoAtWS3H1ROiM1Jg.', 'Dana',   'Okafor', 'reviewer'),
  ('mreyes@elementaccounting.ca',  '$2a$10$2NRdVw1FTSzsWIkxE1olh.e9GHGl3L7lcA7otoAtWS3H1ROiM1Jg.', 'Marcus', 'Reyes',  'editor')
ON CONFLICT (email) DO NOTHING;

-- ---------- lead_magnets (direct-OpenAI generation: PDFs rendered in-process) ----------
-- Served publicly by this app at GET /magnets/:id.pdf. BYTEA is fine at this
-- size (a few hundred KB per PDF, 3 per trigger). ON DELETE SET NULL keeps
-- already-published links working even if a run is purged.
CREATE TABLE IF NOT EXISTS lead_magnets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  pdf             BYTEA NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_magnets_run ON lead_magnets(workflow_run_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- DESIGN_SPEC.md §13 — prototype-parity deltas (idempotent, safe to re-run)
-- ═════════════════════════════════════════════════════════════════════════════

-- Display numbering: runs render as WF-{run_no}, triggers as KB-{n}.
-- Demo seed uses WF-1038..1041 / KB-2208..2214; live runs count up from here.
CREATE SEQUENCE IF NOT EXISTS wf_run_no_seq START 1042;
CREATE SEQUENCE IF NOT EXISTS kb_work_no_seq START 2215;

ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS run_no              INTEGER NOT NULL DEFAULT nextval('wf_run_no_seq'),
  ADD COLUMN IF NOT EXISTS pain_point          TEXT,
  ADD COLUMN IF NOT EXISTS source_insight      TEXT,
  ADD COLUMN IF NOT EXISTS levenshtein         NUMERIC(4,2),      -- research guard score vs nearest registry pain point
  ADD COLUMN IF NOT EXISTS seo_loops           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_suggestions JSONB   NOT NULL DEFAULT '[]',
  -- The 12-element stage array powering pipeline strips, stage lists and the
  -- job-log modal (spec §13.3): [{status,attempts,ms,note,err,startedAt,endedAt}]
  ADD COLUMN IF NOT EXISTS stage_state         JSONB   NOT NULL DEFAULT '[]',
  -- The 6 artifact fields of spec §6: blogUrl, magnetUrl, adId, campaignId, social, karbonNote
  ADD COLUMN IF NOT EXISTS artifacts           JSONB   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scheduled           BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_runs_run_no ON workflow_runs(run_no);

ALTER TABLE content_drafts
  ADD COLUMN IF NOT EXISTS words               INTEGER,
  ADD COLUMN IF NOT EXISTS magnet_name         TEXT,
  -- Generated originals kept alongside the editable payloads so "Reset to
  -- generated" and the per-channel `edited` pills work (spec §7.5).
  ADD COLUMN IF NOT EXISTS meta_ads_original   JSONB,
  ADD COLUMN IF NOT EXISTS ac_email_original   JSONB,
  ADD COLUMN IF NOT EXISTS social_original     JSONB,
  ADD COLUMN IF NOT EXISTS dist_edited         JSONB NOT NULL DEFAULT '{"ads":false,"email":false,"social":false}';

-- ---------- content_registry (spec §13.2 — uniqueness enforcement) ----------
CREATE TABLE IF NOT EXISTS content_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
  asset_type      TEXT NOT NULL CHECK (asset_type IN ('blog','linkedin','facebook','instagram','magnet','painpoint')),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',   -- fingerprinted content (corpus for TF-IDF / Levenshtein)
  sha256          TEXT NOT NULL,
  tfidf_cosine    NUMERIC(4,2),
  levenshtein     NUMERIC(4,2),
  status          TEXT NOT NULL CHECK (status IN ('unique','regenerated','duplicate-blocked')),
  method          TEXT NOT NULL DEFAULT 'SHA-256 + TF-IDF cosine',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_registry_type   ON content_registry(asset_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registry_run    ON content_registry(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_registry_sha    ON content_registry(sha256);

-- ---------- captured_leads (spec §13.5 — magnet sign-ups → ActiveCampaign) ----------
CREATE TABLE IF NOT EXISTS captured_leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
  magnet_id       UUID REFERENCES lead_magnets(id) ON DELETE SET NULL,
  magnet_name     TEXT NOT NULL DEFAULT '',
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  cf_pain_point   TEXT NOT NULL DEFAULT '',   -- contact-level custom field ONLY (never deal/work-item)
  cf_lead_source  TEXT NOT NULL DEFAULT '' CHECK (cf_lead_source IN ('meta_ads','organic_social','email','')),
  synced          BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON captured_leads(created_at DESC);

-- ---------- connections (spec §8.7 — 9 provider cards, statuses drive UI + social stub) ----------
CREATE TABLE IF NOT EXISTS connections (
  id             TEXT PRIMARY KEY,            -- 'karbon'|'openai'|'search'|'wp'|'meta'|'ac'|'li'|'fb'|'ig'
  sort           INTEGER NOT NULL,
  glyph          TEXT NOT NULL,
  glyph_bg       TEXT NOT NULL,
  glyph_fg       TEXT NOT NULL,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL,
  phase          TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('ok','sandbox','attention')),
  cred_mask      TEXT NOT NULL,
  scopes         TEXT[] NOT NULL DEFAULT '{}',
  verified_label TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO connections (id, sort, glyph, glyph_bg, glyph_fg, name, category, phase, status, cred_mask, scopes, verified_label) VALUES
  ('karbon', 1, 'KB', '#1E3A5F', '#BFD6EE', 'Karbon',               'Trigger source',                 'Phase 3 live', 'ok',        'whk_secret ••••••••9d41',                              ARRAY['work-item webhooks','timeline:write','HMAC + idempotency'],          'Verified 2m ago · HMAC-SHA256'),
  ('openai', 2, 'AI', '#15181B', '#E9E7E1', 'ChatGPT Business API', 'Content + distribution · GPT-4o','Phase 1',      'ok',        'sk-proj ••••••••7f2a · gpt-4o · org-verified',         ARRAY['chat.completions','research + generation','distribution copy'],      'Verified 2m ago · 412ms'),
  ('search', 3, 'WS', '#3A5F1E', '#D6EEBF', 'Web Search / News',    'Research source',                'Phase 2',      'ok',        'serp ••••••••2c7a · 1k/day',                           ARRAY['news','local business'],                                              'Verified 5m ago'),
  ('wp',     4, 'WP', '#1F4E5F', '#CDE8F0', 'WordPress',            'CMS · PublisherAdapter',         'Phase 1',      'ok',        'elementaccounting.ca · app-pw ••••x2m8',               ARRAY['posts:write','media:write'],                                          'Verified 8m ago'),
  ('meta',   5, 'MM', '#2547A8', '#CBD8F7', 'Meta Marketing',       'Ads · AdPlatform',               'Phase 3',      'sandbox',   'EAAG ••••••••kt3B · act_884012',                       ARRAY['ads_management','pages_read_engagement','instagram_basic'],          'Sandbox account · app review pending'),
  ('ac',     6, 'AC', '#265B8F', '#CFE2F5', 'ActiveCampaign',       'Email · EmailProvider',          'Phase 2',      'ok',        'elementaccounting.api-us1.com · key ••••41aa',         ARRAY['contacts','campaigns','forms'],                                       'Verified 12m ago · list: Subscribers (1,842)'),
  ('li',     7, 'LI', '#0A4D77', '#C6E2F2', 'LinkedIn',             'Social · SocialPublisher',       'Phase 2',      'ok',        'org: Element Accounting · tok ••••8c02',               ARRAY['w_organization_social'],                                              'Verified 1h ago'),
  ('fb',     8, 'FB', '#1B4C8C', '#CBDDF5', 'Facebook Page',        'Social · SocialPublisher',       'Phase 2',      'ok',        'page: Element Accounting · tok ••••m41q',              ARRAY['pages_manage_posts'],                                                 'Verified 1h ago'),
  ('ig',     9, 'IG', '#7A2E5C', '#F2CFE4', 'Instagram',            'Social · SocialPublisher',       'Phase 2',      'attention', 'ig-business: @elementaccounting · tok expired',        ARRAY['instagram_content_publish'],                                          'Token expired 2d ago — publishes fail non-blocking')
ON CONFLICT (id) DO NOTHING;

-- ---------- app_settings additions (spec §13.4 — orchestrator state) ----------
INSERT INTO app_settings (key, value) VALUES
  ('max_concurrency', '3'),
  ('scheduler_enabled', 'true'),
  ('active_preset', '"hs"'),
  ('custom_pain_points', '[]'),
  ('custom_audiences', '[]'),
  ('master_prompt', 'null'),
  ('presets', '[
    {"key":"hs","label":"Health & Safety (UK)","niche":"UK health & safety advisory & consultancy firms","audience":"Owner-managers of H&S consultancies, aged 35–60","region":"United Kingdom","builtin":true},
    {"key":"yyc","label":"Calgary small business (28–65)","niche":"Calgary-based small business owners","audience":"Small business owners aged 28–65","region":"Calgary, AB","builtin":true}
  ]')
ON CONFLICT (key) DO NOTHING;
