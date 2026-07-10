import axios from 'axios';
import { createHmac } from 'crypto';
import { env } from '../config/env';
import { query } from '../db/pool';
import { redis } from '../redis/connection';
import { activePreset, topicsForPreset } from './presets';

// Simulate Karbon trigger (spec §12): signs a synthetic payload with
// KARBON_WEBHOOK_SECRET and POSTs it to the live webhook — the full HMAC +
// idempotency path is exercised. A second call inside the duplicate window
// re-sends the SAME workItemId, so the webhook's idempotency layer answers
// {duplicate:true} and the client shows the duplicate toast.

const DUP_WINDOW_SECONDS = 5;
const LAST_KEY = 'sim:last';

export interface SimulateOutcome {
  duplicate: boolean;
  workItemId: string;
  runIds?: string[];
  runNos?: number[];
}

interface SimPayload {
  workItemId: string;
  stageId: string;
  clientName: string;
  topic: string;
  keywords: string[];
  tone: string;
  painPoint: string;
  sourceInsight: string;
  scheduled?: boolean;
}

async function buildPayload(scheduled: boolean): Promise<SimPayload> {
  const preset = await activePreset();
  const pool = topicsForPreset(preset);
  const idx = (await redis.incr('sim:topic-idx')) - 1;
  const cfg = pool[idx % pool.length];
  const { rows } = await query<{ n: string }>(`SELECT nextval('kb_work_no_seq') AS n`);
  const kb = `KB-${rows[0].n}`;
  return {
    workItemId: kb,
    stageId: 'mkt-ready',
    clientName: cfg.c,
    topic: cfg.t,
    keywords: cfg.k,
    tone: 'Authoritative, plainspoken',
    painPoint: cfg.pp,
    sourceInsight: cfg.src,
    scheduled
  };
}

export async function fireSimulatedTrigger(scheduled = false): Promise<SimulateOutcome> {
  let payload: SimPayload;
  const last = scheduled ? null : await redis.get(LAST_KEY);
  if (last) {
    payload = JSON.parse(last) as SimPayload; // same workItemId ⇒ idempotency duplicate
  } else {
    payload = await buildPayload(scheduled);
    if (!scheduled) await redis.set(LAST_KEY, JSON.stringify(payload), 'EX', DUP_WINDOW_SECONDS);
  }

  const body = JSON.stringify(payload);
  const sig = createHmac('sha256', env.karbon.webhookSecret).update(body, 'utf8').digest('hex');
  const res = await axios.post(`http://127.0.0.1:${env.port}/api/webhooks/karbon`, body, {
    headers: { 'Content-Type': 'application/json', 'X-Karbon-Signature': `sha256=${sig}` },
    timeout: 30_000,
    validateStatus: (s) => s < 500
  });

  if (res.data?.duplicate) {
    return { duplicate: true, workItemId: payload.workItemId };
  }
  return {
    duplicate: false,
    workItemId: payload.workItemId,
    runIds: res.data?.runIds ?? [],
    runNos: res.data?.runNos ?? []
  };
}
