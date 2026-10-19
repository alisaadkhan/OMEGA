#!/usr/bin/env bash
# One command per browser suite (OPS-06): npm run e2e:customer [-- <runs>]  /  npm run e2e:staff [-- <runs>]
# Starts everything a run needs and nothing remote: the E2E sign-in stub, Vite pointed at that stub (so the browser
# never contacts a hosted Supabase project), the synthetic template (rebuilt from the migrations and the fictional
# catalogue), then the suite's run.sh for each run, and stops only what it started.
# Needs: PostgreSQL on localhost:54330 (PG_BIN, or psql on PATH), Chrome (CHROME_PATH or the default install path),
# `npm install` in scripts/e2e-customer (playwright-core, axe-core). No .env is read for the browser settings.
set -u
SUITE="${1:?usage: run-suite.sh customer|staff [runs]}"
RUNS="${2:-1}"
H="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$H/../.." && pwd)"
if [ -z "${PG_BIN:-}" ]; then PG_BIN="$(dirname "$(command -v psql 2>/dev/null || echo /missing/psql)")"; fi
[ -x "$PG_BIN/psql" ] || [ -x "$PG_BIN/psql.exe" ] || { echo "Set PG_BIN to the PostgreSQL client binaries"; exit 2; }
export PG_BIN
case "$SUITE" in
  customer) STUB="$REPO/scripts/e2e-customer/auth-stub.mjs"; STUB_PORT=4999; VITE_PORT=5173; API_PORT=4000; RUNNER="$REPO/scripts/e2e-customer/run.sh" ;;
  staff) STUB="$REPO/scripts/e2e-staff/stub.mjs"; STUB_PORT=4998; VITE_PORT=5174; API_PORT=4100; RUNNER="$REPO/scripts/e2e-staff/run.sh" ;;
  *) echo "suite must be customer or staff"; exit 2 ;;
esac
LOGS="$(node -p "require('path').join(require('os').tmpdir(), 'mushin-e2e-suite').split(require('path').sep).join('/')")"
mkdir -p "$LOGS"
# Something listens on the port, on IPv4 or IPv6 localhost (Vite binds ::1 on Windows).
busy() { node -e "const net=require('net');const t=(h)=>new Promise((r)=>{const s=net.connect($1,h);s.on('connect',()=>{s.end();r(true)});s.on('error',()=>r(false))});Promise.all([t('127.0.0.1'),t('::1')]).then((a)=>process.exit(a.some(Boolean)?0:1))"; }
for p in $STUB_PORT $VITE_PORT $API_PORT; do
  if busy "$p"; then echo "Port $p is already in use; stop that process first (this script never stops processes it did not start)."; exit 2; fi
done

PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; }
trap cleanup EXIT

bash "$REPO/scripts/e2e-fixtures/build-template.sh" > "$LOGS/template.log" 2>&1 || { tail -5 "$LOGS/template.log"; echo "template build failed"; exit 1; }
node "$STUB" > "$LOGS/stub-$SUITE.log" 2>&1 & PIDS+=($!)
# The browser signs in against the local stub only; supabase-js keeps the session under sb-localhost-auth-token.
( cd "$REPO/frontend" && PORT=$API_PORT VITE_SUPABASE_URL="http://localhost:$STUB_PORT" VITE_SUPABASE_PUBLISHABLE_KEY="e2e-publishable-key-not-a-secret" \
  exec node node_modules/vite/bin/vite.js --port $VITE_PORT --strictPort ) > "$LOGS/vite-$SUITE.log" 2>&1 & PIDS+=($!)
export E2E_SUPABASE_REF=localhost
for i in $(seq 1 60); do busy $STUB_PORT && busy $VITE_PORT && break; sleep 1; done
busy $VITE_PORT || { tail -5 "$LOGS/vite-$SUITE.log"; echo "Vite did not start"; exit 1; }

STATUS=0
STAMP="$(date +%Y%m%d-%H%M%S)"
for r in $(seq 1 "$RUNS"); do
  LABEL="$SUITE-$STAMP-$r"
  bash "$RUNNER" "$LABEL" > "$LOGS/$LABEL.log" 2>&1
  CODE=$?
  grep -E '^\{"label"' "$LOGS/$LABEL.log" || echo "{\"label\":\"$LABEL\",\"error\":\"no result, see $LOGS/$LABEL.log\"}"
  grep -E '^FAIL' "$LOGS/$LABEL.log" | head -20
  if [ $CODE -ne 0 ] || grep -qE '^FAIL' "$LOGS/$LABEL.log" || ! grep -qE '^\{"label"' "$LOGS/$LABEL.log"; then STATUS=1; fi
done
echo "logs: $LOGS"
exit $STATUS
