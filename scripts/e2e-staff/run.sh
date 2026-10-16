#!/usr/bin/env bash
# One staff-console smoke run from a clean state (local only). Usage: run.sh <label>
# Needs: PG_BIN, and Vite serving the frontend on :5174 with PORT=4100 (so /api proxies to this harness's API):
#   (cd frontend && PORT=4100 npx vite --port 5174 --strictPort)
set -u
LABEL=$1
H="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$H/../.." && pwd)"
B="${PG_BIN:?set PG_BIN}"
E="${E2E_STAFF_OUT:-$(node -p "require('path').join(require('os').tmpdir(), 'mushin-e2e-staff').split(require('path').sep).join('/')")}"
export E2E_STAFF_OUT="$E"
mkdir -p "$E"
[ -f "$E/api.pid" ] && kill "$(cat "$E/api.pid")" 2>/dev/null; rm -f "$E/api.pid"
"$B/psql" -h localhost -p 54330 -U postgres -d postgres -qAtc "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'mushin_e2e_team'" >/dev/null
"$B/dropdb" -h localhost -p 54330 -U postgres --if-exists mushin_e2e_team && "$B/createdb" -h localhost -p 54330 -U postgres mushin_e2e_team || exit 1
cd "$REPO" && source "$H/env.sh"
node --import tsx packages/db/src/migrate-cli.ts > "$E/migrate-$LABEL.log" 2>&1 || { echo "migration failed"; exit 1; }
node --env-file-if-exists=.env --import tsx "$H/seed-staff.ts" || exit 1
node --env-file-if-exists=.env --import tsx apps/api/src/server.ts > "$E/api-$LABEL.log" 2>&1 & echo $! > "$E/api.pid"
for i in $(seq 1 60); do curl -s -m 2 http://localhost:4100/health/ready | grep -q '"database":"ok"' && break; sleep 1; done
cd "$H" && node journey.mjs "$LABEL"
STATUS=$?
kill "$(cat "$E/api.pid")" 2>/dev/null; rm -f "$E/api.pid"
exit $STATUS
