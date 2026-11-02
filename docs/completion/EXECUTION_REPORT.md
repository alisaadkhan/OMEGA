# Execution report: verified readiness and creator supply (28 October 2026)

Mandate: `MUSHIN_Claude_Code_Execution_Bundle/MUSHIN_EXECUTION_PROMPT.md`. Issue register and catalogue funnel:
`EXECUTION_STATUS.md`. Branch `feat/internal-completion-and-search-acceptance`, HEAD e292915; nothing committed, pushed or
deployed. The Creator Supply report, the Execution Plan and the DeepSeek review were not available as files; their
findings came from the bundle's consolidated report and were checked against the code.

## 1. Work completed

- Phase A: lint, typecheck, boundaries, unit, integration (PostgreSQL + throwaway Meilisearch), frontend typecheck,
  build and unit tests, secret scans, migration sync check; read-only catalogue inventory, country dry run (0
  transitions) and a new funnel query pack; YouTube retention calendar; projection and duplicate checks.
- Phase B: five fixes (EX-01..05), each with a regression test; two of them shown failing on the defective code first.
- Phase C: candidate SRS corrected (outreach email, trial 2,500 credits, testing credits, free empty search).
- Phase D: CI inspected; its local equivalents pass; header comment corrected.
- Phase E: worker lifecycle, heartbeat, TLS rule and YouTube flags verified in code (no change needed).
- Phase F: supply funnel measured; LLM fallback verified; coverage indicator and creator confirmation recorded as gaps
  waiting for decisions.

## 2. Files changed in this pass and why

| File | Why |
|---|---|
| `apps/api/src/modules/creators/index.ts`, `identity/index.ts` | export what other modules use, so they import through the public index |
| `outreach/compose.ts`, `imports/service.ts`, `imports/index.ts`, `billing/testing-allowance*.int.test.ts`, `scripts/catalog/inventory.ts` | boundary and lint fixes (EX-01) |
| `scripts/catalog/niche-review-sheet.ts`, `scripts/e2e-customer/breakit.mjs` | lint fixes (EX-01) |
| `packages/db/migrations/0062_testing_lot_period.sql` + Supabase copy | one testing lot per workspace-month in the database, with a preflight (EX-02) |
| `packages/db/src/schema/billing.ts`, `billing/repository.ts`, `billing/engine.ts` | write the lot's `period` (EX-02) |
| `creators/eligibility.ts`, `eligibility.test.ts` | undated Pakistani country is stale (EX-04) |
| `audience/service.ts`, `audience.int.test.ts` | Pakistan-only lock on audience endpoints (EX-05, BUG-35) |
| `creators/search-charge.int.test.ts`, `billing/testing-allowance.int.test.ts` | CLK-01 (EX-03), TA-18 (EX-02) |
| `scripts/catalog/funnel.sql` | read-only supply funnel query pack |
| `.github/workflows/ci.yml` | header comment no longer claims there is no remote |
| `MUSHIN_RECONCILED_DOCUMENTATION_CANDIDATE/03A_SOFTWARE_REQUIREMENTS_SPECIFICATION.md` (outside the repo) | SRS corrections (EX-14) |
| `docs/completion/EXECUTION_STATUS.md`, this file, `inventory/2026-10-28-mushin_catalog_v3-phase-a/` | records |

## 3. Confirmed defects fixed

EX-01 build gate broken by this branch (lint 12 errors, boundaries 14 violations). EX-02 no database guarantee of one
testing lot per month. EX-04 undated Pakistani country never stale. EX-05 audience endpoints bypassed the country lock
(existence disclosure, credit reservation, provider job). EX-05b (BUG-36, after the main run) a CSV import of a locked
creator's link matched it, and the matched row unlocked the creator for that workspace; fixed in `imports/service.ts`
with 2 tests in `imports.int` (6/6 pass; fail on the old code). Lint, typecheck and boundaries rechecked clean; the full
integration count below predates this fix. EX-03 was a missing test, not a defect.

## 4. Tests (final working tree)

| Check | Result |
|---|---|
| Lint / typecheck / boundaries | pass / pass / pass (0 violations) |
| Unit | 581 passed (82 files); an earlier full run had 3 failures that passed alone and on rerun (EX-17, cause unknown) |
| Frontend unit / typecheck / build | 74 passed / pass / pass |
| Integration (`mushin_test_claude`, Meilisearch on a throwaway instance) | **732 passed, 0 failed**, 3 expected failures, 7 skipped (live-provider files), 0 blocked |
| Browser, PostgreSQL search (template rebuilt 0001 → 0062) | journey 108/108, break-it 54/54, after restart 54/54 |
| Browser, Meilisearch search | not rerun after these changes (last run earlier today: 108/54/54); none of the changes touch search |
| Secret scans (committed, working tree 255 files, bundle) | 0 findings |
| Search freeze check | not an acceptance pass under elig-2 (FRZ-02); not rerun |
| Hosted CI, staging, production | not run (no access used) |

## 5. Migrations

0062 created with an identical Supabase copy (sync check: 63 files match). Applied only to the disposable databases
`mushin_test_claude` and the browser template (62 migrations each). Preflight tested on `mushin_frz_elig2_disposable` inside
rolled-back transactions: orphan lot refused, duplicate month refused, clean lot backfilled to its month; that database is
still at 0061. `mushin_catalog_v3` (catalogue copy) stays at 0061; the frozen corpus stays at 0042. Rollback: drop the
index, the check and the column (no data depends on them); before applying anywhere persistent, run the preflight's two
queries read-only.

## 6. Catalogue and environment checks

See `EXECUTION_STATUS.md`: funnel per platform, near misses, country sources, retention calendar (all 371 eligible
YouTube profiles would be cleared in the week of 16 Nov 2026 if the worker runs retention), contacts 122 of 387, spend.
Hosted environments: not inspected.

## 7. Blocked

Hosted CI; staging/production migration state; worker hosting; auth email/SMTP; backups; Vercel and Supabase regions and
latency; live provider behaviour; niche accuracy (raters); browser rerun on Meilisearch (not blocked, not repeated).

## 8. Owner decisions (recommendation)

1. **YouTube policy — most urgent.** Without permitted refreshes before about 16 November, eligible YouTube supply falls to
   about zero once retention runs. Recommend deciding before the worker is hosted.
2. Instagram displayed country: keep it out of eligibility until a measurement-only pilot shows how often it exists.
3. Paid pilots: approve only the measurement-only Instagram test first, with a hard cap.
4. Creator confirmation: legal review of consent wording first; a small manual experiment before building the flow.
5. Worker host: any always-on container host near the Supabase region; decide after measuring region latency.
6. Re-rate search under `elig-2` (packet ready) rather than keep `elig-1` as the acceptance test.
7. Apply 0060–0062 to staging only, after a read-only preflight there.
8–9. Pilot scope, abuse controls, live billing, legal pages, auth settings, SMTP, backups: before any real customer.

## 9. Remaining risks and next actions

1. YouTube supply cliff (decision 1). 2. Worker not hosted: schedules, retention, billing jobs and Live Discovery do not
run in staging. 3. Nothing is verified on hosted infrastructure. 4. Instagram 16 and TikTok 0 eligible. 5. Niche accuracy
unmeasured. Next: decisions 1 and 7, then staging validation (migrations, worker, browser journeys against staging).

## 10. Confirmations

No external service, dashboard or account was changed. No paid provider was called; no spend occurred. No email was
sent and no creator was contacted. No persistent or catalogue database was modified (`mushin_catalog_v3` was only read;
the country script ran without `--apply`). YouTube API calls stayed off. No secret value was printed. Nothing was
committed, pushed or deployed.

---

# Continuation, 29 October 2026 (`MUSHIN_Urgent_Continuation_Bundle`)

Scope: P0 YouTube retention, P1 post-audit reruns, P2 owner checklist. Workspace features, completed audits and deferred
items (Instagram pilots, creator confirmation, ranking, coverage UI) were not reopened.

## P0 decision memo: the YouTube retention cliff

**Policy (read 2026-10-29; YouTube API Services Developer Policies, page updated 2026-10-15).** MUSHIN reads YouTube
channels without the creator's credentials, so everything it stores is *Non-Authorized Data*: it may be kept for no more
than 30 calendar days and then deleted or refreshed; statistics such as subscriber counts are named explicitly (III.E.4).
Creating new or derived data or metrics from API Data is not allowed, and YouTube data may be obtained only through the
API (III.E.6, III.I.14). There is no audit exception for this kind of data (III.L covers audited analytics developers only).

**Provenance (measured read-only on `mushin_catalog_v3`).** Every stored YouTube field came from the YouTube API: 2,441
payloads, provider `youtube`, fetched 2026-10-20 to 10-21 (`platform.raw_payloads`, `provider_calls`: `scrape_youtube`
2,460, `search_youtube_video` 613). Derived fields are derived from that API data: country (`platform_registration` 1,548,
`profile_text` 742 = channel description), niche (`profile_text` 2,513, `post_text` 547 = video titles, `ai_assessment`
454), city (`profile_text` 456). No YouTube profile has a creator-confirmed country and none has data from another source.
**Nothing can be separated out and kept**: the retention function (0060) clears exactly API data and data derived from it
(counts, description, country, niches, city, AI summary, evidence, snapshots, avatar) and keeps a creator-confirmed
country. Its behaviour matches the policy; it was not changed.

**Deadline.** All 371 eligible YouTube profiles were fetched 2026-10-20/21, so their data must be deleted or refreshed by
**2026-11-19 to 11-21** (the earlier "week of 16 November" was the calendar week). The frozen evaluation corpus holds
YouTube data from 2026-10-13 (deadline 2026-11-12, matching the owner decision of 2026-10-15).

**Gap found and fixed in code.** If the worker never runs, retention never runs, and the 90-day eligibility window would
have kept showing YouTube creators as eligible on API data 30-90 days old. `eligibility.ts` now caps YouTube follower
evidence at 30 days (`YOUTUBE_API_DATA_MAX_DAYS`): after 30 days the profile is `followers_stale`, whether or not the job
ran. It only shortens the owner's 90-day rule; nothing changes today (all counts are 8-9 days old); the frozen evaluation
is unaffected (0 YouTube counts were older than 30 days at its pinned date). Tests: `eligibility.test.ts` YT-RET-01.

**What code cannot fix: holding the data itself.** The rule above stops display; it does not delete. Wherever the data
is stored and the retention job does not run (staging, whose worker is not hosted; the local catalogue copies), MUSHIN
would hold API data past 30 days.

| Option | Supply after ~20 Nov | Requires |
|---|---|---|
| A. Refresh through the official API before the deadline, then every < 30 days | YouTube kept (counts and descriptions current) | Owner approval to switch `YOUTUBE_API_CALLS=on` for refresh only (the pending YouTube policy decision); a running worker; quota is ample (`channels.list` takes 50 ids per unit) |
| B. Let retention clear it (status quo) | YouTube eligible falls to 0; Instagram 16, TikTok 0 | Retention must actually run on staging by 2026-11-19 (worker, or a one-off approved run); local copies deleted or cleared |
| C. Creator confirmation | Does not keep counts; a confirmed country alone does not make a profile eligible | Not a fix for this deadline |

**Recommendation: A**, if MUSHIN is to keep YouTube creators: it is the only compliant way. Decide by about 2026-11-12 so
the refresh and a check can run before 2026-11-19. **Whatever is decided, staging and the local copies must not hold this
data past 2026-11-19.** Done in code now: the eligibility fail-safe. Needs the owner: the YouTube policy decision, enabling
calls, running retention or refresh on staging, deleting local copies.

## P1 reruns (29 October 2026, this working tree)
(Results are filled in below the checklist, from the runs of 2026-10-29 13:38-14:30 UTC.)

## P2 owner checklist (external; nothing here was done by me)

1. **YouTube retention decision, by about 2026-11-12** (memo above). Then either (A) approve a refresh through the
   official API (`YOUTUBE_API_CALLS=on` for refresh only) and run it before 2026-11-19, or (B) let the data be cleared:
   run the retention job on staging before 2026-11-19 (worker, or an approved one-off run of
   `platform.expire_youtube_api_data` followed by re-projection) and delete or clear the local copies
   (`mushin_catalog_v3`, `mushin_frz_elig2_disposable`, `mushin_eval_disposable` by 2026-11-12, and the files listed in
   `docs/readiness/youtube-eval-data-inventory.md`). Staging storage also holds about 2,338 YouTube channel images.
2. **Migrations 0060-0062 on staging.** Run `psql "$STAGING_DIRECT_URL" -v ON_ERROR_STOP=1 -f
   scripts/ops/preflight-0060-0062.sql` (read-only; the URL from your own environment). Stop if any line shows `ok = f`.
   If all pass: take a backup or confirm point-in-time recovery, apply with the migration runner in a quiet period,
   then run `node --import tsx scripts/supabase/sync-migrations.ts --check` and rerun the preflight (it must then show
   step 1 false, which confirms the new history). Rollback: 0062 drop index `credit_lots_one_testing_per_month_key`,
   constraint `credit_lots_period_rule`, column `credit_lots.period`; 0061 and 0060 add columns, policies and functions
   that later code depends on, so roll back the code with them. Tested locally: the preflight passes on a fresh 0059
   database, refuses one already at 0061, and 0059 -> 0062 applies cleanly.
3. **Supabase dashboard.** API exposed schemas only `public` and `graphql_public` (as in `supabase/config.toml`); Auth
   rate limits for sign-in, sign-up, password recovery and OTP set; "Secure password change" on.
4. **Groq key.** No code path reads it (`config.test.ts`: a leftover `GROQ_API_KEY` configures nothing; Groq appears only
   in the AI budget sum of past spend). Revoke it in the Groq console and delete the line from your local `.env`.
5. **Only what blocks staging validation:** a host for the worker (`docs/readiness/worker-hosting.md`; it runs the
   retention and billing schedules, so item 1 must be settled first), `DATABASE_SSL_CA_FILE` for the staging database
   (production refuses to start without it), backups/point-in-time recovery confirmed, and Supabase Auth email (custom
   SMTP) if staging sign-up is to be tested with real addresses.

## P1 results (29 October 2026, UTC times; current working tree)

| Check (command) | Result |
|---|---|
| `npx eslint .`, `npm run typecheck`, `npm run boundaries` (13:38) | pass, 0 errors, 0 violations (474 modules) |
| `npx vitest run --project unit` (13:38) | 584 passed, 83 files |
| frontend `npx vitest run`, `tsc --noEmit`, `npm run build` | 74 passed; pass; pass |
| `npx vitest run --project int`, run 1 (13:40-13:55) | 733 passed, **1 failed** (NFR-P01), 3 expected failures, 7 skipped |
| `npx vitest run --project int`, run 2 after the fixes (14:15-14:27) | **734 passed, 0 failed**, 3 expected failures, 7 skipped (5 live-provider/budget files), 0 blocked |
| Browser, PostgreSQL search, run 1 (13:56) | main journey stopped after ~60 checks; break-it 46/47; after restart 54/54 |
| Browser, PostgreSQL search, run 2 (14:04) | 108/108, 54/54, after restart 54/54 |
| Browser, Meilisearch search, throwaway 127.0.0.1:7711 (14:10) | 108/108, 54/54, after restart 54/54 (index `e2e_creators` served 48 searches) |
| Preflight 0060-0062 on a fresh local 0059 database | all checks true; refuses a database at 0061; 0059 -> 0062 applies; database dropped |

**Regressions found and fixed.**
1. *API CSP broke the development checkout page (from the 28 Oct security pass).* `form-action 'none'` blocked the mock
   checkout's Pay form, which stopped the browser journey and failed PAY-1. Fixed in `billing/mock-routes.ts`: that one
   HTML page sends its own CSP (inline styles, forms to the API, redirect to the app, no scripts, no framing). The API's
   JSON CSP is unchanged. `billing-api.int` asserts the exact header; browser runs 2 and 3 green.
2. *NFR-P01 fixture data outside the new YouTube 30-day limit.* The performance test made follower dates up to 40 days
   old, so 69 YouTube fixtures became correctly ineligible (931 of 1,000). Fixture dates are now within 25 days; the
   assertion is unchanged.

**Why counts differ from earlier reports.** 581 unit / 732 integration were before the 28 Oct security pass; 583 / 734
after it; unit is 584 now (YT-RET-01 added). The integration count stays 734 because the change today added an assertion
to an existing test, not a new test.

**Files changed in this continuation.** `apps/api/src/modules/creators/eligibility.ts`, `eligibility.test.ts`,
`creators/search.int.test.ts`, `billing/mock-routes.ts`, `billing/billing-api.int.test.ts`, `.vercelignore`,
`scripts/ops/preflight-0060-0062.sql` (new), this report and `EXECUTION_STATUS_CODE.md` (new).

**Note on `EXECUTION_STATUS.md`.** At 2026-10-29 14:07 UTC another session replaced that file with a market-research
report ("How Pakistani Brands Choose Platforms…"). It was left untouched. The execution register (restored from the
bundle copy) and the continuation rows are in `EXECUTION_STATUS_CODE.md`; references to `EXECUTION_STATUS.md` above
mean that register.

**Confirmations.** No YouTube or other provider call; `YOUTUBE_API_CALLS` stays off. No migration or write on a
persistent, staging or production database (`mushin_catalog_v3` was only read). No external account changed; nothing
committed, pushed or deployed; `.env.example` deletion untouched; no secret or creator data printed.
