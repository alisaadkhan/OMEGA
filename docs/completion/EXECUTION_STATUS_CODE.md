> Restored 2026-10-29: `EXECUTION_STATUS.md` was overwritten at 2026-10-29 14:07 UTC by another session with a market-research
> report, which was left in place. This file holds the execution register (from the bundle copy) plus the continuation.

# Execution status: verified readiness and creator supply (28 October 2026)

Mandate: `MUSHIN_Claude_Code_Execution_Bundle/MUSHIN_EXECUTION_PROMPT.md`. Branch `feat/internal-completion-and-search-acceptance`,
HEAD e292915, working tree uncommitted (baseline: 143 modified, 64 untracked, 1 deleted `.env.example` left untouched).
The three reports named in the mandate (Creator Supply and Readiness Decision Report, Execution Plan, DeepSeek review)
are **not in the bundle or on disk**; their findings were taken from the bundle's `REFERENCE_FINDINGS_REPORT.md` and
verified against the code and the local catalogue copy.

Status values: **Confirmed defect** (fixed unless stated) · **Implementation gap** · **Test gap** · **Doc mismatch** ·
**External action** · **Decision** · **Not reproducible / no longer applicable**.

## Catalogue measured (read-only, `mushin_catalog_v3`, 2026-10-28 14:18 UTC)

`mushin_catalog_v3` is the local copy of the operational catalogue (the staging/hosted catalogue was not accessed).
Evidence: `inventory/2026-10-28-mushin_catalog_v3-phase-a/`, `scripts/catalog/funnel.sql`, country dry run (0 transitions).

| Stage | YouTube | Instagram | TikTok |
|---|---|---|---|
| Profiles (= creators; no creator has two platforms) | 2,379 | 108 | 33 |
| Follower count known and ≤ 90 days old | 2,379 | 108 | 33 |
| ≥ 10,000 | 635 | 71 | 14 |
| + active (no post older than 90 days) and available | 581 | 70 | 14 |
| + country Pakistan | 375 | 16 | 0 |
| **Eligible in the search projection** | **371** | **16** | **0** |

- The 4 YouTube profiles between 375 and 371 are possible minors without a staff override: correctly excluded.
- Biggest loss per platform: YouTube at the 10,000 threshold (2,379 → 635), then country (581 → 375: 138 foreign,
  62 unknown, 6 conflicting); Instagram at country (70 → 16, all 54 others unknown); TikTok at country (14 → 0, all unknown).
- Country sources of Pakistani profiles: YouTube platform-declared 1,169, creator-stated 114; Instagram creator-stated 27.
- Search projection: 19 active creators have no search document, all possible minors (by design); 0 orphan documents;
  every document is `elig-2`. Duplicate same-platform profiles: 0. Decided countries without a check time: 0.
- Eligible creators with a usable public contact: 122 of 387.
- Provider spend recorded in this copy: Serper US$1.04 (1,925 calls), Ollama US$0.63, Apify US$0.30, Groq US$0.07, YouTube 0.
- Reported figures 2,520 / 387 (371 / 16 / 0) are **reproduced** on this database at this time.

## Issue register

| ID | Area | Finding | Status | Evidence / action |
|---|---|---|---|---|
| EX-01 | Build gate | `npm run lint` failed (12 errors) and `npm run boundaries` failed (14 violations), all introduced by this branch's uncommitted work; `npm run verify` and CI's verify step could not pass | Confirmed defect, **fixed** | imports routed through module `index.ts`; BOM written as `﻿`; unused import/global removed; inventory reconciliation without non-null assertions (a missing count now fails the check) |
| EX-02 | Credits | One testing lot per workspace-month was enforced only by the ledger reference; the API role's insert policy allows a testing lot alone, and no database constraint stopped a second lot for the month | Implementation gap, **fixed** | migration 0062: `period` column, check rule, unique `(workspace_id, period) where source = 'testing'`, preflight refusing orphans/duplicates; TA-18; preflight tested on a disposable 0061 copy (orphan, duplicate, clean), rolled back |
| EX-03 | Credits | BUG-33 (charge clock) had no direct regression test | Test gap, **fixed** | `search-charge.int` CLK-01, app clock ±2 h from the database; fails on the old code (both cases), passes now |
| EX-04 | Eligibility | A Pakistani country with no `country_checked_at` never became stale | Confirmed defect (fail-open), **fixed** | `eligibility.ts`: unknown check time = `country_stale`, like an undated follower count; unit CTY-FRESH-01; catalogue rows affected: 0 |
| EX-05 | Country lock | `GET /v1/creators/:id/audience` and `POST …/estimate` ignored the Pakistan-only lock: any workspace with the id got the creator's state (confirming it exists) and could reserve credits and queue a provider job (BUG-35, same class as BUG-32) | Confirmed defect, **fixed** | `audience/service.ts` uses `lockedForWorkspace`; 3 tests in `audience.int` (fails on the old code) |
| EX-05b | Country lock | CSV import matched a locked creator's link: the matched import row counts as the workspace holding the creator, which unlocked it (profile, reveal, Update info) and stored an imported email for it (BUG-36; found by an automated security review) | Confirmed defect, **fixed** | `imports/service.ts` answers a locked creator the workspace does not hold like an unknown link; 2 tests in `imports.int` (fail on the old code). Other "holding" tables checked: lists, campaigns, reveals and discovery results already refuse locked creators |
| EX-06 | Country lock | Profile, lookup, reveal, refresh, add-by-link, lists, campaigns | Verified in code and tests | CTY-I05/06, EX-05, discovery lock case, browser CTY-0..7 |
| EX-07 | YouTube retention | Retention clears **all** YouTube API data 30 days after the last scrape, including follower counts, descriptions and the derived country (creator-confirmed kept), then re-projects. Scheduled daily 03:50 on the worker. On this catalogue every one of the 371 eligible YouTube profiles would be cleared in the week of **16 Nov 2026**; it has never run on this copy | Decision (policy) | No code change: the behaviour is the documented policy (DATA-004). Whether it runs on staging depends on the worker being hosted (not verified) |
| EX-08 | Supply | Instagram/TikTok lack acceptable country evidence; TikTok's stored payloads have no country field | Confirmed (data) | funnel above; growth proposal in `CATALOGUE_GROWTH_PROPOSAL.md` |
| EX-09 | Search freeze | Frozen packets are `elig-1`; product is `elig-2` | Decision | FRZ-02: differences are eligibility only, no ranking change; packets not regenerated |
| EX-10 | LLM | Gemini primary, Ollama fallback on failure, timeout or 429 (cool-down), monthly budget cap | Verified in code and unit tests | `config.ts` `llmProviders`, `openai-compatible.ts`, `llm.test.ts`; no live call made. No proactive load balancing (failover only). Groq calls exist in historical spend only |
| EX-11 | Worker | SIGTERM/SIGINT graceful stop, heartbeat each minute, production refuses to start without a database CA file, Dockerfile and hosting doc exist | Verified in code; hosted not verified | External action: host and run it (Decision 5) |
| EX-12 | CI | Workflow covers lint, types, boundaries, unit + integration (PostgreSQL + Meilisearch services), frontend build, both secret scans; its header still says "no GitHub remote" although one is configured | Not run in hosted CI | Local equivalents pass; hosted CI run is an external action |
| EX-13 | Secrets | Committed-source scan, working-tree scan (255 modified/untracked files), bundle scan | Passed locally | 0 findings each; values never printed |
| EX-14 | SRS | Candidate SRS (03A) said outreach sending was deferred; trial credits and the testing allowance and the free empty search were absent | Doc mismatch, **fixed** | `MUSHIN_RECONCILED_DOCUMENTATION_CANDIDATE/03A_…md` §5.5–5.6 corrected against migrations 0050/0061/0062 and the outreach module. The original SRS PDF is read-only and still says what it said |
| EX-15 | Search UX | No per-platform coverage indicator for customers (staff have one) | Implementation gap, deferred | Frontend work is paused by the owner; data exists (eligible counts by platform) |
| EX-16 | Creator confirmation | Schema supports `creator_confirmed` country; no claim flow | Decision | Not built (needs product and legal decisions) |
| EX-17 | Unit flakiness | 3 API unit tests failed once in a full parallel run, passed alone and in the next full run | Test gap (unexplained) | Not changed; cause not proven |
| EX-18 | Live Discovery | Provider calls happen before country is known | By design | The country comes from the fetched profile; results are checked before delivery and charge (B2-18) |
| EX-19 | Hosted state | Staging/production migrations, auth email, SMTP, backups, Vercel/Supabase region, TLS | External action | No read-only hosted access was used; unverified |

## Security and privacy pass (owner request, 28 October 2026 evening)

| ID | Finding | Status |
|---|---|---|
| SEC-PD-01 | Every API request log line carried the full client IP and port (Fastify's request serializer) | **Fixed**: `packages/core/src/logger.ts` request serializer keeps method, path, host and a /24 (IPv4) or /48 (IPv6) address; `apps/api/src/http/request-log.test.ts` failed before the fix |
| SEC-PD-02 | Phone-number fields were not redacted in logs | **Fixed**: `phone`, `phoneNumber`, `mobile`, `whatsapp` keys redacted at any depth; `logger.test.ts` |
| SEC-HD-01 | API headers were helmet defaults: `X-Frame-Options: SAMEORIGIN`, HSTS 180 days, no CSP | **Fixed**: DENY, HSTS 1 year with subdomains, CSP `default-src 'none'` (JSON API); `security.int` asserts exact values |
| SEC-RL-01 | Staff auth routes allowed 10 attempts per minute per IP | **Fixed**: 5 per minute (plus the existing 15-minute account lockout); customer sign-in/sign-up/reset limits are Supabase Auth settings (external) |
| SEC-DP-01 | Internal bundle folder not excluded from CLI deploy uploads | **Fixed**: `.vercelignore` |
| SEC-ST-01 | Customer session (Supabase access/refresh token, contains the email) is in `localStorage` (supabase-js default) | Decision: mitigated by the frontend CSP (`script-src 'self'`, no inline scripts); moving to httpOnly cookies needs a server session layer (frontend paused) |
| SEC-DB-01 | `gcp` and `platform` tables have no row-level security | Not exploitable as configured: schemas revoked from `anon`/`authenticated` (0001, 0009) and not exposed by the Data API (`supabase/config.toml`); hosted dashboard setting to confirm |
| SEC-JWT-01 | Customer JWTs stay valid until expiry after sign-out (stateless) | Accepted: Supabase access tokens are short-lived; no server-side denylist |
| SEC-GIT-01 | Git history (337 commits) scanned for credential formats: 4 matches, all fake test fixtures | No action; `.env` never committed |

## Decisions waiting for the owner

1. YouTube API policy (EX-07): resume permitted refreshes before ~16 Nov 2026, or accept that eligible YouTube supply
   drops to about zero once the worker runs retention, or pursue creator confirmation.
2. Instagram displayed country as evidence. 3. Paid Instagram pilots. 4. Creator confirmation and legal review.
5. Worker host and region. 6. `elig-1` vs `elig-2` evaluation. 7. Applying 0060–0062 to staging.
8. Pilot scope, public sign-up, testing-credit abuse controls, live billing. 9. Legal pages, auth settings, SMTP, backups.

## Final local results (working tree after the fixes)

Lint, typecheck, boundaries pass; unit 581; frontend 74 + typecheck + build; integration 732 passed, 0 failed, 3 expected
failures, 7 skipped, 0 blocked; browser on PostgreSQL 108/54/54. Details: `EXECUTION_REPORT.md`.

## Next task

Hosted verification (staging) once Decision 7 is made; everything else in this mandate that can run locally is done.

## Continuation, 29 October 2026

| ID | Finding | Status |
|---|---|---|
| YT-RET-01 | All stored YouTube data is Non-Authorized API Data (30-day limit, YouTube policy III.E.4); every derived field is derived from it; deadline for the 371 eligible profiles 2026-11-19 to 11-21. Eligibility kept showing YouTube creators for 90 days if the retention job did not run | **Fixed in code**: YouTube follower evidence counts for at most 30 days (`eligibility.ts`). Holding the data on staging/local copies past the deadline is an owner action (memo in `EXECUTION_REPORT.md`) |
| REG-01 | The 28 Oct API CSP (`form-action 'none'`) broke the development mock checkout page (browser PAY-1 and the main journey) | **Fixed**: page-specific CSP in `billing/mock-routes.ts`; `billing-api.int` asserts it |
| REG-02 | NFR-P01 fixtures used YouTube follower dates up to 40 days old | **Fixed**: fixture dates within 25 days; assertion unchanged |
| OPS-PF | No read-only preflight for 0060-0062 | **Added** `scripts/ops/preflight-0060-0062.sql`, tested on a fresh 0059 database |
| GROQ | Any code path still needing the Groq key? | None (config ignores it; budget sums past spend only): safe to revoke |

Results (29 Oct, current tree): lint/typecheck/boundaries pass; unit 584; frontend 74 + build; integration 734 passed,
0 failed; browser on PostgreSQL 108/54/54; browser on Meilisearch 108/54/54. Details: `EXECUTION_REPORT.md`.

## 29 October 2026 (second pass): retention report, shadow report, backlog

| ID | Finding | Status |
|---|---|---|
| YT-RET-04 | Retention job left three kinds of YouTube API data behind: contacts read from the description (530), links read from the channel (381), video hashtags in `creators.tags` (1,213) | **Fixed in migration 0063** (file + Supabase copy; applied only to the disposable test database); tests YT-RET-02/03 |
| YT-RET-05 | Earliest deadline is 2026-11-12 (1 profile), then 2026-11-19 (2,056; 321 eligible) and 2026-11-20 (322; 50 eligible) | Owner decision; `YOUTUBE_RETENTION_REPORT.md` |
| YT-POL-01 | Engagement rate and niche/category tags are derived from YouTube API data, not allowed without the derived-metrics amendment (III.E.4.h, III.L) | Legal/owner decision |
| ELIG-SH | Shadow report over 2,520 profiles; elig-2 unchanged | Done: `ELIGIBILITY_SHADOW_REPORT.md` |
| DQ-01 | Engagement rate stored as exactly 0 or 100 on 23 YouTube and 6 Instagram profiles | Gap (data quality) |

### Backlog (partial or missing; implemented items are not rebuilt; workspace features out of scope)

1. Creator-profile view tracking (most/least viewed by platform): missing.
2. "Leave a Review" button and shared Staff/Super Admin reviews page (no email per review): missing (trial feedback only).
3. Tickets: "In Progress" status, attachments, first-response/resolution/reopen timestamps for staff performance: missing.
4. `frontend/src/app/components/dashboard/AudienceEstimate.tsx:54` still says "Estimate Audience Demographics" (should be Audience Details).
5. Search and zero-result analytics events: missing.
6. Brand-safety review policy and queue; credential verification: missing.
7. Separate statuses for commercial readiness and content-format tags: missing.
8. Per-post data (collection deferred; proposal needs approval).
9. Contacts and links have no platform column (limits 0063 once creators are linked across platforms).

## Master plan status (Research-Informed Implementation Plan, 29 Oct 2026) — updated 2026-10-29 evening

| Plan item | Status | Evidence / blocker |
|---|---|---|
| Phase 0 baseline | **Done** | baseline (chat 29 Oct), `YOUTUBE_RETENTION_REPORT.md` |
| Gate A (baseline incl. retention) | **Done** | |
| Phase 1-2 policy + shadow engine | **Done (shadow only)** | `scripts/catalog/shadow-policy.ts`, `ELIGIBILITY_SHADOW_REPORT.md`; elig-2 stays active |
| Gate B (versioned policy, shadow report) | **Done** | |
| Phase 5 / Gate C dry-run reassessment | **Done for elig-2 + 8 scenarios**; final review after policy approval | owner: choose policy version |
| Phase 6 / Gate D apply statuses, clean search & enrichment | **Blocked** | owner policy approval |
| Phase 7 YouTube retention | **Partly done**: 0063 + fail-safe in code | owner decisions: `YOUTUBE_DECISION_BRIEF.md` (refresh vs expire; amendment; staging cleanup) |
| Phase 8 workers | Verified in code; hosted **unverified** | worker host decision |
| Phase 9 / Gates E-F Brain 1 then Brain 2 acceptance | **Waiting on Gate D** (local suites green today on both backends) | |
| Phase 10 commercial fields, content formats | **Missing; design below** | data source + owner decision |
| Phase 11 / Gate G staff security, tickets | Implemented earlier; **ticket gaps fixed today** (In progress, timestamps, history, performance); attachments **missing** | attachments: storage + upload policy decision (below) |
| Phase 12 / Gate H feedback + analytics | **Done locally** (reviews, creator views, search events, staff pages) | hosted unverified |
| Phase 13 pilots | **Not started** (need approval/spend) | |
| Phase 14 / Gate I staging | **Blocked** | migrations 0060-0065 approval, worker, SMTP, backups |

## 29 Oct implementation (after the reports)

| ID | Change | Tests |
|---|---|---|
| COPY-01 | `AudienceEstimate.tsx`: "Estimate Audience Details" | frontend typecheck/build |
| TKT-LC | 0064: `in_progress` status; `first_response_at`, `resolved_at`, `reopened_count`, `last_reopened_at` by triggers; append-only `support_ticket_events`; `platform.staff_support_performance(days)` (definitions in the migration); customer reply keeps an in-progress request in progress; open-request limit counts in-progress; customer and staff labels | `support.int` TKT-01..04 |
| REV | 0065 `product_reviews`; `POST /v1/feedback` (one per person per 10 min, no email); `GET/PATCH /admin/v1/feedback` (Staff Admin + Super Admin, audited, no person or email shown); customer "Leave a review" at the bottom of every page; staff console "Reviews" | `insights.int` INS-01/02; browser REV-1 |
| USAGE | 0065 `creator_profile_views` (deduplicated per person+creator per 30 min, locked creators not recorded), `search_events` (first page only, no query text); `GET /admin/v1/analytics/creator-views` and `/searches` (Staff Admin + Super Admin), `GET /admin/v1/support/performance` (Super Admin); staff console "Usage" | `usage-events.int` EV-01/02; `insights.int` INS-03 |
| ERASE | `erase_workspace` regenerated with the four new workspace tables | `team.int` guard |

Permissions added (role matrix): `feedback.read`, `feedback.review`, `analytics.read` = Staff Admin + Super Admin (hardware-key step-up as for all admin actions); `support.performance.read` = Super Admin.
Migrations 0064-0065: file + Supabase copy; applied only to the disposable test database and the browser template.

## Designs for gaps that need a decision (not built)

- **Ticket attachments.** Needs object storage for customer files (the avatar bucket is public and must not be reused), an
  allowlist (PNG, JPEG, PDF), a size cap (5 MB), content-type sniffing, a private bucket served through signed URLs, virus
  scanning or an explicit decision to go without, and erasure with the workspace. Owner decision: allow attachments, and on which storage.
- **Brand-safety review.** Data model: `brand_safety_cases` (creator, profile, rule id from an owner-approved policy
  version, evidence quote with source and date, status clear/flagged/under_review/confirmed_violation, reviewer, decision
  note); keyword hits only open cases. Blocked on an owner/legal-approved exclusion policy (plan 5.4).
- **Credential checks.** Per niche (health, finance): register checked, registration number as stated, checked date,
  checker; "self-described" shown separately. Needs the list of niches and registers (owner).
- **Commercial readiness and content formats.** Separate per-profile records: deliverable formats (Reel, Story, TikTok
  video, YouTube long-form, Short, UGC) tagged only from evidence; rates only with source, date, currency, deliverable and
  kind (published quote / agency estimate / model estimate); never shown as fact when estimated. Needs a source (creator
  submission or approved collection).
- **Platform-specific contacts and cross-platform links (0063 limit).** Add `platform` (and `source_profile_id`) to
  `creator_contacts` and `creator_links`, backfilled as the creator's primary platform today (every creator has one
  profile); retention then clears by source platform instead of primary platform; links become an evidence-backed
  `creator_profile_links` relation (evidence type, observed date, confidence) so two profiles are merged only on evidence.
  Migration ready to write once approved; it touches the retention function again.

## 2 November 2026: validation fixes

| ID | Finding | Fix |
|---|---|---|
| DRIFT-01 | `schema-drift.int`: Drizzle `supportTickets` lacked 0064's columns and the `in_progress` status | `packages/db/src/schema/support.ts` updated |
| RLS-01 | `rls.int` guard: `wp.support_ticket_events` had RLS enabled but not forced and no tenant policy | 0064 now forces RLS with the tenant policy, as for every `wp` table (writes come from the security-definer triggers, like `support_messages`) |
| IDX-01 | Postgres best practice (index foreign keys): `workspace_id` on the four new tables (erasure deletes by it), `creator_id` on profile views (creator erasure cascades), assignee on ticket events, `user_id` on search events were unindexed | indexes added in 0064/0065 |
| RB-01 | No rollback script for 0064/0065 | `scripts/ops/rollback-0064-0065.sql`; exercised on the disposable test database (rolled back to 0063, then 0064-0065 re-applied by the runner) |

0064 and 0065 were edited in place: they have been applied only to disposable databases (test database rolled back and
re-applied; the browser template is rebuilt every run). Another Claude session (read-only audit) fixed invalid YAML in
`.github/workflows/ci.yml` line 52 (block scalar); reviewed, kept.

**YouTube deadlines are now 10 days away (12 November) and 17-18 days (19-20 November).** Decisions in `YOUTUBE_DECISION_BRIEF.md` are still open.

**Final results, 2 November 2026 (current tree):** lint, typecheck, boundaries pass; Supabase copies match (66 files);
unit 589; frontend 74 + typecheck + build; integration **745 passed, 0 failed** (3 expected failures, 7 skipped
live-provider tests); browser on PostgreSQL 108 / 55 / 54 and on Meilisearch 108 / 55 / 54 (break-it now includes REV-1).
Baseline before the 29 Oct implementation (for comparison): integration 736, browser 108 / 54 / 54 on both backends.
