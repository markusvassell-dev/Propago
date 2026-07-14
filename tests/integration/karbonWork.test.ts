import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'crypto';
import sample from '../fixtures/karbonWorkWebhook.json';

// Integration — needs Postgres + Redis. Gated behind PROPAGO_IT=1.
const RUN = process.env.PROPAGO_IT === '1';

describe.skipIf(!RUN)('karbon native Work webhook — endpoint + processing', () => {
  let app: import('express').Express;
  let query: typeof import('../../src/db/pool').query;
  let processWorkEvent: typeof import('../../src/services/karbonWork').processWorkEvent;
  let onRunSettledForKarbon: typeof import('../../src/services/karbonWork').onRunSettledForKarbon;
  const workKeys: string[] = [];

  beforeAll(async () => {
    app = (await import('../../src/server')).buildServer();
    ({ query } = await import('../../src/db/pool'));
    const kw = await import('../../src/services/karbonWork');
    processWorkEvent = kw.processWorkEvent;
    onRunSettledForKarbon = kw.onRunSettledForKarbon;
  });

  afterAll(async () => {
    for (const k of workKeys) {
      await query('DELETE FROM workflow_runs WHERE karbon_work_id = $1', [k]);
      await query('DELETE FROM karbon_work_events WHERE work_item_key = $1', [k]);
    }
  });

  it('accepts a Work webhook fast (202) and queues it (signature skipped when no key set)', async () => {
    const key = `WH-${randomBytes(4).toString('hex')}`;
    workKeys.push(key);
    const res = await request(app)
      .post('/api/webhooks/karbon/work')
      .set('Content-Type', 'application/json')
      .send({ ...sample, ResourcePermaKey: key });
    expect(res.status).toBe(202);
    expect(res.body.queued).toBe(true);
    expect(res.body.resourcePermaKey).toBe(key);
  });

  it('acknowledges (200) a webhook with no resource key rather than erroring', async () => {
    const res = await request(app)
      .post('/api/webhooks/karbon/work')
      .set('Content-Type', 'application/json')
      .send({ EventType: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe('no_resource_key');
  });

  it('triggers Propago exactly once at the activation status, and suppresses duplicates', async () => {
    const key = `WI-${randomBytes(4).toString('hex')}`;
    workKeys.push(key);
    const payload = { ...sample, ResourcePermaKey: key };

    const first = await processWorkEvent({ permaKey: key, payload });
    expect(first.triggered).toBe(true);
    expect(first.reason).toBe('triggered');
    expect(first.runIds?.length).toBe(3); // fans out to the 3-content-set batch

    // Same activation + version again ⇒ idempotent, no new runs.
    const dup = await processWorkEvent({ permaKey: key, payload });
    expect(dup.triggered).toBe(false);
    expect(dup.reason).toBe('duplicate');

    const { rows } = await query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM workflow_runs WHERE karbon_work_id = $1',
      [key]
    );
    expect(parseInt(rows[0].n, 10)).toBe(3); // never a 4th
  });

  it('writes the completion status back to Karbon exactly once when the batch settles', async () => {
    const key = `WC-${randomBytes(4).toString('hex')}`;
    workKeys.push(key);
    const first = await processWorkEvent({ permaKey: key, payload: { ...sample, ResourcePermaKey: key } });
    expect(first.triggered).toBe(true);
    const runId = first.runIds![0];

    // Force the whole batch terminal (simulating a finished workflow).
    await query(`UPDATE workflow_runs SET status = 'complete', completed_at = now() WHERE karbon_work_id = $1`, [key]);

    // Not-yet-settled guard is bypassed now; first settle claims the write-back.
    await onRunSettledForKarbon(runId);
    const after1 = await query<{ notified: string | null; state: string }>(
      `SELECT completed_notified_at AS notified, state FROM karbon_work_events WHERE work_item_key = $1`,
      [key]
    );
    expect(after1.rows[0].notified).not.toBeNull();
    expect(after1.rows[0].state).toBe('complete');

    // Second settle (e.g. another run's callback) must NOT write again — the
    // completion-status webhook can't loop because the guard is already set.
    const stamp = after1.rows[0].notified;
    await onRunSettledForKarbon(runId);
    const after2 = await query<{ notified: string | null }>(
      `SELECT completed_notified_at AS notified FROM karbon_work_events WHERE work_item_key = $1`,
      [key]
    );
    expect(after2.rows[0].notified).toEqual(stamp); // unchanged — written exactly once
  });

  it('does nothing when the work item is NOT at the activation status', async () => {
    const key = `WN-${randomBytes(4).toString('hex')}`;
    workKeys.push(key);
    const out = await processWorkEvent({
      permaKey: key,
      payload: { ResourcePermaKey: key, PrimaryStatus: 'Some Other Status', Title: 'nope' }
    });
    expect(out.triggered).toBe(false);
    expect(out.reason).toBe('status_no_match');
    const { rows } = await query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM workflow_runs WHERE karbon_work_id = $1',
      [key]
    );
    expect(parseInt(rows[0].n, 10)).toBe(0);
  });
});
