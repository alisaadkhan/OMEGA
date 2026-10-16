# Supabase migration map

Owner direction 2026-10-14: Supabase becomes the backend (PostgreSQL, Auth, Edge Functions, Queues/pgmq, pg_cron/pg_net,
Vault). This map lists every current route, auth check, transaction, job type, retry path and rate limit with its target.
Baseline: commit `b39eb6e` (Fastify API, pg-boss worker, 28 SQL migrations). Nothing here is implemented yet; no Supabase
project has been touched.

## Update 2026-10-15 (HEAD after `ef03156`)

The map above was drawn at `b39eb6e` (28 migrations). Since then:

| Change | Migration / module | Target handling |
|---|---|---|
| YouTube 30-day retention, identity and derived data | 0029, 0031 `platform.expire_youtube_api_data` | Plain SQL function: port as is; schedule with `pg_cron` (`youtube_retention`, `50 3 * * *`) |
| Top-ups never expire | 0030 (constraint on `wp.credit_lots`) | Port as is |
| Contact availability checks | 0032 `gcp.contact_checks`; worker `outreach.contact_check_requested` | Port the table; the DNS/MX check is a short `creator` queue step (Deno `Deno.resolveDns` replaces `node:dns`) |
| Staff operations: Super Admin, WebAuthn, approvals, provider controls, ticket notes/assignment, consented support access | 0033; `modules/staff`, `modules/staffops` (22 staffops routes + 6 security routes under `/admin/v1`, 4 customer routes under `/v1/support/access-requests`) | Tables and security-definer functions are plain PostgreSQL keyed by `staff.staff_users.id`: port as is, then map staff identity to `auth.users` (section 6). WebAuthn verification (`@simplewebauthn/server`) must be checked under Deno before `staff-api` is ported |
| Rate-limit counters | 0034 `platform.rate_limit_counters`, `platform.rate_limit_hit()`; `RATE_LIMIT_STORE=postgres` | **Done ahead of the port**: this is the section 5 target (`rate_limit_hit`), already running on the current stack and tested (`postgres.int`). Functions call it with the same arguments; Upstash is removed at cutover |
| Creator eligibility elig-1 | 0037 (projection columns, `creator_profiles.last_post_at`, YouTube retention trigger); `creators/eligibility.ts` (pure TypeScript) | Port the migration as is. The policy module ports unchanged to the shared domain package and is used by `customer-api` (search filter, list and campaign guards, profile) and `worker-tick` (projection, delivery gate). Search filters `eligible and eligible_until_epoch > now` in SQL, so no scheduled recompute is needed |
| Catalogue match explanations | `modules/creators/match-reasons.ts` (pure TypeScript) | Ports unchanged into the shared domain package |

Migrations to port as the baseline are now 0001–0034 and 0037 on master. 0035 (team and privacy) and 0036 (outreach email)
are reserved by the team-privacy branch and are not on master yet; reconcile their final content before porting.

## 0. Status and blockers

| Item | Status |
|---|---|
| Local Supabase stack (`supabase start`) | **Blocked**: needs Docker Desktop with WSL 2 on this machine (owner installing). Supabase CLI and Deno are installed after that. |
| Isolated dev/staging project | Not created. Needed for real Auth emails and deployed-function checks; never production. |
| Production cutover | Not before the gates in section 9 pass and the owner has reviewed the migration report. |

## 1. Components: current → target

| Current | Target | Notes |
|---|---|---|
| Fastify API (`apps/api`, Node) | Edge Functions `customer-api` and `staff-api` (Deno) | Pure domain logic (contracts, rules, pricing, fit, brief gate, ledger math) is ported as shared TypeScript modules; Fastify plugins, Node `crypto`, `node:fs` are rewritten for Deno/Web Crypto. |
| Paddle webhook route in Fastify | Edge Function `paddle-webhook` | Raw-body signature check, `webhook_events` uniqueness: unchanged rules. |
| pg-boss worker + outbox relay (`LISTEN mushin_outbox`) | `pgmq` queues + Edge Function `worker-tick` invoked by `pg_cron` via `pg_net` (every minute) and on demand after confirm | The API transaction calls `pgmq.send` directly, so the relay and its LISTEN connection disappear. Each tick reads a bounded batch with a visibility timeout, runs one bounded step, then deletes or re-sends with a checkpoint. |
| pg-boss retries (5, exponential, 5–600 s) and `dead-letter` queue | `pgmq` `read_ct` + visibility timeout for backoff; after the limit, `pgmq.archive` into a `*_dlq` queue with the error | Same limits; dead-letter rows stay inspectable by staff. |
| pg-boss schedules (`apps/worker/src/schedules.ts`) | `pg_cron` jobs that enqueue the same messages | See section 4. |
| Upstash Redis / in-memory limiter | PostgreSQL buckets: `ops.rate_limit_bucket` + one atomic `rate_limit_hit()` function | Paid-start limits fail closed (they already count PostgreSQL rows). Removes the fail-open behaviour. |
| Optional Meilisearch | Removed from production; PostgreSQL FTS + pg_trgm only | Keep the comparison script for evidence; drop `MEILISEARCH_*` config at cutover. |
| Custom staff login (`staff.staff_users`, password + TOTP, `staff_sessions`) | Supabase Auth identities + `staff.staff_membership` (role support/admin/super_admin, status) + Auth MFA (AAL2 required) | Staff permissions stay server-side (`STAFF_PERMISSIONS`); see section 6 for master-pack requirements. |
| Hand-written SQL migrator (`packages/db/src/migrate.ts`, checksums) | Supabase CLI migrations (`supabase/migrations/*.sql`), still hand-written SQL | Port the 28 migrations as the baseline; Drizzle stays a query library only. |
| Own DB roles `mushin_app` / `mushin_worker` + `withTenant` setting `app.*` | Supabase `authenticated` role with JWT claims for RLS, plus narrow `security definer` RPCs for ledger/job writes; service role only inside `worker-tick`/`paddle-webhook` with explicit checks | RLS policies are rewritten from `platform.current_workspace_id()` to a helper that resolves the active workspace from the JWT subject and the requested workspace path parameter **after** a membership check. |
| Object storage for raw payloads (`platform.raw_payloads`, local storage adapter) | Keep in PostgreSQL (current payloads are small) or Supabase Storage if size requires | Retention jobs unchanged. |

## 2. API routes (73) → workspace-scoped target

Rules for every customer route: verify the Supabase JWT; resolve `app_user`; check active membership of `{workspaceId}` and
the role for the action; then run the transaction with RLS. A client-supplied workspace id is only a selector.

| Current | Target (`/api/v1`) | Auth / role | Transaction notes |
|---|---|---|---|
| GET /v1/me, PATCH /v1/me | GET /me, PATCH /me | JWT | First sign-in provisions user + workspace + trial (one transaction, advisory lock per user) |
| PATCH /v1/workspace | PATCH /workspaces/{id} | owner, admin | — |
| GET /v1/workspace/members | GET /workspaces/{id}/members | member | — |
| POST /v1/search | POST /workspaces/{id}/search | member | Search, then charge once per logical search (`catalog_search_charges`, advisory lock, `spendInstant`) |
| POST /v1/search/interpret | POST /workspaces/{id}/search/interpret | member; AI limit | LLM call outside any transaction |
| GET/POST /v1/search/saved, DELETE /v1/search/saved/:id | /workspaces/{id}/search/saved[/{savedId}] | member | — |
| GET /v1/creators/lookup | GET /workspaces/{id}/creators/lookup | member | — |
| GET /v1/creators/:id | GET /workspaces/{id}/creators/{creatorId} | member | Summary request outbox → queue |
| POST/DELETE /v1/creators/:id/reveal | /workspaces/{id}/creators/{creatorId}/reveal-contact | member (POST); owner/admin (DELETE) | Reveal row first, then `spendInstant` (idempotent per workspace + Idempotency-Key) |
| GET /v1/creators/:id/audience, POST …/audience/estimate | same under workspace | member | **Feature stays disabled** (no approved price) |
| POST /v1/discovery/estimates | POST /workspaces/{id}/discovery/estimates | member | Brief gate; estimate row with prices + price version, 15-minute expiry |
| POST /v1/discovery/jobs (live, add_by_url, refresh) | POST /workspaces/{id}/discovery/jobs; POST …/creators/from-url; POST …/creators/{creatorId}/enrich | member; paid-start limits | One transaction: consume estimate, reserve, insert job, `pgmq.send`; Idempotency-Key |
| GET /v1/discovery/jobs, GET …/:id, GET …/:id/results | same under workspace | member | — |
| POST /v1/discovery/jobs/:id/cancel | same under workspace | member | Sets `cancel_requested`; the tick stops at a safe point |
| GET/POST /v1/lists, GET/PATCH/DELETE /v1/lists/:id, POST …/members, PATCH …/members/:creatorId, POST …/members/remove | /workspaces/{id}/lists… | member | Optimistic `version` where present |
| GET/POST /v1/campaigns, GET/PATCH/DELETE /v1/campaigns/:id, POST/DELETE/PATCH …/creators[/{creatorId}], GET/POST …/outreach | /workspaces/{id}/campaigns… | member | `version` conflict → 409 |
| GET /v1/activity, GET /v1/analytics/summary | /workspaces/{id}/activity, /analytics/summary | member | Read only |
| GET /v1/billing/plans | GET /billing/plans (public read of plan config) | none | Lets the landing page read prices from the server (removes the frontend copy) |
| GET /v1/billing/summary, /ledger, /invoices | /workspaces/{id}/billing/… | summary: member; ledger, invoices: owner/admin | — |
| POST /v1/billing/checkout, /subscription/change, /subscription/cancel | /workspaces/{id}/billing/… | owner (admin if policy allows) | Paddle stays gated |
| POST /webhooks/paddle | Edge Function `paddle-webhook` | Paddle signature | Store `(provider, event_id)` before effects |
| GET/POST /v1/support/tickets, GET/PATCH …/:id, POST …/:id/messages | /workspaces/{id}/support/tickets… | member | — |
| POST /v1/public/removal-requests | POST /privacy/creator-requests | none; IP limit | — |
| GET /health/live, /health/ready | `customer-api` `/health` | none | Ready = database reachable + last worker tick age |
| Staff: POST /admin/v1/auth/login, /totp, /refresh, /logout | **Removed**: Supabase Auth sign-in + MFA challenge in the staff console | — | Staff membership checked on every staff request |
| Staff: GET /admin/v1/me, /ops/overview, /ops/jobs, /ops/jobs/:id, /ops/workspaces, /ops/providers, /audit, /support/tickets[/:id], PATCH /support/tickets/:id, GET/POST /removal-requests[/:id/approve|reject] | `staff-api` under `/api/admin/v1/…` | staff membership + capability + AAL2 | Every view/action audited in the same transaction (unchanged rule) |
| Mock Paddle routes (development only) | Not deployed; local mock function only | — | Production refuses mock payments (unchanged) |

Frontend: `apiRequest` and every hook move to `/api/v1/workspaces/{workspaceId}/…` in the same change as the functions;
query keys gain the workspace id; the cache is cleared on sign-out/workspace switch. No duplicate unscoped routes are kept.

## 3. Transactions and invariants that must survive the port

1. Estimate consumption + credit reservation + job insert + queue message: one transaction (`pgmq.send` inside it).
2. Settlement exactly once per job (`lockOpenJob` + `commitPartial`); a released reservation is never charged.
3. Append-only ledger and audit log (no UPDATE/DELETE grants; triggers kept).
4. Reveal idempotency (reveal row unique per workspace + creator before spending).
5. Catalogue search charge once per logical search (advisory lock + `catalog_search_charges`).
6. Advisory locks: credits per workspace, identity provisioning per user, search charge per (workspace, user, hash).
7. Webhook idempotency by `(provider, event_id)`.
8. No provider call inside a database transaction (already true; keep it).

## 4. Jobs, queues and schedules

| Event type (outbox today) | pg-boss queue | Target pgmq queue | Bounded step per tick |
|---|---|---|---|
| discovery.live_requested | discovery-high | `discovery` | One stage per tick (plan → search → gate → extract batch → assess batch → persist → settle); checkpoint in `discovery_jobs`; Apify runs started then polled on later ticks by stored run id |
| discovery.requested (add by link), refresh.requested | discovery-high / discovery-standard | `discovery` | Fetch → archive → assess → save, one step per tick |
| creator.assessment_requested, creator.summary_requested, creator.changed, creator.reindex_all | rescore-low | `creator` | LLM call or projection upsert per message |
| audience.estimate_requested | audience | — | Not migrated while the feature is disabled |
| billing.job, billing.webhook_received | billing | `billing` (concurrency 1 via a single consumer lease) | Pure SQL/TS, short |
| erasure.creator_requested | erasure | `erasure` | Bounded deletes per tick |
| notify.* (credits_low, credits_very_low, trial_ending, trial_expired, payment_failed, subscription_canceled, discovery_job_finished, removal_processed) | notify | `notify` | Today only recorded; Resend later (EMAIL-001) |
| system.* sweeps and purges | system | `pg_cron` calling SQL directly where the work is pure SQL; otherwise enqueue `system` | — |

Schedules to `pg_cron` (same cron strings): release_abandoned `* * * * *`; expire_lots `5 * * * *`; end_trials `10 * * * *`;
trial_notices `20 * * * *`; monthly_grants `30 2 * * *`; scheduled_changes `40 * * * *`; reconcile `30 4 * * *`;
search_reconcile `45 3 * * *`; discovery_sweep and audience_sweep `*/5 * * * *`; purge_expired `15 3 * * *`;
purge_raw_payloads `25 3 * * *`; purge_search_cache `35 3 * * *`; purge_removal_emails `40 3 * * *`; mock_renewals only in
development. Plus the dispatcher tick `* * * * *` (`pg_net` POST to `worker-tick` with a Vault secret).

Retries: max 5 reads (`read_ct`), visibility timeout growing 5 s → 600 s; provider outcomes `unknown` are reconciled
before any non-idempotent retry; after 5 the message goes to `<queue>_dlq` and the job is settled as failed/partial.

## 5. Rate limits

| Bucket today (`rate-limit/types.ts`) | Limit | Target |
|---|---|---|
| ip | `RATE_LIMIT_MAX_REQUESTS`/min (default 120) | `rate_limit_hit('ip', ip, 120, 60)` in each function before work |
| user | same | `rate_limit_hit('user', sub, 120, 60)` |
| auth (staff login) | 10/min | Supabase Auth's own limits + per-IP bucket on staff functions |
| ai (interpret, summary) | 20/min | `rate_limit_hit('ai', sub, 20, 60)` |
| jobs (paid starts per user) | 20/h | Counted from `discovery_jobs` rows in the creating transaction (fail closed) |
| workspaceJobs | 100/h | same, per workspace |
| Monthly provider budgets | Apify USD cap, Serper count cap | Unchanged (computed from `provider_calls`); add LLM cap + per-job cost cap (credit-economics.md) |

## 6. Staff identity and master-pack requirements

Target model: Supabase Auth user + `staff.staff_membership(user_id, role in ('support','admin','super_admin'), status)`;
every staff request requires AAL2 (MFA verified in the session); `super_admin` is created only by an out-of-band bootstrap
command run by the owner, and no endpoint lets an admin grant or raise anyone to super admin.

Master pack requirements to verify before staff security is called complete (`MUSHIN_MASTER_DOCUMENTATION_PACK/04_SPECIFICATIONS_29_DOCS/DOC-029`):

| Requirement | Status in target | Note |
|---|---|---|
| Admin: hardware security key (WebAuthn) mandatory; TOTP only as backup | **Open** | Supabase Auth MFA documents TOTP and phone factors; WebAuthn/passkey support must be verified on the chosen plan before claiming it. If unavailable, record a documented exception or keep admin actions behind TOTP + step-up. |
| Two-person rule for destructive runbook steps; founder co-sign for suspending a paying customer, PITR restore and break-glass | **Open** | Needs an approvals table (requester ≠ approver) and super_admin (= founder) approvals. |
| Consented, read-only, time-boxed (60 min), bannered, audited impersonation; cannot spend, bill, export or send mail | **Not built** | The complete pack prohibits impersonation by default; build only if the owner wants it. |
| Support never sees ledger amounts; admin ledger access logged with reason | Partly | Current support views are redacted; reason capture for admin ledger views is missing. |

## 7. Order of work (each step keeps the current stack running until cutover)

1. Docker + Supabase CLI + Deno installed; `supabase init` in the repo; port the 28 migrations to `supabase/migrations` as a
   baseline and prove a clean `supabase db reset` + the existing RLS tests against it.
2. Add `pgmq`, `pg_cron`, `pg_net`, `rate_limit_hit()`, `staff_membership`; rewrite RLS helpers for JWT claims.
3. Shared domain package importable from Deno (contracts, rules, pricing, fit, brief gate) with its unit tests run under both
   Node and Deno.
4. `customer-api` function route by route with the existing integration tests re-pointed at it; frontend moved to
   workspace-scoped paths in the same change.
5. `worker-tick` with discovery/creator/billing/erasure handlers as bounded steps; crash/redelivery/duplicate-tick tests.
6. `staff-api` on Supabase Auth + MFA; remove the custom staff login.
7. Browser E2E (three consecutive runs, phone width, accessibility) against the local Supabase stack.
8. Migration report; owner review; then remove Fastify, pg-boss, the relay, Upstash and Meilisearch.

Rollback while validating: the Fastify/pg-boss stack and its database stay untouched; the Supabase stack runs on its own
local database. Cutover is a configuration switch of the frontend API base, reversible until the old stack is removed.

## 8. Risks

- Edge Function limits (wall clock, memory) — every step must stay short; Apify runs are polled across ticks, never awaited.
- Connection handling — functions use the Supabase pooler (transaction mode); no session features (LISTEN, session advisory
  locks) — the current code uses only transaction-scoped advisory locks, which work in transaction mode.
- `pgmq` delivery is at least once — every handler must stay idempotent (they are today: job state machine + unique keys).
- Re-pointing ~80 integration test files at a new runtime is the largest effort; the domain logic tests port as they are.

## 9. Acceptance gates (owner direction section E)

Clean `supabase db reset` + restore evidence; Supabase Auth sessions and expiry; positive and negative RLS tests incl.
cross-workspace; API contract tests and frontend integration; queue delivery, idempotency, crash recovery, scheduled ticks,
retries and dead-letter handling; credit invariants under concurrency; PostgreSQL search relevance tests; providers off in
tests; three consecutive E2E runs, phone width and accessibility; a migration report with removed components, architecture,
test outcomes, measured operating cost and blockers. No production cutover before owner review.
