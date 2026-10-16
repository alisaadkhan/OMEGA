#!/usr/bin/env bash
# Game-day drill for alert delivery (audit OPS-03): a stopped worker must raise an alert at the team's webhook within
# 10 minutes. Local only: a disposable database, the API and worker without paid provider keys, and a local webhook
# receiver standing in for the chat channel. Usage: PG_BIN=... alert-drill.sh   (takes about 8 minutes)
set -u
H="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$H/../.." && pwd)"
B="${PG_BIN:?set PG_BIN}"
DB=mushin_alertdrill_disposable
T="$(node -p "require('os').tmpdir()")/mushin-alert-drill"
mkdir -p "$T" && rm -f "$T"/*.log "$T/received.jsonl"
psql() { "$B/psql" -h localhost -p 54330 -U postgres -d "$DB" -Atc "$1"; }
"$B/dropdb" -h localhost -p 54330 -U postgres --if-exists "$DB" && "$B/createdb" -h localhost -p 54330 -U postgres "$DB" || exit 1
cd "$REPO" && source scripts/e2e-customer/env.sh
export DATABASE_URL="postgres://postgres@localhost:54330/$DB" DIRECT_URL="postgres://postgres@localhost:54330/$DB" PORT=4300 RATE_LIMIT_STORE=memory
export ALERT_WEBHOOK_URL=http://127.0.0.1:4997/hook
node --import tsx packages/db/src/migrate-cli.ts > /dev/null || exit 1

node -e '
require("http").createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)).on("end", () => {
  require("fs").appendFileSync(process.argv[1], JSON.stringify({ at: Date.now(), body: JSON.parse(b || "{}") }) + "\n"); res.writeHead(204); res.end(); }); })
  .listen(4997, "127.0.0.1");' "$T/received.jsonl" &
RECEIVER=$!
cleanup() { kill "$RECEIVER" "${API:-}" "${WORKER:-}" 2>/dev/null; }
trap cleanup EXIT

node --env-file-if-exists=.env --env-file-if-exists=.env.meilisearch --import tsx apps/worker/src/main.ts > "$T/worker.log" 2>&1 &
WORKER=$!
echo "waiting for the worker's first heartbeat…"
for i in $(seq 1 180); do [ -n "$(psql "select 1 from platform.process_heartbeats where process = 'worker'")" ] && break; sleep 1; done
[ -n "$(psql "select 1 from platform.process_heartbeats where process = 'worker'")" ] || { echo "FAIL | the worker never reported"; exit 1; }
echo "PASS | the running worker reports its heartbeat"

node --env-file-if-exists=.env --env-file-if-exists=.env.meilisearch --import tsx apps/api/src/server.ts > "$T/api.log" 2>&1 &
API=$!
for i in $(seq 1 60); do curl -s -m 2 http://localhost:4300/health/ready | grep -q '"database":"ok"' && break; sleep 1; done
sleep 70 # one alert check while the worker runs
if grep -q '"key":"worker"' "$T/received.jsonl" 2>/dev/null; then echo "FAIL | a worker alert was sent while the worker ran"; exit 1; fi
echo "PASS | no worker alert while the worker runs"

kill "$WORKER" 2>/dev/null; WORKER=
STOPPED=$(node -p "Date.now()")
echo "worker stopped; waiting up to 10 minutes for the alert…"
for i in $(seq 1 600); do grep -q '"severity":"critical","message":"The background worker' "$T/received.jsonl" 2>/dev/null && break; sleep 1; done
node -e '
const lines = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const first = (sev) => lines.find((l) => (l.body.alerts || []).some((a) => a.key === "worker" && a.severity === sev));
const stopped = Number(process.argv[2]);
const crit = first("critical"), warn = first("warning");
if (warn) console.log(`PASS | warning delivered ${Math.round((warn.at - stopped) / 1000)} s after the worker stopped`);
if (!crit) { console.log("FAIL | no critical worker alert within 10 minutes"); process.exit(1); }
const s = Math.round((crit.at - stopped) / 1000);
console.log(`${s <= 600 ? "PASS" : "FAIL"} | critical alert delivered ${s} s after the worker stopped: ${crit.body.text.split("\n").find((t) => t.includes("worker"))}`);
const leaked = lines.some((l) => /@|secret|password|token/i.test(JSON.stringify(l.body)));
console.log(`${leaked ? "FAIL" : "PASS"} | alert messages carry no addresses or secrets`);
process.exit(s <= 600 && !leaked ? 0 : 1);' "$T/received.jsonl" "$STOPPED"
