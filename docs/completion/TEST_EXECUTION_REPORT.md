# Test execution report

Every line is a command that was actually run, with commit, date, totals and log. Logs under `eval-data/logs/` are
local (git-ignored, never packaged); `%TEMP%` is the Windows temp folder of the machine that ran them.

## Session 3: hosted Supabase (mandate v4, 2026-10-19, working tree on `3682e65`)

| Command | Result |
|---|---|
| `node --import tsx scripts/supabase/align-env.ts` (dry run, then `--write`, then dry run) | 6 variables realigned to `yknp…`; second dry run "nothing to change" |
| `node --env-file=.env --import tsx scripts/supabase/connect-check.ts` | 14 stages: **12 PASS, 1 FAIL** (migrations 0 of 49 applied), **1 BLOCKED** (genuine token) |
| `exposure-check.ts <DATABASE_URL> --api <SUPABASE_URL> --key <public key>` (hosted) | 18 checks, 0 problems (after the S6 fix; before it: crash, then 2 false positives) |
| Fresh disposable local DB `mushin_disposable_rehearsal_*`: `migrate-cli.ts --test` twice, then dropped | 49 applied; second run "already up to date" (plain PostgreSQL 17; the Supabase-image rehearsal needs Docker, which is not running) |
| `vitest run scripts/supabase/align-env.test.ts packages/db/src/migrate-cli.test.ts` | 5 passed |
| eslint on changed files; `npm run typecheck`; `npm run boundaries` | clean; clean; no violations |

## Final regression (Phase 7, 2026-10-19)

| Command | Commit | Result | Log |
|---|---|---|---|
| `npm run verify` (lint, typecheck, boundaries, unit + integration) in a fresh clone **without `.env`** (`MUSHIN-cleanci-v3`, own test DB, Meilisearch via env) | `611480b` | **929 passed, 0 failed, 7 skipped** (120 files passed, 5 skipped); blocked: 0 | `eval-data/logs/verify-v3-final.log` |
| `npx tsc --noEmit -p frontend/tsconfig.json` | `611480b` | pass | console |
| `npm --prefix frontend run build` | `611480b` | pass; landing bundle 843.77 kB (245.30 kB gzip) | console |
| `node --import tsx scripts/check-bundle-secrets.ts frontend/dist` | `611480b` | pass (no server setting names, secret formats, privileged JWTs or source maps) | console |
| `node scripts/e2e-customer/csp-check.mjs` | `611480b` | 7 passed, 0 failed | console |
| `node --import tsx scripts/search-eval/freeze-check.ts …/search_eval_queries_unlabeled.csv` | `611480b` | intact: Brain 1 35 queries, Brain 2 25 briefs byte for byte | console |
| `npm run e2e:customer -- 3` | `611480b` | **3 × (102 + 52) = 462 passed, 0 failed** (runs customer-20261019-194501-1..3) | `eval-data/logs/e2e-v3-final.log`, `%TEMP%/mushin-e2e-suite/` |
| `npm run e2e:staff -- 3` | `611480b` | **3 × 31 = 93 passed, 0 failed** (runs staff-20261019-195721-1..3) | same |

The 7 skipped tests are the five live-provider suites (`*.live.int.test.ts`), which need paid keys and explicit flags
(forbidden by mandate §2.2).

## Earlier runs in this mandate

| Command | Commit | Date | Result | Log |
|---|---|---|---|---|
| `npm run verify`, fresh clone, no `.env` (baseline) | `f690848` | 2026-10-19 | 924 passed, 0 failed, 7 skipped | `eval-data/logs/verify-v3-cleanclone.log` |
| `npm run verify`, working checkout | `f690848` | 2026-10-19 | lint failed on the untracked `scripts/test-local-pg.mjs` (not part of any commit, not created by this work) | `eval-data/logs/verify-v3-baseline.log` |
| `npm run e2e:customer -- 3` | `0bbb2f9` code | 2026-10-19 | 3 × (91 + 40) = 393/393 | `%TEMP%/mushin-e2e-suite/` |
| `npm run e2e:staff -- 3` | `0bbb2f9` code | 2026-10-19 | 3 × 31/31 | `eval-data/logs/e2e-staff-v3.log` |
| `npm audit --omit=dev` (root, frontend) | `1623b79` | 2026-10-19 | 0 vulnerabilities after removing the unused `react-router` (1 high before) | console |
| `vitest run scripts/search-eval/metrics.test.ts` | `5b52fef` | 2026-10-19 | 11 passed | console |

## Failures found and fixed during this mandate

| Failure | Root cause | Fix |
|---|---|---|
| E2E legal check intermittent ("recorded: false") | Terms dialog hid itself before the acceptance was stored | `7b82696` dialog stays open until stored |
| E2E expired-session check failed after isolating the browser | Browser had been sending token refreshes to the hosted Supabase project; the local stub did not answer them | `0bbb2f9` stub answers Auth calls; Vite points at it |
| E2E 768 px width | Top bar overflowed to 958 px beside the sidebar | `e5aad05` add-by-link box from 1024 px |
| E2E axe `scrollable-region-focusable` on Activity | Scrollable main region not keyboard reachable | `e5aad05` focusable with visible focus ring |
| E2E sidebar did not leave an open list | Section not reset on re-selection | `954d60e` |
| Clean-clone lint: `Event` undefined | Browser global used in the journey | `340364c` |
| Source secret-scan test timed out at 5 s | Larger committed tree, parallel load (no finding) | `611480b` 60 s limit, assertion unchanged |

## Not run (and why)

- Live-provider suites, Paddle sandbox, Resend, hosted Supabase: not authorised (mandate §2.2).
- Manual screen-reader/keyboard review: needs a person (UX-05).
- `score.ts` end to end: needs completed human rating sheets.
