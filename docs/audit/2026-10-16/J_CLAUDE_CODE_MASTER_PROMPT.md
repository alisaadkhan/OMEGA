# J — Master implementation prompt for Claude Code

> Paste everything below the line into Claude Code at the repository root **only after the owner has authorised
> implementation**. It assumes this audit pack is committed at `docs/audit/2026-10-16/`.

---

You are implementing the MUSHIN remediation roadmap. MUSHIN is a TypeScript monorepo: Fastify API (`apps/api`), pg-boss
worker (`apps/worker`), shared packages (`packages/{contracts,core,db,integrations}`), React/Vite SPA (`frontend/`),
PostgreSQL migrations `packages/db/migrations/0001…0037`. The audit at `docs/audit/2026-10-16/` is your specification:
`E_GAP_REGISTER.md` (+ `registers/gap_register.csv`) defines each item, its acceptance criteria and tests;
`I_IMPLEMENTATION_ROADMAP.md` defines the order; `G_…` the architecture; `K_…` the UI behaviour.

## Non-negotiable rules

1. **Never** print, log, commit or copy secret values. Never read `.env` values into output. Work only with variable names.
2. **No paid or remote calls:** no Serper, Apify, YouTube, Groq/Ollama, Resend, Paddle, Upstash or Meilisearch Cloud
   requests; no Supabase project changes; no deploys; no emails; no payments. Tests use fakes. If a task needs one of
   these, stop at the prepared code and write "BLOCKED: needs <account/authorisation>" in `docs/readiness/progress.md`.
3. **Search is frozen** (`search-freeze-2026-10-16-elig1`). Do not change retrieval, ranking, query understanding, Live
   Discovery selection/fit or anything that changes rating packets until the owner records the rating result. Run
   `scripts/search-eval/freeze-check.ts` before merging anything that touches `apps/api/src/modules/creators` or
   `discovery`. Items SRCH-06/07/08/09 and SEC-16 wait for that decision.
4. **Never touch `eval-data/`** (no delete, regenerate, overwrite, purge) — the owner runs the purge after rating.
5. **Do not decide owner items** (`I_…` §8, D-01…D-18). Implement the recommended default only when the progress record
   shows the owner approved it; otherwise skip and list it as waiting.
6. **Migrations are forward-only and additive**, numbered from 0038, never edit an applied migration; constraints added
   `NOT VALID` then validated; every migration has an integration test.
7. **Small commits**, one gap ID per commit (`fix(SEC-04): …`), each with tests. Run `npm run verify` (and the frontend
   build + bundle scan when the frontend changes) before every commit; record command, result and SHA.
8. A task is **done** only when its acceptance criterion in `gap_register.csv` is demonstrated by a test you ran. Never
   mark something verified from reading code. Update `docs/readiness/progress.md` and regenerate
   `docs/readiness/traceability.csv` statuses from evidence.
9. If you find a new defect, add it to the gap register with the next free ID and the same fields; do not fix it silently
   unless it is inside the current task.

## Order of work

**Phase P0** (each item independent unless stated; follow the table in `I_…` §3):
1. OPS-01 — make the live scraper suite read config inside its test so a clean clone with no `.env` runs `npm run verify`
   green; confirm `ci.yml` needs no secrets. Verify with `env -i PATH="$PATH" HOME="$HOME" npm run verify` against a
   local disposable PostgreSQL (`TEST_DATABASE_URL=postgres://…@localhost:…/mushin_test`).
2. Packaging hygiene for SEC-01 — add `scripts/package-source.sh` using `git archive HEAD` and run the bundle-secret
   scanner over the result; add a CI secret-scan step. (Rotation itself is the owner's.)
3. SEC-02 — migration 0038 `staff.step_ups`; WebAuthn success inserts a row (5-minute validity, bound to the session
   family); `requireStaff` for `HARDWARE_KEY_ACTIONS` checks for a live row instead of trusting `amr`. Tests: forged
   token with `amr:["otp","hwk"]` and no row → 403; expired row → 403; existing flows still pass.
4. SEC-04 — `findMembership`: when a workspace is requested and is not a membership → `FORBIDDEN workspace_access_denied`;
   fallback only when no header. Add response header `x-workspace-id`; frontend: per-tab selection (sessionStorage) +
   `storage` event warning; client verifies the echoed id. Tests: integration + frontend unit.
5. SEC-03 — `customer-token.ts`: `emailVerified` from `app_metadata.email_confirmed === true` (document the Supabase
   custom access-token hook SQL in `docs/readiness/supabase-auth-hook.md`; do not apply it). Keep `user_metadata` ignored.
   Test: token with only `user_metadata.email_verified` cannot accept an invitation.
6. BIL-01 — update `frontend/src/app/lib/plans.ts`, `components/landing/Metrics.tsx` and the quote dialog to the
   settlement rule **only with the owner-approved wording**; extend `plans-claims.test.ts` to pin constants
   (`find_new`, `live_creator`, `TIKTOK_LIVE_MINIMUM_CREDITS`).
7. BIL-05 — migration 0039: ledger/lots/payments/subscriptions FKs `on delete restrict`; trigger refusing `delete from
   wp.workspaces` unless `status = 'deleted'` (and no ledger rows) — tests including `erase_workspace` and the
   erase-coverage guard.
8. SRCH-04 — migration 0040 `platform.provider_runs`; `apify.ts` persists `run_id` before polling and resumes an existing
   run for the same `(job_id, batch_key)`; pass `maxTotalChargeUsd` (from the per-job cap) and `runTimeoutSecs`; record
   cost once. Test with a fake Apify HTTP server: kill/restart mid-run → same run resumed, one cost row. This is provider
   plumbing, not ranking: it does not change rating packets (confirm with the freeze check).

**Phase P1** (only after P0 is green): DOC-01 regeneration of traceability; UX-02 PKCE + `#/reset-password` (code and
unit tests only; staging verification is BLOCKED); UX-01 static legal page routes with placeholder text clearly marked
"DRAFT — awaiting legal review" and `wp.users.terms_version/terms_accepted_at` (migration 0041) — never publish invented
legal text as final; OPS-02 synthetic fixture catalogue (invented creators clearly labelled `fixture`, no real people,
no YouTube API data) + seed script + E2E harness reading it; metrics reporting additions for SRCH-13 (standard P@5,
bootstrap CI, weighted kappa, raw agreement) in `scripts/search-eval/metrics.ts` with tests — reporting only. Owner-gated
items (BIL-02, DIS-26, SRCH-02 budget, SRCH-10 pilot) wait for recorded approval.

**Phase P2** (after D-01 is recorded): SEC-05 trustProxy from configuration with a production start-up check; SEC-06
Postgres limiter by default regardless of Upstash variables, then ARCH-03 removal; SRCH-05 DB-backed provider budget
reservations; BIL-06 migration 0042 one open live job per workspace; SEC-07 enrolment approval; SEC-09 key-versioned
ciphertext + `scripts/reencrypt.ts` with dry-run; SEC-13 server-side Auth user deletion behind a flag (BLOCKED for
verification); SEC-10 audit hash chain (0043); ARCH-07 config cross-check; DATA-03 streamed export; BIL-04 constraint.

**Phase P3:** UX-04 code splitting with an admin entry; SEC-15 delete fabricated testimonial components; ARCH-02 env
cleanup with a test that every `.env.example` key is read; historical-doc banners.

## Reporting

At the end of each session append to `docs/readiness/progress.md`: commits (SHA, gap ID), commands run with results,
tests added, items BLOCKED with the exact unblocking action, and new findings. Never round results up: "847 passed, 4
skipped, 0 failed at <SHA> (CI <url>)" is the required form.
