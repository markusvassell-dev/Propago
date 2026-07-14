# Propago — Production Code Handoff Bundle

Full-stack marketing automation hub for a financial advisory firm (Element Accounting) targeting under-served niches — health & safety sector first. Karbon work management triggers an end-to-end pipeline: external AI content generation → SEO scoring → human review gate → WordPress deploy → distribution copy generation → **second** human review gate → Meta Ads + ActiveCampaign + organic social publishing → Karbon timeline callback.

**Every Karbon trigger fans out to exactly 3 content sets** (blog post + lead-magnet PDF + distribution payloads), each running as its own workflow/saga — identical to the design prototype.

**Stack:** Node.js 20 + TypeScript (Express), PostgreSQL (raw SQL via `pg`), Redis + BullMQ, React + Tailwind dashboard. Modular monolith with adapter interfaces at every external seam.

---

## About the design files (`design/`)

`design/Propago Dashboard.dc.html` (+ `support.js`, `assets/element-logo.png`) is the **high-fidelity interactive design reference** built during the design phase — open it in a browser. It is a prototype showing intended look and behavior, **not production code to copy directly**. Recreate its screens in the React frontend using the skeleton components in `frontend/src/` as the starting point. It is hifi: treat its layout, spacing, copy, states (both review gates, remake/reject actions, audit modal, conflict notices, blog theme preview, dark mode) as the spec. **`DESIGN_SPEC.md` is the written contract for that recreation — every design token, copy string, screen and behavior, plus the prototype-simulation → production translation table and the backend deltas. Follow it verbatim; where anything else disagrees with it on UI/UX, DESIGN_SPEC.md wins.**

Dashboard design tokens: bg `#F4F2ED`, card `#FFFFFF`, ink `#1A1D20`, muted `#8A8578`, green `#137A5B`, amber `#B45309`, violet `#5B4FC2`, red `#B3261E`, cyan `#0E7490`; type: Space Grotesk (display), IBM Plex Sans (body), IBM Plex Mono (labels/data). The prototype's dark palette lives in its `THEMES` object.

**Blog theme (Element Accounting site palette — distinct from the dashboard):** page greige `#E1DBD6`, body text `#3F3A3B`, heading/logo green `#597363`, copper accent `#BC7C54`, footer dark green `#3C4C3C`; **Arial** for all blog headings and body. See "Blog rendering" below.

---

## Repository layout

```
DESIGN_SPEC.md                    THE implementation contract — read first (every token, string, screen, behavior)
db/schema.sql                     Complete PostgreSQL DDL (enums, constraints, indexes, seeds)
src/
  index.ts                        Entrypoint — binds 0.0.0.0:$PORT, boots API + workers
  server.ts                       Express app, /healthz, static frontend serving
  config/env.ts                   Typed env access (throws on missing required vars)
  db/pool.ts                      pg Pool + tx helper + audit() writer
  redis/connection.ts             ioredis setup (BullMQ-safe options, backoff, failover)
  middleware/karbonHmac.ts        Strict HMAC-SHA256 raw-body signature verification
  middleware/idempotency.ts       Redis SETNX idem:{workItemId}:{stageId}, 24h TTL
  middleware/auth.ts              JWT + Redis session verification, role gates
  routes/webhook.routes.ts        POST /api/webhooks/karbon (raw → HMAC → idempotency → 3-run batch)
  routes/auth.routes.ts           /api/auth/login | logout | me (bcrypt + JWT + sessions)
  routes/api.routes.ts            Runs, review queue, gates (approve/revise/remake/reject),
                                  overrides, settings (409 conflicts)
  routes/magnets.routes.ts        Public GET /magnets/:id.pdf — lead-magnet delivery links
  saga/orchestrator.ts            Durable saga: guarded Postgres state transitions; RUNS_PER_TRIGGER
  queues/queues.ts                BullMQ queues, retry policy, rate-limit table
  workers/index.ts                Worker processors + terminal-failure handling
  services/karbonClient.ts        Karbon TIMELINE API notes (success + "Workflow Failed")
  services/seoScorer.ts           Internal SEO scorer (density/readability/headings/meta)
  services/distributionCopy.ts    GPT-4o distribution payloads (brand voice in system prompt)
  services/blogHtml.ts            Markdown → Element-theme WordPress HTML (rule 12)
  services/leadMagnetPdf.ts       In-process lead-magnet PDF render + Postgres storage
  adapters/types.ts               ContentGenerationProvider · CmsPublisher · AdPlatform ·
                                  EmailProvider · SocialPublisher interfaces
  adapters/OpenAIGenerationAdapter.ts   Direct OpenAI (ChatGPT API) generation — blog + lead magnet
  adapters/SerpApiAdapter.ts      Web/news search for the research stage — stub mode without a key
  adapters/WordPressAdapter.ts    REST publish into the Element site theme, stub mode without creds
  adapters/MetaAdsAdapter.ts      Lead-gen campaign/adset/creative/ad — sandbox mode
  adapters/ActiveCampaignAdapter.ts     Message + campaign send, UTM-rewritten body
  adapters/SocialAdapters.ts      LinkedIn / Facebook / Instagram — independent, non-blocking
  scripts/migrate.ts              Applies db/schema.sql
frontend/src/
  lib/api.ts · context/AuthContext.tsx · pages/Login.tsx · pages/ReviewQueue.tsx · pages/Settings.tsx
Dockerfile · railway.toml · docker-compose.yml · .env.example
design/                           Hifi HTML design reference (see above)
```

## Saga state machine

```
triggered → generating → seo_review ⇄ revision/remake
  seo_review → deploying → dist_generating → dist_review   (gate 2 — always human)
  dist_review → publishing → completing → complete
  seo_review → rejected   (terminal — human discarded the run; nothing published)
  any blocking step → failed  (retries exhausted → "Workflow Failed" on Karbon timeline)
```

`generating` internally covers four sub-steps the dashboard renders as separate pipeline stages (DESIGN_SPEC.md §2): research (SerpAPI web/news search → ChatGPT pain-point extraction with the Levenshtein > 0.7 duplicate guard; with a real `SERPAPI_KEY` the extract is grounded in live sources with real citations, otherwise it runs GPT-only), draft generation, the Uniqueness Registry check (SHA-256 exact + TF-IDF cosine ≥ 0.82 ⇒ blocked and regenerated), and the auto-SEO loop (score < threshold ⇒ suggestions applied and regenerated, max 3 loops).

Every transition is a guarded `UPDATE … WHERE status = <expected>`: a second reviewer, a double-click, or a replayed job gets 0 rows and a `409 Conflict` — never a silent overwrite. Auto-approve (configurable threshold, default 80) applies to gate 1 only.

**Gate 1 actions** (`seo_review`): **Approve** → deploy (admin/reviewer) · **Edit draft** (any role, logged) · **Request revision** with a note → loops to generation (admin/reviewer) · **Remake** → discards the draft and regenerates from scratch, no note (any role — matches the prototype) · **Reject** → terminal, run discarded (admin/reviewer). Rejection posts no Karbon failure note — that's reserved for system failures; it's visible in the dashboard and audit trail.

## Architecture rules honored (from the design phase — do not drop)

1. **Webhook idempotency + security** — HMAC-SHA256 on the raw body with timing-safe compare (`karbonHmac.ts`); Redis `SET NX EX 86400` on `idem:{workItemId}:{stageId}` (`idempotency.ts`); DB unique constraint `(karbon_work_id, karbon_stage_id, batch_seq)` as durable backstop.
2. **Karbon specifics** — completion + failure notes via the **Timeline API only** (`karbonClient.ts`); work-item custom fields are never written. Terminal failure state posts "Workflow Failed" with the verbatim error body.
3. **API resilience** — BullMQ worker limiters: `activecampaign` 5 req/s, `meta-ads` 10 req/10s (`queues.ts` + `workers/index.ts`).
4. **Railway** — binds `0.0.0.0`, reads `process.env.PORT` (`index.ts`); `DATABASE_URL`/`REDIS_URL` from Railway plugins.
5. **Distribution review gate** — GPT-4o payloads (headline ≤40, primary ≤125, IG "link in bio"); saga pauses at `dist_review`; publish jobs are enqueued only by `POST /runs/:id/publish-all`; every field editable, overrides logged. Auto-approve never applies here.
6. **OpenAIGenerationAdapter** — direct OpenAI (ChatGPT API) call inside the BullMQ generation worker; the Replit offload is retired and `OPENAI_API_KEY` is required (`config/env.ts`). Input carries `topic, keywords, tone, brandVoice` plus `variant {seq, of}` (distinct angle per content set) and `remake` flags; output (1000+ word post + lead-magnet content) maps into the existing WorkflowRun/draft schema. API/network errors are classified cleanly so BullMQ's retry policy (3×, exponential) runs before the terminal-failure note posts to the Karbon timeline.
7. **Brand voice** — `app_settings.brand_voice`, sent as `brandVoice` to the generator and prepended to the GPT-4o system prompt.
8. **UTM enforcement** — `utils/utm.ts`, applied inside adapters at publish time so manual edits can't strip tracking.
9. **Dashboard UX** — audit trail feeds the job-log modal (queue, attempts, timestamps, verbatim HTTP errors via `job.failed` events); lead-magnet preview link pre-approval; light/dark theming per the design reference.
10. **Multi-user auth** — bcrypt + JWT + Redis sessions, `/api/auth/*`, role enum (editors can edit and remake but never approve/reject/publish), `audit_trails.user_id` on every action, 409 concurrency notices.
11. **Trigger fan-out (exactly 3 content sets per trigger)** — `RUNS_PER_TRIGGER = 3` in `saga/orchestrator.ts`: the webhook handler simply enqueues 3 generation jobs per delivery (`batch_seq` 1–3), one WorkflowRun per set — identical to the prototype. This is NOT a cap mechanism; idempotency de-dup of identical deliveries still applies per rule 1 and can never add a 4th run.
12. **Blog rendering — Element Accounting theme** — posts publish INTO the site's existing WordPress theme at `elementaccounting.ca/blog/`; the dashboard's draft preview mirrors it 1:1 (see the prototype's Preview modal). `services/blogHtml.ts` emits the semantic structure (H2 section headings, disc bullet lists, full-width figures, no H1 — the theme's hero owns the title); the theme supplies Arial type, greige `#E1DBD6` background, green `#597363` headings, hero meta "In {Category} • {Date} • {N} Minutes", and the dark-green footer CTA band with copper `#BC7C54` buttons. Set category + featured image in WP (or extend the payload with `categories`/`featured_media`).

## Local development

```bash
cp .env.example .env                      # fill in secrets
docker compose up -d postgres redis       # infra (schema auto-applies on first boot)
npm install && npm run build
npm run db:migrate                        # idempotent — safe to re-run
npm run dev                               # API + workers on http://localhost:3000
# Frontend dev: cd frontend && npm install && npm run dev (Vite proxy → :3000)
```

Seeded users (password `change-me` — rotate immediately): `jmercer@elementaccounting.ca` (admin), `dokafor@elementaccounting.ca` (reviewer), `mreyes@elementaccounting.ca` (editor).

Simulate a Karbon trigger locally (the prototype's "Simulate Karbon trigger" button, as curl):

```bash
BODY='{"workItemId":"KB-2214","stageId":"mkt-ready","clientName":"Halcyon Occupational Health","topic":"Cash flow forecasting for occupational health providers","keywords":["cash flow forecast","occupational health finance"],"tone":"Authoritative, plainspoken"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$KARBON_WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -X POST http://localhost:3000/api/webhooks/karbon \
  -H "Content-Type: application/json" -H "X-Karbon-Signature: sha256=$SIG" -d "$BODY"
# 202 response lists 3 runIds — one per content set (blog + magnet + distribution).
# Send it twice: the second delivery returns {"duplicate":true} — idempotency in action.
```

## Karbon native Work webhook (automatic trigger)

Two inbound webhook routes exist:

- `POST /api/webhooks/karbon` — our **internal** shape (`workItemId, stageId, topic…`), signed with `KARBON_WEBHOOK_SECRET`. Used by the simulate curl above.
- `POST /api/webhooks/karbon/work` — Karbon's **native** Work webhook (`WebhookType="Work"`). This is the hands-off automation: Karbon fires it on any Work Item update, Propago fetches the item, and triggers **only** when the item is at the activation status.

**How the native flow works:** ack fast (Karbon cancels slow/erroring subscriptions) → verify the signature if `KARBON_WEBHOOK_SIGNING_KEY` is set → process async on the `karbon-inbound` queue: read `ResourcePermaKey` → `GET /v3/WorkItems/{key}` → check `PrimaryStatus`/`SecondaryStatus`/`WorkStatus` against `PROPAGO_TRIGGER_STATUS` → idempotency row in `karbon_work_events` (one batch per work item + activation status + version) → trigger the 3-content-set batch. When the batch finishes, Propago writes `PROPAGO_COMPLETE_STATUS` back to the item **once** and posts a Timeline note. Because it only triggers on the *activation* status, the completion write-back can't loop, and a failed batch is never marked complete (it sets `PROPAGO_ERROR_STATUS` if configured).

**Env vars:** `KARBON_AUTH_TOKEN`, `KARBON_ACCESS_KEY` (API auth), `KARBON_WEBHOOK_SIGNING_KEY` (verify inbound), `PROPAGO_TRIGGER_STATUS`, `PROPAGO_COMPLETE_STATUS`, and optional `PROPAGO_ERROR_STATUS`.

**Create / check the subscription** (Karbon API — needs the same auth headers):

```bash
# Create a Work webhook subscription pointing at your deployment:
curl -X POST "$KARBON_API_BASE/WebhookSubscriptions" \
  -H "Authorization: Bearer $KARBON_AUTH_TOKEN" -H "AccessKey: $KARBON_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"WebhookType":"Work","TargetUrl":"https://<your-app>.up.railway.app/api/webhooks/karbon/work"}'
# The response includes a SigningKey — put it in KARBON_WEBHOOK_SIGNING_KEY and redeploy.

# List existing subscriptions to confirm it's active:
curl "$KARBON_API_BASE/WebhookSubscriptions" \
  -H "Authorization: Bearer $KARBON_AUTH_TOKEN" -H "AccessKey: $KARBON_ACCESS_KEY"
```

**Test it without Karbon** — admin-authenticated route that runs a sample (or supplied) payload through the exact same decision path (signature aside):

```bash
# Uses a default "Ready for Propago" sample; or POST {"payload": { …Karbon Work fields… }}
curl -X POST https://<your-app>.up.railway.app/api/simulate-work-webhook \
  -H "Content-Type: application/json" -b cookies.txt   # admin session cookie
# → { ok:true, triggered:true, reason:"triggered", runIds:[…3…] }
```

A sample native payload lives at `tests/fixtures/karbonWorkWebhook.json`.

## Access & set-password flow

Login is email + password (bcrypt cost 10, JWT session in Redis). Passwords are
never stored in plaintext and never logged. Invited users set their own password
instead of receiving a temporary one:

1. An admin invites a user (`POST /api/users`). The account is created with an
   **unusable** password hash and a single-use, SHA-256-hashed token
   (`password_reset_tokens`, `purpose='invite'`, 7-day TTL). The response returns
   `setPasswordPath` (e.g. `/set-password?token=…`) — Settings shows a copyable link.
2. The user opens `/set-password?token=…`, chooses a password (min 8 chars, letter +
   digit), and posts to `POST /api/auth/set-password`. The token is validated by hash
   lookup (unused + unexpired), the password is bcrypt-hashed, all outstanding tokens
   for that user are consumed, and existing sessions are revoked.
3. `POST /api/users/:id/reset-password` (admin) mints a fresh reset link the same way.

Only the token **hash** is stored; the raw token is shown once at creation and never
logged. Roles/permissions are unchanged by this flow — the invited role is what the
user has on first login.

## AI-usage / spend controls

Two env vars cap per-trigger OpenAI spend (both clamped, so a bad value can't blow the
budget):

| Var | Range | Default | Effect |
| --- | --- | --- | --- |
| `MAX_LEAD_MAGNETS_PER_KARBON_TRIGGER` | 1–3 | 3 | Lead magnets (and content sets) created per Karbon delivery. The DB idempotency constraint guarantees a replayed webhook can never add a 4th. Lower it to spend less per trigger. |
| `SEO_MAX_AUTOLOOPS` | 0–3 | 3 | Max auto-SEO regeneration loops per run before it goes to the human gate. Each loop is one extra generation call; `0` disables auto-remake entirely. |

Each delivery logs `lead magnets requested (cap): N, created this delivery: M` — no
credentials, keys, or client details in the log.

## GitHub → Railway deployment

1. `git init && git add -A && git commit -m "Propago initial"` → push to a new GitHub repo (`.env` is gitignored; commit `.env.example` only).
2. Railway → **New Project → Deploy from GitHub repo** → select the repo. Railway detects `railway.toml` + `Dockerfile`.
3. **Add plugins:** New → Database → PostgreSQL, then New → Database → Redis. Railway auto-injects `DATABASE_URL` and `REDIS_URL` into the service.
4. **Variables tab:** set every secret from `.env.example` (JWT_SECRET, MASTER_ENCRYPTION_KEY, KARBON_*, OPENAI_API_KEY, WORDPRESS_*, META_* with `META_SANDBOX_MODE=true`, AC_*, LINKEDIN_*, FB_*, IG_*).
5. Migration is automatic: `railway.toml`'s start command applies `db/schema.sql` (idempotent) before every boot — no manual migrate step.
6. Point the Karbon webhook at `https://<service>.up.railway.app/api/webhooks/karbon` (Phase 3) and paste the shared secret into both Karbon and `KARBON_WEBHOOK_SECRET`.
7. Health check is `/healthz` (verifies Postgres + Redis). If a deploy fails its health check, the usual cause is a missing plugin var — the app fails fast with the exact missing name.

**Scaling:** the default topology runs API + workers in one service. To split, create a second Railway service from the same repo with start command `node dist/index.js --worker` and change the first to `--web`.

## Phased rollout (matches the original plan)

- **Phase 1 (live now in this code):** core engine, direct OpenAI generation (3 sets per trigger), SEO scorer, review dashboard with remake/reject, WordPress deploy — trigger via the curl above.
- **Phase 2:** set AC_* + LinkedIn/FB/IG creds; toggle adapters on in Settings. Social failures are per-platform and non-blocking.
- **Phase 3:** Meta app review (`ads_management`, `pages_read_engagement`, `instagram_basic`) → flip `META_SANDBOX_MODE=false`; register the live Karbon webhook.

Until credentials exist, WordPress/Meta/AC/social adapters run in **structural stub mode**: they log the exact payload they would send (UTM already applied) and return synthetic IDs, so the whole saga is exercisable end-to-end on day one. SerpAPI is the same: no `SERPAPI_KEY` ⇒ the research stage skips live search and extracts the pain point GPT-only, exactly as before. Add the key later to turn real, cited web/news grounding on with no code change.
