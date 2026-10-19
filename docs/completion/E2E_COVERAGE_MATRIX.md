# E2E coverage matrix

The mandate's 20 journeys (§10.2) and regression journeys (§10.3) mapped to the checks that cover them. Browser suites:
`npm run e2e:customer` (`scripts/e2e-customer/journey.mjs`, two phases: main and after an API/worker restart) and
`npm run e2e:staff` (`scripts/e2e-staff/journey.mjs`). Check areas are the first argument of each `check(...)`.
Every run uses the synthetic catalogue and blank provider keys; the browser talks only to a local Auth stub.

Latest results (2026-10-19): customer 102 + 52 = 154/154 at `954d60e`; staff 31/31 at `850943d`+ (UX commits). Phase 7
re-runs both three times (TEST_EXECUTION_REPORT.md).

**Coverage:** Full = the journey's behaviour is checked in the browser. Partial = part in the browser, the rest only in
integration tests (named) or not at all (stated).

| # | Journey | Coverage | Browser checks (area: what) | Also covered by / gap |
|---|---|---|---|---|
| 1 | Sign-in, session lifecycle, sign-out | Full (with the E2E Auth stub) | auth: dashboard → login when signed out; reload restores session; expired session refused and ends on login; signed-out after sign-out; confirmation result page | Real Supabase sign-in: `scripts/supabase/auth-check.sh` (local Supabase) |
| 2 | First workspace, onboarding, switching | Partial | dashboard: first visit provisions the workspace with the trial; team: switcher offers both workspaces after joining; removed member's tab lands in their own workspace | Creating an additional workspace from the UI: not covered |
| 3 | Role permissions, direct unauthorized access | Full | roles (admin/member UI + API 403s), isolation (another workspace gets 404/empty), staff roles (Support refused admin APIs) | `security.int`, RLS tests |
| 4 | Brain 1 search, several query types | Full (correctness only) | search: text, partial handle, platform filter, different queries differ, match reasons, contact availability; eligibility | Relevance **not accepted** |
| 5 | Empty results, invalid input, search failure | Partial | search: empty result explained + Find New offered; malformed input 400; AI reading unavailable does not block | Search backend outage in the browser: not covered (API readiness tested) |
| 6 | Live Discovery brief → quote → confirm → progress → completion | Partial | discovery: insufficient credits; quote names platforms and price; rule text; same quote twice → one job; tampered estimate refused | **Delivered-creators completion is not run in the browser** (providers blank); covered by `live-runner.int` / `live-replay` with recorded fixtures |
| 7 | Provider failure, honest status | Full | discovery: provider unavailable → job fails honestly, every credit returns; ledger nets to zero | |
| 8 | Duplicate prevention | Partial | lists: duplicate name refused; discovery: one job per quote | Creator de-duplication in Live Discovery: `live-runner.int` |
| 9 | Profile: source, freshness, unknown, eligibility, contact | Full | profile: stored creator, no contact values, availability and source/check state; eligibility: below-minimum reason | |
| 10 | Lists: create, add/remove, rename, delete | Full | lists: save from profiles, note, favourite, duplicate refused, rename and delete in the UI, sidebar returns to index | Member removal from a list: `lists.int` |
| 11 | Campaigns: create, stages, assignment, limits | Full | campaigns: from list selection, stage/fee/declined, no stale conflict; plans: Starter limit 3, archive/restore, Scale unlimited | |
| 12 | Credit reserve/charge/release, insufficient, failure recovery | Full | discovery: reserve/release net zero; billing: balance equals ledger; pricing: search charged once, repeat free | `engine.int` |
| 13 | Pricing and billing, mock checkout labelled | Full | plans: page equals server catalogue, no annual/discount; billing: mock checkout activates plan | Test checkout page says "Test mode: no real payment" |
| 14 | Outreach without real messages | Full | campaigns: outreach logged with author; plans: email in test mode (nothing delivered) | |
| 15 | Contact availability, permission, reveal credits | Full | profile: reveal confirmed first, charges 5 once, value shown; second reveal free | Member/denied reveal paths: `creators` service tests |
| 16 | Staff operations, approvals, step-up, restrictions | Partial | staff: sign-in per role, step-up with a virtual key, directory, audit search, Support refused admin APIs | Approvals UI not run in the browser (`staffops.int`); forged step-up token: `webauthn.int` |
| 17 | Export, deletion, retention, blockers | Full | privacy: export contents (no staff notes), account deletion and sign-out; plans: export plan gating | Deletion blockers: `team.int`, `privacy` tests |
| 18 | Session expiry, unauthorized, no retry loop | Full | auth: expired session → login (single refresh refused by the stub, no loop) | |
| 19 | Responsive 390/768/1280/1440 + keyboard | Partial | phone: 12 public routes and dashboard sections at 390; landing and dashboard at 768 and 1280; default viewport 1440; a11y: axe on every page/dialog | Manual keyboard-only and screen-reader pass: not done (UX-05) |
| 20 | Reload, direct route, stale cursor, offline, recovery | Partial | auth: reload on a direct URL; states: unknown route → Page not found; offline banner; degraded banner; restart: data persists after API/worker restart | Stale cursor: not covered (Search frozen, SRCH-08) |

## Regression journeys (§10.3)

| Regression | Coverage | Where |
|---|---|---|
| Forged staff token without server-side step-up refused | Integration | `webauthn.int` ("a token forged with the signing secret and an hwk claim is refused") |
| Non-member workspace header → 403 `workspace_access_denied`, no read/write | Browser + integration | customer `team` (removed member 403, never redirected); identity tests |
| Two tabs keep their own workspace | Partial | per-tab sessionStorage (`frontend/src/app/api/workspace.ts`); customer `team` (other tab told it lost access); a true two-tab switch is not scripted |
| Zero-result search charged under current rule (D-05) | Browser | customer `pricing` ("a zero-result search is charged once…") |
| Live Discovery failure mid-run + worker restart: no duplicate charge, creator or orphaned run | Integration | `live-runner.int`, `provider-runs.int`, reconciler tests; browser `restart` covers persistence only |
| Pricing page and quote numbers equal server constants | Browser + unit | customer `plans`, `discovery` (rule text); `frontend/src/app/api/plans-claims.test.ts` |
| Migration constraints, financial retention | Integration | `billing-schema.int`, `service.int` (BIL-04), 0042 tests, `key-rotation.int` (column coverage) |
| Build output secret scan | Build | `scripts/check-bundle-secrets.ts frontend/dist` |
