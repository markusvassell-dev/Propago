import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { query } from '../db/pool';
import { redis } from '../redis/connection';
import { requireAuth, SESSION_COOKIE, sessionKey, JwtClaims } from '../middleware/auth';
import {
  validatePassword,
  generateResetToken,
  hashResetToken,
  RESET_TOKEN_TTL_HOURS
} from '../utils/password';

export const authRouter = Router();

const BCRYPT_COST = 10;

/**
 * Mint a single-use set/reset-password token for a user. Only the token HASH is
 * stored; the RAW token is returned once and delivered out-of-band (a link the
 * admin shares, or an emailed reset). Reused by the invite flow and admin reset.
 * Never log the returned raw token.
 */
export async function createResetToken(userId: string, purpose: 'invite' | 'reset'): Promise<string> {
  const raw = generateResetToken();
  const expires = new Date(Date.now() + RESET_TOKEN_TTL_HOURS * 3600 * 1000);
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, hashResetToken(raw), purpose, expires]
  );
  return raw;
}

/** Revoke every live session for a user (called after a password change). */
async function revokeUserSessions(userId: string): Promise<void> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [userId]
  );
  for (const s of rows) await redis.del(sessionKey(s.id));
  await query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: 'admin' | 'reviewer' | 'editor';
}

const handleOf = (u: UserRow) => `${u.first_name[0].toLowerCase()}.${u.last_name.toLowerCase()}`;

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response) => {
  const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
  if (!password) {
    // Spec §4 (production variant): empty-password copy.
    res.status(422).json({ error: 'password_required', message: 'Enter your password.' });
    return;
  }
  if (!email) {
    res.status(422).json({ error: 'email_required', message: 'Enter your email.' });
    return;
  }

  const { rows } = await query<UserRow>('SELECT * FROM users WHERE email = $1', [
    email.trim().toLowerCase()
  ]);
  const user = rows[0];
  if (!user) {
    // Invite-only (spec §4): unknown email gets the explicit invite message.
    res.status(401).json({
      error: 'unknown_email',
      message: "Invite-only — that email hasn't been invited. Ask an admin to add you in Settings → Team."
    });
    return;
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: 'invalid_credentials', message: 'Incorrect email or password.' });
    return;
  }

  const jti = randomUUID();
  const ttlSeconds = env.sessionTtlHours * 3600;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  // Redis = fast-path session store; Postgres row = durable audit copy.
  await redis.set(sessionKey(jti), user.id, 'EX', ttlSeconds);
  await query(
    `INSERT INTO sessions (id, user_id, user_agent, ip, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [jti, user.id, req.header('user-agent') ?? null, req.ip, expiresAt]
  );

  const claims: Omit<JwtClaims, 'exp'> = {
    sub: user.id,
    jti,
    role: user.role,
    handle: handleOf(user),
    email: user.email
  };
  const token = jwt.sign(claims, env.jwtSecret, { expiresIn: ttlSeconds });

  res
    .cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env.isProd,
      sameSite: 'lax',
      maxAge: ttlSeconds * 1000
    })
    .json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        handle: handleOf(user)
      }
    });
});

// POST /api/auth/logout
authRouter.post('/logout', requireAuth, async (req: Request, res: Response) => {
  if (req.sessionJti) {
    await redis.del(sessionKey(req.sessionJti));
    await query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [req.sessionJti]);
  }
  res.clearCookie(SESSION_COOKIE).json({ ok: true });
});

// POST /api/auth/set-password  { token, password }
// Public (the caller proves identity by holding the single-use token). Used by
// invited users to choose their first password AND by password resets.
authRouter.post('/set-password', async (req: Request, res: Response) => {
  const { token, password } = (req.body ?? {}) as { token?: string; password?: string };
  if (!token || typeof token !== 'string') {
    res.status(422).json({ error: 'token_required', message: 'Missing or invalid set-password link.' });
    return;
  }
  const pwError = validatePassword(password);
  if (pwError) {
    res.status(422).json({ error: 'weak_password', message: pwError });
    return;
  }

  const { rows } = await query<{ id: string; user_id: string; used_at: string | null; expires_at: string }>(
    `SELECT id, user_id, used_at, expires_at FROM password_reset_tokens WHERE token_hash = $1`,
    [hashResetToken(token)]
  );
  const t = rows[0];
  const invalid = !t || t.used_at !== null || new Date(t.expires_at).getTime() < Date.now();
  if (invalid) {
    // Same response whether unknown, used, or expired — no token oracle.
    res.status(400).json({ error: 'invalid_token', message: 'This link is invalid or has expired. Ask an admin for a new one.' });
    return;
  }

  const hash = await bcrypt.hash(password as string, BCRYPT_COST);
  await query(`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, [hash, t.user_id]);
  await query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [t.id]);
  // Any other outstanding invite/reset tokens for this user are now moot.
  await query(`UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [t.user_id]);
  await revokeUserSessions(t.user_id); // force re-login everywhere with the new password
  console.info(`[auth] password set for user ${t.user_id} (token consumed)`); // no password / token in log
  res.json({ ok: true });
});

// GET /api/auth/me
authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const { rows } = await query<UserRow>(
    'SELECT id, email, password_hash, first_name, last_name, role FROM users WHERE id = $1',
    [req.user!.id]
  );
  const u = rows[0];
  if (!u) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  res.json({
    user: {
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      lastName: u.last_name,
      role: u.role,
      handle: handleOf(u)
    }
  });
});
