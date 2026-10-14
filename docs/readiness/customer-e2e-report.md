# Customer-side end-to-end test report

Date: 2026-10-14. Code under test: commit `099f349` (master). Harness: `scripts/e2e-customer/` (committed with this report).

## 1. Summary

- A real browser (headless Chrome, Playwright) drove the real UI → Fastify API → pg-boss worker → PostgreSQL 17 →
  self-hosted Meilisearch. The database was reset from a catalog-only template before every run. Each run ended with an
  API/worker restart and a persistence check.
- **56 automated checks per run. 8 consecutive full runs passed (56/56 each)**: 5 from the working copy and 3 from the
  committed harness. Before that, one earlier attempt stalled once (section 6).
- **Two customer-facing defects were found and fixed** (`099f349`), with a regression test.
- **Scenario coverage: 38 of 49 scenarios PASS (78%).** Of the 46 scenarios that can run without paid providers or
  external accounts, 38 PASS (83%). The rest are 3 BLOCKED, 4 MISSING (not built) and 4 NOT TESTED. Nothing FAILS.
- No money was spent. Apify, Serper, Groq, Ollama and audience sources were blank. Payments used the built-in mock
  Paddle provider.
- **Conclusion:** usable as an MVP for a *catalog-first* customer (search, profiles, lists, campaigns, outreach log,
  credits, roles, support) in a controlled pilot. It is **not yet usable** for paid live discovery, real sign-up,
  invitations or real payments (section 9).

## 2. Environment and method

| Item | Value |
|---|---|
| Database | `mushin_e2e`, recreated from `mushin_e2e_template` before each run (21 real catalog creators, 20 search documents, 3 plans, 8 contacts, no users) |
| Search | Meilisearch 1.55, index prefix `e2e_` (the `dev_` index is untouched); reconciled from PostgreSQL at worker start-up |
| Auth | Local ES256 signing stub (`auth-stub.mjs`, Supabase claim shape) and JWKS on :4999. **Real Supabase sign-in is not exercised.** |
| Identities | owner, admin, member (same workspace), outsider (second workspace), expired token |
| Providers | All metered providers blank; LLM unavailable by design; mock Paddle checkout |
| Rate limit | `RATE_LIMIT_MAX_REQUESTS=2000` for automation speed, in-memory limiter; production values unchanged (finding F-5) |
| Evidence per check | UI state *and* the API response and/or a direct SQL assertion; browser console errors, API 5xx and staff (`/admin/v1`) calls are recorded for the whole run |

Teammates join the owner's workspace through a database fixture, because invitations are not implemented (M-1).

## 3. Test matrix

Status: PASS, FAIL, BLOCKED (cannot run without credentials, spend or a decision), MISSING (feature not built),
NOT TESTED (possible locally but not in this journey). Layers exercised: U = UI, A = API, D = database, W = worker,
S = search index.

| # | Requirement | Role | Scenario: action → expected | Observed | Layers | Status |
|---|---|---|---|---|---|---|
| 1 | AUTH-001 | signed out | Open `#/dashboard` → sent to login | Redirected to `#/login` | U | PASS |
| 2 | AUTH-001 | expired | Expired token → API 401, UI ends on login | 401; `#/login` | U A | PASS |
| 3 | AUTH-001 | owner | Reload a direct dashboard URL → session restored | Dashboard shown | U A | PASS |
| 4 | AUTH-001 | new user | Real Supabase sign-up / sign-in | Stub only | — | BLOCKED (no Supabase test credentials) |
| 5 | — | new user | Password reset / email verification | Hosted by Supabase | — | NOT TESTED |
| 6 | FRONT-001 | owner | First visit → real 200-credit trial, honest empty cards | Balance 200 (API), "No lists/campaigns yet", no sample content | U A | PASS |
| 7 | — | owner | Edit profile name | Stored in `wp.users` | U A D | PASS |
| 8 | — | owner | Rename workspace | Stored in `wp.workspaces` | U A D | PASS |
| 9 | — | owner | Team list shows members and roles | owner, admin, member shown | U A | PASS |
| 10 | — | owner | Invite a teammate | No invitation feature | — | MISSING |
| 11 | CAT-001 | owner | Text search → UI shows exactly the API's creators | API 9 = UI 9; no job created | U A S | PASS |
| 12 | INT-002 | owner | LLM unavailable → search still works | Interpret 503; results shown | U A | PASS (AI-on path BLOCKED: no LLM key) |
| 13 | CAT-001 | owner | Different queries → different, related results | Pass | U A S | PASS |
| 14 | CAT-003 | owner | Partial handle finds the creator | Found | U A S | PASS |
| 15 | CAT-002 | owner | Platform filter (UI and API) | Only that platform | U A S | PASS |
| 16 | CAT-001 | owner | No results → explained, offers live discovery | Shown | U | PASS |
| 17 | — | owner | Malformed search input → 400 | 400 | A | PASS |
| 18 | CONTACT-001 | owner | Profile panel shows stored creator, no contact values | No contact values | U A | PASS |
| 19 | CONTACT-002 | owner | Reveal a contact (charged once) | Covered by `profile.int` only | — | NOT TESTED (E2E) |
| 20 | CRM-001 | owner | Save 2 creators to a list; note; favourite; duplicate name refused | All stored; duplicate 409 | U A D | PASS |
| 21 | CRM-001 | owner | Add from list to campaign; stage, agreed fee, declined outcome; totals exclude declined | Stored; totals correct (after fix D-2) | U A D | PASS |
| 22 | CRM-001 | owner | Log outreach | Stored with author | U A D | PASS |
| 23 | LIVE-001 | owner | Size above balance cannot be confirmed | Confirm disabled; insufficient credits | U A | PASS |
| 24 | LIVE-001 | owner | Quote names platforms and price before reserving | No job or reservation before confirm | U A D | PASS |
| 25 | CREDIT-002, BILL-003 | owner | Provider unavailable → job fails honestly, all credits return | `failed`; 200 → 200 | U A D W | PASS |
| 26 | CREDIT-002 | owner | Ledger reserve/release nets to zero | 0 | D | PASS |
| 27 | LIVE-002 | owner | Confirm the same quote twice → one job, one reservation | 202 then 200, one job | A D W | PASS |
| 28 | LIVE-002 | owner | Unknown/tampered estimate id refused | Refused | A | PASS |
| 29 | LIVE-003 | owner | Live discovery success (creators delivered and charged) | Needs Apify/Serper/LLM | — | BLOCKED (paid providers) |
| 30 | JOB-003 | owner | Cancel a running job from the UI | Jobs fail at once with no provider | — | NOT TESTED (E2E; `live-runner.int` covers it) |
| 31 | — | owner | Add creator by profile link | Paid start | — | NOT TESTED |
| 32 | BILL-001 | owner | Checkout activates plan and grants credits | Mock: Explorer active, 2,700 credits | U A D W | PASS (mock) |
| 33 | BILL-001 | owner | Real Paddle sandbox checkout | No merchant account | — | BLOCKED |
| 34 | CREDIT-002 | owner | Balance equals ledger lots | 2,700 = lots | A D | PASS |
| 35 | — | owner | Dashboard cards equal API and DB | Equal | U A D | PASS |
| 36 | FRONT-001 | owner | Activity feed shows real actions only | Real actions only | U A | PASS |
| 37 | — | owner | Support request stored for the workspace | Stored | U A D | PASS |
| 38 | AUTH-001 | admin | Rename workspace; see shared lists/campaigns; view ledger | Allowed | U A | PASS |
| 39 | AUTH-001 | member | Cannot rename (UI disabled, API 403); cannot read ledger or buy (403); no purchase controls; can use lists | As expected | U A | PASS |
| 40 | — | viewer | Read-only viewer role | No such role in docs or code | — | MISSING |
| 41 | AUTH-001 | outsider | Every private record of another workspace → 404 | 404 ×5 | A | PASS |
| 42 | AUTH-001 | outsider | Activity, lists, analytics of other workspace not visible | Empty | A | PASS |
| 43 | CAT-001 | outsider | Catalog stays globally searchable | Results | A S | PASS |
| 44 | AUTH-001 | owner | After sign-out the dashboard is unreachable | `#/login` | U | PASS |
| 45 | PERS-001 | owner | List, members, note, campaign pipeline survive API/worker restart | Persisted | A D | PASS |
| 46 | PERS-001 | owner | Search answers after restart (index reconciled) | Results | A S W | PASS |
| 47 | — | all | No browser console errors, no API 5xx, no staff calls from customer pages | None (after fix D-1) | U A | PASS |
| 48 | EMAIL-001 | owner | Email notifications | No email provider | — | MISSING |
| 49 | CRM-001 | owner | Export lists/campaigns | Planned, not built | — | MISSING |
| — | PRIV-002 | owner | Audience demographics | Off by policy (audience spec §10) | — | Not counted (deliberately off) |
| — | — | owner | Phone-width layout, keyboard/screen-reader use | Not exercised | — | Not counted; see section 9 |

**Verification percentage.** Each row is one customer scenario. Its status comes from the eight passing runs, and every
row needs the UI, API or database assertions listed. PASS 38 / 49 = **78%**. Without the 3 BLOCKED rows: 38 / 46 =
**83%**. The counts are: FAIL 0; BLOCKED 3 (rows 4, 29, 33); MISSING 4 (10, 40, 48, 49); NOT TESTED 4 (5, 19, 30, 31).
Row 12 counts as PASS for its tested half (search without AI). Its AI-on half needs the same LLM keys as row 29.

## 4. Run results

| Run set | Harness | Runs | Result |
|---|---|---|---|
| First attempt | working copy | run1, run2, run3 | run1 56/56; **run2 stalled** (section 6); run3 56/56 |
| Second attempt | working copy, with browser activity logging | run1–run5 | 5 × 56/56 consecutive |
| Third attempt | committed `scripts/e2e-customer/`, after a machine restart | repo1–repo3 | 3 × 56/56 consecutive |

Each run is 50 checks in the main phase plus 6 after the restart. That makes 8 consecutive full passes; the
requirement was 3. Over all 11 attempts, 10 passed and 1 stalled.

Supporting checks on `099f349`:
- `npm run verify` (lint, typecheck, boundaries, tests): **664 passed, 7 skipped, 0 failed** (84 test files). The 7
  skips are live-provider tests.
- `frontend` `vite build` succeeded.
- Lint of `scripts/e2e-customer` is clean, and dependency-cruiser reports no violations.

### Phone width and accessibility (2026-10-14/15)

The after-restart phase now also checks, signed in as the owner: axe-core 4.10.2 (WCAG 2.1 A/AA, serious and critical
findings) on Search, Lists and Campaigns at 1440 px, and at 390 × 844 the landing page, login, dashboard, Search (with
results), Lists, Campaigns and Credits & billing. Each must be reachable, must not scroll sideways (page or main area),
must have no visible element cut off at the screen edge, and must pass axe. That is 22 checks after the restart (6
before) and 73 per run.

| Run set | Commit | Result |
|---|---|---|
| After the per-job cost cap | `3ec6ec2` | postcap-1, postcap-3: 57/57; postcap-2: 56/57 (console error from a Vite hot reload when I edited a component during the run; not a product defect) |
| Final, three in a row | `9157bc1` | 3 × 73/73 |

Defects the new checks found, all fixed in `9157bc1`:

| ID | Severity | Defect | Fix |
|---|---|---|---|
| D-3 | P1 | On phones the 240 px sidebar stayed open: content squeezed to about 150 px and the top bar (account menu) cut off | Below 768 px navigation is a drawer opened from the top bar's menu button (Escape closes it) |
| D-4 | P2 | Grey text (slate-400 on white, about 2.6:1) below WCAG AA 4.5:1 in customer pages; amber/slate pill text just under 4.5:1 | Slate-500 for text on light backgrounds (dark cards keep slate-400); amber-800 and slate-600 pill text |
| D-5 | P2 | List cards were a role=button containing the favourite button (nested interactive controls) | The list name is the card's stretched button; the star sits above it |
| D-6 | P3 | Landing feature tabs ran past a 390 px screen | Smaller tab padding and no icons below 640 px |
| T-1 | Test | "Dashboard cards equal API" failed only around midnight: the test computed the date range in UTC, the API uses Pakistan time | Test computes the range in Asia/Karachi |

## 5. Defects found and fixed

| ID | Severity | Defect | Fix | Regression evidence |
|---|---|---|---|---|
| D-1 | P1 | Every customer page load sent `POST /admin/v1/auth/refresh`, got 401, logged a console error and used the per-IP rate limit. Offices behind one IP were affected first. | Staff session restored only on `#/admin` routes (`AdminAuthContext.tsx`) | E2E check "customer pages send no staff (admin) requests" (0 calls in 8 runs) |
| D-2 | P1 | Editing a campaign creator twice quickly gave a false 409 "Updated by someone else" and lost the fee; the cache kept the old version until a refetch | Saved version applied to the cache on success (`campaigns-mapping.ts`, `useUpdateCampaignCreator`) | `campaigns-mapping.test.ts` (2 tests); E2E campaigns check |

Both fixes are in commit `099f349`.

## 6. Open findings (not fixed: owner decision or outside scope)

| ID | Priority | Finding |
|---|---|---|
| F-1 | P1 | **Intermittent stall, cause unproven.** In one attempt the owner's dashboard sent no API request for 30 s after the expired-session step, and the page wait timed out. It has not recurred in 8 instrumented runs. A likely factor is that the journey is not hermetic: the browser contacts the real Supabase project (expired-token refresh, avatar storage), Google Fonts and Unsplash. The harness now logs every page request and screenshots open pages on failure (`debug-*.log`, `FAILED-*.png`). |
| F-2 | P1 | Invitations are not implemented; a workspace cannot gain teammates through the product. |
| F-3 | P2 | No Viewer role exists (only owner/admin/member). |
| F-4 | P2 | **Spec conflict:** the documentation pack's role matrix lets members view the credit ledger, but the repo billing spec and the code restrict it to owner/admin. The E2E follows the code. |
| F-5 | P2 | The rate limit is 120 requests/min per IP and per user by default. That may be tight for several staff behind one office NAT. The Upstash limiter fails open. |
| F-6 | P2 | The paid-start limit (20/h per user) lives in remote Upstash and survives database resets. Local testers can hit it unexpectedly. |
| F-7 | P3 | The dashboard credit card shows "Healthy" while the balance is still loading. |
| F-8 | P3 | The subscription card may read "Inactive" during the trial (observed once; to verify). |
| F-9 | P3 | Inner dashboard sections have no URLs (`#/dashboard` keeps the internal view), so a section cannot be bookmarked or opened directly. |
| F-10 | P3 | One 404 per run from a static asset (favicon or a mock-checkout asset); harmless but noisy. |

The staff hierarchy (Support → Admin → Super Admin = owners) is a documented gap. The code has staff roles
`support` and `admin` only, and no Super Admin. Nothing was changed here (out of scope).

## 7. Dummy and placeholder data inventory

| Location | What | Customer-visible? | Status |
|---|---|---|---|
| `frontend/src/app/components/landing/FeatureTabs.tsx` | Product illustrations with fictional creators and numbers | Yes (landing page) | Labelled "fictional examples" (`d776d61`) |
| `landing/Testimonials.tsx`, `LogoCloud.tsx`, `TrustGrid.tsx` | Placeholder testimonials, logos, trust badges | No (not imported anywhere) | Unused; delete or replace before they are wired in |
| `scripts/seed-data/creators.ts` | Demo creators with modelled authenticity and `@example.com` emails, labelled "demo data" | Only if someone runs the dev seed | Not present in `mushin_e2e_template` (all 21 snapshots are real assessments) |
| Payments | Mock Paddle provider | Yes in development only | Production refuses to start without a Paddle key (BILL-002) |
| Auth (E2E only) | Signing stub and fixture teammates | No | Test tooling only |

Seeded lists, campaigns, activity, notifications, staff KPIs and payment methods were removed earlier and stay
removed. Every run checks for "Sample"/"Illustrative" text.

## 8. Blocked integrations

| Integration | Blocks | Needs |
|---|---|---|
| Supabase Auth (real project) | Sign-up and sign-in (row 4); password reset and email verification (row 5) | Test project credentials |
| Apify, Serper, Groq/Ollama | Live discovery success, add-by-link, AI query interpretation (rows 12, 29, 31) | Your spend authorisation |
| Paddle | Real checkout (row 33) | Merchant/sandbox account |
| Email (Resend) | Notifications (row 48) | Provider integration (not built) |
| Audience demographics | Audience estimates | Off by decision (audience spec §10) |

## 9. Is it usable as an MVP?

**Yes, for a controlled, catalog-first pilot.** A signed-in team can do all of the following, with correct data at
the API and database:
- search the catalog;
- open profiles;
- build lists;
- run campaigns with an outreach log;
- buy credits (mock);
- respect roles and workspace isolation;
- keep everything across restarts.

**Not yet, for open self-serve customers.** That needs:
1. real Supabase sign-in verified;
2. invitations (F-2);
3. an authorised live-discovery run proving the paid path end to end;
4. a Paddle sandbox checkout;
5. phone-width and accessibility checks, which this journey does not cover.

## 10. Reproduction

Prerequisites:
- the local PostgreSQL cluster on :54330 with `mushin_e2e_template`;
- Meilisearch (`npm run meili:start`);
- the frontend dev server (`cd frontend && npm run dev -- --port 5173 --strictPort`);
- Chrome.

```bash
# One-time: catalog-only template from mushin_local (users, staff and platform event tables emptied)
createdb -h localhost -p 54330 -U postgres -T mushin_local mushin_e2e_template
psql -h localhost -p 54330 -U postgres -d mushin_e2e_template -c "do \$\$ declare r record; begin
  for r in select format('%I.%I', schemaname, tablename) t from pg_tables where schemaname in ('wp','staff')
    or (schemaname='platform' and tablename in ('outbox','idempotency_keys','provider_calls','summary_requests','webhook_events'))
  loop execute 'truncate ' || r.t || ' restart identity cascade'; end loop; end \$\$;"

cd scripts/e2e-customer && npm install        # playwright-core only; not a workspace package
node auth-stub.mjs &                          # JWKS on :4999; writes identities.json to the output folder
export PG_BIN=/path/to/postgres/bin           # psql, createdb, dropdb
export E2E_SUPABASE_REF=<project ref>         # public: first label of VITE_SUPABASE_URL
# optional: CHROME_PATH, E2E_OUT (default <os tmp>/mushin-e2e)
for r in run1 run2 run3; do ./run.sh $r; done
```

`run.sh` does the following for each run:
1. recreates `mushin_e2e` from the template;
2. starts the API and worker with `env.sh`, which blanks the paid providers;
3. runs the main journey;
4. restarts both services;
5. runs the after-restart phase.

Results are appended to `<E2E_OUT>/results.jsonl`. Screenshots and logs also go to `<E2E_OUT>`.
