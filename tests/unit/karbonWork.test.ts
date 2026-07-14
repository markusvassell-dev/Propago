import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import {
  extractResourcePermaKey,
  extractStatuses,
  matchesStatus,
  statusVersion,
  buildTrigger
} from '../../src/services/karbonWork';
import { karbonSignatureValid } from '../../src/middleware/karbonWebhookSig';
import sample from '../fixtures/karbonWorkWebhook.json';

describe('extractResourcePermaKey', () => {
  it('reads the key from the top-level or nested shapes', () => {
    expect(extractResourcePermaKey(sample)).toBe('3aBcQ2WorkItemPermaKeyExample');
    expect(extractResourcePermaKey({ WorkItemKey: 'WI-1' })).toBe('WI-1');
    expect(extractResourcePermaKey({ Resource: { PermaKey: 'RP-2' } })).toBe('RP-2');
    expect(extractResourcePermaKey({ Data: { ResourcePermaKey: 'D-3' } })).toBe('D-3');
    expect(extractResourcePermaKey({})).toBe('');
    expect(extractResourcePermaKey(null)).toBe('');
  });
});

describe('status extraction + matching (not just legacy WorkStatus)', () => {
  it('reads primary/secondary/work status fields', () => {
    const s = extractStatuses(sample as Record<string, unknown>);
    expect(s.primary).toBe('Ready for Propago');
    expect(s.work).toBe('In Progress');
  });

  it('matches the activation status case-insensitively against ANY status field', () => {
    expect(matchesStatus(sample as Record<string, unknown>, 'Ready for Propago')).toBe(true);
    expect(matchesStatus(sample as Record<string, unknown>, 'ready FOR propago')).toBe(true);
    // WorkStatus also counts, not only PrimaryStatus:
    expect(matchesStatus({ WorkStatus: 'Blank' }, 'Blank')).toBe(true);
    expect(matchesStatus({ SecondaryStatus: 'Propago Complete' }, 'Propago Complete')).toBe(true);
    expect(matchesStatus(sample as Record<string, unknown>, 'Propago Complete')).toBe(false);
    expect(matchesStatus({}, 'Ready for Propago')).toBe(false);
    expect(matchesStatus(sample as Record<string, unknown>, '')).toBe(false);
  });
});

describe('statusVersion — dedup stamp', () => {
  it('uses LastActivityDate when present, else a stable fallback', () => {
    expect(statusVersion(sample as Record<string, unknown>)).toBe('2026-07-14T15:30:00Z');
    expect(statusVersion({ Version: 7 })).toBe('7');
    expect(statusVersion({})).toBe('v0');
  });
});

describe('buildTrigger', () => {
  it('maps work-item fields into a KarbonTrigger', () => {
    const t = buildTrigger(sample as Record<string, unknown>, sample as Record<string, unknown>, 'WI-9', 'Ready for Propago');
    expect(t.workItemId).toBe('WI-9');
    expect(t.stageId).toBe('Ready for Propago'); // batch keyed by activation status
    expect(t.topic).toContain('cash flow forecasting');
    expect(t.clientName).toBe('Halcyon Occupational Health');
    expect(Array.isArray(t.keywords)).toBe(true);
  });

  it('falls back to a safe topic when the title is missing', () => {
    const t = buildTrigger({}, {}, 'WI-X', 'Ready for Propago');
    expect(t.topic).toContain('WI-X');
  });
});

describe('karbonSignatureValid — HMAC-SHA256 over the raw body', () => {
  const key = 'test-signing-key';
  const body = Buffer.from(JSON.stringify(sample));

  it('accepts a correct hex OR base64 signature', () => {
    const hex = createHmac('sha256', key).update(body).digest('hex');
    const b64 = createHmac('sha256', key).update(body).digest('base64');
    expect(karbonSignatureValid(body, hex, key)).toBe(true);
    expect(karbonSignatureValid(body, b64, key)).toBe(true);
  });

  it('rejects a wrong signature, wrong key, or tampered body', () => {
    const hex = createHmac('sha256', key).update(body).digest('hex');
    expect(karbonSignatureValid(body, 'deadbeef', key)).toBe(false);
    expect(karbonSignatureValid(body, hex, 'other-key')).toBe(false);
    expect(karbonSignatureValid(Buffer.from(body.toString() + 'x'), hex, key)).toBe(false);
    expect(karbonSignatureValid(body, '', key)).toBe(false);
  });
});
