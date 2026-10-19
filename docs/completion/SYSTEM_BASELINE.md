# System baseline (mandate v3, Phase 1)

Recorded 2026-10-19 at `master` `f690848`. Updates the audit baseline (`docs/audit/2026-10-16/`, state at `1398cee`);
nothing here re-audits the system.

## Session 3 (mandate v4, 2026-10-19): topology and hosted Supabase

HEAD `3682e65` on `master` at the start. In the working tree, not from this session:
- `.env.example` deleted (left as found);
- untracked `.claude-flow/`, the readiness report and `scripts/test-local-pg.mjs`.

**Topology (addendum A).** Values are never shown; only variable names and project refs, which are not secret.

| Service | Talks to | Variables |
|---|---|---|
| Browser SPA | Supabase Auth (sign-in, refresh); MUSHIN API | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (public key only; bundle scan forbids server names) |
| API (Fastify) | PostgreSQL through `DATABASE_URL` (transaction pooler, 6543); Supabase JWKS; Auth admin API | `DATABASE_URL`, `JWT_ISSUER`, `JWKS_URI`, `JWT_AUDIENCE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_SSL_CA_FILE` |
| Worker (pg-boss) | PostgreSQL through `DATABASE_URL`; queue and LISTEN through `DIRECT_URL` (session pooler, 5432); providers | `DIRECT_URL` and provider keys |
| Migrations | `DIRECT_URL` (`npm run db:migrate`), ledger `platform.schema_migrations` | `DIRECT_URL` |

**Intended role of Supabase.** Supabase is intended to host both Auth and the primary PostgreSQL database (with Storage).
- **Evidence:**
  - ADR-0001 (`docs/readiness/adr-0001-target-architecture.md`) keeps the Node API and worker on Supabase
    DB/Auth/Storage;
  - the README's pooler layout;
  - migration 0048 handles Supabase's `extensions` schema;
  - `supabase/migrations` mirrors every migration.
- **Not yet approved:** ADR-0001 is still proposed, and approving it is owner decision D-01.
- **Where data lives today:** only the developer PostgreSQL on `localhost:54330`, which holds evaluation data and
  synthetic test databases. **No customer data exists anywhere.**

**Hosted project findings (read-only checks, 2026-10-19).**

| # | Finding | Class | Evidence | Action |
|---|---|---|---|---|
| S1 | `.env` mixed three projects: `yknp…` (data URL, DB, service and anon keys), `cpzl…` (frontend URL, public key, `JWT_ISSUER`, `JWKS_URI`), `sjwk…` (`TEST_DATABASE_URL`, hosted pooler) | Inconsistent project identifiers | `scripts/supabase/align-env.ts` dry run | The owner chose `yknp…`. Frontend URL, public key, issuer and JWKS were aligned to it; backup `.env.bak-2026-10-19T15-51-40-934Z` |
| S2 | `db.yknp….supabase.co` has only an IPv6 address; this network has no IPv6 route (`ENETUNREACH`). Earlier `EAI_AGAIN` was the same host failing to resolve | Network (not credentials) | DNS A record absent (`ENODATA`); AAAA present | `DATABASE_URL` now uses the transaction pooler and `DIRECT_URL` the session pooler, same project and same password |
| S3 | `DIRECT_URL` pointed at the `ap-south-1` pooler; the project is in `ap-northeast-2` (pooler `aws-1-ap-northeast-2`) | Configuration | pooler answered "tenant/user not found" in every other region | Corrected by `align-env` |
| S4 | The hosted database is empty: 0 tables in `public`, no MUSHIN schemas, no migration ledger; 2 Auth users | Migrations not applied | `connect-check`: 0 of 49 | **BLOCKED (owner):** applying 49 migrations is a remote schema change (see DECISION_LOG HOST-01) |
| S5 | `npm run db:migrate:test` would have pushed every migration to the hosted `sjwk…` project named in `TEST_DATABASE_URL` | Unsafe configuration | `migrate-cli.ts` had no host check | Fixed: `--test` now refuses non-local URLs (`migrate-cli.test.ts`) |
| S6 | The exposure check crashed when MUSHIN schemas did not exist, and flagged Supabase's own `public.rls_auto_enable` (an event-trigger function: not callable, only touches tables created in `public`, where MUSHIN creates none) | Tool defect | hosted run | Fixed; hosted run 18 checks, 0 problems |
| S7 | No `DATABASE_SSL_CA_FILE` value: database TLS is encrypted but the certificate is not verified in development | TLS | `connect-check` | **Owner:** download the project's CA certificate (Dashboard → Database settings → SSL), set the path. Production config already requires it |
| S8 | The Supabase CLI is not logged in (`AccessTokenRequiredError`); Docker is not running | Tooling | CLI, `docker info` | Not needed for the pooler connection. Security Advisor and `migration list` need the login |
| S9 | Email confirmation is on for `yknp…` (`mailer_autoconfirm=false`), which needs working SMTP for sign-up | Auth configuration | `/auth/v1/settings` | **Owner:** custom SMTP before customers sign up (UX-02) |

## Drift from the audit baseline

| Item | Audit (1398cee, 16 Oct) | Now (f690848, 19 Oct) |
|---|---|---|
| Commits after the audit | — | 58 (audit fixes, plan entitlements, docs) |
| Migrations | 0001–0037 | 0001–0049 (0038–0040 plan model; 0041–0049 audit fixes) — **next free: 0050** |
| API routes | 116 | 123 (+ 5 used only by tests) |
| Worker | 9 queues, 15 schedules | 9 queues, 21 schedules (adds provider-run reconcile, heartbeat, purges) |
| Upstash | wired | removed (ARCH-03) |
| E2E data | developer's `mushin_local` copy | synthetic template `mushin_e2e_synthetic_template` (`npm run e2e:template`) |
| Untracked, not created by this work | readiness report, `.claude-flow/` | same, plus `scripts/test-local-pg.mjs` (new, author unknown; left untouched) |

## Stack

- Frontend: React 18 + Vite SPA, hash router (`frontend/src/app/App.tsx`), Tailwind; dashboard and staff console load
  on demand.
- API: Fastify (`apps/api`), customer `/v1/**`, staff `/admin/v1/**`, `/webhooks/paddle`, `/health/live`, `/health/ready`.
- Worker: pg-boss (`apps/worker`), outbox relay, 9 queues, 21 schedules.
- Packages: `contracts` (zod), `core` (config, crypto, logger), `db` (drizzle, migrations, RLS helpers), `integrations`
  (Apify, Serper, YouTube, Groq/Ollama, Meilisearch, Paddle, Resend, storage).
- Database: PostgreSQL 17 locally on `localhost:54330`; Supabase is the target (ADR-0001 proposed).
- Auth: customers by Supabase Auth JWT (JWKS); staff by password + TOTP + WebAuthn step-up (server-side rows).

## Local services and setup

| Service | How | Notes |
|---|---|---|
| PostgreSQL 17 | `pg_ctl -D C:/Users/SAAD/mushin-local-pg/data start` (portable binaries in `tmp/pg-test-runtime/`) | test DBs must contain `test` in the name (guard) and never be `mushin_eval*` |
| Meilisearch | `npm run meili:start` | optional; PostgreSQL search is the default |
| Docker Desktop + local Supabase | `npx supabase start` | available on this machine (mandate §4 assumed not); used for auth-check, recovery-check, exposure-check |
| E2E | `scripts/e2e-customer/run.sh`, `scripts/e2e-staff/run.sh` (stub + Vite needed); wrapper commands added in Phase 3 | synthetic catalogue only |

## Baseline checks (actually run)

| Command | Where | SHA | Date | Result | Log |
|---|---|---|---|---|---|
| `npm run verify` (lint, typecheck, boundaries, unit + integration) | clean clone `MUSHIN-cleanci-v3`, no `.env`, own test DB, Meilisearch via env | `f690848` | 2026-10-19 | **924 passed, 0 failed, 7 skipped** (120 files passed, 5 skipped) | `eval-data/logs/verify-v3-cleanclone.log` |
| `npm run verify` | working checkout | `f690848` + untracked files | 2026-10-19 | **lint failed** on untracked `scripts/test-local-pg.mjs` (not part of the commit; not created by this work) | `eval-data/logs/verify-v3-baseline.log` |

Earlier evidence (2373a31, 17 Oct, see `docs/readiness/progress.md`): frontend build + bundle scan + csp-check 7/7;
freeze check intact; customer E2E 3 × (91 + 40); staff E2E 3 × 31. Re-run in Phase 7.

## Skipped tests (7)

The five live-provider suites (`*.live.int.test.ts`: discovery live-eval, live-replay, live-runner; integrations llm,
scrapers). They run only with explicit live flags and paid keys, which this mandate forbids (§2.2); none is skipped to
hide a failure.
