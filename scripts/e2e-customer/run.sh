#!/usr/bin/env bash
# One full customer E2E run from a clean state. Usage: run.sh <label>
# Needs: PG_BIN (PostgreSQL client binaries), E2E_SUPABASE_REF, auth-stub.mjs running, Meilisearch and the frontend dev server (:5173),
# and the template from scripts/e2e-fixtures/build-template.sh (synthetic catalogue; E2E_TEMPLATE overrides it).
set -u
LABEL=$1
H="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$H/../.." && pwd)"
B="${PG_BIN:?set PG_BIN}"
# Same default folder as journey.mjs and auth-stub.mjs (the OS temp directory).
E="${E2E_OUT:-$(node -p "require('path').join(require('os').tmpdir(), 'mushin-e2e').split(require('path').sep).join('/')")}"
export E2E_OUT="$E"
mkdir -p "$E"
stop() { for f in "$E/api.pid" "$E/worker.pid"; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; rm -f "$f"; done; sleep 2; }
start() {
  local P=$1
  cd "$REPO" && source "$H/env.sh"
  node --env-file-if-exists=.env --env-file-if-exists=.env.meilisearch --import tsx apps/api/src/server.ts > "$E/api-$LABEL-$P.log" 2>&1 & echo $! > "$E/api.pid"
  node --env-file-if-exists=.env --env-file-if-exists=.env.meilisearch --import tsx apps/worker/src/main.ts > "$E/worker-$LABEL-$P.log" 2>&1 & echo $! > "$E/worker.pid"
  for i in $(seq 1 60); do curl -s -m 2 http://localhost:4000/health/ready | grep -q '"database":"ok"' && grep -q "reconciled at start-up" "$E/worker-$LABEL-$P.log" && return 0; sleep 1; done
  echo "services did not become ready: $(curl -s -m 2 http://localhost:4000/health/ready) (a dependency configured in .env, such as Meilisearch, may be down)"; return 1
}
stop
"$B/psql" -h localhost -p 54330 -U postgres -d postgres -qAtc "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'mushin_e2e'" >/dev/null
"$B/dropdb" -h localhost -p 54330 -U postgres --if-exists mushin_e2e && "$B/createdb" -h localhost -p 54330 -U postgres -T "${E2E_TEMPLATE:-mushin_e2e_synthetic_template}" mushin_e2e || exit 1
# A failed start stops what it started, so a later run is not blocked by an orphaned API on :4000 (acceptance 2026-10-20).
start main || { stop; exit 1; }
cd "$H" && node journey.mjs "$LABEL" main
# Break-it pass (2026-10-26): new workflows, lost responses, double clicks, cross-workspace ids, concurrent spending.
cd "$H" && node breakit.mjs "$LABEL"
stop; start restart || { stop; exit 1; }
cd "$H" && node journey.mjs "$LABEL" after-restart
stop
