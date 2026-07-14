import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'crypto';

// Integration tests — need Postgres + Redis. Gated behind PROPAGO_IT=1 so a bare
// `npm test` (unit only) still passes in CI without infra.
const RUN = process.env.PROPAGO_IT === '1';

describe.skipIf(!RUN)('auth: email/password login + set-password flow', () => {
  // Imported lazily so env is set (tests/setup.ts) before config/env.ts loads.
  let app: import('express').Express;
  let query: typeof import('../../src/db/pool').query;

  beforeAll(async () => {
    app = (await import('../../src/server')).buildServer();
    ({ query } = await import('../../src/db/pool'));
  });

  it('logs in a seeded user with email + password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'jmercer@elementaccounting.ca', password: 'change-me' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    expect(res.headers['set-cookie']?.join(';')).toContain('nf_session');
  });

  it('rejects a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'jmercer@elementaccounting.ca', password: 'nope-nope-9' });
    expect(res.status).toBe(401);
  });

  it('invited user sets a password via token, then logs in; role is preserved', async () => {
    const admin = request.agent(app);
    await admin.post('/api/auth/login').send({ email: 'jmercer@elementaccounting.ca', password: 'change-me' });

    const email = `it-${randomBytes(4).toString('hex')}@elementaccounting.ca`;
    const inv = await admin.post('/api/users').send({ first: 'Test', last: 'Invitee', email, role: 'reviewer' });
    expect(inv.status).toBe(201);
    const token = inv.body.setPasswordToken as string;
    expect(token).toBeTruthy();
    expect(inv.body.setPasswordPath).toContain('/set-password?token=');

    // Cannot log in before setting a password (account has an unusable hash).
    const before = await request(app).post('/api/auth/login').send({ email, password: 'anything-123' });
    expect(before.status).toBe(401);

    // Weak password is rejected.
    const weak = await request(app).post('/api/auth/set-password').send({ token, password: 'short' });
    expect(weak.status).toBe(422);

    // Set a strong password with the token.
    const set = await request(app).post('/api/auth/set-password').send({ token, password: 'Reviewer-pass9' });
    expect(set.status).toBe(200);

    // Token is single-use.
    const reuse = await request(app).post('/api/auth/set-password').send({ token, password: 'Another-pass9' });
    expect(reuse.status).toBe(400);

    // Now login works and the invited role is intact.
    const after = request.agent(app);
    const login = await after.post('/api/auth/login').send({ email, password: 'Reviewer-pass9' });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('reviewer');
    const me = await after.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);

    await query('DELETE FROM users WHERE email = $1', [email]);
  });
});

describe.skipIf(!RUN)('karbon: max 3 lead magnets per trigger + replay safety', () => {
  let query: typeof import('../../src/db/pool').query;
  let createRunFromTrigger: typeof import('../../src/saga/orchestrator').createRunFromTrigger;
  let ConflictError: typeof import('../../src/saga/orchestrator').ConflictError;
  let MAX: number;
  const wid = `IT-${randomBytes(4).toString('hex')}`;

  beforeAll(async () => {
    ({ query } = await import('../../src/db/pool'));
    const orch = await import('../../src/saga/orchestrator');
    createRunFromTrigger = orch.createRunFromTrigger;
    ConflictError = orch.ConflictError;
    MAX = orch.MAX_LEAD_MAGNETS_PER_KARBON_TRIGGER;
  });

  afterAll(async () => {
    await query('DELETE FROM workflow_runs WHERE karbon_work_id = $1', [wid]);
  });

  const trigger = {
    workItemId: wid,
    stageId: 'mkt-ready',
    clientName: 'IT Client',
    topic: 'integration test topic for lead magnet cap',
    keywords: ['a', 'b'],
    tone: 'plain'
  };

  it('creates exactly MAX (3) runs — one lead magnet each — on first delivery', async () => {
    const out = await createRunFromTrigger(trigger);
    expect(MAX).toBe(3);
    expect(out.runIds.length).toBe(3);
    const { rows } = await query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM workflow_runs WHERE karbon_work_id = $1',
      [wid]
    );
    expect(parseInt(rows[0].n, 10)).toBe(3);
  });

  it('a replayed/duplicate delivery creates NO additional runs (idempotency)', async () => {
    await expect(createRunFromTrigger(trigger)).rejects.toBeInstanceOf(ConflictError);
    const { rows } = await query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM workflow_runs WHERE karbon_work_id = $1',
      [wid]
    );
    expect(parseInt(rows[0].n, 10)).toBe(3); // still 3 — never a 4th
  });
});
