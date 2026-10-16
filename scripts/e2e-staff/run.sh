#!/usr/bin/env bash
# One staff-console smoke run from a clean state (local only). Usage: run.sh <label>
# Needs: PG_BIN, the customer harness template database mushin_e2e_template (its catalogue gives the eligibility
# coverage card real counts), and Vite serving the frontend on :5174 with PORT=4100 (so /api proxies to this harness's API):
#   (cd frontend && PORT=4100 npx vite --port 5174 --strictPort)
set -u
LABEL=$1
H="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$H/../.." && pwd)"
B="${PG_BIN:?set PG_BIN}"
E="${E2E_STAFF_OUT:-$(node -p "require('path').join(require('os').tmpdir(), 'mushin-e2e-staff').split(require('path').sep).join('/')")}"
export E2E_STAFF_OUT="$E"
mkdir -p "$E"
for f in "$E/api.pid" "$E/worker.pid"; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; rm -f "$f"; done
"$B/psql" -h localhost -p 54330 -U postgres -d postgres -qAtc "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'mushin_e2e_team'" >/dev/null
"$B/dropdb" -h localhost -p 54330 -U postgres --if-exists mushin_e2e_team && "$B/createdb" -h localhost -p 54330 -U postgres -T mushin_e2e_template mushin_e2e_team || exit 1
cd "$REPO" && source "$H/env.sh"
node --import tsx packages/db/src/migrate-cli.ts > "$E/migrate-$LABEL.log" 2>&1 || { echo "migration failed"; exit 1; }
node --env-file-if-exists=.env --import tsx "$H/seed-staff.ts" || exit 1
node --env-file-if-exists=.env --import tsx apps/api/src/server.ts > "$E/api-$LABEL.log" 2>&1 & echo $! > "$E/api.pid"
# The worker's start-up reconcile computes each creator's eligibility in the search documents (as after a deploy).
node --env-file-if-exists=.env --import tsx apps/worker/src/main.ts > "$E/worker-$LABEL.log" 2>&1 & echo $! > "$E/worker.pid"
for i in $(seq 1 90); do curl -s -m 2 http://localhost:4100/health/ready | grep -q '"database":"ok"' && grep -q "reconciled at start-up" "$E/worker-$LABEL.log" && break; sleep 1; done
cd "$H" && node journey.mjs "$LABEL"
STATUS=$?
for f in "$E/api.pid" "$E/worker.pid"; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; rm -f "$f"; done
exit $STATUS
