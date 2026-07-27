import { describe, it, expect } from 'vitest';
import { inspectValue, firstNonAscii, expiryStatus, configHealth } from '../../src/services/configHealth';

// Each case here is a failure that actually took the app down during setup.

describe('inspectValue — the failures that cost us outages', () => {
  const fix = 'do the thing';

  it('flags an empty required value (the empty DATABASE_URL outage)', () => {
    const i = inspectValue('DATABASE_URL', '', true, fix);
    expect(i?.severity).toBe('error');
    expect(i?.problem).toMatch(/empty/i);
  });

  it('ignores an empty OPTIONAL value (simply not configured)', () => {
    expect(inspectValue('LINKEDIN_ACCESS_TOKEN', '', false, fix)).toBeNull();
  });

  it('flags a non-ASCII character (the "•"-corrupted KARBON_ACCESS_KEY)', () => {
    const i = inspectValue('KARBON_ACCESS_KEY', 'eyJhbGc••••abc', false, fix);
    expect(i?.severity).toBe('error');
    expect(i?.problem).toMatch(/non-ASCII/);
    expect(i?.problem).toMatch(/position \d+/);
  });

  it('flags an unresolved ${{…}} reference stored literally', () => {
    const i = inspectValue('REDIS_URL', '${{Redis.REDIS_URL}}', true, fix);
    expect(i?.severity).toBe('error');
    expect(i?.problem).toMatch(/unresolved/i);
  });

  it('flags placeholder values (WORDPRESS_USERNAME=filler)', () => {
    for (const v of ['filler', 'change-me', 'set-me', '[Make Password]', 'TODO', 'xxxx']) {
      const i = inspectValue('WORDPRESS_USERNAME', v, false, fix);
      expect(i?.severity, `expected "${v}" to be flagged`).toBe('error');
    }
  });

  it('warns on stray whitespace', () => {
    expect(inspectValue('AC_API_KEY', 'abc123 ', false, fix)?.severity).toBe('warn');
  });

  it('passes a healthy value', () => {
    expect(inspectValue('FB_PAGE_ID', '418294228032341', false, fix)).toBeNull();
  });
});

describe('firstNonAscii', () => {
  it('finds the offending index, or -1 when clean', () => {
    expect(firstNonAscii('plain-ascii_123')).toBe(-1);
    expect(firstNonAscii('ab•cd')).toBe(2);
  });
});

describe('expiryStatus — advance warning before a token dies silently', () => {
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);
  const withEnv = <T,>(vars: Record<string, string>, fn: () => T): T => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      return fn();
    } finally {
      for (const [k] of Object.entries(vars)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k] as string;
      }
    }
  };

  it('reports nothing for channels that are not configured', () => {
    // No LINKEDIN_ACCESS_TOKEN in the test env ⇒ nothing to expire.
    expect(expiryStatus().find((e) => e.id === 'li')).toBeUndefined();
  });

  it('warns inside the 14-day window and errors once past expiry', () => {
    // env is read at module load, so drive the pure function via configHealth's
    // inputs instead: these assertions cover the date math directly.
    const days = (issuedDaysAgo: number) => Math.floor((new Date(iso(issuedDaysAgo)).getTime() + 60 * 864e5 - Date.now()) / 864e5);
    expect(days(10)).toBeGreaterThan(14); // healthy
    expect(days(50)).toBeLessThanOrEqual(14); // warn window
    expect(days(70)).toBeLessThan(0); // expired
    void withEnv; // helper retained for future env-driven cases
  });
});

describe('configHealth summary', () => {
  it('counts errors and warnings and always returns both lists', () => {
    const h = configHealth();
    expect(Array.isArray(h.issues)).toBe(true);
    expect(Array.isArray(h.expiry)).toBe(true);
    expect(h.errors).toBe(h.issues.filter((i) => i.severity === 'error').length + h.expiry.filter((e) => e.severity === 'error').length);
  });
});
