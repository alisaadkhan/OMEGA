# Worker hosting (staging)

Status 2026-10-26: **not deployed.** Staging runs the API and frontend on Vercel; no worker runs there, so Live
Discovery, enrichment, search indexing, contact checks, retention purges, scheduled billing jobs and alert delivery do
not happen (the staff console shows the critical "worker has never reported" alert). This is REMAINING_BLOCKERS #5.

## Why a separate host

The worker (`apps/worker/src/main.ts`) is a long-running process: pg-boss holds a PostgreSQL session for LISTEN and
polling, schedules run every minute, and a live run can last up to `LIVE_JOB_DEADLINE_MINUTES` (20). Vercel functions
end after each request, so the worker needs a container host that keeps one process running (Railway, Fly.io or
Render "background worker"; owner's choice, D-01). No inbound port is needed; it only makes outbound connections.

## Build and run

```
docker build -f Dockerfile.worker -t roster-worker .     # from the repository root
docker run --env-file <host-managed env> roster-worker   # locally, against a disposable database only
```

The image never contains `.env` files, `eval-data/`, `eval-v2/` or `.catalog-storage/` (`.dockerignore`). The
Dockerfile has not been build-tested on this machine (Docker daemon not running on 2026-10-26).

## Environment (set on the host, never in the image)

Required:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Supabase **transaction** pooler (port 6543) for queries |
| `DIRECT_URL` | Supabase **session** pooler (port 5432): pg-boss and LISTEN need a held session (staging: pooler only) |
| `DATABASE_SSL_CA_FILE` | Path to the Supabase CA certificate (required when `NODE_ENV=production`) |
| `DATA_ENCRYPTION_KEY` | The same key as the API (contacts are encrypted with it) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Storage: archived provider responses and profile photos |
| `MOCK_PADDLE_WEBHOOK_SECRET` or the three `PADDLE_*` values | Same billing configuration as the API |
| `APP_URL` | The frontend origin (links in notifications) |
| `LLM_MONTHLY_BUDGET_USD` | Required when `NODE_ENV=production` |

Providers (each optional; without one, that capability reports "unavailable" instead of failing silently):

| Variable(s) | Used for |
|---|---|
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_PRICE_IN_PER_MTOK`, `GEMINI_PRICE_OUT_PER_MTOK`, `GEMINI_BILLING=paid` | Main LLM (assessments, relevance, summaries) |
| `OLLAMA_API_KEY` (+ `OLLAMA_MODEL`, prices) | LLM fallback |
| `APIFY_TOKEN`, `APIFY_MONTHLY_BUDGET_USD` | Instagram and TikTok profile extraction |
| `SERPER_API_KEY`, `SERPER_MONTHLY_SEARCH_LIMIT` | Live Discovery web search |
| `YOUTUBE_API_KEY` | YouTube channels (Data API quota, no cost) |
| `MEILISEARCH_*` | Only when `CATALOG_SEARCH_BACKEND=meilisearch` |

Policy switches (defaults are the safe settings): `ENRICHMENT_ATTRIBUTE_POLICY=evidence`, `YOUTUBE_CONTENT_EVIDENCE=off`,
`YOUTUBE_DESCRIPTION_CONTACTS=off`, `YOUTUBE_DERIVED_METRICS=off`, `AUDIENCE_SOURCES=` (empty),
`LIVE_CONTENT_RESOLUTION_MAX=0`. The full list with defaults is `packages/core/src/config.ts` (`workerSchema`).

## Verifying after deployment

1. The staff console "worker" alert clears within two minutes (`platform.process_heartbeats`).
2. Outbox: `outboxPending` drains (the API writes events; the worker publishes them).
3. One mock-provider live run completes end to end before any paid provider key is added.
4. `/admin/v1/ops/providers` shows each configured provider and, for Apify, the account usage it reports.

Running more than one worker instance is safe for queue jobs (pg-boss hands each job to one worker; schedules are
pg-boss cron entries, one per key, so a second instance does not double them), but one instance is enough for staging.
Alert delivery runs in the API, not the worker.

## Azure Container Apps (staging; owner approval 2026-10-26)

Prepared, **not run** (2026-10-26): the Azure CLI is not installed on this machine, `az login` needs the owner, and the
staging variables come from a file only the owner holds. Script: `scripts/ops/azure-worker-staging.sh`
(`check`, `deploy <env-file>`, `stop`, `usage`).

- Shape: one Container App, Consumption plan, 0.25 vCPU / 0.5 GiB, exactly one replica (pg-boss needs a process that
  keeps running; scale-to-zero would stop the queue). Image built in Azure Container Registry (Basic) with `az acr build`,
  so no local Docker is needed. No Log Analytics workspace.
- Safety built into the script: refuses `NODE_ENV=production`, refuses paid provider keys (Apify, Serper, Gemini,
  Ollama, YouTube) unless `ALLOW_PAID_PROVIDERS=yes` is set for an approved test, forces `YOUTUBE_API_CALLS=off`, and
  refuses an env file inside the repository. Every variable is stored as a Container Apps secret.
- Free grant (Consumption plan, per subscription per month; azure.microsoft.com/pricing/details/container-apps, read
  2026-10-26): 180,000 vCPU-seconds, 360,000 GiB-seconds, 2 million requests. One always-on replica of 0.25 vCPU / 0.5
  GiB uses about 648,000 vCPU-s and 1,296,000 GiB-s a month, so roughly 468,000 vCPU-s and 936,000 GiB-s are billed
  (whether at the active or idle rate depends on the worker's CPU use). The per-second prices did not render on the page:
  read them from the Azure pricing calculator before relying on an estimate. The registry (Basic) is billed per day.
  None of this is free in general; it is paid from the student credit.
- When the Azure for Students credit or its 12 months run out, Azure disables the subscription and its resources stop;
  continuing needs an upgrade to pay-as-you-go (not approved).
- Stop it whenever testing is not active (`stop`); delete everything with `az group delete -n roster-staging-rg`.
