# Implementation plan (mandate v3)

Work order and phase-gate results. Phases follow mandate §6; most audit P0–P2 work was done before this mandate
(see GAP_REGISTER.md), so each phase lists only what remains and what proves the gate.

## Phase 1 — Baseline and workspace

- [x] Audit pack committed at `docs/audit/2026-10-16/` (secret scan 0 findings) — `f690848`
- [x] Mandate saved at `docs/completion/MUSHIN_COMPLETION_MANDATE_V3.md` — `f690848`
- [x] DECISION_LOG, GAP_REGISTER, REQUIREMENTS_TRACEABILITY, this plan, PROGRESS, SYSTEM_BASELINE
- [x] Baseline drift recorded: audit `1398cee` / 37 migrations → checkout `f690848` / 49 migrations; next migration 0050
- [ ] Baseline checks re-run at the current SHA (verify in the checkout and in a clean clone without `.env`) → SYSTEM_BASELINE.md

**Gate:** baseline recorded with SHA and real totals; no user work discarded.

## Phase 2 — P0 security, integrity, spend, money

All audit P0 items are implemented with tests (GAP_REGISTER). Remaining mandate-specific defaults:
1. SEC-02 follow-up: step-up validity 5 minutes (was 15).
2. SEC-05 follow-up: production refuses to start without an explicit `TRUSTED_PROXIES`.

**Gate:** both with tests; `npm run verify` green in the checkout and a clean clone without `.env`.

## Phase 3 — Reproducible E2E

1. OPS-06: `npm run e2e:customer` and `npm run e2e:staff` (start stub + Vite, build the synthetic template, run, stop).

**Gate:** each passes three consecutive times from those commands.

## Phase 4 — Modules and UI (no change to frozen Search behaviour)

1. UX-08: email-confirmation result screen.
2. UX-06: 404 screen for unknown routes.
3. UX-07: error boundary with request id; degraded-service banner driven by `/health/ready`.
4. Session expiry: one retry, then a sign-in prompt (verify existing behaviour, fix if looping).
5. Route inventory and §8.2 states per screen; fix any working-looking control without an action.
6. Design handoff in `design/figma/` (9 files; no real Figma file without access).

**Gate:** every route implemented or honestly unavailable, covered by E2E or a justified exception.

## Phase 5 — Operations without a host

Done before this mandate: SEC-05/06, ARCH-03, SRCH-05, BIL-06, SEC-09, SEC-10, OPS-03, OPS-04. Remaining:
1. RUNBOOK.md (start, migrate, restore drill, key rotation, provider pause, diagnosis).
2. Structured-log redaction test and request ids in error responses (verify existing tests; add where missing).
3. Dependency audit (`npm audit`, report only; no forced upgrades without review).

## Phase 6 — Search

Frozen: no ratings recorded. Only SRCH-14 reporting metrics (weighted kappa, raw agreement, bootstrap CIs, standard
P@5) with tests; freeze check must stay byte-for-byte.

## Phase 7 — Final regression and reports

verify, frontend typecheck/build, bundle scan, csp-check, freeze check, `e2e:customer` ×3, `e2e:staff` ×3; then
TEST_EXECUTION_REPORT, E2E_COVERAGE_MATRIX, SECURITY_REVIEW, SEARCH_ACCEPTANCE_REPORT, RELEASE_READINESS,
REMAINING_BLOCKERS.
