import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { env } from './config/env';
import { authRouter } from './routes/auth.routes';
import { apiRouter, publicLeadsRouter } from './routes/api.routes';
import { webhookRouter } from './routes/webhook.routes';
import { magnetsRouter } from './routes/magnets.routes';
import { pool } from './db/pool';
import { redis } from './redis/connection';

export function buildServer(): express.Express {
  const app = express();
  app.set('trust proxy', 1); // Railway sits behind a proxy

  // Webhooks FIRST — they need the raw body, so they mount before express.json().
  app.use('/api/webhooks', webhookRouter);

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Railway health check target — verifies Postgres + Redis, but EACH check is
  // time-boxed. ioredis is configured with maxRetriesPerRequest:null, so a
  // command issued before the connection is ready would otherwise queue and
  // hang forever; that would make a single /healthz request never resolve and
  // Railway's healthcheck time out (deploy killed in a restart loop). With the
  // timeout, an unready dependency returns a fast 503 instead — Railway retries
  // every few seconds and the deploy goes green as soon as Redis connects.
  const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} check timed out after ${ms}ms`)), ms))
    ]);

  app.get('/healthz', async (_req: Request, res: Response) => {
    try {
      await withTimeout(pool.query('SELECT 1'), 4000, 'postgres');
      await withTimeout(redis.ping(), 4000, 'redis');
      res.json({ ok: true });
    } catch (err) {
      res.status(503).json({ ok: false, error: (err as Error).message });
    }
  });

  // Public lead-magnet PDFs (rendered in-process since the Replit offload was
  // retired) — no auth: these links go out in emails and published posts.
  app.use('/magnets', magnetsRouter);

  app.use('/api/auth', authRouter);
  // Public lead-capture endpoint (magnet sign-up forms POST here — no auth).
  app.use('/api/leads', publicLeadsRouter);
  app.use('/api', apiRouter);

  // Serve the built React dashboard (single-service topology).
  const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
  app.use(express.static(frontendDist));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'), (err) => err && next());
  });

  // Central error handler — never leak stack traces to clients.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[http]', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
