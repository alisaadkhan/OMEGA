# Local setup and testing (Windows, verified 2026-10-14)

Everything runs on your machine: PostgreSQL, Meilisearch, the API, the worker and the frontend. Secret values stay in `.env` and `.env.meilisearch` (both git-ignored) and are never printed by the scripts.

## 1. One-time installation

1. **Node 22.12+** and `npm install` at the repo root.
2. **PostgreSQL 16+.** This machine uses the portable PostgreSQL 17 binaries at `D:\New folder (2)\New folder (2)\tmp\pg-test-runtime\pgsql-portable\bin` (call that `PGBIN`) and a persistent cluster on **port 54330**:
   ```
   "%PGBIN%\initdb" -D "%USERPROFILE%\mushin-local-pg\data" -U postgres -A trust -E UTF8 --locale=C
   (add to data\postgresql.conf)  listen_addresses = 'localhost'   port = 54330
   "%PGBIN%\pg_ctl" -D "%USERPROFILE%\mushin-local-pg\data" -l "%USERPROFILE%\mushin-local-pg\postgres.log" -w start
   "%PGBIN%\createdb" -h localhost -p 54330 -U postgres mushin_local
   "%PGBIN%\createdb" -h localhost -p 54330 -U postgres mushin_test
   ```
   `trust` authentication is acceptable only because the server listens on `localhost`.
   - **`mushin_local`** is for running the app and testing by hand. Tests never touch it.
   - **`mushin_test`** is wiped by every integration test run (the guard refuses any URL that isn't on localhost with "test" or "disposable" in the database name).
3. **Meilisearch (optional backend, needed for the full test suite).** Download `meilisearch-windows-amd64.exe` (v1.55.0) from https://github.com/meilisearch/meilisearch/releases into `%USERPROFILE%\meilisearch\`. Then run `npm run meili:start` once (this creates the master key) and `npm run meili:env`. Details: `docs/readiness/search-backends.md`.
4. **Migrations:**
   ```
   set DIRECT_URL=postgres://postgres@localhost:54330/mushin_local&& set DATABASE_SSL_CA_FILE=&& npm run db:migrate
   set TEST_DATABASE_URL=postgres://postgres@localhost:54330/mushin_test&& set TEST_DATABASE_SSL_CA_FILE=&& npm run db:migrate:test
   ```

## 2. Environment

`.env` already holds the project's keys. For local runs, override these (shell values win over `.env`, and `.env.meilisearch` wins over `.env`):

| Variable | Local value | Why |
|---|---|---|
| `DATABASE_URL`, `DIRECT_URL` | `postgres://postgres@localhost:54330/mushin_local` | Never use the remote Supabase database for local testing |
| `DATABASE_SSL_CA_FILE` | empty | Local server has no TLS |
| `NODE_ENV` | `development` | Enables the mock checkout |
| `APIFY_TOKEN` | empty unless a paid test is authorised | Instagram/TikTok extraction then fails and refunds at $0 |
| `SERPER_API_KEY` | empty unless a paid test is authorised | Find New Creators then fails and refunds at $0 |
| `AUDIENCE_SOURCES` | empty | The audience-estimate feature stays off |
| `CATALOG_SEARCH_BACKEND` | `postgres` (default) or `meilisearch` (set by `.env.meilisearch`) | Choose the catalog backend |

To check `.env` yourself without printing secrets, confirm these names exist: `JWKS_URI`, `JWT_ISSUER`, `JWT_AUDIENCE` (Supabase Auth), `DATA_ENCRYPTION_KEY`, `STAFF_JWT_SECRET`, `MOCK_PADDLE_WEBHOOK_SECRET` (`npm run env:secrets` adds missing ones). Also check `MEILISEARCH_TEST_HOST`: it pointed at Meilisearch Cloud before 2026-10-14 and is now overridden by `.env.meilisearch`.

## 3. Start everything (four terminals)

```
npm run meili:start            # optional when CATALOG_SEARCH_BACKEND=postgres
npm run dev:api                # http://localhost:4000  (GET /health/ready lists database, redis, search)
npm run dev:worker             # reconciles search projections at start-up, then runs jobs
npm run dev:web                # http://localhost:5173
```

`npm run dev` starts the API, worker and web together. Restarting PostgreSQL after a reboot: `"%PGBIN%\pg_ctl" -D "%USERPROFILE%\mushin-local-pg\data" -l "%USERPROFILE%\mushin-local-pg\postgres.log" start`.

## 4. Sign in

- **Customers:** a real Supabase Auth user in the project named by `JWKS_URI`/`JWT_ISSUER`. Not verified in this environment, because the seed account was rejected. Automated UI checks used a local signing stub issuing the same claims (`sub`, `email`, audience `authenticated`).
- **Staff console:** open http://localhost:5173/#/admin/login. Create an account with `npm run create-admin -- --email you@mushin.pk --name "You" --role admin|support`, run with the local `DATABASE_URL` override. It prints a one-time password and a TOTP QR code.

## 5. Manual acceptance checklist

| # | Steps | Expected |
|---|---|---|
| 1 | Search: type `food`, Enter | Real creators from `mushin_local`; no estimate or job calls |
| 2 | Search `realwowbo` (partial) | @realwowboy found (both backends) |
| 3 | Choose YouTube, search again | Only YouTube creators; the platform chip stays selected |
| 4 | Search nonsense text | "No creators match", with Find new creators offered |
| 5 | Open a creator; press Escape | Profile matches stored data; Escape closes it |
| 6 | Profile › Save › new list; Lists page | List shows the creator; notes, remove, rename, favourite and delete persist across reload |
| 7 | Profile › Add to campaign; Campaigns | Creator in Identified; stage, fee, content and due date persist; Declined is its own column; agreed total excludes declined |
| 8 | Campaign creator › Outreach › log | Entry with your name; card shows the latest outreach |
| 9 | Find New Creators (paid keys blank) | Quote names the platforms; after confirming, the run fails honestly and every credit returns |
| 10 | Stop on a running live search | "Stopping…", then only delivered creators charged |
| 11 | Dashboard, Analytics, Activity, bell | Real counts only; no "Sample" labels; activity doesn't change by itself |
| 12 | Settings › name, workspace, team | Saved via the API; members-only rename rules |
| 13 | Support › New request; staff replies | Customer sees the "MUSHIN support" reply; status "Waiting for you" |
| 14 | Staff (support role) | No Providers, Audit or Removals; masked owner emails |
| 15 | Staff (admin) › Audit log | Ticket views, replies and workspace searches recorded |
| 16 | Stop Meilisearch while it is the backend | `/health/ready` reports `search: down` (503); search still answers |

## 6. Automated checks

```
set TEST_DATABASE_URL=postgres://postgres@localhost:54330/mushin_test&& set TEST_DATABASE_SSL_CA_FILE=&& npm run verify
cd frontend && npm run build
```

`verify` runs lint, typecheck, the dependency-boundary check and all tests. With Meilisearch running, 2026-10-14 @07580ef gave 661 passed, 7 skipped. The skipped tests make paid live provider calls and are opt-in. Rules:
- Never run two suites against the same `TEST_DATABASE_URL` at once: they wipe each other's data and fail by the dozen.
- Meilisearch must be running: four suites fail with `ECONNREFUSED 127.0.0.1:7700` otherwise.

Measurement scripts (test database only):
- `node --import tsx scripts/search-compare.ts 1000 10000 100000`
- `node --import tsx scripts/crm-load-check.ts`

## 7. Common failures

| Symptom | Cause / fix |
|---|---|
| Search returns nothing in Meilisearch mode | Empty index: restart the worker (it reconciles at start-up) or run `npm run search:reindex` |
| `/health/ready` 503 with `redis: down` | The Upstash rate limiter is unreachable. Requests still pass, because that limiter fails open; spend caps don't |
| Integration tests refuse to start | `TEST_DATABASE_URL` isn't a localhost "test"/"disposable" database |
| `role "postgres" does not exist` | You started a different cluster: use the `mushin-local-pg` data directory |
| PostgreSQL won't start after cleanup | Empty system folders (e.g. `pg_notify`) were deleted: recreate them as empty folders |
