import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { query } from '../db/pool';
import { redis } from '../redis/connection';
import { requireAuth, SESSION_COOKIE, sessionKey, JwtClaims } from '../middleware/auth';

export const authRouter = Router();

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
