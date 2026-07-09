#!/usr/bin/env bash
# Propago — Replit boot script (the Run button executes this; see .replit).
# Starts Redis → installs deps → builds dashboard → applies schema → boots app.
set -euo pipefail

# 1 · Redis (in-workspace, provided by replit.nix)
mkdir -p .redisdata
if ! redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1; then
  redis-server --bind 127.0.0.1 --port 6379 --daemonize yes \
               --dir .redisdata --appendonly yes --save ""
fi
for _ in $(seq 1 40); do
  redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1 && break
  sleep 0.25
done
redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1 || { echo "[boot] Redis failed to start"; exit 1; }
echo "[boot] Redis up on 127.0.0.1:6379"

# 2 · Dependencies (first boot only)
[ -d node_modules ] || npm install
[ -d frontend/node_modules ] || (cd frontend && npm install)

# 3 · Dashboard build — Express serves frontend/dist.
#     Delete frontend/dist (or run `cd frontend && npm run build`) to rebuild.
[ -d frontend/dist ] || (cd frontend && npm run build)

# 4 · Schema — idempotent, safe on every boot. Needs DATABASE_URL, which the
#     built-in Replit SQL database injects once you provision it (Database tool).
npm run db:migrate:dev

# 5 · API + BullMQ workers, single process on 0.0.0.0:$PORT
if [ "${1:-}" = "--prod" ]; then
  [ -d dist ] || npm run build
  exec npm start
else
  exec npm run dev
fi
