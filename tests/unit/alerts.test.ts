import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { sendAlert } from '../../src/services/alerts';
import { env } from '../../src/config/env';

// Alerting must never break a workflow: every path here either delivers, or
// logs and returns — it must not throw.

describe('sendAlert', () => {
  const original = { url: env.alerts.webhookUrl, on: [...env.alerts.on] };
  let post: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    post = vi.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: {} } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    env.alerts.webhookUrl = original.url;
    env.alerts.on = [...original.on];
  });

  const unique = (t: string) => `${t} ${Math.random().toString(36).slice(2)}`;

  it('delivers to the configured webhook with a readable text payload', async () => {
    env.alerts.webhookUrl = 'https://hooks.example.com/abc';
    env.alerts.on = ['run_failed'];
    const title = unique('Run failed at "deploy"');

    await sendAlert({ kind: 'run_failed', title, detail: 'HTTP 500', runLabel: 'WF-1042' });

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://hooks.example.com/abc');
    expect(String(body.text)).toContain(title);
    expect(String(body.text)).toContain('HTTP 500');
    expect(String(body.text)).toContain('WF-1042');
    expect(body.kind).toBe('run_failed');
  });

  it('does not deliver a kind that is switched off', async () => {
    env.alerts.webhookUrl = 'https://hooks.example.com/abc';
    env.alerts.on = ['run_failed']; // needs_review disabled
    await sendAlert({ kind: 'needs_review', title: unique('Draft awaiting review') });
    expect(post).not.toHaveBeenCalled();
  });

  it('honours the "all" wildcard', async () => {
    env.alerts.webhookUrl = 'https://hooks.example.com/abc';
    env.alerts.on = ['all'];
    await sendAlert({ kind: 'needs_review', title: unique('Draft awaiting review') });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('logs instead of throwing when no webhook is configured', async () => {
    env.alerts.webhookUrl = '';
    env.alerts.on = ['all'];
    await expect(sendAlert({ kind: 'run_failed', title: unique('No destination') })).resolves.toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });

  it('never throws when delivery fails — a broken webhook must not break a run', async () => {
    env.alerts.webhookUrl = 'https://hooks.example.com/abc';
    env.alerts.on = ['all'];
    post.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await expect(sendAlert({ kind: 'run_failed', title: unique('Delivery blows up') })).resolves.toBeUndefined();
  });

  it('dedupes identical alerts inside the window (a 3-run batch failing once)', async () => {
    env.alerts.webhookUrl = 'https://hooks.example.com/abc';
    env.alerts.on = ['all'];
    const title = unique('Run failed at "generate"');
    await sendAlert({ kind: 'run_failed', title, dedupeSeconds: 60 });
    await sendAlert({ kind: 'run_failed', title, dedupeSeconds: 60 });
    await sendAlert({ kind: 'run_failed', title, dedupeSeconds: 60 });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
