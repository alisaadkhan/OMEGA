#!/usr/bin/env bash
# Local Supabase Auth ↔ MUSHIN API check (local stack only; nothing hosted is touched). Usage: auth-check.sh
# Needs: `supabase start` running, PG_BIN, and the local MUSHIN PostgreSQL on :54330.
set -u
H="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$H/../.." && pwd)"
B="${PG_BIN:?set PG_BIN}"
LOG="$(node -p "require('os').tmpdir()")/mushin-supabase-auth-api.log"
"$B/dropdb" -h localhost -p 54330 -U postgres --if-exists mushin_auth_disposable && "$B/createdb" -h localhost -p 54330 -U postgres mushin_auth_disposable || exit 1
cd "$REPO" && source scripts/e2e-customer/env.sh
export DATABASE_URL=postgres://postgres@localhost:54330/mushin_auth_disposable DIRECT_URL=postgres://postgres@localhost:54330/mushin_auth_disposable
export PORT=4200 SUPABASE_URL=http://127.0.0.1:54321 JWKS_URI=http://127.0.0.1:54321/auth/v1/.well-known/jwks.json JWT_ISSUER=http://127.0.0.1:54321/auth/v1 RATE_LIMIT_STORE=memory
# The local stack's own service key (a fixed local development key), so the API can delete Auth users (audit SEC-13).
SUPABASE_SERVICE_ROLE_KEY="$(npx supabase status -o json 2>/dev/null | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.SECRET_KEY??j.SERVICE_ROLE_KEY??"")})')"
export SUPABASE_SERVICE_ROLE_KEY
node --import tsx packages/db/src/migrate-cli.ts > /dev/null || exit 1
node --env-file-if-exists=.env --import tsx apps/api/src/server.ts > "$LOG" 2>&1 &
API_PID=$!
for i in $(seq 1 60); do curl -s -m 2 http://localhost:4200/health/ready | grep -q '"database":"ok"' && break; sleep 1; done
node --import tsx "$H/auth-check.mjs"
STATUS=$?
kill "$API_PID" 2>/dev/null
exit $STATUS
