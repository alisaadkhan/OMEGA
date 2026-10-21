> **Superseded in part (2026-10-21).** This file and `readiness/progress.md` describe 2026-10-14 to 2026-10-17; the running record is `completion/PROGRESS.md` and the component status is `completion/TECHNOLOGY_INVENTORY.md`. Current values: `docs/README.md`. Kept unchanged below as history.

# MUSHIN readiness report (section 0: 2026-10-17; sections 1–7: 2026-10-14, HEAD 07580ef, historical)

Section 0 is current. Sections 1–7 describe the state of 2026-10-14 and are kept for history; where they differ from
section 0 or `progress.md` (the single running record, audit DOC-01), those win. Every status below names its evidence.

The central record of what is built, what is verified and what is blocked. It is backed by:
- `traceability.csv`: the 59 canonical requirements → implementation → tests → status;
- `acceptance-matrix.md`: module and integration results;
- `search-backends.md`: local Meilisearch and the backend comparison;
- `local-setup.md`: how to run and test everything;
- `customer-e2e-report.md`: customer-side browser E2E (matrix, runs, defects, findings; harness in `scripts/e2e-customer/`);
- `credit-economics.md`: owner prices versus measured provider cost (3× rule, TikTok shortfall, proposed caps);
- `supabase-migration-map.md`: every route, job, schedule, transaction and rate limit mapped to the approved Supabase target.

## 0. Release-readiness checklist (updated 2026-10-16, master)

Status words: **ready** (done and verified here), **partial** (built, some evidence missing), **blocked** (needs the owner,
an account, a credential, people or Docker), **not tested**. Nothing has been deployed; no production system exists.

| Gate | Status | Evidence / what closes it |
|---|---|---|
| Architecture and hosting choice | blocked | ADR-0001 (proposed, owner decides D-01): Supabase for database, Auth and Storage; the Fastify API and pg-boss worker stay. Hosting provider and region not chosen (owner). |
| Separate dev/staging/prod configuration and secrets | partial | Config validation refuses unsafe production settings (TLS CA, Paddle keys, LLM cap, memory rate limiter). No staging or production environment exists. |
| CI, clean build, migrations, smoke tests | partial | `.github/workflows/ci.yml` (verify, frontend build, bundle and committed-source secret scans) passes in a clean clone without `.env` (OPS-01). **Never run on a hosted CI**: no remote exists (owner). Test totals are quoted only with their commit in `progress.md`. |
| Rollback plan | partial | Forward-only migrations; the Fastify stack stays until Supabase parity (migration map §7). No deployment to roll back yet. |
| DNS / TLS / domain / CDN | not tested | Not provisioned. API sends `Cache-Control: private, no-store`; static asset caching must be set on the chosen host (fingerprinted `/assets/*` immutable, `index.html` no-cache). |
| Auth redirect URLs, email templates, auth rate limits | partial | Local Supabase stack: sign-in, invitations' confirmed-email check, account deletion (auth-check 17/17) and password recovery in Chrome with Mailpit (recovery-check 10/10). Hosted project, SMTP and email templates: blocked (owner). |
| Database RLS, indexes, retention jobs | partial | RLS on every workspace table with isolation tests; Data API exposure check 0 problems on the local Supabase stack (SEC-11, `scripts/supabase/exposure-check.ts`; run it on the hosted project). |
| Backup and restore | partial | Local drills pass (`scripts/restore-drill.ts`; `scripts/ops/restore-drill.sh`: erasures and YouTube expiry re-applied after a restore, OPS-04). Key rotation tooling (SEC-09). Hosted backups/PITR, RPO/RTO and a hosted drill: owner. `DATA_ENCRYPTION_KEY` needs its own backup. |
| Observability and alerts | partial | Alerts delivered to `ALERT_WEBHOOK_URL` (required in production): thresholds, worker heartbeat, credit mismatch; drill: stopped worker → critical in 289 s (OPS-03). Error tracker and uptime check: not chosen (owner). |
| Provider caps and kill switches | partial | Apify, Serper and LLM monthly caps; per-job cost cap and 20-minute deadline; provider pause (staff, on team-privacy branch). Production cap values: owner. Provider terms review (Apify actors): owner. |
| Billing (Paddle sandbox, webhooks, refunds) | blocked | Mock provider only; webhook idempotency tested locally; financial records survive workspace deletion (BIL-05). Needs a Paddle sandbox account and the refund policy (OD-009). |
| Search acceptance | blocked | Human ratings needed: 413 judgements per rater (222 + 35 Brain 1, 131 + 25 Brain 2; packets `blind-b1-elig1`, `blind-b2-elig1`; the older 273/207 packets are superseded). Delete YouTube data by 2026-11-12. Search is **not accepted**; Brain 2 figures since 13 Oct are replay. |
| Creator eligibility (10,000 minimum) | ready | elig-1 enforced in search, Live Discovery delivery, lists, campaigns, profiles; E2E 3 × 82/82. Staff coverage endpoint `GET /admin/v1/ops/eligibility` (counts only); its console page waits for the staff UI. |
| Contact privacy and empty states | ready | Contact values only after an explicit reveal; empty and below-minimum states are shown truthfully (E2E). |
| Accessibility and phone width | partial | axe (WCAG 2.0–2.2 A/AA serious/critical) on every customer page, campaign detail and the profile dialog, phone width on the main pages: E2E 3 × 90/90 after fixing A-1..A-3. Manual keyboard, screen-reader and zoom review: not done. |
| Security tests | partial | Bundle and committed-source secret scans, API authorization, injection and header tests; SPA security headers checked in Chrome (SEC-14); server-side staff step-up, first-key enrolment codes, hash-chained staff audit log (SEC-02/07/10). No external penetration test yet. |
| Load and recovery | partial | `scripts/load-check.ts` 2026-10-16, local disposable stack, 200 requests per endpoint at concurrency 10, all 200: search repeat p50/p95/p99 81/95/231 ms (target p95 800), lists 35/46/47, campaigns 33/49/56, creator profile 55/64/82, billing summary 47/60/69 (targets p95 300). Earlier 100k search benchmark. Rate limits shared across instances; worker crash/retry/deadline tests. Single machine, small catalogue: no hosted or large-scale load test yet. |
| Legal: privacy policy, terms, YouTube identifiers, provider redistribution rights | partial | Draft Terms, Privacy, Refunds and Creator data pages with recorded acceptance (UX-01). Counsel review, YouTube identifiers and provider rights: owner. Must not be presumed passed. |

### Hosting recommendation (proposal, nothing provisioned)

Smallest setup that fits the Supabase direction and keeps the Vite frontend. Prices are 2026 third-party summaries
(checked 2026-10-16) and **must be confirmed on each vendor's pricing page** before committing.

| Part | Now (current stack) | After the Supabase migration | Estimated monthly cost |
|---|---|---|---|
| Database, Auth, storage, backups | Supabase Pro, region nearest Pakistan (confirm Mumbai availability) | same | about USD 25 base incl. a Micro compute; PITR is a paid add-on (price not confirmed) |
| Frontend (static Vite build) | Cloudflare Pages: static requests free and unlimited; fingerprinted `/assets/*` cached immutable, `index.html` no-cache | same | USD 0 on the free plan (500 builds/month reported) |
| API + worker (Fastify, pg-boss) | One small always-on container each, near Pakistan: Fly.io (about USD 2–5 per small machine, metered) or Render Starter (about USD 7 per service plus a workspace fee) | Kept (ADR-0001, proposed): Edge Function limits do not fit 20-minute live runs | USD 5–15 |
| Search | PostgreSQL (default); Meilisearch not deployed (no measured need) | PostgreSQL | USD 0 |
| Rate limits | PostgreSQL counters; Upstash removed (ARCH-03) | same | USD 0 |

Expected total about USD 30–40 a month before usage, excluding provider spend (Apify, Serper, LLM, all capped), Paddle
fees and any PITR add-on. Sources: supabase.com/pricing (via 2026 summaries), Cloudflare Pages limits docs, Fly.io and
Render pricing summaries.

## 1. Bottom line

MUSHIN is a working, locally verified MVP codebase. Search (catalog and live discovery), lists, campaigns with a manual outreach log, analytics, activity, settings, customer support and a staff console all run end to end through the real UI, API, worker and database. Automated: 661 tests pass, 0 fail. Real-UI journeys: 69 of 69 checks pass across six journeys.

**It is not production-ready.** The remaining gates are external or owner decisions, not unbuilt features:
- real Supabase sign-in;
- a live paid-provider smoke test;
- an Apify actor terms review;
- Paddle merchant/sandbox verification;
- a backup restore drill;
- the human-labelled search panel;
- three pricing/identity decisions (§6).

Requirement status: **34 complete, 19 partial, 4 blocked, 1 missing (transactional email), 1 unverified (CDN headers)**.

## 2. Documentation inventory and source of truth

| Area | Authoritative source | Notes |
|---|---|---|
| Product scope, decisions, requirement IDs | Spec pack `MUSHIN_COMPLETE_BUILD_DOCUMENTATION/` (2026-10-13): `01_DECISIONS`, `02_PRODUCT_SCOPE`, `03A_SRS`, `contracts/requirements.csv` | Newest and canonical for *what* to build. The nested `MUSHIN_COMPLETE_BUILD_DOCUMENTATION/MUSHIN_COMPLETE_BUILD_DOCUMENTATION/` folder is a duplicate copy (identical except the diagrams) |
| Page-level UI rules | Pack `frontend/FRONTEND_PAGE_BY_PAGE_SPEC.md` | Used for lists, campaigns, outreach, analytics, settings, activity, staff |
| Runtime architecture as built | Repo `docs/superpowers/specs/2026-10-06-mushin-backend-architecture-design.md` | Fastify API + pg-boss worker + PostgreSQL. See conflict C1 |
| Billing / credits | Repo `2026-10-07-billing-credits-design.md`, pack `11_CREDIT_BILLING` | Consistent |
| Search, pipeline, live discovery | Repo `2026-10-08-…search`, `2026-10-09-…pipeline`, `2026-10-09-live-discovery-erasure-design.md` (§20–21), pack `09_LIVE_DISCOVERY_BUILD_SPEC` | Repo specs record measured behaviour |
| Audience estimates | Repo `2026-10-13-audience-estimate-design.md` | Optional, off by default, policy-gated |
| Original SRS / diagrams | `reference_files/*.pdf` | Historical; superseded where the pack differs |
| Requirements open questions | `docs/00-requirements-analysis-and-questions.md` | Historical |

### Conflicts and the interpretation used

| # | Conflict | Interpretation used (and why) |
|---|---|---|
| C1 | Pack: Supabase Edge Functions + cron. Repo (as built): Fastify API + pg-boss worker on PostgreSQL. | Kept the built runtime. The pack allows a dedicated worker host when Edge limits don't fit, and rewriting a tested backend without evidence would be speculative. **Owner should confirm the hosting target.** |
| C2 | Pack: "no Meilisearch in MVP unless a measured gain". Repo plan: Meilisearch projection. | PostgreSQL stays the default. Meilisearch is a tested, optional, self-hosted backend with automatic fallback. Measurement in `search-backends.md` |
| C3 | Pack: staff use Supabase Auth plus a staff role table. Repo: separate staff login (password + TOTP). | Kept (it is MFA-protected, separate and tested). Recorded as STAFF-001 *partial*; **owner decision** |
| C4 | Repo plan: outreach sequences, mailboxes, tasks. Pack: manual outreach logging only; tasks deferred. | Followed the pack (newer, narrower): manual log; Inbox/tasks shown as "planned" |
| C5 | Pack: add-by-URL limit 50/h per user, 100/h per workspace. Built: paid starts 20/h per user. | Kept 20/h per user (stricter) and added 100/h per workspace. **Owner to confirm values** |

## 3. What changed in this pass (commits 9ad7fcc … 07580ef)

- **Search:**
  - local Meilisearch with automatic PostgreSQL fallback;
  - start-up reconcile (fixes empty-index search);
  - PostgreSQL typo/partial matching;
  - a 100k common-word query cut from about 1 s to 89 ms p95;
  - customers can stop a running Find New Creators search;
  - honest location evidence, platform scope in the quote, and new-vs-known labels.
- **New modules:**
  - lists of saved creators;
  - campaigns (pipeline, PKR fees, content status, concurrency-safe edits) with an append-only manual outreach log;
  - analytics;
  - activity feed;
  - customer support tickets;
  - staff operations console (overview, job inspector, workspace lookup, support queue, provider usage, audit log);
  - real settings.
- **Integrity:** removed seeded lists, campaigns, activity generator, notifications, staff KPIs/revenue, saved payment methods and invented diagnostic ids. Dead buttons are wired or disabled with reasons, and landing illustrations are labelled fictional.
- **Hardening:**
  - every API response is `Cache-Control: private, no-store`;
  - per-workspace paid-start limit;
  - erasure now covers lists and campaigns;
  - cross-workspace staff reads go only through redacted security-definer functions;
  - staff views and replies are audited.

## 4. Module status

| Module | Status | Evidence |
|---|---|---|
| Identity, workspaces, tenant isolation | Complete (local) | RLS + isolation tests in every new module; real Supabase sign-in not verified |
| Catalog search (both backends) | Built; **not accepted** (no human ratings) | 11/11 UI checks per backend; 100k comparison |
| Live discovery | Built; **not accepted**; live success path not re-run since 13 Oct (later figures are replay) | Failure/refund verified live at $0; success path verified earlier (spec §21) and in replay tests |
| Credits and billing | Complete with mock payments | Ledger invariants tested; Paddle unverified |
| Lists | Complete | 12/12 UI; lists.int |
| Campaigns + outreach log | Complete | 13/13 UI; campaigns.int |
| Analytics / activity / dashboard | Complete | 10/10 UI; analytics.int |
| Settings | Complete except the Supabase-only actions | identity.int; UI |
| Support (customer + staff) | Complete | ops.int; 12/12 UI |
| Staff operations | Built (since 2026-10-14) | Provider pause, job retry/cancel, approvals, WebAuthn step-up; see section 0 |
| Transactional email | Missing | No provider integrated; UI states that no email is sent |
| Audience estimate | Optional, disabled | Policy gates unchanged |

## 5. Security, reliability and performance review (implementation, not documents)

- **Tenant isolation:**
  - every new table has forced RLS and a workspace policy;
  - tests prove raw queries under another tenant's context return nothing;
  - staff never read tenant tables directly.
- **Credits:**
  - live runs settle only delivered work; stopped and failed runs settle as partial or zero;
  - retries charge once;
  - spend caps (Apify budget, Serper monthly limit, credit reservations) live in PostgreSQL and fail closed.
- **Rate limits:**
  - every customer route has per-user and per-IP limits;
  - paid starts have per-user and per-workspace limits;
  - counters live in PostgreSQL and fail closed (Upstash removed, ARCH-03);
  - a support-ticket flood is capped at 20 open per workspace.
- **Secrets:**
  - the frontend bundle contains only public Supabase config;
  - Meilisearch keys are git-ignored, its master key stays outside the repo, and keys are never logged.
  - **Owner action:** the Meilisearch Cloud test key in `.env` is no longer used; rotate or remove it.
- **Data integrity:**
  - optimistic concurrency on campaign creators;
  - the outreach log and staff audit are append-only;
  - erasure cascades to all workspace references.
- **Search index drift:** repaired at worker start-up, nightly, and on demand (`npm run search:reindex`).
- **Performance:** every measured read path is ≤ 89 ms p95 locally at realistic sizes (`acceptance-matrix.md`).
- **Not measured:** concurrency, the remote database, cold starts.
- **Proposed MVP targets** (the pack sets only search's 800 ms): CRM reads p95 ≤ 300 ms and search p95 ≤ 800 ms at 2× expected peak, on staging.
- **Known limitations:**
  - catalog cards don't explain per-factor matches (CAT-005);
  - pagination is page-based rather than cursor-based (CAT-004);
  - the job state enum has no separate `cancel_requested` value (it's a flag);
  - an activity page boundary can skip events with identical timestamps (rare);
  - no CI pipeline in this repository.

## 6. Blockers and what is needed from the owner

| Blocker | Why it blocks | What to do |
|---|---|---|
| Real Supabase customer sign-in | Customer auth was verified only with a local signing stub | Provide a working test user (not in chat) or confirm the project settings; then run checklist items 1, 6, 12 |
| Paid live-provider smoke test | Brain 2's success path needs Serper (and Apify for Instagram/TikTok) | Authorise a spend cap (suggested: Serper ≤ 10 searches; Apify ≤ $0.10) |
| Apify actor terms | EXT-001: actors must be reviewed and pinned before production | Review the Instagram/TikTok actors' terms; pin build versions |
| Paddle | BILL-001/002 verified only against the mock | Sandbox credentials and the merchant-readiness decision |
| Restore drill | OPS-002 | Run a backup restore on the Supabase project |
| Human-labelled search panel | QA-001 relevance claims | Two raters label the query set in the pack's `testing/` folder |
| Pricing rule (CREDIT-003) | Base fee charged only when creators are delivered | Approve or change |
| Staff identity (C3), hosting target (C1), paid-start limits (C5) | Decisions differ between documents | Decide; the code works either way |

## 7. MVP readiness

- **Ready now:** hands-on local acceptance testing of the whole product (`local-setup.md` §5). A closed internal demo with pilot credits and Apify/Serper either off or under an authorised cap.
- **Not ready:** paying customers, or any real customer data, until the §6 gates close. Those are tenant tests against the real Supabase project, a restore drill, provider terms, Paddle, and the owner decisions.
