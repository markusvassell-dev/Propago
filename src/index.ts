import { buildServer } from './server';
import { startWorkers } from './workers';
import { env } from './config/env';
import { pool } from './db/pool';
import { redis, closeRedis } from './redis/connection';
import { closeQueues, configureScheduler } from './queues/queues';
import { getSetting } from './services/presets';

// Single-service topology: HTTP API + BullMQ workers in one process. This is
// the simplest Railway deployment; to scale, run `node dist/index.js --worker`
// as a second Railway service and `--web` as the first.

const mode = process.argv.includes('--worker') ? 'worker' : process.argv.includes('--web') ? 'web' : 'all';

/** Connection string with credentials stripped — safe for deploy logs. */
function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.username ? `${u.username}:***@` : ''}${u.hostname}:${u.port || '(default)'}${u.pathname}`;
  } catch {
    return '(unparseable URL)';
  }
}

const timed = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms))]);

/**
 * Boot diagnostics: probe Postgres + Redis and say EXACTLY what we're dialing
 * and what came back, so a failed Railway healthcheck is explained by the
 * deploy logs instead of a bare 503. Retries every 10s (max 12) so the logs
 * also show a dependency that comes up late.
 */
function bootDiagnostics(): void {
  const probe = async (attempt: number): Promise<void> => {
    let pgOk = false;
    let redisOk = false;
    try {
      await timed(pool.query('SELECT 1'), 5000);
      pgOk = true;
      console.info(`[boot] postgres OK — ${redactUrl(env.databaseUrl)}`);
    } catch (err) {
      console.error(
        `[boot] postgres FAILED — dialing ${redactUrl(env.databaseUrl)} → ${(err as Error).message}\n` +
          `[boot]   hint: on Railway, DATABASE_URL should be the reference variable \${{Postgres.DATABASE_URL}}. ` +
          `If it points at a public *.rlwy.net proxy host, also set DATABASE_SSL=true.`
      );
    }
    try {
      await timed(redis.ping(), 5000);
      redisOk = true;
      console.info(`[boot] redis OK — ${redactUrl(env.redisUrl)}`);
    } catch (err) {
      console.error(
        `[boot] redis FAILED — dialing ${redactUrl(env.redisUrl)} → ${(err as Error).message} (status: ${redis.status})\n` +
          `[boot]   hint: on Railway, REDIS_URL should be the reference variable \${{Redis.REDIS_URL}}. ` +
          `Internal *.railway.internal hosts are IPv6-only; public proxy URLs must include the password.`
      );
    }
    if (pgOk && redisOk) {
      console.info('[boot] all dependencies reachable — /healthz will return 200');
      return;
    }
    if (attempt < 12) setTimeout(() => void probe(attempt + 1), 10_000);
    else console.error('[boot] giving up on dependency probes after 12 attempts — /healthz stays 503 until config is fixed');
  };
  void probe(1);
}

async function main(): Promise<void> {
  // Bind the HTTP server FIRST so Railway's healthcheck sees an open port and a
  // responsive /healthz within ~1s of boot. Workers (which open blocking Redis
  // connections) start afterwards and can never delay the server coming up — a
  // slow/unready Redis must not fail the deploy.
  if (mode !== 'worker') {
    const app = buildServer();
    // RAILWAY CRITICAL (rule 4): bind 0.0.0.0 and use process.env.PORT.
    // Railway assigns the port dynamically; hardcoding localhost:3000 makes
    // the health check unreachable and the deploy gets killed.
    app.listen(env.port, env.host, () => {
      console.info(`[server] listening on http://${env.host}:${env.port} (${env.nodeEnv})`);
    });
  }

  bootDiagnostics();

  const workers = mode !== 'web' ? startWorkers() : [];

  if (mode !== 'web') {
    // Re-arm (or clear) the bi-weekly auto-runner from the persisted setting.
    getSetting<boolean>('scheduler_enabled', true)
      .then((on) => configureScheduler(on))
      .catch((err) => console.error('[scheduler] configure failed', err.message));
  }

  const shutdown = async (signal: string) => {
    console.info(`[shutdown] ${signal} — draining…`);
    await Promise.allSettled([
      ...workers.map((w) => w.close()),
      closeQueues(),
      closeRedis(),
      pool.end()
    ]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM')); // Railway sends SIGTERM on redeploy
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
