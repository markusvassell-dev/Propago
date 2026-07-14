import { createHash, randomBytes } from 'crypto';

// Password policy + single-use token helpers for the set/reset-password flow.
// Deliberately dependency-light and side-effect-free so it is unit-testable
// without a database. NEVER log passwords or raw tokens.

export const MIN_PASSWORD_LENGTH = 8;
export const RESET_TOKEN_TTL_HOURS = 168; // 7 days

/** Returns an error string when the password is unacceptable, or null when OK. */
export function validatePassword(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'Password is required.';
  if (pw.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (pw.length > 200) return 'Password must be 200 characters or fewer.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain at least one letter and one number.';
  return null;
}

/** Cryptographically-random single-use token (URL-safe). The RAW value is shown once. */
export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only the HASH is stored; lookups hash the presented token and compare. */
export function hashResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}
