# Technology inventory

Verified against the code on 2026-10-21, branch `feat/internal-completion-and-search-acceptance`. This replaces the
component descriptions in older documents where they differ.

**Evidence levels** (what each status claims, and nothing more):

| Level | Meaning |
|---|---|
| U | Unit-tested |
| I | Integration-tested against real local dependencies: PostgreSQL 17, local Meilisearch, pg-boss |
| E | End-to-end in a browser against the local stack (`scripts/e2e-customer`, `scripts/e2e-staff`) |
| H | Verified against the hosted external service |
| B | Blocked or not tested |

A mock, fixture, replay or local service is not hosted evidence.

## Runtime components

| Component | Purpose | Where | Configuration | Evidence | Status / outstanding |
|---|---|---|---|---|---|
| React 18 + Vite 6 SPA | Customer app, staff console, public pages | `frontend/` (own lockfile); Tailwind 4, Radix UI, TanStack Query | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TRIAL_PHONE` (public values only) | U (46), E (customer 162 checks, staff 31) | Complete. CI typechecks it (`tsc --noEmit -p frontend/tsconfig.json`); the bundle secret scan passes. Hosting not chosen (owner, D-01) |
| Fastify 5 API | HTTP API, Zod contracts, guards, rate limits, health | `apps/api` | `loadApiConfig` (`packages/core/src/config.ts`): the only reader of environment variables in app code | U, I, E | Complete locally. Not deployed (D-01) |
| Zod contracts | Request and response schemas shared by the API and the SPA | `packages/contracts` | — | U (64 incl. frontend) | Complete |
| PostgreSQL (system of record) | All data; row-level security per workspace; append-only ledgers and audit | `packages/db` (Drizzle schema + forward-only SQL migrations 0001–0052; copies in `supabase/migrations/`) | `DATABASE_URL` (transaction pooler), `DIRECT_URL` (session pooler, migrations and the queue), `DATABASE_SSL_CA_FILE` | I (local 17); H for migrations and data on staging `yknp…` (0052; catalogue loaded 2026-10-20) | Complete. Staging TLS is encrypted but the server certificate is not verified until the owner provides the CA file (CA-01) |
| Supabase Auth | Customer sign-up, sign-in, recovery; the API verifies JWTs via JWKS | `apps/api/src/auth/*`, `frontend/src/app/lib/supabase.ts` | `JWT_ISSUER`, `JWKS_URI`, `JWT_AUDIENCE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only) | U, I (local token stub), H (JWKS reachable; forged tokens refused, 2026-10-19) | A genuine hosted sign-in token check and recovery email are blocked by SMTP setup (SMTP-01) |
| Staff identity | Separate staff login: argon2 password, TOTP, WebAuthn step-up, enrolment codes, Super Admin approvals | `apps/api/src/modules/staff`, `staffops` | `STAFF_JWT_SECRET` | U, I, E (staff 31) | Complete for the pilot (D-09s: keep own login) |
| pg-boss worker | Outbox delivery, discovery and live runs, assessments, indexing, notifications, purges, sweeps | `apps/worker` (handlers in `discovery-handlers.ts`, `queues.ts`; schedules in `worker.ts`) | `DIRECT_URL` (queue and LISTEN) | U, I | Complete. Retries and duplicate safety come from the transactional outbox and idempotent handlers; tested in `queues.test`, `worker-side.int`, provider-runs |
| Catalogue search: PostgreSQL (default) | Brain 1 retrieval from `gcp.creator_search_documents`; v1 frozen, v2 behind `SEARCH_PROFILE` | `apps/api/src/modules/creators/postgres-search.ts` | `CATALOG_SEARCH_BACKEND=postgres` (default), `SEARCH_PROFILE=v1` (default) | U, I; freeze check byte for byte | Complete. Relevance not accepted: needs human ratings (SRCH-01) |
| Meilisearch Cloud (optional backend, retained) | Alternative catalogue index, kept in sync by the worker | `packages/integrations/src/search` | `MEILISEARCH_HOST` (Cloud project, Singapore), `MEILISEARCH_API_KEY` (worker), `MEILISEARCH_SEARCH_KEY` (API), `MEILISEARCH_INDEX_PREFIX` (`dev_`) | U; I against a **local** Meilisearch via the `.env.meilisearch` override; Cloud: **B** (unreachable from this network, 2026-10-21) | Retained and unchanged. See "Meilisearch" below |
| Brain 2: Live Discovery | Brief → quote → reservation → web/YouTube search → Apify/YouTube extraction → AI assessment → evidence → delivery → catalogue | `apps/api/src/modules/discovery` | `SERPER_API_KEY`, `YOUTUBE_API_KEY`, `APIFY_TOKEN` + actor IDs, `LIVE_*` settings | U, I (fixtures), replay (freeze check); real runs 2026-10-13 and 2026-10-20 (≈ USD 1.7 under owner authorisation) | Implemented and exercised live. Apify account at its USD 5 monthly limit until 2026-11-01 (no Instagram/TikTok extraction) |
| LLM (Groq, Ollama Cloud fallback) | Creator assessment, discovery relevance, AI summaries | `packages/integrations/src/llm` | `GROQ_API_KEY`, `OLLAMA_API_KEY`, `LLM_MONTHLY_BUDGET_USD` (USD 5 locally when unset; required in production), per-token prices | U, I (mock), live use 2026-10-20 | Rate limits (429) cap parallel work; budget enforced |
| Payments (Paddle) | Plans, top-ups, webhooks | `packages/integrations/src/payments`, `apps/api/src/modules/billing` | Paddle keys (unset → mock provider, test-mode checkout) | U, I (mock), E (mock checkout) | Real payment path **B** (BIL-03: Paddle sandbox and seller onboarding, owner) |
| Email (Resend) | Outreach email and notifications | `packages/integrations/src/email`, `apps/api/src/modules/outreach` | `OUTREACH_EMAIL_MODE` = `off` (default) / `test` (records, never delivers; refused in production) / `resend` (needs key, webhook secret, from address) | U, I (mock provider) | Real delivery **B** (owner authorises sending; SMTP-01 for auth emails) |
| Object storage | Archived provider payloads and avatar copies (retention purge) | `packages/integrations/src/storage` | Supabase Storage via `SUPABASE_URL` + service key | U, I (memory store; local file store for the catalogue build) | Hosted bucket write not verified (B) |
| Operations tooling | Migrations, key rotation, erasure journal, restore drill, audit verify, reindex | `scripts/*`, `npm run ops:*` | — | I (local) | Hosted backup/PITR **B** (D-12) |

## Meilisearch (retained Cloud integration)

**Selection.** `CATALOG_SEARCH_BACKEND`:
- **`postgres` (default):** Meilisearch is never queried.
- **`meilisearch`:** the API searches Meilisearch first. Only a `PROVIDER_UNAVAILABLE` error falls back to the PostgreSQL projection, and the fallback is logged as a warning. A bad request is never masked.
- **Either way:** results are always re-read from PostgreSQL under row-level security, so a stale index cannot surface hidden or erased creators.

**Readiness.** With `meilisearch` selected, `/health/ready` pings the index. Since 2026-10-21, an unconfigured index reports `down` (HTTP 503) instead of `skipped`. Production refuses to start in Meilisearch mode without host and both keys.

**Secrets.** The admin key is used by the worker only, the search key by the API only; neither reaches the browser bundle (bundle scan).

**Synchronisation.** The worker upserts or removes on `creator.changed`. A nightly reconcile (`creator.reindex_all`) and `npm run search:reindex` repair drift by comparing epochs; they never clear the index.

**Tests.**
- Integration tests create a uniquely named index (`test_<random>_creators`) and drop only that one. Shared indexes such as `dev_creators` are never cleared.
- The tests run against the local server when `.env.meilisearch` exists. In a checkout with only `.env`, they would write their own throwaway index to the Cloud project. An aborted run can leave one `test_*` index behind.

**Not verified.**
- The Cloud project is unreachable from this machine (connection timeout on 2026-10-21), so a hosted sync, search and fallback check is **NOT TESTED**.
- To close it: from a network that reaches the project, run `npm run meili:health` without `.env.meilisearch`, then the `meilisearch.int` suite (throwaway index only).

## Dependencies removed or added (2026-10-21)

- **Removed:** 11 frontend packages never imported (MUI, Emotion, react-dnd, react-slick, react-popper and others). Backend packages: every declared dependency is used.
- **Added:** `@types/react` and `@types/react-dom` at 18.3. They were previously present only as peers of the removed MUI packages (and at 19.x).

## Known latent items

- **Staff audit search paging.** It accepts a bare `before` timestamp (`platform.staff_audit_search`), so rows written at the same instant could be skipped by an API client paging with it. The admin UI does not page it (it filters, up to 500 rows). Fixing it needs a migration to the database function.
- **Support ticket limit.** The 20-open-ticket limit per workspace is checked without a lock, so two concurrent requests could exceed it by one.
