import axios from 'axios';
import { env } from '../config/env';
import { redis } from '../redis/connection';

// Outbound alerts.
//
// Everything in this app already logs, but nobody reads logs — the OpenAI
// credit outage sat unnoticed for days because a parked run makes no noise, and
// a run waiting at the review gate is equally silent. These push the two events
// that actually need a human to somewhere a human looks.
//
// Delivery is a single generic webhook (ALERT_WEBHOOK_URL). The payload is
// Slack/Discord-compatible ({text}) and also carries structured fields, so the
// same URL works for Slack, Discord, or a Zapier/Make hook that forwards to
// email. No new dependency, and nothing to configure when it's switched off.

export type AlertKind = 'run_failed' | 'needs_review' | 'batch_complete' | 'config';

export interface Alert {
  kind: AlertKind;
  title: string;
  detail?: string;
  runLabel?: string;
  runId?: string;
  /** Suppress repeats of the same thing for this many seconds (default 300). */
  dedupeSeconds?: number;
}

const EMOJI: Record<AlertKind, string> = {
  run_failed: '🔴',
  needs_review: '📝',
  batch_complete: '✅',
  config: '⚙️'
};

/** Alert types the operator wants delivered (ALERT_ON, comma list). */
function enabled(kind: AlertKind): boolean {
  const on = env.alerts.on;
  return on.includes('all') || on.includes(kind);
}

/**
 * Fire-and-forget: alerting must never break a workflow, so every failure here
 * is logged and swallowed. Deduped in Redis so a batch of three runs failing
 * for the same reason doesn't send three identical messages.
 */
export async function sendAlert(a: Alert): Promise<void> {
  const line = `${EMOJI[a.kind]} ${a.title}${a.detail ? ` — ${a.detail}` : ''}`;

  if (!enabled(a.kind)) {
    console.info(`[alert:skipped] ${line} (ALERT_ON=${env.alerts.on.join(',') || 'none'})`);
    return;
  }

  // Dedupe on kind+title so repeated identical alerts stay quiet for a window.
  try {
    const key = `alert:${a.kind}:${Buffer.from(a.title).toString('base64').slice(0, 60)}`;
    const first = await redis.set(key, '1', 'EX', a.dedupeSeconds ?? 300, 'NX');
    if (first !== 'OK') {
      console.info(`[alert:deduped] ${line}`);
      return;
    }
  } catch {
    // Redis unavailable — still try to deliver rather than dropping the alert.
  }

  if (!env.alerts.webhookUrl) {
    // No destination configured: the log line is the alert.
    console.warn(`[alert] ${line} (set ALERT_WEBHOOK_URL to deliver these)`);
    return;
  }

  const runUrl = a.runId && env.appBaseUrl ? `${env.appBaseUrl.replace(/\/$/, '')}/runs` : undefined;
  const text = [line, a.runLabel ? `Run: ${a.runLabel}` : '', runUrl ? `Open: ${runUrl}` : '']
    .filter(Boolean)
    .join('\n');

  try {
    await axios.post(
      env.alerts.webhookUrl,
      { text, kind: a.kind, title: a.title, detail: a.detail ?? '', run: a.runLabel ?? '', url: runUrl ?? '' },
      { timeout: 8000 }
    );
    console.info(`[alert:sent] ${line}`);
  } catch (err) {
    const msg = axios.isAxiosError(err) ? `${err.response?.status ?? ''} ${err.message}`.trim() : String(err);
    console.warn(`[alert:failed] ${line} — delivery error: ${msg}`);
  }
}
