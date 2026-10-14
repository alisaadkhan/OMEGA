# Module acceptance and integration test matrix (2026-10-14, HEAD 07580ef)

**Environment.** Local PostgreSQL 17 on port 54330; self-hosted Meilisearch 1.55 on 127.0.0.1:7700; API, worker and Vite frontend running locally. Headless Chrome drove the real UI. Customer sign-in used a local signing stub with Supabase-shaped claims; staff sign-in used real password + TOTP accounts in the local database. Apify and Serper were **blank**: no paid call was made in this pass. A **mock** means a provider fixture inside an automated test; **live UI** means the real frontend → API → worker → database path.

## Automated suite

`npm run verify` (lint, typecheck, boundaries, tests): **661 passed, 7 skipped, 0 failed**. The skipped tests are the opt-in paid live-provider tests. Frontend `npm run build` succeeds.

## By module

| Module | Automated (integration unless noted) | Live UI journey | Result | Mocked / not live |
|---|---|---|---|---|
| Catalog search (Brain 1), PostgreSQL | search.int, creators-api.int, search-compare (1k/10k/100k) | search-acceptance, PostgreSQL mode | **PASS** 11/11 | — |
| Catalog search, Meilisearch | search.int, worker-side.int, meilisearch.int, search-compare | search-acceptance, Meilisearch mode; live fallback with Meilisearch stopped; restart persistence | **PASS** 11/11 | — |
| Live discovery (Brain 2) | live-runner.int (23+2), live-service.int, live-api.int, discovery-runner.int | Quote → confirm → provider failure → full refund | **PASS** (failure path) | Serper/Apify/YouTube success paths are mock/replay only: **blocked live** (spend authorisation) |
| Live discovery cancellation | live-runner.int (before start, mid-extraction), live-api.int | Stop buttons render; not exercised live (needs a running paid job) | **PASS** automated | Live stop of a paid run not tested |
| Billing and credits | engine.int, service.int, partial-commit.int, billing-api.int | Balance unchanged after failed run | **PASS** | Paddle checkout and webhooks: mock provider only |
| Contact reveal | profile.int | No contact values in cards, lists or campaigns | **PASS** | — |
| Lists | lists.int (5 tests incl. RLS, erasure, HTTP) | lists-acceptance | **PASS** 12/12 | Export is not available (visibly) |
| Campaigns + outreach log | campaigns.int (5 tests incl. stale-edit 409, append-only, RLS, erasure) | campaigns-acceptance | **PASS** 13/13 | Tasks/reminders and sending are not in the MVP |
| Analytics | analytics.int | dashboard-acceptance (numbers equal the API) | **PASS** | — |
| Activity feed, bell, dashboard | analytics.int (activity), app UI | dashboard-acceptance (no sample content; no self-changing log) | **PASS** 10/10 | — |
| Settings | identity.int (name, rename, members, 403) | support-staff-acceptance (profile, team, honest notifications) | **PASS** | Password change and other-session sign-out call Supabase Auth: **not verified** (no real Supabase user) |
| Support (customer) | ops.int (ticket flow, isolation, closed → 409) | support-staff-acceptance | **PASS** | — |
| Staff console | ops.int (roles, masking, providers, audit), staff-login.int, staff-session.int | support-staff-acceptance (support and admin roles, TOTP) | **PASS** 12/12 | — |
| Data removal / erasure | erasure.int; lists/campaigns erasure cases | Existing admin removal queue | **PASS** automated | — |
| Audience estimate (optional) | audience.int, method.test | Not exercised (off by default) | **PASS** automated | Disabled; policy gates in `2026-10-13-audience-estimate-design.md` |

## Cross-module integration checks

| Check | Evidence |
|---|---|
| Saving a creator from Search, a list or a profile writes to the same list | lists-acceptance (profile), SaveToListMenu in search cards/bulk bar |
| Adding to a campaign from a profile, a search selection or a list | campaigns-acceptance; AddToCampaignMenu |
| Erasing a creator removes them from reveals, discovery results, lists, campaigns and outreach | erasure function (migration 0025); lists.int; campaigns.int |
| Hidden creators (possible minors, removal requested) never appear in search, lists, campaigns, analytics or activity counts | search-compare lifecycle rows; lists.int; campaigns.int |
| One workspace never sees another's lists, campaigns, outreach, tickets, activity or analytics | lists.int, campaigns.int, analytics.int, ops.int (including raw queries under the other tenant's RLS) |
| A failed or stopped live run never charges for undelivered work | live-runner.int; UI provider-failure refund |
| Two concurrent editors cannot silently overwrite a campaign creator | campaigns.int + UI (409, reload, warning) |
| Staff reads across workspaces only through redacted functions, and views/replies are audited | ops.int; UI audit-log check |

## Performance (local, warm, single user)

| Path | Size | p95 |
|---|---|---|
| Catalog search, PostgreSQL | 100,000 creators | 89 ms (all shapes) |
| Catalog search, Meilisearch | 100,000 creators | 28 ms |
| Lists index / detail | 60 lists, 6,000 members | 26 / 10 ms |
| Campaigns index / detail | 30 campaigns, 3,000 creators | 11 / 12 ms |
| Analytics summary (90 days) | 15,000 outreach events | 29 ms |
| Activity feed | as above | 29 ms |

Not measured: concurrent load, the remote Supabase database, cold starts.

## Blocked live checks and the minimal test to run once unblocked

| Check | Needs | Minimal test |
|---|---|---|
| Real customer sign-in | A working Supabase Auth user for the configured project | Sign in at http://localhost:5173, then run checklist items 1, 6, 12 in `local-setup.md` |
| Find New Creators success path | Written authorisation and a spend cap for Serper (and Apify for Instagram/TikTok) | One YouTube size-5 run (Serper only, about 3 searches), then one Instagram size-5 run (Apify ≤ $0.05) |
| Paddle checkout | Paddle sandbox credentials | Sandbox checkout → webhook → plan active → ledger grant |
| Supabase password change / sign out others | Real Supabase user | Settings › Password & sessions |
