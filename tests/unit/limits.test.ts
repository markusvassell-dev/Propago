import { describe, it, expect } from 'vitest';
import { clampInt } from '../../src/utils/num';

describe('MAX_LEAD_MAGNETS_PER_KARBON_TRIGGER clamp (1..3, default 3)', () => {
  it('defaults to 3 when unset/invalid', () => {
    expect(clampInt(undefined, 1, 3, 3)).toBe(3);
    expect(clampInt('', 1, 3, 3)).toBe(3);
    expect(clampInt('abc', 1, 3, 3)).toBe(3);
  });
  it('caps above 3 down to 3 (cannot exceed the spend ceiling)', () => {
    expect(clampInt('5', 1, 3, 3)).toBe(3);
    expect(clampInt(99, 1, 3, 3)).toBe(3);
  });
  it('allows lowering to 1 or 2 to spend less', () => {
    expect(clampInt('1', 1, 3, 3)).toBe(1);
    expect(clampInt('2', 1, 3, 3)).toBe(2);
    expect(clampInt('0', 1, 3, 3)).toBe(1); // floor at 1
  });
});

describe('SEO_MAX_AUTOLOOPS clamp (0..3, default 3)', () => {
  it('clamps to range', () => {
    expect(clampInt(undefined, 0, 3, 3)).toBe(3);
    expect(clampInt('0', 0, 3, 3)).toBe(0);
    expect(clampInt('7', 0, 3, 3)).toBe(3);
  });
});
