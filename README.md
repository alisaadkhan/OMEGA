# MUSHIN 2.0

**Start here:** `docs/readiness/README.md` (readiness report and blockers), `docs/readiness/local-setup.md` (run and test everything locally, including the self-hosted Meilisearch option), `docs/readiness/acceptance-matrix.md`, `docs/readiness/traceability.csv` and `docs/readiness/search-backends.md`.

## Requirements
- Node 22.12+ (24 recommended)
- A filled-in `.env` at the repo root (see `.env.example`).

## Setup
```bash
npm install
npm --prefix frontend install
npm run env:secrets      # adds DATA_ENCRYPTION_KEY and STAFF_JWT_SECRET if missing
npm run db:migrate       # applies migrations using DIRECT_URL (session pooler, port 5432)
```

## Run everything
```bash
npm run dev              # API on :4000, worker, and the web app on :5173
```
The API and the worker's queries use `DATABASE_URL` (transaction pooler, port 6543). Only the worker's
job queue (pg-boss, 3 connections) and its LISTEN connection use `DIRECT_URL` (session pooler), which on
Supabase's free tier allows about 15 clients in all.

## Create the first staff admin
```bash
npm run create-admin -- --email you@mushin.pk --name "Your Name"
```
Scan the printed QR code with an authenticator app. The temporary password is shown once.

## Checks
```bash
npm run verify           # lint + typecheck + module boundaries + all tests
npm run test:int         # database tests only (uses TEST_DATABASE_URL)
```

## Billing (sub-project 2)

- Without Paddle keys the API uses a **mock payment provider**: purchases open a test-mode checkout page at
  `PUBLIC_API_URL/mock-paddle/checkout/<workspaceId>/<id>` with **Pay** and **Simulate failed payment**. `npm run env:secrets` creates
  `MOCK_PADDLE_WEBHOOK_SECRET`. Run both the API and the worker so webhooks are applied.
- Switching to Paddle sandbox:
  1. Create a sandbox account (sandbox-vendors.paddle.com), products and prices for the three plans (monthly and yearly) and the three top-up packs.
  2. Put the sandbox price ids into `platform.plans.paddle_price_ids` and `platform.topup_packs.paddle_price_id` (replacing the `pri_mock_*` ids).
  3. Set a default payment link, and a notification destination pointing to `<public API URL>/webhooks/paddle`.
  4. Set `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENVIRONMENT=sandbox` and restart the API and the worker.
- Prices, credit costs, trial length and meter thresholds live in `platform.plans`, `platform.topup_packs`,
  `platform.credit_action_costs` and `platform.billing_settings` and can be changed without a deploy.

## Search (sub-project 3)

Catalogue search runs on **PostgreSQL** by default (`CATALOG_SEARCH_BACKEND=postgres`); nothing else is needed.
Meilisearch is optional, self-hosted only, and kept for comparison (owner rule: no Meilisearch Cloud; it would be one
more vendor holding creator data). To try it:

- **Local Meilisearch** (https://github.com/meilisearch/meilisearch/releases) on `127.0.0.1:7700` with a master key.
  On Windows with Smart App Control on, the unsigned Windows program is blocked: run the Linux program in WSL instead.

Then set in `.env`:

| Variable | Value |
|---|---|
| `MEILISEARCH_HOST` | `http://127.0.0.1:7700` |
| `MEILISEARCH_API_KEY` | the **Default Admin API Key** (used by the worker) |
| `MEILISEARCH_SEARCH_KEY` | the **Default Search API Key** (used by the API) |
| `MEILISEARCH_INDEX_PREFIX` | e.g. `dev_`; people sharing one Meilisearch need different prefixes |
| `MEILISEARCH_TEST_HOST` / `MEILISEARCH_TEST_KEY` | for integration tests: the same host and the admin key (tests use throwaway `test_*` indexes) |

With `CATALOG_SEARCH_BACKEND=meilisearch` and Meilisearch unreachable, search falls back to PostgreSQL.

```bash
npm run db:migrate       # creator tables (0009, 0010)
npm run seed:creators    # optional: 8 demo creators for development (refused in production)
```

The worker indexes creators after any change and reconciles the index nightly. AI features (plain-English search,
creator summaries) use Groq, falling back to Ollama Cloud; every call's cost is recorded in `platform.provider_calls`.
Set `LIVE_LLM_TESTS=1` to run the one live AI check (`packages/integrations/src/llm/llm.live.int.test.ts`).

## Creator data (sub-project 4A)

Users add a creator by pasting a public profile link (top-bar lookup or the search page's "Add by profile link") and refresh a profile
with "Update info". The worker fetches the profile (Apify for Instagram and TikTok, the YouTube Data API for YouTube), archives the raw
response in Supabase Storage (`raw-payloads`, private; purged after `platform.enrichment_settings.raw_retention_days`), measures
authenticity signals, asks the AI to explain them, flags possible minors, and saves everything. Audience estimates are off
unless an approved data source is configured (`AUDIENCE_SOURCES`); the AI never estimates audience percentages.

| Variable | Purpose |
|---|---|
| `APIFY_TOKEN` | Apify API token (worker) |
| `APIFY_INSTAGRAM_ACTOR_ID` / `APIFY_TIKTOK_ACTOR_ID` | default `apify/instagram-profile-scraper` / `clockworks/tiktok-profile-scraper` |
| `APIFY_MONTHLY_BUDGET_USD` | monthly Apify spend cap (default 5); jobs fail and refund once it is reached |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key (free quota ≈ 3,300 creators/day) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | storage for raw payloads and profile photos (worker only) |
| `LIVE_SCRAPE_TESTS=1` | runs the live scraper check (~$0.02 of Apify) |

Prices (credits) live in `platform.credit_action_costs`: `refresh_data` 10 (Instagram, YouTube), `refresh_tiktok` 30 (TikTok is billed
per video by Apify). The other pipeline settings live in `platform.enrichment_settings`.

## Live discovery and erasure (sub-project 4B)

**Find New Creators** (search page) runs the current search on Google through Serper, keeps relevant profiles with the AI,
shows creators MUSHIN already knows for free, and fetches and assesses up to 5, 10 or 15 new ones with the 4A pipeline.
A run that delivers at least one creator costs 50 credits plus 10 for each new creator (at least 100 when TikTok is in
scope), never more than the confirmed quote; a run that delivers no creator costs nothing. The quote's maximum is
reserved and the rest returned. Google results are cached for 15 minutes in `platform.serper_cache`.

**Removal requests**: creators ask at `/#/remove-my-data`; their profile is hidden at once; staff approve or reject at
`/#/admin` → Removal requests (staff sign in with password and authenticator code). Approval erases contacts,
profiles, history, archives and photo, keeps a tombstone and the credit ledger, and blocks the links by hash.

| Variable | Purpose |
|---|---|
| `SERPER_API_KEY` | Serper (Google search) key, worker only |
| `SERPER_MONTHLY_SEARCH_LIMIT` | searches per calendar month before runs fail and refund (default 2500) |

In development the website proxy rewrites the staff refresh cookie's path (`frontend/vite.config.ts`); when the site is
deployed, serve the API so `/admin/v1/auth` cookies reach it, or rewrite the path the same way.

Serper's free plan allows 10 results per `site:` search, so each run makes up to 3 searches per platform with 10 results each.
Migrations `0012`–`0014` add the run, result, cache, removal-request and do-not-re-add tables, allow the API to reserve a run's
maximum, and let erasure scrub every workspace's rows that name the creator.
