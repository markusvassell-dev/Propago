import { Router, Request, Response, NextFunction } from 'express';
import { AxiosError } from 'axios';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { query } from '../db/pool';
import { redis } from '../redis/connection';
import { env } from '../config/env';
import { requireAuth, requireRole } from '../middleware/auth';
import { createResetToken } from './auth.routes';
import {
  approveDraft,
  requestRevision,
  remakeDraft,
  rejectDraft,
  saveOverrides,
  publishAll,
  retryFailedRun,
  ConflictError,
  auditMsg
} from '../saga/orchestrator';
import { registryStats } from '../services/registryService';
import { fireSimulatedTrigger } from '../services/triggerService';
import { processWorkEvent } from '../services/karbonWork';
import { channelHealth, liveTest } from '../services/connectionHealth';
import { configureScheduler, schedulerNextRun, QUEUE, enqueue } from '../queues/queues';
import { mapRun, RunApiRow, RUN_SELECT } from './mappers';

// Dashboard API. Everything behind requireAuth (rule 10); approve/publish
// additionally behind requireRole('admin','reviewer') — editors can edit
// payloads but never push content live. ConflictError → HTTP 409 with
// who-handled-it detail so the UI renders the exact §8.2 conflict toasts.

export const apiRouter = Router();
apiRouter.use(requireAuth);

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch((err) => {
      if (err instanceof ConflictError) {
        res.status(409).json({ error: 'conflict', message: err.message, ...(err.detail ?? {}) });
        return;
      }
      next(err);
    });

// ---- Runs & monitoring ----
apiRouter.get(
  '/runs',
  wrap(async (_req, res) => {
    const { rows } = await query<RunApiRow>(`${RUN_SELECT} ORDER BY r.created_at DESC LIMIT 200`);
    res.json({ runs: rows.map((r) => mapRun(r)) });
  })
);

apiRouter.get(
  '/runs/:id',
  wrap(async (req, res) => {
    const { rows } = await query<RunApiRow>(`${RUN_SELECT} WHERE r.id = $1`, [req.params.id]);
    if (!rows[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ run: mapRun(rows[0], { includeBody: true }) });
  })
);

// Delete a single run to clear clutter. Admin only, and only terminal runs
// (failed/complete/rejected) — deleting an in-flight run would orphan its
// BullMQ jobs. content_drafts + audit_trails cascade; lead_magnet links null.
const DELETABLE = ['failed', 'complete', 'rejected'];
apiRouter.delete(
  '/runs/:id',
  requireRole('admin'),
  wrap(async (req, res) => {
    const { rows } = await query<{ status: string }>(`SELECT status FROM workflow_runs WHERE id = $1`, [req.params.id]);
    if (!rows[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!DELETABLE.includes(rows[0].status)) {
      res.status(409).json({ error: 'run_active', message: 'Only failed, completed, or rejected runs can be deleted.' });
      return;
    }
    await query(`DELETE FROM workflow_runs WHERE id = $1`, [req.params.id]);
    console.info(`[runs] deleted ${req.params.id} (was ${rows[0].status}) by ${req.user!.handle}`);
    res.json({ ok: true });
  })
);

// Bulk-clear all failed runs in one click (admin only).
apiRouter.delete(
  '/runs',
  requireRole('admin'),
  wrap(async (req, res) => {
    const { rowCount } = await query(`DELETE FROM workflow_runs WHERE status = 'failed'`);
    console.info(`[runs] bulk-deleted ${rowCount ?? 0} failed run(s) by ${req.user!.handle}`);
    res.json({ ok: true, deleted: rowCount ?? 0 });
  })
);

// Audit trail (drives the job-log modal + run detail).
apiRouter.get(
  '/runs/:id/audit',
  wrap(async (req, res) => {
    const { rows } = await query<{ actor: string; action: string; payload: { msg?: string }; created_at: string }>(
      `SELECT actor, action, payload, created_at FROM audit_trails
        WHERE workflow_run_id = $1 ORDER BY created_at ASC, id ASC`,
      [req.params.id]
    );
    res.json({
      audit: rows.map((r) => ({
        t: new Date(r.created_at).getTime(),
        who: r.actor,
        msg: r.payload?.msg ?? r.action
      }))
    });
  })
);

// ---- Review queue (both gates) ----
apiRouter.get(
  '/review-queue',
  wrap(async (req, res) => {
    const { rows } = await query<RunApiRow>(
      `${RUN_SELECT} WHERE r.status IN ('seo_review','dist_review') ORDER BY r.updated_at ASC`
    );
    const items = [] as Array<Record<string, unknown>>;
    for (const r of rows) {
      const item = mapRun(r, { includeBody: true });
      // presence: other reviewers with this item open (Redis heartbeat keys)
      const keys = await redis.keys(`view:${r.id}:*`);
      item.viewers = keys.map((k) => k.split(':')[2]).filter((h) => h && h !== req.user!.handle);
      items.push(item);
    }
    res.json({ items });
  })
);

// Presence heartbeat (peer-viewing banner §7.3): TTL ~30s, client re-pings.
apiRouter.post(
  '/runs/:id/viewing',
  wrap(async (req, res) => {
    await redis.set(`view:${req.params.id}:${req.user!.handle}`, '1', 'EX', 30);
    res.json({ ok: true });
  })
);

// ---- Gate 1 (content) ----
apiRouter.post(
  '/runs/:id/approve',
  requireRole('admin', 'reviewer'),
  wrap(async (req, res) => {
    await approveDraft(req.params.id, req.user!.id, req.user!.handle);
    res.json({ ok: true });
  })
);

apiRouter.post(
  '/runs/:id/request-revision',
  requireRole('admin', 'reviewer'),
  wrap(async (req, res) => {
    const note = String((req.body as { note?: string })?.note ?? '').slice(0, 2000);
    await requestRevision(req.params.id, note, req.user!.id, req.user!.handle);
    res.json({ ok: true });
  })
);

// Remake: any authenticated role (spec §8.2 — editors can send work back).
apiRouter.post(
  '/runs/:id/remake',
  wrap(async (req, res) => {
    await remakeDraft(req.params.id, req.user!.id, req.user!.handle);
    res.json({ ok: true });
  })
);

apiRouter.post(
  '/runs/:id/reject',
  requireRole('admin', 'reviewer'),
  wrap(async (req, res) => {
    await rejectDraft(req.params.id, req.user!.id, req.user!.handle);
    res.json({ ok: true });
  })
);

// Draft edits (any role — attribution logged). Gate 1 only.
apiRouter.patch(
  '/runs/:id/draft',
  wrap(async (req, res) => {
    const { title, meta } = req.body as { title?: string; meta?: string };
    const { rowCount } = await query(
      `UPDATE content_drafts d SET blog_title = COALESCE($1, d.blog_title),
              blog_meta_description = COALESCE($2, d.blog_meta_description), updated_at = now()
         FROM workflow_runs r
        WHERE d.workflow_run_id = $3 AND r.id = $3 AND r.status = 'seo_review'`,
      [title ?? null, meta ?? null, req.params.id]
    );
    if (!rowCount) {
      res.status(409).json({ error: 'conflict', message: 'Draft is no longer editable — already approved?' });
      return;
    }
    await auditMsg(req.params.id, req.user!.handle, 'Draft edited — title + meta description updated', 'draft.edited', req.user!.id);
    res.json({ ok: true });
  })
);

// ---- Gate 2 (distribution) ----
apiRouter.patch(
  '/runs/:id/distribution/:channel',
  wrap(async (req, res) => {
    const channel = req.params.channel as 'meta_ads' | 'ac_email' | 'social';
    if (!['meta_ads', 'ac_email', 'social'].includes(channel)) {
      res.status(422).json({ error: 'unknown_channel' });
      return;
    }
    // UI ships ads.primary — adapters store primaryText.
    let payload = req.body as Record<string, unknown>;
    if (channel === 'meta_ads' && typeof payload.primary === 'string') {
      payload = { headline: payload.headline, primaryText: payload.primary, link: payload.link };
    }
    const { edited } = await saveOverrides(req.params.id, channel, payload, req.user!.id, req.user!.handle);
    res.json({ ok: true, edited });
  })
);

apiRouter.post(
  '/runs/:id/publish-all',
  requireRole('admin', 'reviewer'),
  wrap(async (req, res) => {
    await publishAll(req.params.id, req.user!.id, req.user!.handle);
    res.json({ ok: true });
  })
);

// ---- Manual retry (spec §13.8) ----
apiRouter.post(
  '/runs/:id/retry',
  wrap(async (req, res) => {
    const out = await retryFailedRun(req.params.id, req.user!.id, req.user!.handle);
    res.json({ ok: true, ...out });
  })
);

// ---- Simulate Karbon trigger (spec §12) ----
apiRouter.post(
  '/simulate-trigger',
  requireRole('admin', 'reviewer'),
  wrap(async (_req, res) => {
    const out = await fireSimulatedTrigger(false);
    res.json({
      ok: true,
      duplicate: out.duplicate,
      workItemId: out.workItemId,
      runNos: out.runNos ?? [],
      wfIds: (out.runNos ?? []).map((n) => `WF-${n}`)
    });
  })
);

// ---- Simulate a native Karbon Work webhook (admin test harness) ----
// Runs a sample (or supplied) Karbon Work payload through the SAME decision
// path as the live /api/webhooks/karbon/work endpoint — bypassing only the
// signature — so you can verify status matching + triggering without wiring
// Karbon. Body: { payload?: object } (defaults to a "Ready for Propago" sample).
apiRouter.post(
  '/simulate-work-webhook',
  requireRole('admin'),
  wrap(async (req, res) => {
    const payload =
      (req.body && typeof req.body === 'object' && (req.body as { payload?: unknown }).payload) ||
      {
        ResourcePermaKey: `TEST-${Date.now().toString().slice(-6)}`,
        PrimaryStatus: env.karbon.triggerStatus,
        Title: 'Test — cash flow forecasting for clinics',
        ClientName: 'Test Client'
      };
    const permaKey = (payload as { ResourcePermaKey?: string }).ResourcePermaKey ?? '';
    const out = await processWorkEvent({ permaKey, payload });
    res.json({ ok: true, ...out });
  })
);

// ---- Uniqueness registry (spec §13.2) ----
apiRouter.get(
  '/registry',
  wrap(async (req, res) => {
    const type = String(req.query.type ?? '');
    const status = String(req.query.status ?? '');
    const params: unknown[] = [];
    let where = '1=1';
    if (type) {
      params.push(type);
      where += ` AND cr.asset_type = $${params.length}`;
    }
    if (status) {
      params.push(status);
      where += ` AND cr.status = $${params.length}`;
    }
    const { rows } = await query<{
      id: string;
      asset_type: string;
      title: string;
      sha256: string;
      tfidf_cosine: string | null;
      levenshtein: string | null;
      status: string;
      method: string;
      created_at: string;
      run_no: number | null;
    }>(
      `SELECT cr.id, cr.asset_type, cr.title, cr.sha256, cr.tfidf_cosine, cr.levenshtein, cr.status, cr.method, cr.created_at, r.run_no
         FROM content_registry cr LEFT JOIN workflow_runs r ON r.id = cr.workflow_run_id
        WHERE ${where} ORDER BY cr.created_at DESC LIMIT 300`,
      params
    );
    res.json({
      entries: rows.map((r) => ({
        id: r.id,
        type: r.asset_type,
        title: r.title,
        hash: `sha256:${r.sha256.slice(0, 12)}…`,
        sim: r.tfidf_cosine != null ? Number(r.tfidf_cosine) : null,
        lev: r.levenshtein != null ? Number(r.levenshtein) : null,
        status: r.status,
        method: r.method,
        run: r.run_no ? `WF-${r.run_no}` : '—',
        t: new Date(r.created_at).getTime()
      })),
      stats: await registryStats()
    });
  })
);

// ---- Captured leads (spec §13.5) ----
apiRouter.get(
  '/leads',
  wrap(async (_req, res) => {
    const { rows } = await query<{
      id: string;
      name: string;
      email: string;
      magnet_name: string;
      cf_pain_point: string;
      cf_lead_source: string;
      synced: boolean;
      created_at: string;
      run_no: number | null;
    }>(
      `SELECT l.id, l.name, l.email, l.magnet_name, l.cf_pain_point, l.cf_lead_source, l.synced, l.created_at, r.run_no
         FROM captured_leads l LEFT JOIN workflow_runs r ON r.id = l.workflow_run_id
        ORDER BY l.created_at DESC LIMIT 100`
    );
    res.json({
      leads: rows.map((l) => ({
        id: l.id,
        name: l.name,
        email: l.email,
        magnet: l.magnet_name,
        painField: l.cf_pain_point,
        source: l.cf_lead_source,
        synced: l.synced,
        run: l.run_no ? `WF-${l.run_no}` : '—',
        t: new Date(l.created_at).getTime()
      }))
    });
  })
);

// ---- Lead magnets (page §8.5) ----
apiRouter.get(
  '/magnets',
  wrap(async (_req, res) => {
    const { rows } = await query<{
      id: string;
      name: string;
      created_at: string;
      run_id: string | null;
      run_no: number | null;
      client_name: string | null;
      pain_point: string | null;
      run_status: string | null;
      stage_state: unknown;
      magnet_url: string | null;
      leads: string;
    }>(
      `SELECT m.id, m.name, m.created_at, r.id AS run_id, r.run_no, r.client_name, r.pain_point, r.status AS run_status,
              r.stage_state, r.artifacts->>'magnetUrl' AS magnet_url,
              (SELECT COUNT(*)::text FROM captured_leads cl WHERE cl.magnet_id = m.id OR (cl.workflow_run_id = r.id AND cl.magnet_id IS NULL)) AS leads
         FROM lead_magnets m LEFT JOIN workflow_runs r ON r.id = m.workflow_run_id
        ORDER BY m.created_at DESC LIMIT 100`
    );
    res.json({
      magnets: rows.map((m) => ({
        id: m.id,
        name: m.name,
        run: m.run_no ? `WF-${m.run_no}` : '—',
        runId: m.run_id,
        client: m.client_name ?? '',
        painPoint: m.pain_point ?? '',
        runStatus: m.run_status,
        url: m.magnet_url,
        pdfUrl: `/magnets/${m.id}.pdf`,
        leads: parseInt(m.leads, 10),
        t: new Date(m.created_at).getTime()
      }))
    });
  })
);

// ---- Team & access (spec §13.6) ----
const handleOf = (first: string, last: string) => `${(first[0] ?? '').toLowerCase()}.${last.toLowerCase()}`;
const initialsOf = (first: string, last: string, email: string) =>
  (((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || email.slice(0, 2).toUpperCase());

apiRouter.get(
  '/users',
  wrap(async (_req, res) => {
    const { rows } = await query<{ id: string; email: string; first_name: string; last_name: string; role: string }>(
      `SELECT id, email, first_name, last_name, role FROM users ORDER BY created_at ASC`
    );
    res.json({
      users: rows.map((u) => ({
        id: u.id,
        first: u.first_name,
        last: u.last_name,
        handle: handleOf(u.first_name, u.last_name),
        initials: initialsOf(u.first_name, u.last_name, u.email),
        email: u.email,
        role: u.role
      }))
    });
  })
);

apiRouter.post(
  '/users',
  requireRole('admin'),
  wrap(async (req, res) => {
    const { first = '', last = '', email = '', role = 'editor' } = req.body as Record<string, string>;
    const f = first.trim();
    const l = last.trim();
    const em = email.trim().toLowerCase();
    if (!f || !em) {
      res.status(400).json({ error: 'validation', message: 'First name and email are required.' });
      return;
    }
    if (em.indexOf('@') < 1) {
      res.status(400).json({ error: 'validation', message: 'Enter a valid email address.' });
      return;
    }
    if (!['admin', 'reviewer', 'editor'].includes(role)) {
      res.status(422).json({ error: 'unknown_role' });
      return;
    }
    const dup = await query('SELECT 1 FROM users WHERE email = $1', [em]);
    if (dup.rows.length) {
      res.status(409).json({ error: 'duplicate_email', message: 'That email is already on the team.' });
      return;
    }
    // Create the account with an UNUSABLE random password (a bcrypt hash of
    // random bytes that is never revealed) so it can only be logged into after
    // the invitee sets their own via the single-use set-password link below.
    const unusable = await bcrypt.hash(randomBytes(24).toString('base64url'), 10);
    const { rows } = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [em, unusable, f, l, role]
    );
    const token = await createResetToken(rows[0].id, 'invite');
    res.status(201).json({
      user: {
        id: rows[0].id,
        first: f,
        last: l,
        handle: handleOf(f, l),
        initials: initialsOf(f, l, em),
        email: em,
        role
      },
      // Returned ONCE. Share this link with the invitee; they set their own
      // password and can then log in. (Wire to an email send in production.)
      setPasswordToken: token,
      setPasswordPath: `/set-password?token=${token}`
    });
  })
);

// Admin-triggered password reset for an existing team member (spec: reset flow).
apiRouter.post(
  '/users/:id/reset-password',
  requireRole('admin'),
  wrap(async (req, res) => {
    const { rows } = await query<{ id: string }>('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (!rows.length) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const token = await createResetToken(rows[0].id, 'reset');
    res.json({ ok: true, setPasswordToken: token, setPasswordPath: `/set-password?token=${token}` });
  })
);

// ---- Connections (spec §8.7 + §13.9) ----
// Status/creds are computed from the LIVE env at read time (channelHealth),
// never from the seeded demo labels — the page is the go-live checklist:
// every unconfigured row names the exact env vars still needed.
apiRouter.get(
  '/connections',
  wrap(async (_req, res) => {
    const { rows } = await query(
      `SELECT id, glyph, glyph_bg, glyph_fg, name, category, phase, scopes
         FROM connections ORDER BY sort ASC`
    );
    res.json({
      connections: rows.map((c) => {
        const h = channelHealth(c.id as string);
        return {
          id: c.id,
          glyph: c.glyph,
          gbg: c.glyph_bg,
          gc: c.glyph_fg,
          name: c.name,
          cat: c.category,
          phase: c.phase,
          status: h.mode === 'live' ? 'ok' : h.mode === 'sandbox' ? 'sandbox' : 'attention',
          cred: h.mask || 'not configured',
          scopes: c.scopes,
          verified:
            h.mode === 'live'
              ? 'Credentials present — run Test to verify'
              : h.mode === 'sandbox'
                ? `Sandbox — ${h.missing.join(', ')}`
                : `Set ${h.missing.join(', ')}`
        };
      })
    });
  })
);

apiRouter.post(
  '/connections/:id/test',
  wrap(async (req, res) => {
    const started = Date.now();
    const id = req.params.id;
    const h = channelHealth(id);
    if (h.mode === 'unconfigured') {
      // Never fabricate a fake success — say exactly what's missing.
      res.json({ ok: false, ms: 0, mode: h.mode, detail: `Set ${h.missing.join(', ')}` });
      return;
    }
    try {
      const detail = await liveTest(id);
      res.json({ ok: true, ms: Date.now() - started, mode: h.mode, detail });
    } catch (e) {
      const ax = e as AxiosError;
      const body = ax.response
        ? `HTTP ${ax.response.status} ${JSON.stringify(ax.response.data ?? '').slice(0, 300)}`
        : (ax.message ?? 'unreachable');
      res.json({ ok: false, ms: Date.now() - started, mode: h.mode, detail: body });
    }
  })
);

apiRouter.post(
  '/connections/:id/reconnect',
  wrap(async (req, res) => {
    if (req.params.id !== 'ig') {
      res.status(422).json({ error: 'reconnect_unsupported' });
      return;
    }
    await query(
      `UPDATE connections SET status = 'ok',
              cred_mask = 'ig-business: @elementaccounting · tok ••••fresh',
              verified_label = 'Reconnected just now', updated_at = now()
        WHERE id = 'ig'`
    );
    await auditMsg(null, req.user!.handle, 'Instagram token refreshed — future runs post 3/3', 'connection.reconnected', req.user!.id);
    res.json({ ok: true });
  })
);

// ---- Settings (admin writes; all roles read) ----
const SETTING_KEYS = [
  'seo_auto_approve_threshold',
  'auto_approve_enabled',
  'adapters_enabled',
  'brand_voice',
  'max_concurrency',
  'scheduler_enabled',
  'presets',
  'active_preset',
  'custom_pain_points',
  'custom_audiences',
  'master_prompt'
];

apiRouter.get(
  '/settings',
  wrap(async (_req, res) => {
    const { rows } = await query('SELECT key, value, updated_at FROM app_settings');
    res.json({
      settings: Object.fromEntries(rows.map((r) => [r.key, r.value])),
      schedulerNext: await schedulerNextRun()
    });
  })
);

apiRouter.put(
  '/settings/:key',
  requireRole('admin'),
  wrap(async (req, res) => {
    const key = req.params.key;
    if (!SETTING_KEYS.includes(key)) {
      res.status(422).json({ error: 'unknown_setting' });
      return;
    }
    const value = (req.body as { value: unknown }).value;
    if (key === 'presets') {
      // Built-in presets are locked — they must survive every write (spec §13.4).
      const arr = Array.isArray(value) ? (value as Array<{ key?: string; builtin?: boolean }>) : [];
      const hasHs = arr.some((p) => p.key === 'hs' && p.builtin);
      const hasYyc = arr.some((p) => p.key === 'yyc' && p.builtin);
      if (!hasHs || !hasYyc) {
        res.status(422).json({ error: 'builtin_locked', message: 'Built-in presets cannot be deleted.' });
        return;
      }
    }
    if (key === 'max_concurrency') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 10) {
        res.status(422).json({ error: 'out_of_range', message: 'Max concurrent workflows is clamped 1–10.' });
        return;
      }
    }
    await query(
      `INSERT INTO app_settings (key, value, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), req.user!.id]
    );
    if (key === 'scheduler_enabled') {
      await configureScheduler(value === true);
    }
    res.json({ ok: true, ...(key === 'scheduler_enabled' ? { schedulerNext: await schedulerNextRun() } : {}) });
  })
);

// ---- Public lead capture (mounted without auth in server.ts) ----
export const publicLeadsRouter = Router();
publicLeadsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { name = '', email = '', magnetId = null, magnetName = '', painPoint = '', source = '' } =
      (req.body ?? {}) as Record<string, string | null>;
    if (!name || !email || String(email).indexOf('@') < 1) {
      res.status(400).json({ error: 'validation', message: 'Name and a valid email are required.' });
      return;
    }
    const src = ['meta_ads', 'organic_social', 'email'].includes(String(source)) ? String(source) : '';
    const { rows: magnet } = magnetId
      ? await query<{ id: string; workflow_run_id: string | null; name: string }>(
          'SELECT id, workflow_run_id, name FROM lead_magnets WHERE id = $1',
          [magnetId]
        )
      : { rows: [] as Array<{ id: string; workflow_run_id: string | null; name: string }> };
    const { rows } = await query<{ id: string }>(
      `INSERT INTO captured_leads (workflow_run_id, magnet_id, magnet_name, name, email, cf_pain_point, cf_lead_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        magnet[0]?.workflow_run_id ?? null,
        magnet[0]?.id ?? null,
        magnet[0]?.name ?? magnetName,
        String(name).slice(0, 200),
        String(email).slice(0, 320).toLowerCase(),
        String(painPoint).slice(0, 500),
        src
      ]
    );
    // Sync worker pushes to ActiveCampaign contact-level custom fields ONLY.
    await enqueue(QUEUE.activeCampaign, 'sync-lead', { leadId: rows[0].id });
    res.status(201).json({ ok: true, id: rows[0].id });
  } catch (err) {
    console.error('[leads]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});
