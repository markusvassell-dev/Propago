import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { validatePassword, generateResetToken, hashResetToken, MIN_PASSWORD_LENGTH } from '../../src/utils/password';

describe('password policy', () => {
  it('rejects short / weak passwords', () => {
    expect(validatePassword('')).toBeTruthy();
    expect(validatePassword('short1')).toBeTruthy();           // < 8
    expect(validatePassword('allletters')).toBeTruthy();       // no digit
    expect(validatePassword('12345678')).toBeTruthy();         // no letter
    expect(validatePassword(undefined)).toBeTruthy();
    expect(validatePassword(12345678 as unknown)).toBeTruthy(); // non-string
  });
  it('accepts a valid password', () => {
    expect(validatePassword('Sunflower9')).toBeNull();
    expect('correct-horse-battery-9'.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(validatePassword('correct-horse-battery-9')).toBeNull();
  });
});

describe('reset tokens', () => {
  it('generates unpredictable tokens and hashes deterministically', () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThan(20);
    // hash is stable for the same input, differs across inputs, and is not the raw token
    expect(hashResetToken(a)).toEqual(hashResetToken(a));
    expect(hashResetToken(a)).not.toEqual(hashResetToken(b));
    expect(hashResetToken(a)).not.toEqual(a);
    expect(hashResetToken(a)).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
});

describe('bcrypt round-trip (no plaintext stored)', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await bcrypt.hash('Sunflower9', 10);
    expect(hash).not.toContain('Sunflower9');       // hash is not the plaintext
    expect(await bcrypt.compare('Sunflower9', hash)).toBe(true);
    expect(await bcrypt.compare('wrong-pass9', hash)).toBe(false);
  });
});
