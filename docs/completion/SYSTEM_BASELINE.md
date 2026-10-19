# System baseline (mandate v3, Phase 1)

Recorded 2026-10-19 at `master` `f690848`. Updates the audit baseline (`docs/audit/2026-10-16/`, state at `1398cee`);
nothing here re-audits the system.

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
