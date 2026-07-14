import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import 'dotenv/config';

// Applies db/schema.sql (idempotent DDL). Usage: npm run db:migrate
//
// Runs as Railway's preDeployCommand — a separate one-off container, decoupled
// from the HTTP server start so a slow/hanging DB shutdown can never delay the
// server binding or the /healthz healthcheck.

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    // Fail fast with a clear error instead of hanging if the DB is unreachable.
    connectionTimeoutMillis: 15_000
  });
  const sql = readFileSync(join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.info('[migrate] schema applied');
  // pool.end() can hang against a networked Postgres (idle keep-alive clients),
  // which previously stopped the process from exiting and — when the migration
  // was chained to the server start — kept the server from ever binding. Cap it
  // and exit explicitly so this step always terminates promptly.
  await Promise.race([pool.end(), new Promise((r) => setTimeout(r, 3000))]);
  console.info('[migrate] done');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] failed', err);
  process.exit(1);
});
