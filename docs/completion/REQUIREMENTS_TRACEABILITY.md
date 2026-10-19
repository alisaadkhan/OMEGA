# Requirements traceability (mandate v3)

Generated from the audit checklist (`docs/audit/2026-10-16/registers/traceability_checklist.csv`, state at `1398cee`)
joined with the repository's running record (`docs/readiness/traceability.csv`). Status uses mandate §11 terms:
**Locally verified** = tests or local runs in this repository exercised it; nothing here is Integration, Acceptance
verified or Production ready (no real providers, hosts or human ratings yet). Search requirements stay **not accepted**.

| ID | P | Domain | Route / page | Tests | Audit (16 Oct) | Now | Note |
|---|---|---|---|---|---|---|---|
| AUTH-001 | P0 | Access control | all `/v1/**` (customer guard, RLS) | rls.int; identity.int (cross-user); lists/campaigns/support/analytics isolation tests; ops.int | Partial | Locally verified | Repeat with a real Supabase project (blocked: credentials) |
| AUTH-002 | P0 | Access control | all `/v1/**` (customer guard, RLS) | check-bundle-secrets.test; scan of the 2026-10-16 production build passed | Implemented, not fully verified | Locally verified | — |
| CAT-001 | P0 | Catalog Search | see implementation | search.int; UI search-acceptance (no estimate/job calls) | Implemented, not fully verified | Locally verified | — |
| CAT-002 | P0 | Catalog Search | see implementation | search.int; scripts/search-compare.ts (0 violating at 100k; identical totals) | Implemented, not fully verified | Locally verified | — |
| CAT-003 | P1 | Catalog Search | see implementation | aliases.test; catalog-aliases.int (6); understand.test; panel on 469 real recorded profiles | Blocked | Implemented (partial) | Human-labelled relevance (QA-001) |
| CAT-004 | P1 | Catalog Search | see implementation | search.int (cursor paging and refusal); E2E | Partial | Locally verified | — |
| CAT-005 | P0 | Catalog Search | see implementation | match-reasons.test; catalog-aliases.int (CAT-005); search-mapping.test (matchSummary); Brain 1 panel identical 35/35 to the rating-packet baseline | Implemented, not fully verified | Locally verified | Per-field provenance on the profile remains DATA-001 |
| INT-001 | P1 | Query interpretation | see implementation | search.int interpretation tests | Implemented, not fully verified | Locally verified | — |
| INT-002 | P1 | Query interpretation | see implementation | search.int; understand.test; catalog-aliases.int (sentence queries, conflicting range refused) | Implemented, not fully verified | Locally verified | — |
| INT-003 | P1 | Query interpretation | see implementation | search.int; UI call log | Implemented, not fully verified | Locally verified | — |
| LIVE-001 | P0 | Live discovery | `#/dashboard` › Find New Creators; `/v1/discovery/**` | discovery-service.int; live-service.int | Implemented, not fully verified | Locally verified | — |
| LIVE-002 | P0 | Live discovery | `#/dashboard` › Find New Creators; `/v1/discovery/**` | live-service.int (duplicate confirm returns same job) | Implemented, not fully verified | Locally verified | — |
| LIVE-003 | P0 | Live discovery | `#/dashboard` › Find New Creators; `/v1/discovery/**` | worker.int; live-runner.int | Implemented, not fully verified | Locally verified | — |
| LIVE-004 | P0 | Live discovery | `#/dashboard` › Find New Creators; `/v1/discovery/**` | live-runner.int (job_cost_cap before first batch; batch sized to the cap; job_deadline before the first batch, between waves, retry after the deadline reuses pa | Implemented, not fully verified | Implemented (partial) | Re-measure per-profile cost estimates (one TikTok run); owner to confirm the deadline value |
| URL-001 | P0 | Candidate safety | see implementation | avatar.test | Partial | Implemented (partial) | Acceptable while no arbitrary URL is fetched; revisit if that changes |
| EXT-001 | P0 | Provider extraction | see implementation | — | Blocked | Blocked | Owner/legal review of actors; pin builds |
| EXT-002 | P0 | Provider extraction | see implementation | standardize.test; scrapers.test; pipeline.int | Implemented, not fully verified | Locally verified | — |
| ID-001 | P0 | Identity resolution | see implementation | creator-plane.int; pipeline.int | Implemented, not fully verified | Locally verified | — |
| ID-002 | P1 | Identity resolution | see implementation | — | Partial | Implemented (partial) | Build when cross-platform overlap grows (spec §21: not needed now) |
| DATA-001 | P0 | Data quality | see implementation | profile.int | Partial | Implemented (partial) | Per-field provenance where shown |
| DATA-002 | P0 | Data quality | see implementation | projection.test; UI | Implemented, not fully verified | Locally verified | — |
| DATA-003 | P1 | Freshness | see implementation | rules.test | Partial | Implemented (partial) | Source-specific TTLs after retention review |
| RANK-001 | P0 | Ranking | see implementation | search-compare (stable repeats; identical order across backends) | Implemented, not fully verified | Locally verified | — |
| RANK-002 | P0 | Ranking | see implementation | fit.test (location evidence wording); match-reasons.test | Partial | Implemented (partial) | Show fit-score factor weights on catalog cards if the owner wants them |
| AUTHENT-001 | P0 | Authenticity | see implementation | assessment.test; contracts | Implemented, not fully verified | Locally verified | — |
| PERS-001 | P0 | Persistence | see implementation | live-runner.int; worker-side.int; UI (empty index repaired) | Implemented, not fully verified | Locally verified | — |
| JOB-001 | P0 | Job lifecycle | see implementation | contracts discovery.test | Partial | Implemented (partial) | Document the flag as the state or add it to the enum |
| JOB-002 | P0 | Job lifecycle | see implementation | discovery-runner.int; live-runner.int (charges once) | Implemented, not fully verified | Locally verified | — |
| JOB-003 | P1 | Job lifecycle | see implementation | live-runner.int (2 tests); live-api.int | Implemented, not fully verified | Locally verified | — |
| CREDIT-001 | P0 | Credits | `/v1/billing/**`, search/discovery charges | live-service.int; engine.int | Implemented, not fully verified | Locally verified | — |
| CREDIT-002 | P0 | Credits | `/v1/billing/**`, search/discovery charges | engine.int; partial-commit.int; service.int | Implemented, not fully verified | Locally verified | — |
| CREDIT-003 | P0 | Credits | `/v1/billing/**`, search/discovery charges | live-runner.int; plans.test; E2E quote text | Implemented, not fully verified | Implemented (partial) | Owner approval of the base-fee rule (OD-001); empty catalogue searches still cost 50 (BIL-02, owner decision) |
| CONTACT-001 | P0 | Contact reveal | see implementation | profile.int; lists/campaigns tests assert no contact fields | Implemented, not fully verified | Locally verified | — |
| CONTACT-002 | P0 | Contact reveal | see implementation | profile.int | Implemented, not fully verified | Locally verified | — |
| CRM-001 | P1 | CRM | see implementation | lists.int; campaigns.int; analytics.int; UI journeys 12/12 and 13/13 | Implemented, not fully verified | Locally verified | Export and tasks remain planned |
| BILL-001 | P0 | Billing | `#/dashboard` › Billing; `/v1/billing/**`; `/webhooks/paddle` | payments.test; service.int (duplicate events grant once) | Blocked | Implemented (partial) | Paddle sandbox test (blocked: merchant account) |
| BILL-002 | P1 | Billing | `#/dashboard` › Billing; `/v1/billing/**`; `/webhooks/paddle` | config.test | Partial | Implemented (partial) | Owner/vendor gate |
| EMAIL-001 | P2 | Notifications | see implementation | — | Missing | Open | Integrate Resend when needed |
| OPS-001 | P0 | Operations | `#/admin` (staff console); `/admin/v1/ops/**` | ops.int; staffops.int; alert-notifier.int; staff E2E; alert drill (worker stopped -> critical in 289 s) | Implemented, not fully verified | Locally verified | Choose the alert channel, error tracker and uptime check (owner) |
| OPS-002 | P0 | Operations | `#/admin` (staff console); `/admin/v1/ops/**` | 2026-10-16 drill on mushin_local: 62 tables / 899 rows and migration history identical (dump 0.5 s; restore 0.8 s) | Blocked | Blocked | Restore rehearsal on the hosted project before pilot |
| PRIV-001 | P0 | Privacy | `#/dashboard` › Settings › Privacy; `/v1/me/delete`, `/v1/workspace/export` | erasure.int; lists.int; campaigns.int | Implemented, not fully verified | Locally verified | — |
| QA-001 | P0 | Search quality | see implementation | metrics.test; retention.test; freeze-check passes on search-freeze-2026-10-15 | Blocked | Blocked | Two raters + adjudicator (owner arranging); delete YouTube eval data by 2026-11-12 |
| QA-002 | P0 | Security quality | see implementation | Full suite 661/668 (7 live-only skipped) | Partial | Implemented (partial) | See those rows |
| PERF-001 | P0 | Performance | build output, API p95 | app.test | Implemented, not fully verified | Locally verified | — |
| PERF-002 | P0 | Performance | build output, API p95 | security-headers.test; csp-check.mjs (7/7 in Chrome against the build) | Blocked | Implemented (partial) | Check the headers on the chosen host after deployment (none yet) |
| PERF-003 | P0 | Performance | build output, API p95 | live-runner.int (retry reuses cached searches) | Implemented, not fully verified | Locally verified | — |
| RATE-001 | P0 | Rate limits | see implementation | rate-limit.test; postgres.int; config.test | Conflicting | Implemented (partial) | Switch production to RATE_LIMIT_STORE=postgres at the Supabase cutover; owner to confirm limit values (RATE-002) |
| RATE-002 | P0 | Rate limits | see implementation | rate-limit.test (workspace cap) | Partial | Implemented (partial) | Owner to confirm values |
| OPS-003 | P0 | Operations | `#/admin` (staff console); `/admin/v1/ops/**` | discovery-runner.int; queues.test | Implemented, not fully verified | Locally verified | — |
| OPS-004 | P0 | Operations | `#/admin` (staff console); `/admin/v1/ops/**` | ops.int; UI staff journey (no fake health) | Implemented, not fully verified | Locally verified | — |
| STAFF-001 | P0 | Staff security | `#/admin/login`, `#/admin` › Security; `/admin/v1/auth/**`, `/admin/v1/security/**` | staff-login.int; staff-session.int; webauthn.int; staffops.int; staff-audit-chain.int; staff E2E (virtual authenticator) | Partial | Implemented (partial) | Owner decision: keep staff identity as MUSHIN's own login or move it to Supabase Auth (DIS-09); real hardware keys untested |
| STAFF-002 | P0 | Staff privacy | see implementation | ops.int; UI staff journey | Implemented, not fully verified | Locally verified | — |
| STAFF-003 | P0 | Staff operations | see implementation | permissions.ts; UI | Implemented, not fully verified | Locally verified | — |
| FRONT-001 | P0 | Frontend integrity | see implementation | UI journeys (no sample content checks) | Implemented, not fully verified | Locally verified | Landing illustrations labelled fictional |
| FRONT-002 | P0 | Frontend integration | see implementation | Manual sweep | Partial | Implemented (partial) | Add a lint/check for handler-less buttons |
| PRIV-002 | P0 | Privacy | `#/dashboard` › Settings › Privacy; `/v1/me/delete`, `/v1/workspace/export` | contracts; audience.int (incl. expiry deletion) | Implemented, not fully verified | Locally verified | Creator-authorised analytics (design D) if verified demographics are wanted |
| AI-001 | P0 | AI safety | see implementation | llm.test; worker-side.int (summary leak refused) | Implemented, not fully verified | Locally verified | — |
| SEARCH-006 | P0 | Live Discovery | see implementation | live-runner.int | Implemented, not fully verified | Locally verified | — |
| BILL-003 | P0 | Billing | `#/dashboard` › Billing; `/v1/billing/**`; `/webhooks/paddle` | live-runner.int (known-only → 50; TikTok minimum); discovery-runner.int (duplicate add-by-link free) | Implemented, not fully verified | Locally verified | TikTok minimum is provisional: re-measure TikTok costs incl. payment fees |
| CAT-006 | P0 | Search billing | see implementation | search-charge.int (6); creators-api.int; E2E pricing check | Implemented, not fully verified | Locally verified | Owner-approved price; revisit with usage data |
| DATA-004 | P0 | YouTube API retention and derived metrics | see implementation | source-policy.int (retention incl. identity and derived data) | Blocked | Implemented (partial) | Legal review of keeping handle/URL; derived-metrics permission (Policies III.E.4.h / III.L) before enabling scores; Live Discovery Campaign Fit uses YouTube dat |
| PLAN-001 | P0 | Plan/entitlement integrity | `#/` Pricing, Billing; `/v1/billing/catalog` | entitlements.int; campaigns.int; outreach.int; exports.int; E2E pricing page = API | Conflicting | Locally verified | Annual billing not offered until approved (OD-002) |
| OPS-005 | P1 | Provider budgets and alerts | see implementation | ops.int; config.test (production LLM cap); budget.test (zero cap); live-runner.int (job_cost_cap) | Partial | Implemented (partial) | Per-job deadline; alert delivery beyond logs; remaining-budget display; owner to set the production LLM cap |
| BILL-005 | P0 | Credit lots and expiry | see implementation | rules.test (top-ups last); service.int (top-up never expires, monthly renews, constraint) | Implemented, not fully verified | Locally verified | — |
| ELIG-001 | P0 | Creator eligibility | Search, Live Discovery, lists, campaigns, profile | eligibility.test (9,999/10,000/10,001, unknown, stale, inactive, one qualifying of two, invalid URLs, creator rules, expiry); eligibility.int (search, lists, ca | Verified | Locally verified | 90-day count age confirmed by the owner (2026-10-16). Remaining: activity unverified for every record collected before 0037 (needs a permitted refresh); creator |

65 requirements. Gap IDs named in notes are tracked in GAP_REGISTER.md.
