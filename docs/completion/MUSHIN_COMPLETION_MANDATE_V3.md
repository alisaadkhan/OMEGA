# MUSHIN — Unified Full-System Completion Mandate v3

Version: 3.0 · 17 October 2026
Purpose: Complete MUSHIN end to end: engineering, UI/UX, security, integrations, testing, Figma-ready design handoff, operational documentation, and honest release-readiness assessment.
Precedence: This mandate combines the original full-system completion brief with the audit-driven Completion Mandate v2. It supersedes both for execution. The audit pack and the most recent dated owner decisions in docs/readiness/progress.md are the starting sources of truth. Where older requirements conflict with this mandate, follow this mandate; where a later dated owner decision conflicts with it, follow the later owner decision. Never silently resolve a conflict that changes security, data access, legal obligations, or customer charges.

> Saved verbatim from the owner's message of 2026-10-17 so that every session reads the same text.

## 0. Session protocol and continuity

This is a multi-session job. Do not assume the whole project can be completed in one context window. Work in small, verifiable units and leave enough evidence for another session to continue without rediscovering prior work.

### At the start of every session

Read, in this order:
1. This mandate.
2. docs/completion/PROGRESS.md (create it if missing).
3. docs/audit/2026-10-16/E_GAP_REGISTER.md.
4. docs/audit/2026-10-16/I_IMPLEMENTATION_ROADMAP.md.
5. git status --short, current branch, and git log --oneline -20.

The audit is the baseline. Do not redo the entire audit. Verify the exact parts of the system you are about to change, inspect relevant code and tests, and add new findings only when evidence reveals a gap not already recorded.

If the audit pack is not present, put the supplied audit pack at docs/audit/2026-10-16/ and commit it as a documentation-only change before implementation. Do not invent missing audit contents. If a file is unavailable, record that fact and proceed using what is available.

The audit refers to master @ 1398cee, 37 migrations, and new migrations starting at 0038. First reconcile this against the actual checkout. If the branch, commit, migration count, or schema state differs, preserve the working tree, inspect the drift, and record it in PROGRESS.md. Start new migrations at 0038 only if migration 0037 is confirmed to be the latest migration in the actual repository. Never use a stale migration number merely because it appears in this mandate.

### During each session

- Select the next unblocked item from §6 in order.
- Prefer one audit gap ID per commit. If a task genuinely spans multiple IDs, explain why in the commit and progress log.
- Each code commit includes the relevant tests and documentation.
- Keep the app runnable after each meaningful change; run npm run verify, the frontend build, and API/worker startup checks as far as the environment permits.
- Do not combine unrelated refactors with a targeted security or data-integrity fix.
- Preserve user work, untracked files, and unrelated changes.

### At the end of each session—or roughly every two hours

Update docs/completion/PROGRESS.md with:
- Current commit SHA and gap ID(s) completed.
- Exact files and behavior changed.
- Exact commands run and their real results.
- Test totals: passed, failed, skipped, and blocked.
- Any environmental or owner-decision blocker, including why it blocks the work.
- The next unblocked gap ID and precise next action.
- Any migration numbers reserved or created.

A new session must be able to continue from this file without reconstructing the history from scratch. Do not write status updates in place of doing available implementation work.

## 1. Mission and definition of success

Bring MUSHIN from its current locally working MVP state to the most complete, honest, maintainable, well-tested product the available repository and environment can support.

This means finishing the product across the complete chain:

Requirements → database → API/services/workers → frontend/UI → integrations → security → automated tests → browser E2E → operational documentation → release-readiness evidence.

Your job is not merely to audit, create a plan, improve the dashboard, or add documentation. Implement the work. Test it. Fix failures. Retest. Continue until the acceptance criteria pass or a genuine external blocker remains.

The product should feel like a mature, professionally designed SaaS application—not a generic vibe-coded demo. It must work meaningfully, handle edge cases honestly, respect security boundaries, and give users clear recovery paths. Do not add complexity or decorative features for their own sake.

You are not expected to declare production readiness in this environment. Some gates require real people, accounts, paid services, legal review, or a production host. Close everything that can be closed safely and leave each blocked gate with one specific next action.

### Work autonomously, with boundaries

Make normal, reversible engineering and design decisions using the code, audit, product requirements, and this mandate. Record significant decisions in docs/completion/DECISION_LOG.md.

Do not ask the owner to approve every small choice. For owner decisions listed in §3.3, write the question and recommendation into the decision log, ask once in a concise message, and continue with other unblocked work. Stop before actions involving money, real communications, remote systems, production data, destructive changes, or unresolved security/legal/customer-charging decisions.

## 2. Hard rules — never break these

1. Secrets: Never print, log, commit, expose, or paste secret values. Never read .env values into output or reports. Refer to environment-variable names only. Treat the current .env as compromised because of audit SEC-01. Rotating credentials is the owner's task; do not attempt to use or reveal the exposed credentials.
2. No external side effects: Do not make paid or real provider calls to Serper, Apify, YouTube, Groq, Ollama, or other configured providers; send real email through Resend; make real Paddle payments; modify Supabase projects; change hosted infrastructure; deploy; push to a remote; or otherwise change a remote system unless the owner explicitly authorizes the specific action. Use deterministic mocks, synthetic fixtures, or approved sandboxes for tests. Do not infer authorization from having credentials available.
3. Search freeze: Do not change retrieval, ranking, query understanding, Live Discovery creator selection, Campaign Fit, normalization, or any behavior that could alter the current Search rating packets until the owner records the rating result in docs/readiness/progress.md (or the later owner-designated progress source). This includes seemingly small relevance fixes. Before merging a change touching apps/api/src/modules/creators/** or apps/api/src/modules/discovery/**, run node --import tsx scripts/search-eval/freeze-check.ts <queries.csv> with the appropriate frozen query corpus and require a byte-for-byte pass. Only search-adjacent plumbing proven not to change outputs—such as persisting provider run IDs—may proceed while frozen. If the check cannot run, the change is blocked until an equivalent documented verification is available.
4. Evaluation data: Never modify, regenerate, purge, rename, or copy eval-data/. The owner is responsible for purging it after human rating, by the documented deadline of 12 November 2026. Do not include evaluation data in generated reports or packages.
5. No fake success: Never present synthetic, fixture, replayed, seeded, cached, or mocked results as live provider results. Never claim that a test passed unless it was actually run and its output supports the claim. Never mark a real integration as verified based on a mock. Never weaken, delete, or skip a failing test merely to achieve green results.
6. Migrations: Use forward-only, additive migrations. Never edit a migration that has already been applied. Confirm actual migration numbering before creating the next migration; the audit baseline expects 0038 onward if 0037 is truly latest. Add constraints as NOT VALID when appropriate and validate in a subsequent migration/step. Every migration needs an integration test. Avoid destructive data transformations without explicit authorization and a reviewed recovery plan.
7. Preserve user work: Never run git reset --hard, git clean, force-push, or delete/overwrite untracked files you did not create. In particular, leave frontend.zip, supabase/, .claude-flow/, and the untracked readiness report untouched unless the owner explicitly authorizes a specific change. Do not overwrite the user's current modifications to make the working tree clean.
8. Server-side authority: The server is authoritative for plan prices, discounts, credit balances, credit charging, permissions, workspace membership, account status, and access control. The frontend displays server decisions; it must never be the enforcement layer.
9. No silent substitutes: If a capability is unavailable, show an honest disabled/unavailable state with the reason and next step. Do not ship a button that appears functional but does nothing. Do not silently substitute unrelated creators, fake metrics, static results, or fabricated profile fields.
10. No unauthorized production claims: Do not call MUSHIN production-ready merely because the code builds or local tests pass. Use the exact status definitions in §11.
11. Data protection: Do not put personal data, email addresses, provider payloads containing personal information, or secret-shaped values into logs, screenshots, fixtures, reports, or commits unless explicitly necessary and safely redacted. Synthetic test creators must be clearly fictional.
12. No opportunistic rewrite: Do not replace the architecture or introduce new managed services simply because they are fashionable. Investigate first, prefer the smallest maintainable fix, and document reasons for any consequential change.

## 3. Decisions and known business rules

### 3.1 Already decided — implement as stated

Use the latest dated owner decision in docs/readiness/progress.md if present; the following decisions are the baseline:
- Top-up credits never expire. Monthly plan credits end at the applicable renewal date.
- Creator eligibility requires a minimum of 10,000 followers, with the follower count no older than 90 days; activity is tracked separately under elig-1.
- YouTube-derived data follows the 30-day refresh-or-delete rule. YouTube-derived scores remain disabled.
- Audience demographics remain disabled. Never estimate or fabricate age, gender, or location percentages.
- Local/staging LLM expenditure has a USD 5 monthly cap. Production must set an explicit cap.
- Search acceptance requires two independent human raters and one adjudicator. Gates are weighted kappa ≥ 0.60, strict Precision@5 ≥ 0.80, nDCG@10 ≥ 0.75, coverage ≥ 0.90, and all behavior cases passing. Do not change these thresholds.
- Customer identity is targeted to Supabase Auth. Privileged staff actions require a hardware-key WebAuthn step-up.
- Search is not accepted until human relevance evaluation has been completed and the owner records the result. Existing replayed Brain 2 results are not evidence of live-discovery quality.

### 3.2 Pre-approved engineering defaults — implement without asking

| Audit ID | Required implementation |
|---|---|
| SEC-02 | Store each WebAuthn step-up in a server-side row with a five-minute validity. Check it on each privileged request; do not trust the amr claim alone. |
| SEC-03 | Derive confirmed email from a server-trusted source such as Supabase app_metadata populated by a token hook. Never trust editable user_metadata for confirmation. The hook may be documented but not applied to the remote project without authorization. |
| SEC-04 | A requested workspace that is not a membership returns HTTP 403 workspace_access_denied. Fall back only when no workspace header is sent. Echo x-workspace-id; implement per-tab client selection. |
| SEC-05 | Configure trustProxy using an explicit CIDR list; production refuses to start without valid configuration. |
| SEC-06 / ARCH-03 | Use PostgreSQL as the default rate limiter even when Upstash variables are present, then remove unused Upstash code paths safely. |
| BIL-05 | Use ON DELETE RESTRICT for ledger, lots, payments, and subscriptions; add a trigger or equivalent server-enforced guard against hard deletion of workspaces with retained financial records. |
| BIL-06 | Permit only one open Live Discovery job per workspace. Enforce this safely under concurrent requests. |
| SRCH-04 | Persist Apify run IDs before waiting, resume appropriately on retry, and send maxTotalChargeUsd and runTimeoutSecs to the actor when supported. Do not make real provider calls while implementing. |
| SRCH-05 | Use PostgreSQL-backed provider budget reservations rather than per-process-only counters. |
| SEC-07 | First security-key enrollment requires an authorized approval or a one-time code generated through the CLI. |
| SEC-09 | Use key-versioned ciphertext and provide a re-encryption script with a dry-run mode. Never log plaintext or secrets. |
| OPS-01 | Make test suites load configuration inside tests so a clean clone with no .env can run npm run verify without failing because developer secrets are absent. |
| OPS-02 | Build a synthetic fixture catalogue and seed script using invented, clearly labelled creators. Do not use real people or YouTube API data for E2E fixtures. |
| UX-02 | Implement the Supabase PKCE flow, #/reset-password screen, and email-confirmation result screen within the supported local environment. |
| UX-04 | Add route-level code splitting and a separate admin entry where compatible with the existing architecture. |
| SEC-15 | Delete unused fake testimonial/logo components after verifying they are genuinely unused. |
| DATA-03 | Stream exports or explicitly flag/handle exports exceeding 50,000 rows; do not silently truncate them. |

### 3.3 Owner decisions — record, ask once, and continue elsewhere

Create a Waiting for owner section in docs/completion/DECISION_LOG.md. Record each item, the impact, the recommendation, and the smallest next action. Ask the owner once; do not stall unrelated work. Do not implement a decision-dependent behavior until answered.

| ID | Decision required | Suggested answer to present |
|---|---|---|
| D-01 | Hosting: keep Node API + worker on small containers with Supabase DB/Auth/Storage, or port to Edge Functions? | Keep the existing Node API and worker. |
| D-04 | Exact public wording for Live Discovery pricing. | Use the corrected wording in §5. |
| D-05 | Should catalogue searches with zero results be free? | Yes; change only after the owner confirms. Current code charges them. |
| D-06 | May workspace Admins purchase plans/top-ups, or Owners only? | Owners only. |
| D-08 | Monthly budget and priority policy for automatic catalogue refresh. | Propose USD 10/month and refresh saved creators first. |
| D-09 | Maximum capped live-provider pilot envelope. | Propose 15 briefs, Serper ≤ 200 calls, Apify ≤ USD 3, LLM ≤ USD 1. No pilot calls before authorization. |
| D-10 | Launch scope by platform (including TikTok beta). | Instagram + YouTube, with TikTok clearly labelled beta. |
| D-11 | Should contact strings embedded in public bios be redacted from payloads? | Redact and reveal only through the paid contact-reveal path. |
| D-12 | RPO/RTO, point-in-time recovery spend, billing-record retention. | Propose 24-hour RPO for a pilot and require owner approval for cost/retention. |
| D-17 | Growth yearly discount versus the shared "save 20%" label. | Change the label to each plan's actual saving. |
| Legal | Final Terms, Privacy, Refunds, and Creator Data wording. | Build page shells with a clear DRAFT — awaiting legal review banner. Do not present as legally approved. |

Never let unanswered owner decisions block work that does not depend on them.

## 4. Known baseline — do not rediscover it needlessly

Treat these as audit findings to verify only when relevant to the work at hand. Reconcile any mismatch with the actual checkout as described in §0.

### Stack and environment

- React 18 / Vite SPA with hash routing in frontend/.
- Fastify API in apps/api, including /v1/**, /admin/v1/**, and /webhooks/paddle routes; the audit counted 116 routes.
- pg-boss worker in apps/worker, with an outbox relay, nine queues, and 15 schedules according to the audit.
- Shared packages under packages/{contracts,core,db,integrations}.
- PostgreSQL; audit baseline says 37 migrations.
- Supabase Auth JWKS for customers; custom password + TOTP + WebAuthn for staff.
- Developer machine: Windows, Node ≥ 22.12, PostgreSQL on localhost:54330, Meilisearch via npm run meili:start, and no Docker/WSL. Therefore supabase start cannot be assumed to work locally.
- Integration tests require TEST_DATABASE_URL pointing to a localhost database whose database name contains test. Preserve and test the database-name guard.

### Baseline test/build results recorded by the audit (not new results)

- Lint, typecheck, and boundary checks passed.
- Vitest: 847 passed, four skipped, and one suite failed without a developer .env.
- Frontend build and bundle-secret scan passed.
- Browser E2E was not reproducible from a clean repository because it depended on the developer's mushin_local catalogue.

These are historical audit results, not claims that the current checkout has just passed. Re-run the baseline checks and record the actual output and SHA.

### Existing strengths to preserve

The audit reports: forced RLS on all 28 wp tables; append-only, idempotent credit ledger; atomic quote → reserve → job flow; elig-1 applied consistently; workspace deletion with financial retention; one trial per identity; SSRF-safe avatar fetching; Paddle signature logic; and honest operation-outcome states. Do not rebuild these without evidence of a defect.

### Search baseline — not accepted

- Only 11 of 35 Brain 1 panel queries returned anything in the audit.
- Brain 2 figures since 13 October included replayed results.
- TikTok and Urdu-script coverage were very limited.
- Human rating is still required. Do not treat prior E2E success, stable ranking, or successful provider adapters as evidence that search relevance is accepted.

## 5. Pricing truth table — reflect code, not a mistaken prompt

Verify the current implementation in the cited migrations/services before changing billing behavior. This section is a truth table for auditing and displaying the current code; owner decisions in §3.3 govern any policy change.

| Plan/action | Current server rule in the audit baseline | Required attention |
|---|---|---|
| Starter | Rs 4,900/month or Rs 3,900/month yearly; 2,500 credits | Verify the pricing display matches server constants. |
| Growth | Rs 12,900/month or Rs 10,900/month yearly; 12,000 credits | Actual saving is approximately 15.5%; UI currently says "save 20%". Resolve through D-17. |
| Scale | Rs 24,900/month or Rs 19,900/month yearly; 35,000 credits | Must not be omitted from plans UI or tests. |
| Trial | 14 days, 200 credits, once per person | Verify server-side identity and duplicate-trial rules. |
| Catalogue search | 50 credits per logical search; same user + same text/filters within 30 minutes is free; current code charges even when no results are returned | D-05 governs whether empty searches become free. Until decided, do not silently change existing server policy. |
| Live Discovery | Quote maximum is 50 + 10 × requested size (5/10/15). Charge only if ≥1 creator is delivered: 50 base credits + 10 per new creator. Known creators are free. TikTok scope has a 100-credit minimum. Charge is capped at the quote. Nothing delivered → zero charge. | Pricing copy currently says "you pay only for new creators actually added; nothing if none is found." Resolve exact public wording via D-04 and test client values against server constants. |
| Refresh / add by link | 50 credits across platforms | Verify UI, API, and ledger agree. |
| Contact reveal | 5 credits; denied or unavailable → zero charge | Verify permission, availability, and ledger behavior. |

Suggested D-04 wording:
"Find New Creators is quoted before you confirm. If at least one creator is delivered, you pay a 50-credit base fee plus 10 credits for each new creator (creators already in MUSHIN are free). Runs that include TikTok cost at least 100 credits. If nothing is delivered, you pay nothing."

Do not apply this wording without the owner's decision if D-04 is unanswered.

Add or maintain tests such as plans-claims.test.ts that pin every number on the pricing page and quote dialog to authoritative server constants. Never duplicate business rules independently in UI constants. If the server rules change after a decision, update the tests to the approved rule rather than weakening them.

## 6. Prioritized execution plan with phase exit gates

Follow this order. A phase does not authorize skipping earlier red gates. If a gate is blocked by a clearly documented external limitation, complete all safe work within that phase, record the blocker and its next action, and continue only with work that does not depend on the blocked gate.

### Phase 1 — Establish the baseline and workspace

Create or update docs/completion/ with:
- SYSTEM_BASELINE.md — update from the audit; do not re-audit everything.
- REQUIREMENTS_TRACEABILITY.md — derive from registers/traceability_checklist.csv and the real page/module inventory.
- GAP_REGISTER.md — link E_GAP_REGISTER.md, map audit IDs, and add newly discovered gaps with the next free IDs.
- IMPLEMENTATION_PLAN.md — execution order, dependencies, and phase gates.
- DECISION_LOG.md — approved defaults, rationale, and waiting-for-owner questions.
- PROGRESS.md — session handover file.

Re-run the baseline checks; record command, current commit SHA, date, actual totals, and blockers. Reconcile the baseline drift described in §0.

Exit gate: baseline and audit pack state are recorded accurately with a commit SHA; no user work was discarded.

### Phase 2 — P0 security, data integrity, provider-spend safety, and money

Proceed in this order unless the gap register proves a dependency requires a safe adjustment:
1. OPS-01: tests/config work with no .env.
2. SEC-02: server-verified staff step-up.
3. SEC-04: workspace access isolation and workspace-header behavior.
4. SEC-03: trusted email confirmation.
5. BIL-05: financial retention and hard-delete controls.
6. SRCH-04: persist/resume Apify run IDs and enforce provider cost/time bounds without real provider calls.
7. SEC-01 support: a safe packaging script using git archive plus a secret scan; do not rotate or use secrets.

Include focused unit/integration tests, cross-workspace negative tests, concurrency/retry coverage where relevant, and migration tests. Do not proceed to risky feature work while any critical acceptance criterion in this phase fails.

Exit gate: the listed acceptance criteria are demonstrated by tests actually run; npm run verify is green from a clean clone with no .env; relevant security tests pass. If an external service blocks a local startup check, state exactly which checks passed and why the remaining check is blocked—do not call the gate green.

### Phase 3 — Make E2E reproducible

Implement OPS-02: a synthetic, fictional creator fixture catalogue and seed script. Use it to build deterministic templates for scripts/e2e-customer and scripts/e2e-staff. Introduce an authentication stub only in E2E configuration; it must not be enabled by production builds or normal runtime.

The E2E harness must not depend on a personal development database or real creator data. Use mocks for every paid/remote provider.

Exit gate: on a clean, configured clone, npm run e2e:customer and npm run e2e:staff each pass three consecutive times. Record separate totals and commands for each run. If a real environmental blocker remains, make the deterministic suite reproducible as far as possible and record precisely what blocks the gate.

### Phase 4 — Complete modules and the entire UI, without breaking the search freeze

Complete the modules in this order:
1. Auth flows (UX-02): PKCE, password recovery, reset-password, confirmation result, expiry states.
2. Workspace/team flows (SEC-04 client behavior, UX-03): per-tab switch, membership/invitations, accurate permission handling.
3. Pricing truthfulness: D-04 and D-17 dependent copy changes only after answers; meanwhile document defects and finish noncontroversial UI plumbing.
4. Legal page shells (UX-01) with explicit draft banners pending counsel.
5. Contact/profile payload policy (SEC-08) after D-11.
6. Lists, campaigns, creator eligibility messaging, and outreach tracking.
7. Settings, exports, deletion, and account lifecycle.
8. Staff console, SEC-07 key-enrollment approvals, approval UX, audit history, provider controls, job controls, and removal review.
9. Global states, 404, maintenance/degraded UI, error boundaries, and accessibility.
10. Route-level code splitting and separate admin entry (UX-04).

Search UI work is allowed only if it does not alter frozen result behavior. Implement required empty/error/credit/status states and related display improvements while keeping the underlying output contract unchanged; run the freeze check whenever relevant.

Exit gate: every route in §8 is implemented or shows an honest, reason-specific unavailable state, and is covered by an E2E test or a documented justified exception. No interface should contain a working-looking button that does nothing.

### Phase 5 — Operations and reliability readiness without a host

Complete the engineering work that can be validated locally:
- SEC-05: trusted-proxy configuration and startup behavior.
- SEC-06 / ARCH-03: PostgreSQL rate limiting and removal of unused Upstash paths.
- SRCH-05: durable provider budget reservation.
- BIL-06: one open Live Discovery job per workspace, safe under concurrency.
- SEC-09: key-versioned encryption and dry-run re-encryption script.
- SEC-10 and any related audit register items: investigate and implement only what the evidence calls for.
- Health/readiness endpoints: /health/live, /health/ready.
- Request IDs in error responses and structured-log redaction tests.
- Background-job retry, cancellation, stuck-job recovery, and worker restart behavior.
- docs/completion/RUNBOOK.md: local start, migration, local restore drill, key rotation, provider pause, diagnosis, and recovery procedures.

Also investigate practical caching/invalidation, rate limiting, indexes, pagination, configuration validation, backups/recovery assumptions, observability, dependency vulnerabilities, and deployment reproducibility. Implement only changes supported by concrete requirements or findings; do not add paid infrastructure or claim cloud configuration exists when it does not.

Exit gate: all P2 engineering items are closed or recorded as blocked with root cause and exact next action; operational checks are reproducible locally where environment permits.

### Phase 6 — Search work only after rating results are recorded

If—and only if—the owner records the adjudicated rating result in docs/readiness/progress.md or the later designated progress file, begin search behavior changes according to the gap register. The audit work order identifies:
- SRCH-07: strict filter schemas.
- SRCH-06: report ignored query clauses.
- SRCH-08: keyset pagination.
- SRCH-09 / SEC-16: transparent partial results and deterministic reasons.
- SRCH-02: refresh scheduler, only after D-08.

For each proposed change, run the evaluation tools on the frozen corpus, preserve the before/after diff, and keep the corpus and packet handling compliant with §2. Do not claim relevance improvement without new human ratings.

If no rating result is recorded yet, do not change retrieval, query interpretation, ranking, discovery selection, or fit behavior. You may improve the search reporting additions only: standard Precision@5, bootstrap confidence intervals, weighted kappa, raw agreement, and related tests in scripts/search-eval/metrics.ts. Then return to other unblocked work.

### Phase 7 — Final regression, full audit, and reports

After the final code change:
- Run all feasible verification commands again.
- Run customer and staff E2E suites, including the required defect journeys in §10.
- Recheck the entire route inventory, requirement traceability, role permissions, and migration list.
- Run freeze checks for any relevant files.
- Verify UI handoff mappings still point to actual files and tests.
- Inspect the final diff, check for secret leakage, and verify user changes and protected untracked files remain intact.
- Write evidence-based final reports.

After each phase, revisit the gap register and select any newly unblocked task. Do not stop simply because a phase report was written.

## 7. Full product/module completion requirements

Build a real inventory from the repository, audit pack, API routes, schema, tests, and requirements. Apply the following checklist to every module, not only the modules explicitly listed below:

Schema and constraints → API/service logic and validation → server-side authorization → UI with all states → cross-workspace negative test → unit + integration tests → browser E2E journey → safe logs/observability → documentation.

### 7.1 Authentication, identity, and onboarding

Verify and complete, as appropriate to the real requirements:
- Sign-up, sign-in, sign-out, confirmation result, session refresh, session expiry, password recovery, and set-new-password.
- One retry on an expired/401 session where appropriate, followed by a clear sign-in modal/page rather than an infinite loop.
- Supabase PKCE flow without pretending remote Auth works when it has not been configured.
- Deleted-account messaging and appropriate user lifecycle states.
- Workspace creation and first-use onboarding.
- Authentication boundary between customer and staff systems.

### 7.2 Workspaces, teams, and permissions

- Workspace switcher and per-tab selection.
- Create/join workspace where permitted.
- Invitations: preview, wrong email, expired, revoked, accepted, and already-used states.
- Membership removal, ownership transfer, leaving a workspace, and deletion blockers.
- Workspace-header validation and server-side membership enforcement on every relevant endpoint.
- Explicit tests for a non-member sending a workspace header, a two-tab workspace switch, and any cross-tenant read/write path.
- All roles enforced on the server; frontend visibility is only a convenience.

### 7.3 Brain 1 — existing catalogue search (highest product priority, but frozen until ratings)

The underlying search result contract is frozen as described in §2. Within that limit, complete the usable UI and existing non-output-changing plumbing:
- Query input, cost/credit chip, selected filters, current filter summary, and a "how we read your query" explanation where already supported by the contract.
- Useful results with real fixture or database provenance, appropriate pagination, creator profile navigation, and clear status.
- Empty results, few results, conflicting ranges, insufficient credits, no plan, rate limiting, stale cursor, API error, offline, and retry states.
- No fake "live" results, arbitrary fixed creator list, or query-insensitive result set presented as real.
- Search operations and costs must follow server responses; no client-side duplicate charging rules.
- Do not alter phrase matching, query normalization, ranking, filters, or other frozen behavior before rating approval.

### 7.4 Brain 2 — Live Discovery

- Brief validation with actionable errors derived from the actual missingRequirements/contract result.
- Quote before confirmation, with maximum/minimum, expiry, platform scope, and credit balance rules sourced from the server.
- One active/open job per workspace.
- Appropriate progress display, polling with backoff, cancellation, deadlines, and safe worker recovery.
- Every terminal result has distinct, honest messaging: succeeded, completed-empty, insufficient balance, partial, failed, cancelled, stopped by cost cap, or stopped by deadline, as supported by the server contract.
- Display final credit outcome from the server; never estimate a final charge in the UI.
- Persist provider run IDs before waiting and resume safe retries according to SRCH-04.
- Deduplicate creators and avoid charging for known creators as specified by the server rule.
- Clearly distinguish fixture/mock mode from actual provider-backed live discovery.
- Never call paid providers during the mandate unless explicitly authorized.

### 7.5 Creator profiles and data quality

- Real creator profile page and supported platform links.
- Display creator statistics, niche, location, and audience data only when actually available and permitted.
- Show the source and freshness for every number where relevant.
- Show "Unknown" or "Unavailable" for missing data; never convert missing values into zero.
- Explain eligibility and reasons for ineligibility. Enforce elig-1 and the 90-day freshness rule consistently.
- Label AI-generated summaries as AI-generated; distinguish verified evidence from inference.
- Keep audience demographic features disabled until expressly approved and supported with real evidence.
- Honor minor-protection and removal-hidden states where the code/requirements define them.
- Show contact availability without leaking raw contact strings into unauthorized payloads.
- Contact reveal follows the server-authoritative credit and permission path.

### 7.6 Lists and creator organization

- Create, rename, view, and delete lists where required.
- Add/remove creators, duplicate prevention, creator availability changes, and clear empty states.
- Respect workspace membership and permissions.
- Useful search, filter, sorting, and bulk actions when justified by existing requirements.

### 7.7 Campaigns and campaign fit

- Create, edit, view, and progress campaigns through supported stages.
- Briefs, budgets, timelines, creator assignment, campaign limit indicator, and fee calculations.
- Creator eligibility labels and meaningful fit explanation based on actual available data.
- Optimistic concurrency conflict handling, safe state transitions, and audit/history views where supported.
- Do not alter Campaign Fit output while the search freeze applies.
- Campaign data must persist and remain consistent across reloads and users with authorized access.

### 7.8 Outreach and contact management

- Outreach log, campaign-related contact actions, status history, and useful filters.
- The existing user-facing flow must be clearly marked manual — MUSHIN does not send emails where automatic sending is not implemented/authorized.
- Distinguish email available, unavailable, unverified, and verified states based on trusted evidence.
- Resend may be integrated only where a real email address and required permissions exist, but do not send real messages during testing.
- Test duplicate-send prevention, retry/idempotency, and delivery state only with mocks/sandbox.

### 7.9 Credits, plans, billing, and checkout

- Credit balance breakdown: available, held/reserved, top-ups that never expire, monthly credits and renewal/end date.
- Ledger/history with role restrictions governed by D-06 where relevant.
- Insufficient-balance, quote-expiry, cancellation, provider failure, partial-result, refund/release, and idempotency states.
- Correct Starter, Growth, and Scale plans and trial rules from §5.
- Server-authoritative amounts and balances. Pricing page/quote dialog numbers must be tied by tests to server constants.
- Mock checkout is clearly labelled in non-production. Test Paddle signatures and webhook behavior locally with controlled fixtures; do not charge real customers.
- Past-due/cancelled banners where the subscription state supports them.

### 7.10 Staff, support, and administrative console

Complete the intended hierarchy and operational workflows without expanding authority:
- Support staff.
- Operations Admin.
- Super Admin (owner-only creation through the CLI).
- Staff login, TOTP and WebAuthn step-up as defined by the actual implementation and audit.
- Server-side five-minute step-up proof per privileged action.
- Approval queue with exact action/payload preview, self-approval prohibited, clear approve/reject outcomes, and full audit history.
- Provider pause/resume, job retry/cancel, support-ticket assignment/notes, removal review, consented support access, and user/workspace investigation according to existing requirements.
- Prevent ordinary Admin from creating/promoting Super Admin.
- Explicit forged-staff-token-without-step-up test.
- Sensitive actions must be authorized, auditable, and reversible where possible.

### 7.11 Settings, data rights, and lifecycle

- Profile/workspace settings and notifications only where supported.
- Account/workspace export, deletion, retention explanation, and blockers.
- Explain export inclusions/exclusions and safely stream or clearly handle more than 50,000 rows.
- Financial records remain retained according to the implemented legal/accounting rule; do not hard-delete restricted financial records.
- Data-rights workflows must report actual outcome and status, not just a success toast.

### 7.12 Operations and integrations

- API and worker startup/configuration checks.
- Database connection and migration reliability.
- Background queues, outbox relay, retry/cancellation, duplicate jobs, and worker restart.
- Provider timeout, rate limit, malformed response, empty result, partial response, and outage paths.
- PostgreSQL-backed rate limiting and provider budget reservations.
- Structured logs with request IDs and redaction.
- /health/live and /health/ready with correct semantics.
- Reasonable caching/invalidation, indexes, paginated APIs, and performance fixes based on measured need.
- Secure configuration and secrets handling.
- Document backup/restore design and perform only local, safe restore drills; do not claim hosted backups or point-in-time recovery are enabled unless verified by an authorized host.

## 8. UI/UX completion and Figma-ready handoff

### 8.1 UI principle: missing design is not a reason to leave a feature unusable

Inspect every route, page, modal, drawer, form, table, filter, menu, chart, and interaction. If a page is missing, build it. If incomplete, finish it. If a backend operation exists without a usable interface, implement the interface. If an interface has no real operation, connect it or display a truthful disabled/unavailable state.

Temporary UI is acceptable as a bridge to Figma only if it is functional, accessible, responsive, coherent with the design system, and connected to real local behavior where that behavior exists. A placeholder must never conceal unfinished backend work.

### 8.2 Required states for asynchronous/interactive screens

For each applicable screen, implement:
- Loading skeleton or progress indicator.
- Empty/first-use state.
- Success state.
- Validation error.
- API error including request ID where available.
- Permission denied.
- Session expired and recovery.
- Offline/network interrupted.
- Long-running operation.
- Partial result.
- Destructive-action confirmation.
- Retry/recovery actions.
- Explicit unavailable capability with reason.

Also test long creator names, long bios, missing images, unusually large numbers, wide tables, narrow viewports, stale data, and realistic collection sizes.

### 8.3 Visual quality and brand

Keep the existing MUSHIN light SaaS visual system: white/slate surfaces, navy primary, and indigo accent. Add one teal/cyan-family accent token for positive or "live" states only. Use the actual Tailwind/CSS variables in frontend/src/styles and the audit's K_UI_UX_SPECIFICATION.md as the source of truth.

Do not redesign the entire application, change the brand, or reskin working pages without evidence. Do not add gradients, glassmorphism, arbitrary card grids, fake charts, meaningless statistics, fake testimonials, fake customer logos, or decorative content that does not serve a user task.

Prioritize:
- Strong information hierarchy and legible typography.
- Consistent spacing and reusable components.
- Clear navigation and contextual actions.
- Useful data tables, filters, sorting, and pagination.
- Search-first creator workflows and realistic creator content.
- Transparent costs, eligibility, result provenance, and operation states.
- Responsive behavior and touch-friendly controls.
- Accessible labels, focus states, keyboard behavior, error descriptions, and contrast.
- Clear microcopy and meaningful recovery options.

### 8.4 Required pages and route inventory

Inventory all real routes from the code and audit before claiming completeness. The following pages must exist if specified in the audit/requirements, including pages missing today:
- Customer authentication/onboarding flows.
- Sign-in and the supported sign-up/confirmation flow.
- Set-new-password / #/reset-password screen.
- Email-confirmation result screen.
- Workspace/team/invitation flows.
- Creator catalogue search and Live Discovery.
- Creator profile, lists, campaigns, outreach, billing/credits, and settings.
- Staff/admin entry and required staff workflows.
- Terms.
- Privacy.
- Refunds.
- Creator Data Notice with visible DRAFT — awaiting legal review banner.
- 404 page.
- Maintenance/degraded-state page or global banner.
- Every additional route discovered from the source, audit, or requirements.

For unavailable capabilities, show a disabled control and a message such as Not available yet — <specific reason>. Never use a button that looks active but has no action.

### 8.5 Responsive/accessibility requirements

- Verify at viewport widths 390, 768, 1280, and 1440 px.
- Use at least 44 px touch targets for important interactive controls where applicable.
- Use dir="auto" for Urdu/user-entered text when appropriate and dir="ltr" for handles, URLs, and technical identifiers.
- Target WCAG 2.2 AA. Run axe against every in-scope page in E2E where the tool supports it, plus a manual keyboard-only pass recorded in the report.
- Test keyboard focus, dialogs, menus, forms, validation, contrast, screen-reader labels, and non-color status cues.

### 8.6 Create the complete design handoff in design/figma/

No Figma access is available in the stated environment. Produce real, complete specification files and be explicit that no actual Figma file was created. If authorized Figma access becomes available, use it; otherwise do not fabricate a link or claim that frames/components were created in Figma.

Start from docs/audit/2026-10-16/K_UI_UX_SPECIFICATION.md, use the audit pack's Figma page IDs 00–23, and take real tokens/components from frontend/src/styles and the existing UI. The handoff must correspond to the actual project rather than an unrelated conceptual redesign.

Create these files:
1. README.md — purpose, structure, usage instructions, design status, and limitations.
2. PRODUCT_UI_SPEC.md — brand, foundations, tokens, typography, spacing, responsive rules, accessibility, component conventions.
3. PAGE_INVENTORY.md — every route/screen, role, permissions, purpose, sections, actions, data, dependencies, all states, responsive behavior, links, current status.
4. COMPONENT_SPEC.md — buttons, icon buttons, inputs, selectors, filters, tables, pagination, creator cards/profiles, platform badges, dialogs, drawers, toasts, alerts, nav, tabs, skeletons, empty states, charts only where useful, credit/pricing components, permission-aware/destructive controls; document variants, states, dimensions, interaction rules, and accessibility.
5. WIREFRAMES.md — detailed screen hierarchy and layout guidance for every page, including major sections, component placement, important interactions, and responsive adaptations.
6. INTERACTION_FLOWS.md — onboarding, workspace switching, existing search, Live Discovery, profile inspection, list management, campaigns, outreach, credits, billing, staff approval/security, provider failures, and recovery.
7. FIGMA_BUILD_GUIDE.md — step-by-step Figma construction guide including pages, frames, components, variants, auto-layout, prototype connections, and responsive versions.
8. FIGMA_IMPLEMENTATION_MAP.csv — each route/component mapped to its specification, real source files, implementation status, and E2E test.
9. DESIGN_GAPS.md — missing design, unresolved decisions, known discrepancies, and follow-up work.

Use a suggested Figma page structure:
- 00 Cover and design principles.
- 01 Foundations and tokens.
- 02 Shared components.
- 03 Authentication and onboarding.
- 04 Main application shell.
- 05 Creator discovery.
- 06 Creator profiles and lists.
- 07 Campaigns and outreach.
- 08 Credits and billing.
- 09 Workspace settings.
- 10 Support and administration.
- 11 Responsive layouts.
- 12 Edge cases and component states.

Reconcile these labels with the existing audit pack's actual page IDs 00–23; do not overwrite its established mapping with an incompatible numbering scheme.

Every page inventory row must identify its route, access role, component/source files, expected behavior, UI states, and associated automated check. Every implementation-map row must point to files and tests that actually exist. Update the handoff whenever a page/component changes. A markdown specification is a design handoff, not a real Figma file.

## 9. Engineering quality beyond the happy path

Apply these checks across the product, not as a one-time checklist detached from implementation.

### Data integrity

- Enforce database relationships, unique constraints, foreign keys, and indexes for critical paths.
- Use transactions where operations must succeed or fail together.
- Prevent duplicate job submissions, double charging, duplicate external side effects, and replayed webhook processing.
- Handle concurrency and retry/idempotency correctly.
- Validate and normalize inputs at system boundaries without changing frozen search outputs.
- Verify migrations on an isolated test database and never edit applied migrations.
- Explicitly test tenant/workspace data isolation, including negative cases.

### Security

Review realistic attack surfaces including authentication bypass, object-level authorization, cross-workspace leakage, privilege escalation, unsafe staff step-up, untrusted email-confirmation metadata, injection, XSS, CSRF where applicable, SSRF, unsafe redirects, file handling, rate limiting, secrets exposure, overly permissive CORS, weak webhook verification, and sensitive data in logs.

Do not add security middleware just to tick a box. Configure it correctly, understand proxy/network assumptions, and test both allowed and denied behavior. Security claims must refer to specific executed tests or clearly state they remain unverified.

### Resilience and recoverability

- Reasonable network/provider timeouts.
- Bounded retries and backoff.
- Clear failure and partial-result states.
- No duplicate side effects from repeated requests.
- Idempotent job and billing operations.
- Recovery for interrupted workers, stalled jobs, and database/service interruption.
- Proper distinction between liveness and readiness.
- Documented local recovery drills and honest hosted-backup limitations.

### Performance

- Inspect expensive queries and missing indexes.
- Paginate large result sets and exports.
- Avoid loading unbounded datasets into browser memory.
- Avoid repeated API calls, unnecessary rendering, and redundant calculations.
- Inspect build output/bundle size and code splitting.
- Test realistic synthetic data volumes before optimizing.

### Maintainability

- Keep frontend contracts aligned to API schemas/types.
- Reuse central validation, permission, and pricing logic.
- Avoid duplicated business logic and magic constants.
- Avoid speculative abstractions and excessive dependencies.
- Remove dead code only after proving it is unused.
- Keep naming, error handling, telemetry, and directory ownership consistent.

## 10. Test strategy, acceptance suite, and evidence

Testing is mandatory. Creating test files is not the same as running tests. Use existing tooling wherever possible; introduce a dependency only when there is a demonstrated need and it is compatible with the actual project versions.

### 10.1 Required test layers

- Unit tests: validation, business rules, credit calculations, permissions, ranking helpers only when search behavior is unfrozen, deduplication, state transitions, and failure handling.
- API/database integration tests: routes, authorization, transactions, migrations, constraints, worker/job behavior, webhooks, and server/client contracts.
- Frontend component tests: forms, accessibility, loading/empty/error/disabled states, and interaction behavior.
- Browser E2E tests: actual local application journeys with synthetic fixtures and isolated E2E authentication stubs.
- Regression tests: every corrected defect gets a reproducible test where practical.
- Security-focused tests: forged tokens, unauthorized workspace access, privilege boundaries, data leakage, and rate limiting.
- Search software-correctness tests, separate from the human relevance evaluation.
- Search relevance results only from the human rating protocol.

### 10.2 Required 20 E2E user journeys

Use a synthetic fixture catalogue and deterministic mocks for every paid/remote provider. Test the real local browser application, not only mocked React handlers.

1. Sign-in, session lifecycle, and sign-out.
2. First workspace creation/onboarding and workspace switching.
3. Role-specific permissions and direct unauthorized URL/API access.
4. Brain 1 catalogue search across multiple query types with the fixture catalogue.
5. Empty search results, invalid filters, and search failure/recovery.
6. Live Discovery brief validation, quote, confirmation, progress, and completion using fixtures/mocks.
7. Live Discovery provider failure and honest partial/failure status.
8. Duplicate creator prevention across search, persistence, and lists.
9. Creator profile inspection, source/freshness, unknown fields, eligibility, and contact states.
10. List creation, creator addition/removal, rename, and deletion where allowed.
11. Campaign creation, stage transitions, creator assignments, and campaign limits.
12. Credit reservation/charge/release, insufficient balance, and failed-operation recovery.
13. Pricing and billing display with sandbox/mock checkout clearly labelled.
14. Outreach creation/tracking with no real messages sent.
15. Contact information availability, verification, permission, and reveal-credit rules.
16. Staff operations, approvals, step-up protection, and restricted administrative actions.
17. Export, deletion, retention explanation, and lifecycle blockers where implemented.
18. Session expiration, unauthorized requests, and recovery without infinite retry loops.
19. Responsive navigation and key flows at 390, 768, 1280, and 1440 px, plus keyboard accessibility checks.
20. Page reload, direct route entry, stale cursor, offline/network interruption, and recovery.

### 10.3 Additional regression journeys tied to known defects

Also test:
- Forged staff token without valid server-side step-up is refused.
- Non-member workspace header receives 403 workspace_access_denied and cannot read or write another workspace's data.
- Switching workspaces in two tabs preserves per-tab selection and sends the correct header.
- Zero-result catalogue search has the current server-defined credit outcome; until D-05 is answered, it remains charged under existing code.
- Live Discovery handles a provider failure mid-run followed by a worker restart without duplicate charge, duplicate creator, or orphaned provider run.
- Every pricing-page and quote-dialog number matches server constants and rules.
- Migration constraints and financial retention rules behave as intended.
- Build output secret scan passes without printing any secret values.

### 10.4 Search acceptance suite — correctness is not relevance

Before the owner authorizes search behavior changes, test only frozen-output-compatible plumbing and reporting. Once rating is authorized, keep these dimensions separate:

Software correctness: determinism where intended, deduplication, credit correctness, persistence, timeout/failure handling, pagination, and provider adapter behavior.

Human relevance acceptance: two independent raters plus adjudication; weighted kappa ≥ 0.60; strict Precision@5 ≥ 0.80; nDCG@10 ≥ 0.75; coverage ≥ 0.90; all behavior cases passing. Report the approved evaluation protocol and actual human-rated data only. A successful unit test or a nice-looking search screen does not establish relevance.

### 10.5 Commands and evidence

Run the applicable project commands, including:
- npm run verify
- npx tsc --noEmit -p frontend/tsconfig.json
- npm --prefix frontend run build
- node --import tsx scripts/check-bundle-secrets.ts frontend/dist
- npm run e2e:customer
- npm run e2e:staff
- node --import tsx scripts/search-eval/freeze-check.ts <queries.csv> when relevant
- Any targeted integration/migration/test commands needed for the gap being fixed.

Check the actual package scripts before use and document any changed command names; do not pretend a nonexistent command was executed. Tests must use the test-database guard and isolated test data.

Every report must use this evidence format for each result: command + commit SHA + exact date + passed/failed/skipped/blocked totals + log path. For example, "847 passed, 0 failed, 4 skipped at abc1234, 2026-10-18." Use that form only when the actual run supports it.

When a test fails, find and fix the root cause where feasible. Otherwise record the failure, exact reproduction steps, expected/actual behavior, severity, and blocker. Never hide it by weakening or deleting the test.

Capture browser screenshots of key screens and failure states when the environment supports it, ensuring they contain no real personal data or secrets.

## 11. Status definitions and completion reports

Use these exact status words for every module and integration:
1. Implemented — the code exists.
2. Locally verified — relevant behavior was exercised successfully through tests or local execution that you actually ran.
3. Integration verified — behavior was exercised against the real dependency, not a mock. In this environment, Supabase, Paddle, Resend, Serper, Apify, YouTube, and hosted LLM services remain unverified unless the owner specifically authorizes real integration testing and it is actually performed.
4. Acceptance verified — defined acceptance criteria passed, including human ratings for Search.
5. Production ready — acceptance plus hosting, monitoring, backups/recovery, legal review, security operations, and owner go/no-go are complete.

A build succeeding does not establish E2E coverage. A mock passing does not verify a real provider. Local functionality does not prove production deployment readiness.

### Required engineering deliverables under docs/completion/

- SYSTEM_BASELINE.md
- REQUIREMENTS_TRACEABILITY.md
- GAP_REGISTER.md
- IMPLEMENTATION_PLAN.md
- DECISION_LOG.md
- PROGRESS.md
- RUNBOOK.md
- TEST_EXECUTION_REPORT.md
- E2E_COVERAGE_MATRIX.md
- SECURITY_REVIEW.md
- SEARCH_ACCEPTANCE_REPORT.md
- RELEASE_READINESS.md
- REMAINING_BLOCKERS.md

The design handoff files listed in §8.6 must also exist under design/figma/.

### Report requirements

- SYSTEM_BASELINE.md: actual stack, current SHA/branch, setup requirements, services, migration state, and baseline test outputs.
- REQUIREMENTS_TRACEABILITY.md: every identified requirement links to implementation, page/route, test, and evidence/status.
- GAP_REGISTER.md: audit IDs, severity, dependencies, status, commit, tests, and blockers.
- IMPLEMENTATION_PLAN.md: current work order and phase-gate results.
- DECISION_LOG.md: resolved decisions, owner questions, recommendations, and consequences.
- PROGRESS.md: session-to-session handover as defined in §0.
- RUNBOOK.md: startup, migration, local recovery drill, key rotation, provider pause, and common diagnostic procedures.
- TEST_EXECUTION_REPORT.md: exact commands, SHA/date, totals, failures, skipped/blocked tests, and log paths.
- E2E_COVERAGE_MATRIX.md: the 20 journeys and additional regression journeys mapped to tests and actual results.
- SECURITY_REVIEW.md: findings addressed, tests executed, remaining risk, and unverified environments.
- SEARCH_ACCEPTANCE_REPORT.md: freeze status, software correctness results, reporting/metrics implementation, human rating status, and explicit acceptance decision.
- RELEASE_READINESS.md: per-module/per-integration status using the exact definitions above; never use "production ready" without evidence for every required gate.
- REMAINING_BLOCKERS.md: specific blocker, why it cannot be cleared here, owner or external action required, and the smallest next step.

### Final response to the owner

Keep the final response concise, direct, and factual. Include:
1. What changed, with commit SHAs and migrations.
2. Module statuses using the exact terms above.
3. Exact verification/build/unit/integration/E2E totals.
4. Search status—NOT ACCEPTED until the required human ratings pass.
5. Which services were tested with fixtures/mocks versus real dependencies.
6. UI routes/pages completed and the design handoff files created; clearly state that no real Figma file was created without access.
7. Security/authorization checks completed and remaining risk.
8. Outstanding owner decisions.
9. Exact remaining blockers and the three most important next actions.
10. Commands required to start the system and reproduce the tests.

Do not provide an optimistic narrative unsupported by evidence. It is better to report an honest partial completion than a false success claim.

## 12. Parallel execution rules

If sub-agents are available, split independent tasks by explicit file ownership and acceptance criteria. No two agents may edit the same file concurrently. The central session owner assigns migration numbers in PROGRESS.md before a worker creates a migration and integrates all changes before a phase gate.

Suggested partition from the audit:
- Agent A — identity/staff security: apps/api/src/auth/**, modules/identity/**, modules/staff/**, modules/staffops/**; first assigned migrations 0038–0039 only if confirmed available.
- Agent B — billing/provider plumbing: modules/billing/**, packages/integrations/src/{scrapers,websearch}/**; next central-assigned migrations, expected 0040+ only after confirmation.
- Agent C — frontend pages and states: frontend/src/**, except frontend/src/api/workspace.ts if Agent A owns it for workspace security.
- Agent D — tests, E2E fixtures, design handoff: scripts/e2e-*/**, scripts/seed-data/**, design/figma/**.

Adjust paths after verifying the real repository structure. Do not assign work to nonexistent directories without investigating. If agents are unavailable, do the work sequentially. In either case, the central integrator must resolve conflicts, run the full suite, inspect the final diff, and confirm the application remains runnable before declaring a phase complete.

## 13. When to stop and ask

Ask the owner only for:
- An unanswered decision in §3.3 that blocks a specific implementation.
- An action that would spend money, send a message, contact creators, touch a remote system, deploy, push, or delete data.
- A security design decision not covered by the pre-approved defaults.
- A requirement conflict that changes what customers are charged, what they can access, or what personal data is disclosed.

Record the question and recommendation in DECISION_LOG.md, ask once, then continue with unrelated work. Do not repeat a question already answered in a later dated owner decision.

Everything else: make a sensible decision, document it, implement it, and test it.

## Final directive

Start by reading this mandate, the progress handover, the audit gap register and roadmap, and the actual Git state. Reconcile any baseline drift; do not redo the audit or discard uncommitted work.

Then execute the prioritized work order. Do not stop at an audit, plan, UI mockup, green build, or report. Finish the actual modules, build functional temporary UI wherever a screen is missing, produce the full Figma-ready handoff, and test the whole feasible system end to end.

The operating loop is: inspect the relevant evidence → research the actual uncertainty → implement a focused change → test → fix → retest → update the gap register and PROGRESS.md → move to the next unblocked item.

Repeat until the acceptance criteria are met or a genuine blocker requires an external action. Never misrepresent what is done, what is verified, or what remains.
