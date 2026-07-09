# Run Propago on Replit — everything except publishing

The entire app — API, BullMQ workers, PostgreSQL, Redis, React dashboard — runs inside **one unpublished Replit App workspace**. The workspace dev URL is your app while you test. **Publishing (Replit's Deploy/Publish step) is the one deliberately-deferred piece** — see the last section for what changes when you flip it on.

`.replit`, `replit.nix`, and `replit-start.sh` in this bundle are preconfigured: Node 20, Redis via Nix, port 3000 exposed, Run button = full boot.

## 1 · Create the app

Either route works:

- **Upload:** replit.com → **Create App** → Node.js template → drag this bundle's contents into the file tree (replace the template's files, including hidden `.replit` — enable "Show hidden files" in the file-tree menu).
- **GitHub:** push this bundle to a repo → Create App → **Import from GitHub**.

## 2 · Provision the built-in PostgreSQL

Tools → **Database (SQL Database)** → create. Replit injects `DATABASE_URL` into the workspace automatically — **do not add it as a Secret**. The boot script applies `db/schema.sql` (idempotent) on every Run; inspect data later with the Database tool's SQL runner.

If boot ever fails with an SSL-required error, add Secret `DATABASE_SSL=true`.

## 3 · Secrets (Tools → Secrets)

Required to boot:

- `JWT_SECRET` — long random string
- `MASTER_ENCRYPTION_KEY` — 64 hex chars (`openssl rand -hex 32`)
- `KARBON_WEBHOOK_SECRET` — any secret for now; must match what you sign test payloads with
- `REPLIT_GENERATOR_APP_URL` — the generator app's URL **including `/api/generate`** (step 5)
- `REPLIT_SERVICE_SECRET` — must equal the generator app's secret

Optional — every adapter runs in structural **stub mode** without its creds (logs the exact payload, returns synthetic IDs): `OPENAI_API_KEY` (distribution copy), `WORDPRESS_*`, `META_*` (keep `META_SANDBOX_MODE=true`), `AC_*`, `LINKEDIN_*`, `FB_*`, `IG_*`.

Do **not** set `DATABASE_URL` (auto), `REDIS_URL`, or `PORT` (both set by `.replit`).

## 4 · Press Run

`replit-start.sh` starts Redis, installs deps (first boot only), builds the dashboard, applies the schema, and boots API + workers. Open the webview in a new tab — that `https://….replit.dev` dev URL is publicly reachable **while the workspace is awake**. Log in: `jmercer@elementaccounting.ca` / `change-me` (admin; also `dokafor@…` reviewer, `mreyes@…` editor — rotate all three).

## 5 · The generator app (second, separate Replit App)

`replit-generator/` ships as its own tiny Replit app (see its README). It can stay **unpublished too**: while its workspace is open, its dev URL is reachable — set `REPLIT_GENERATOR_APP_URL` to `https://<generator-dev-url>/api/generate`. If its workspace sleeps, generation jobs fail cleanly: 3 retries with backoff, then a "Workflow Failed" note on the Karbon timeline. Keep both workspaces open while testing.

## 6 · Smoke test — trigger a full run

From the Propago workspace Shell:

```bash
BODY='{"workItemId":"KB-2214","stageId":"mkt-ready","clientName":"Halcyon Occupational Health","topic":"Cash flow forecasting for occupational health providers","keywords":["cash flow forecast","occupational health finance"],"tone":"Authoritative, plainspoken"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$KARBON_WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -X POST http://localhost:3000/api/webhooks/karbon \
  -H "Content-Type: application/json" -H "X-Karbon-Signature: sha256=$SIG" -d "$BODY"
# The 202 response lists 3 runIds — every trigger fans out to exactly 3
# content sets (blog + lead magnet + distribution), one run per set.
# Send it twice — the second returns {"duplicate":true} (idempotency); a
# replayed delivery can never add a 4th run.
```

Then watch it in the dashboard: Runs → three runs appear → `seo_review` → approve (or **remake** to regenerate from scratch, or **reject** to discard the run) → WordPress deploy (stub) → `dist_review` → **Approve & Publish All** → stub publishes → complete. The audit-trail modal shows every job.

## Using Replit Agent on this codebase

If you let Agent touch the workspace, paste this first — it prevents the usual rewrites:

> This workspace contains a complete, working Node 20 + TypeScript app (Propago). Do NOT scaffold a new app, change the stack, or add an ORM (raw `pg` SQL is intentional). Keep the raw-body HMAC webhook middleware mounted BEFORE `express.json()` — never reorder it. Redis runs in-workspace via `replit-start.sh`; the Run command is `bash replit-start.sh` and must stay. Database is Replit's built-in PostgreSQL via `DATABASE_URL`; schema lives in `db/schema.sql`, applied by `npm run db:migrate:dev`. Do NOT publish/deploy anything — workspace-only. Task: make sure deps install, the SQL database is provisioned, the app boots, and `/healthz` returns `{"ok":true}`. Stop there.

## The one thing that doesn't work yet: publishing

Deferred on purpose. Consequences while unpublished:

- No stable public URL — the dev URL only answers while the workspace is awake.
- The **live** Karbon webhook can't be registered yet (that's Phase 3 anyway); use the signed curl above.
- Redis/queue state lives in `.redisdata/` in the workspace — fine for testing.

When you're ready: **Publish → Reserved VM** (not Autoscale — workers must run 24/7 and Redis is on-machine; Autoscale would need external Redis, e.g. Upstash, plus a separate always-on worker). The `[deployment]` block in `.replit` already has the VM build/run commands. Re-enter secrets in the Deployments pane, confirm `DATABASE_URL` is set for the deployment, then point Karbon at `https://<app>.replit.app/api/webhooks/karbon`.
