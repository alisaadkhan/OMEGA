#!/usr/bin/env bash
# Password recovery against the LOCAL Supabase stack in a real browser (audit UX-02). Usage: recovery-check.sh
# Needs: `supabase start` (its config.toml allows redirects to http://localhost:5175) and npm install in this folder.
set -u
H="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$H/../.." && pwd)"
LOG="$(node -p "require('os').tmpdir()")/mushin-recovery-vite.log"
STATUS="$(cd "$REPO" && npx supabase status -o json 2>/dev/null)"
field() { printf '%s' "$STATUS" | node -e "let s='';process.stdin.on('data',(d)=>(s+=d)).on('end',()=>{const j=JSON.parse(s);process.stdout.write(String($1??''))})"; }
# The local stack's fixed development keys only; Vite reads these before any .env file.
export VITE_SUPABASE_URL="$(field j.API_URL)"
export VITE_SUPABASE_PUBLISHABLE_KEY="$(field '(j.PUBLISHABLE_KEY??j.ANON_KEY)')"
case "$VITE_SUPABASE_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "local Supabase stack not running"; exit 1 ;; esac
cd "$REPO/frontend" && npx vite --port 5175 --strictPort > "$LOG" 2>&1 &
VITE_PID=$!
for i in $(seq 1 60); do curl -s -m 2 -o /dev/null http://localhost:5175/ && break; sleep 1; done
cd "$REPO" && node "$H/recovery-check.mjs"
RESULT=$?
kill "$VITE_PID" 2>/dev/null
# npx leaves the Vite child running on Windows; stop whatever still listens on :5175.
for pid in $(netstat -ano 2>/dev/null | awk '/:5175 .*LISTENING/ {print $NF}' | sort -u); do taskkill //PID "$pid" //T //F > /dev/null 2>&1; done
exit $RESULT
