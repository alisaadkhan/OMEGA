# E — Complete gap register

Source of truth: `registers/gap_register.csv` (50 items; same content as below). Generated from one list so the CSV and
this document cannot drift.

**How to read it.**
- **Severity** describes the harm if the gap stays open. *Critical*: blocks a real release or exposes data/money now.
  *High*: serious security, financial, legal or core-function risk before launch. *Medium*: a real defect or missing
  control with a workaround or limited blast radius. *Low*: hygiene.
- **Priority (P0–P3)** is the remediation phase from the brief: P0 immediate security/data-loss/correctness; P1 Search
  acceptance and critical product blockers; P2 production reliability and operations; P3 maintainability. A Critical
  item can sit in P2 when it cannot be done before an earlier dependency (for example OPS-03 needs a hosting decision).
- **Status** uses the brief's vocabulary: Verified · Implemented, not fully verified · Partial · Missing · Conflicting ·
  Blocked.
- **Classification** follows Stage 3: required for the agreed MVP · required for safe production operation · required
  by an applicable external obligation · recommended improvement · optional future enhancement. Each mandatory
  classification is justified by the "Expected (source)" line.
- Evidence tags: **[ran]** executed in this audit (`evidence/VERIFICATION_LOG.md`), **[code]** source inspected,
  **[doc]** written record, **[web]** external source (`D_RESEARCH_REPORT.md`).

**Root causes behind several symptoms.**
1. *Secret hygiene* (SEC-01) amplifies SEC-02, SEC-09, ARCH-07 and blocks OPS-01 (pushing to a remote safely).
2. *No hosted environment* (ARCH-01 undecided) blocks SEC-05, SEC-11, SEC-14, OPS-03, OPS-04, UX-02, SEC-13, BIL-03.
3. *Evidence lives on one machine* (OPS-01, OPS-02): every reported test total is single-machine until CI runs.
4. *Catalogue lifecycle not designed* (SRCH-02) underlies SRCH-03 and the Brain 1 empty-result rate.
5. *Documentation drift* (DOC-01) produced the conflicting orders and stale statuses (see register B).

**Counts.** P0: 9 · P1: 12 · P2: 22 · P3: 7. Critical 5 · High 17 · Medium 21 · Low 7.

## P0

### SEC-01 — Populated secrets shipped inside the shared repository archive

**Severity:** Critical · **Category:** security · **Module:** Secrets / configuration · **Roles:** All · **Status:** Missing · **Classification:** Required for safe production operation · **Owner decision:** Yes — only the owner can rotate external credentials

- **Expected (source):** Secrets never leave the developer machine or a secret manager (pack 13 §Auth; AUTH-002; OWASP API8:2023).
- **Actual (evidence):** [ran] MUSHIN_1.zip contains a populated .env: remote Supabase DATABASE_URL/DIRECT_URL with password, SUPABASE_SERVICE_ROLE_KEY, DATA_ENCRYPTION_KEY, STAFF_JWT_SECRET, Apify, Serper, YouTube, Groq, Ollama, Upstash, HuggingFace, Resend, Meilisearch Cloud keys; plus supabase/.temp/start-secrets/*/docker.env. File is gitignored and absent from git history (good) but the archive was distributed.
- **Impact:** Anyone holding the archive can read/modify the remote database (bypassing RLS via the owner role), decrypt stored creator contacts and staff TOTP secrets, mint staff access tokens (see SEC-02), spend provider budgets and send email.
- **Resolution:** Containment runbook in H §2: treat all as compromised; rotate in dependency order (DB password, Supabase JWT signing keys/service role, STAFF_JWT_SECRET, provider tokens); re-encrypt data under a new DATA_ENCRYPTION_KEY with a key-version column; review provider usage logs and Supabase auth/audit logs since 2026-10-16; remove the archive from every place it was shared; add a pre-archive script that refuses to package ignored files.
- **Alternatives:** If the remote Supabase project holds no real data, deleting and recreating it is simpler than rotation.
- **Acceptance criteria:** Every listed credential has a rotation date after 2026-10-16 recorded in an owner-held log; old values fail authentication (tested by owner); a packaging script produces archives with no .env*, supabase/.temp, or key-shaped strings (scanner passes).
- **Tests:** Secret scanner over any future archive; manual verification that old keys are rejected.

### BIL-01 — Public pricing promises 'you pay only for new creators actually added; nothing if none is found' — settlement charges a base fee for known-only results and a 100-credit TikTok minimum

**Severity:** High · **Category:** functional defect · **Module:** Pricing copy / Live Discovery settlement · **Roles:** Visitor, Owner · **Status:** Conflicting · **Classification:** Required by an applicable external obligation (truthful pricing) · **Owner decision:** Choose: fix copy (recommended) or change rule

- **Expected (source):** Public claims must match server behaviour (pack 01 'Product claims'; PLAN-001; owner decisions 2026-10-14 #1 and #3).
- **Actual (evidence):** [code] frontend lib/plans.ts and landing/Metrics.tsx copy; [code] discovery/live-runner.ts charges min(quote, max(tiktokMinimum, base + new)) whenever any visible creator (known creators included) is delivered; progress.md decision #3 'known-only → 50'.
- **Impact:** Customer-facing misstatement on a paid action; disputes and refunds; consumer-protection risk.
- **Resolution:** Change copy to the real rule: 'A base fee of 50 credits applies when at least one creator is delivered; each new creator costs 10; runs that include TikTok cost at least 100. If nothing is delivered you pay nothing.' Show the same in the quote dialog (minimumCredits already returned).
- **Alternatives:** Change the settlement rule instead (owner decision).
- **Acceptance criteria:** plans-claims.test asserts the copy matches settlement constants; quote dialog shows base, per-creator and minimum.
- **Tests:** Unit test over copy constants; E2E checks quote text.

### OPS-01 — Prepared CI would fail on first run and has never run; nothing since 10 Oct is on the remote

**Severity:** High · **Category:** testing · **Module:** CI / release engineering · **Roles:** — · **Status:** Partial · **Classification:** Required for safe production operation · **Owner decision:** Choose remote host (GitHub private repo)

- **Expected (source):** Required checks on each PR (pack 04 Phase 3); readiness README 'CI prepared, not run'.
- **Actual (evidence):** [ran] Without a developer .env, scrapers.live.int.test.ts throws ConfigError at collection (vitest exit 1). ci.yml does not set DATABASE_URL/DIRECT_URL/DATA_ENCRYPTION_KEY. [ran] The only git remote is a local bundle file last updated 2026-10-10; 84 commits exist only on the developer machine and in this archive.
- **Impact:** No independent build evidence; single-machine risk of losing six days of work; reported totals depend on a secret-bearing .env.
- **Resolution:** Move loadWorkerConfig inside the test (or guard with skipIf before reading env); push master to a private hosted remote (after SEC-01 hygiene); run CI; make CI green the merge gate.
- **Alternatives:** Provide dummy non-secret values in ci.yml env.
- **Acceptance criteria:** A clean checkout with no .env runs `npm run verify` green; CI run URL recorded with commit SHA.
- **Tests:** CI itself.
- **Depends on:** SEC-01 (push only after secret hygiene)

### SEC-02 — Hardware-key step-up is a claim inside an HS256 token: whoever holds STAFF_JWT_SECRET bypasses WebAuthn

**Severity:** High · **Category:** security · **Module:** Staff auth / WebAuthn step-up · **Roles:** Admin, Super Admin · **Status:** Partial · **Classification:** Required for safe production operation · **Owner decision:** No (engineering) — but staff-auth target (OD-005) is the owner's

- **Expected (source):** Admin/Super Admin actions require proof of a hardware key in the current session (owner decision 2026-10-14 #13; NIST SP 800-63B-4 AAL3 phishing resistance).
- **Actual (evidence):** [code] apps/api/src/modules/staff/tokens.ts signs access tokens with HS256 and carries amr:['otp','hwk']; HARDWARE_KEY_ACTIONS trust the amr claim. Role/status are re-checked per request (isActive) but the hwk factor is not bound to any server-side record. The secret is exposed (SEC-01).
- **Impact:** With the secret and a staff id (readable from the exposed DB), an attacker issues a Super Admin token with hwk and performs every privileged action.
- **Resolution:** Rotate STAFF_JWT_SECRET; store each step-up as a server-side row (staff_id, session family, credential ref, expires_at) and check it per privileged request instead of trusting amr; shorten step-up validity (e.g. 5 min) for approvals; consider asymmetric signing so only the API holds the private key.
- **Alternatives:** Move staff identity to Supabase Auth with MFA (OD-005) and keep WebAuthn as server-verified step-up rows.
- **Acceptance criteria:** A token with forged amr:hwk but no matching step-up row receives 403 on every HARDWARE_KEY_ACTION; step-up rows expire; test exists.
- **Tests:** Integration test: forged token (valid signature, no step-up row) is refused; expired step-up refused.
- **Depends on:** SEC-01

### SEC-03 — Invitation acceptance trusts user-editable user_metadata.email_verified

**Severity:** High · **Category:** security · **Module:** Team invitations · **Roles:** Owner, Admin, invitee · **Status:** Implemented, not fully verified · **Classification:** Required for agreed MVP (S2 invitations are built) · **Owner decision:** No

- **Expected (source):** Only the invited, verified email can accept (0035 header; team.ts comment).
- **Actual (evidence):** [code] auth/customer-token.ts sets emailVerified from payload.user_metadata.email_verified; team.ts accept() relies on it. [web] Supabase docs: user_metadata 'can be modified by authenticated end users' and is not suitable for authorization.
- **Impact:** If the Supabase project allows sessions before email confirmation (or an OAuth provider with unverified email), a person who signs up with the invitee's address and edits their own metadata can join the workspace with a forwarded or leaked link.
- **Resolution:** Derive verification from a server-trusted source: enable 'Confirm email' and treat any session as confirmed only via app_metadata set by a custom access-token hook (email_confirmed_at), or look up auth.users.email_confirmed_at with the service role at accept time.
- **Alternatives:** Bind invitation tokens to a one-time code emailed to the invitee (requires email provider).
- **Acceptance criteria:** A token whose user_metadata.email_verified=true but whose app_metadata/auth record shows unconfirmed email cannot accept (403 email_unverified).
- **Tests:** Unit test on the verifier; integration test with a stub token carrying user_metadata only.
- **Depends on:** Real Supabase project (OD-004)

### SEC-04 — Silent fallback to another workspace when X-Workspace-Id is not one of the user's memberships

**Severity:** High · **Category:** security · **Module:** Tenant resolution · **Roles:** All customer roles · **Status:** Conflicting · **Classification:** Required for agreed MVP · **Owner decision:** No

- **Expected (source):** Reject mismatched workspace IDs (pack 02 §5 'reject mismatched workspace IDs'; AUTH-001).
- **Actual (evidence):** [code] identity/repository.ts findMembership returns rows.find(requested) ?? rows[0]: a stale/removed workspace id silently resolves to the user's oldest workspace. [code] frontend api/workspace.ts keeps the selection in localStorage shared by all tabs.
- **Impact:** After removal from a workspace, or after switching in another tab, writes (list additions, campaign edits, paid searches, Live Discovery quotes) land in a different workspace than the screen shows; credits are spent from the wrong balance.
- **Resolution:** When a workspace is requested and is not a membership, return 403 workspace_access_denied (no fallback); only fall back when no header is sent; echo the resolved workspace id in a response header and have the client verify it; store the selection per tab (sessionStorage) and broadcast switches.
- **Alternatives:** Adopt workspace-scoped paths (/v1/workspaces/{id}/...) as in the target OpenAPI (OD-012).
- **Acceptance criteria:** Request with a non-member workspace id → 403 and no state change; client shows 'You no longer have access to <name>'; two-tab test shows no cross-workspace write.
- **Tests:** Integration test for 403; E2E two-tab switch test.

### SEC-05 — Client IP is not established behind a proxy (no trustProxy policy)

**Severity:** High · **Category:** security · **Module:** API edge / rate limits · **Roles:** All · **Status:** Missing · **Classification:** Required for safe production operation · **Owner decision:** Hosting choice (OD-003)

- **Expected (source):** Per-IP limits on every route (RATE-001; OWASP API4:2023).
- **Actual (evidence):** [code] app.ts creates Fastify without trustProxy; rate-limit/plugin.ts keys the ip bucket on req.ip. [web] Fastify: default false; forwarded headers are spoofable unless the proxy chain is explicitly trusted.
- **Impact:** Behind any CDN/load balancer every customer shares the proxy's IP: 120 requests/minute for the whole product (self-inflicted outage). If later set to true naively, attackers spoof X-Forwarded-For and evade IP limits.
- **Resolution:** Configure trustProxy with the chosen host's exact proxy CIDRs (or the platform's documented client-IP header); add a startup check that refuses production without it; test ip derivation.
- **Alternatives:** Drop the IP bucket for authenticated routes and rely on user/workspace buckets; keep IP limits only for unauthenticated routes.
- **Acceptance criteria:** In staging behind the real proxy, two clients from different IPs have independent buckets; a spoofed X-Forwarded-For from outside the trusted range is ignored.
- **Tests:** Unit test of IP derivation; staging smoke test.
- **Depends on:** ARCH-01 hosting choice

### SRCH-04 — Apify run IDs are not persisted before waiting; crash or timeout can orphan paid runs and start duplicates

**Severity:** High · **Category:** reliability · **Module:** Brain 2 / Apify adapter · **Roles:** Owner (credits), MUSHIN (COGS) · **Status:** Missing · **Classification:** Required for safe production operation · **Owner decision:** No

- **Expected (source):** Store provider run reference immediately after creation; reconcile unknown outcomes before retry (pack 15 Job recovery 3–5; JOB-001/002; LIVE-004).
- **Actual (evidence):** [code] packages/integrations/src/scrapers/apify.ts runActor starts a run and polls in-process; run.id lives only in memory; abort only on the in-process deadline. No maxTotalChargeUsd/maxItems/runTimeoutSecs passed ([web] Apify ActorStartOptions supports them). Worker retry (pg-boss retryLimit 5) re-runs the batch; archive check avoids re-fetching only completed profiles.
- **Impact:** Worker crash/deploy during a run → the run continues charging Apify, its cost is never recorded in provider_calls (spend caps undercount), and the retry pays again.
- **Resolution:** Persist {provider, run_id, job_id, batch_key, started_at} before polling; on retry, resume polling the stored run; pass maxTotalChargeUsd (pay-per-event) and runTimeoutSecs; nightly reconciliation of Apify runs vs provider_calls via Apify API.
- **Alternatives:** Use Apify webhooks to a signed endpoint for completion.
- **Acceptance criteria:** Kill the worker mid-run in a test: on restart the same run_id is resumed, no second run is started, cost recorded once.
- **Tests:** Integration test with fake Apify server and process kill; reconciliation job test.

### BIL-05 — Financial tables cascade-delete with the workspace row

**Severity:** Medium · **Category:** architecture · **Module:** Billing schema · **Roles:** — · **Status:** Partial · **Classification:** Required for safe production operation · **Owner decision:** Retention period (OD-013)

- **Expected (source):** Ledger is append-only and retained for accounting (pack 07; 0035 header 'billing records are KEPT').
- **Actual (evidence):** [ran] FK confdeltype='c' for wp.credit_ledger, wp.credit_lots, wp.payments, wp.subscriptions → wp.workspaces.
- **Impact:** Any hard delete (manual SQL, future cleanup job, staff tool) silently destroys billing evidence.
- **Resolution:** Migration: change those FKs to ON DELETE RESTRICT (or NO ACTION) and add a trigger refusing DELETE on wp.workspaces unless status='deleted' and a retention period has passed.
- **Alternatives:** Revoke DELETE on wp.workspaces from every role.
- **Acceptance criteria:** DELETE FROM wp.workspaces with ledger rows fails; erase_workspace still works.
- **Tests:** Migration integration test.


## P1

### SRCH-01 — Search is NOT ACCEPTED: no human relevance ratings exist

**Severity:** Critical · **Category:** testing · **Module:** Search (Brain 1 + Brain 2) · **Roles:** All customers · **Status:** Blocked · **Classification:** Required for the agreed MVP · **Owner decision:** Yes (raters, final acceptance)

- **Expected (source):** Two raters + adjudication; gates kappa ≥ 0.6, strict P@5 ≥ 0.80, nDCG@10 ≥ 0.75, coverage ≥ 90%, all behaviour cases (owner 2026-10-14/15; OD-007).
- **Actual (evidence):** [ran] Kits exist (222 B1 rows, 35 B1 cases, 131 B2 rows, 25 B2 cases per rater = 413 judgements); no returned ratings anywhere in the archive.
- **Impact:** No evidence that MUSHIN finds relevant creators; the core value proposition is unproven.
- **Resolution:** Run the rating round on the published timetable (raters named by 2026-10-20) with the protocol amendments proposed in F §6 (as proposals, not silent changes).
- **Alternatives:** None for acceptance.
- **Acceptance criteria:** score.ts reports with kappa and all gates, adjudicated, for both brains; owner records a pass/fail decision.
- **Tests:** Human evaluation.
- **Depends on:** Owner names raters

### SRCH-02 — Catalogue self-empties: no scheduled refresh, 90-day count rule and 30-day YouTube retention

**Severity:** Critical · **Category:** architecture · **Module:** Creator catalogue lifecycle · **Roles:** All customers · **Status:** Missing · **Classification:** Required for the agreed MVP · **Owner decision:** Yes — refresh budget and priority policy

- **Expected (source):** Brain 1 searches real persisted, eligible, fresh creators (CAT-001; elig-1 90-day rule; DATA-004 YouTube 30-day).
- **Actual (evidence):** [code] worker/schedules.ts has no refresh job; refresh only on customer request (50 credits) or Live Discovery. eligibility.ts drops creators whose count is older than 90 days; expire_youtube_api_data clears YouTube metrics after 30 days without refresh. customer-e2e-report.md: fixture catalogue stops being eligible ~2027-01-11.
- **Impact:** Without paid refreshes the catalogue shrinks to zero; YouTube-primary creators vanish after 30 days; Brain 1 results decay continuously.
- **Resolution:** Budgeted, prioritised refresh scheduler (creators most saved/searched first) under a monthly provider cap; YouTube API refresh within 30 days (YouTube API is quota-free in USD); metrics-only cheap actor runs; dashboard of eligible-catalogue size over time with an alert.
- **Alternatives:** Accept decay and present Brain 1 as 'recently verified creators' only; or license a data provider.
- **Acceptance criteria:** Simulated 120-day clock run keeps ≥ X% (owner-set) of the eligible catalogue eligible within the configured monthly budget; alert fires when eligible count drops > 10% week over week.
- **Tests:** Integration test with pinned clock; cost-cap test.
- **Depends on:** OD-008 provider spend; SRCH-04

### UX-01 — Terms of Service and Privacy Policy do not exist, yet sign-up says the user agrees to them

**Severity:** Critical · **Category:** missing feature · **Module:** Public site / legal · **Roles:** Visitor · **Status:** Missing · **Classification:** Required by an applicable external obligation · **Owner decision:** Yes

- **Expected (source):** Lawful collection and transparency (pack 13; brief Stage 2 §9); readiness README 'Legal: blocked'.
- **Actual (evidence):** [code] components/auth/Signup.tsx line 143 text; App.tsx routes have no terms/privacy pages.
- **Impact:** Unenforceable consent; regulatory and platform-terms exposure; payment providers (Paddle) require published terms/privacy/refund policies.
- **Resolution:** Legal drafts (qualified advice) for Terms, Privacy Policy (customers and creators), Refund policy, Creator data notice; publish as static pages; link from signup, footer, removal page.
- **Alternatives:** None.
- **Acceptance criteria:** Pages reachable without sign-in; signup links work; versions recorded with acceptance timestamp per user.
- **Tests:** E2E link check; DB check of acceptance version.
- **Depends on:** Legal review

### ARCH-01 — Two incompatible target architectures are both recorded as current direction

**Severity:** High · **Category:** architecture · **Module:** Target architecture · **Roles:** — · **Status:** Conflicting · **Classification:** Required for safe production operation · **Owner decision:** Yes

- **Expected (source):** One approved target (OD-003).
- **Actual (evidence):** [doc] supabase-migration-map.md: 'Owner direction 2026-10-14: Supabase becomes the backend (Edge Functions, pgmq, pg_cron)'. [doc] Reconciled pack 00/01/03 (14 Oct): 'Do not migrate to Supabase Edge Functions/pg_cron'. [web] Edge Functions: 2 s CPU per request, 150/400 s wall clock, 256 MB; native addon support undocumented; code uses @node-rs/argon2 (native), long Apify polling, LLM calls.
- **Impact:** Work may be spent porting a tested backend for no product gain, or production hosting stays undecided.
- **Resolution:** Recommendation (engineering judgement, D §2): keep the Node API + pg-boss worker as two small always-on containers; adopt Supabase for PostgreSQL, Auth, Storage only. Revisit Edge Functions only for stateless webhooks if a measured need exists.
- **Alternatives:** Full Edge Function port per migration map (higher effort, re-verification of every invariant).
- **Acceptance criteria:** An ADR signed by the owner; the other document marked superseded.
- **Tests:** —

### BIL-02 — Every new catalogue search costs 50 credits even when it returns nothing

**Severity:** High · **Category:** UX · **Module:** Catalogue Search pricing · **Roles:** Owner, Member · **Status:** Conflicting · **Classification:** Recommended improvement · **Owner decision:** Yes

- **Expected (source):** Owner pricing 2026-10-14: 50 credits per logical search; pack 09: empty/insufficient Live Discovery charges zero; search behaviour 'no suitable creators → say so'.
- **Actual (evidence):** [code] creators/search-charge.ts charges after the search answers regardless of result count. Trial grants 200 credits (0005) = 4 searches; Starter 2,500 = 50 searches/month; a spelling correction is a new search.
- **Impact:** With 25 of 35 panel queries empty today, most early searches would be paid empty answers; strong trial-to-paid friction.
- **Resolution:** Owner decision; recommended: zero-result searches free (release instead of commit) and refinements of the same search within 30 minutes free.
- **Alternatives:** Keep charge but show 'No results — 50 credits refunded' credit; or lower the price.
- **Acceptance criteria:** A search returning 0 results leaves the balance unchanged and records a zero charge row.
- **Tests:** search-charge.int.

### DOC-01 — Reconciled documentation candidate is already stale and contradicts repository and owner decisions

**Severity:** High · **Category:** documentation · **Module:** Documentation set · **Roles:** — · **Status:** Conflicting · **Classification:** Required for safe production operation · **Owner decision:** Yes (several items)

- **Expected (source):** Single source of truth (brief Stage 2 §14).
- **Actual (evidence):** See B_DOCUMENTATION_INVENTORY_AND_DISCREPANCIES.md (26 discrepancies, DIS-01..DIS-26).
- **Impact:** Implementers follow contradictory instructions (e.g. two sessions received different orders).
- **Resolution:** Adopt the discrepancy register decisions; mark superseded text; one progress record; date and commit-stamp every status claim.
- **Alternatives:** —
- **Acceptance criteria:** Every DIS item closed with a decision and edited files.
- **Tests:** Doc link check.

### OPS-02 — Browser E2E cannot be reproduced from the repository

**Severity:** High · **Category:** testing · **Module:** E2E harness · **Roles:** — · **Status:** Partial · **Classification:** Required for safe production operation · **Owner decision:** No

- **Expected (source):** Reproducible tests (pack 04 Phase 0, 14).
- **Actual (evidence):** [ran] scripts/e2e-*/run.sh clone mushin_e2e_template, built from the developer's mushin_local, not in the repo.
- **Impact:** 3 × 102/102 and 3 × 31/31 are single-machine claims; CI cannot run them.
- **Resolution:** Commit a synthetic, clearly-labelled fixture catalogue (no real creator data, no YouTube API data) and a seed script that builds the template; run E2E in CI nightly.
- **Alternatives:** Store an encrypted template dump outside git (still single-owner).
- **Acceptance criteria:** Fresh clone + `npm run e2e:customer` passes in CI.
- **Tests:** CI nightly job.
- **Depends on:** OPS-01

### SRCH-03 — Catalogue and evaluation coverage are too small to support market claims; TikTok is essentially unevaluated

**Severity:** High · **Category:** missing feature · **Module:** Catalogue coverage · **Roles:** All customers · **Status:** Partial · **Classification:** Required for the agreed MVP · **Owner decision:** Yes — launch scope per platform

- **Expected (source):** Pakistan-first catalogue across Instagram, TikTok, YouTube (pack 02 §1).
- **Actual (evidence):** [doc] local catalogue 21 creators; [ran] evaluation corpus 455 creators, 204 eligible; Brain 1 rated rows: Instagram 152, YouTube 65, TikTok 5; Brain 2: Instagram 63, YouTube 55, TikTok 13; city column 'unknown' in all 353 rated rows; only 4 of 35 B1 queries and 2 of 25 B2 briefs are in Urdu script.
- **Impact:** Even a passing rating round says nothing about TikTok, Urdu-script queries, or city-level accuracy.
- **Resolution:** State the scope of any acceptance explicitly ('Instagram/YouTube, English/Roman Urdu'); plan a second, capped evaluation round focused on TikTok and Urdu after a capped live pilot.
- **Alternatives:** Defer TikTok from the launch scope.
- **Acceptance criteria:** Acceptance report lists per-platform and per-script sample sizes and confidence intervals; no claim beyond them.
- **Tests:** Evaluation round 2.
- **Depends on:** SRCH-01, OD-008

### SRCH-13 — Evaluation design limits what the gates can show

**Severity:** High · **Category:** testing · **Module:** Evaluation protocol · **Roles:** — · **Status:** Partial · **Classification:** Required for the agreed MVP · **Owner decision:** Yes

- **Expected (source):** Valid, interpretable search metrics (brief Stage 4).
- **Actual (evidence):** [ran] Brain 1: only 10 of 35 queries return any result (53 result rows); 10 queries have nothing to rate; P@5 divides by min(5, n) so a single relevant result scores 1.0; pools are drawn from MUSHIN's own corpus/variants; 47 of 86 B1 creators appear in several queries; unweighted 3-class kappa; Brain 2 rows come from replay.
- **Impact:** P@5 over ≤ 10 queries has wide uncertainty; coverage may be undefined or flattering; pass/fail could be decided by one or two queries.
- **Resolution:** Proposals in F §6 (report n and bootstrap CIs, report standard P@5 alongside, weighted kappa + raw agreement, label Brain 2 as replay, add a precommitted 'inconclusive' outcome). Owner approves before rating starts; thresholds unchanged.
- **Alternatives:** Run as is and interpret conservatively.
- **Acceptance criteria:** Owner-approved protocol version recorded before kits are sent.
- **Tests:** metrics.test additions.

### UX-02 — Email confirmation and password-recovery links are untested and likely broken with the hash router

**Severity:** High · **Category:** functional defect · **Module:** Customer auth flows · **Roles:** Visitor, customer · **Status:** Blocked · **Classification:** Required for the agreed MVP · **Owner decision:** No

- **Expected (source):** Sign-up, recovery, verification, session refresh tested against real Supabase (OD-004; pack 14).
- **Actual (evidence):** [code] lib/supabase.ts uses default flow with detectSessionInUrl; App.tsx is a #/ hash router; resetPasswordForEmail redirects to /#/login and no PASSWORD_RECOVERY handler or set-new-password screen exists (password change only in Settings).
- **Impact:** Users who forget passwords may be unable to reset; confirmation links may land on a broken route.
- **Resolution:** Use PKCE flow (code in query string), add /#/reset-password screen handling PASSWORD_RECOVERY, test every Supabase email link in a staging project with custom SMTP.
- **Alternatives:** Switch to a path router.
- **Acceptance criteria:** Staging: sign-up confirmation, recovery (new password set), email change and magic links all complete in a real browser.
- **Tests:** Staging E2E with real Supabase test project.
- **Depends on:** OD-004, custom SMTP (D §4)

### SRCH-06 — Negative constraints and instructions are silently dropped

**Severity:** Medium · **Category:** UX · **Module:** Brain 1 query understanding · **Roles:** Searchers · **Status:** Partial · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** Support negative filters (brief Stage 4); explain how the query was understood (CAT-005).
- **Actual (evidence):** [code] creators/understand.ts NOT_A_TOPIC removes whole clauses containing exclude/avoid/do not/except; response 'understood' does not list what was removed. Panel Q023 'do not show creators outside Lahore'.
- **Impact:** Users believe exclusions were applied when they were ignored.
- **Resolution:** Return `ignored: [{text, reason}]` in the search response and show a chip 'Not applied: …'; where an exclusion maps to a supported filter (city, platform), apply it as an explicit negative filter.
- **Alternatives:** Refuse queries with exclusions and ask the user to use filters.
- **Acceptance criteria:** Q023-style query shows a visible 'not applied' notice or applies the exclusion; behaviour case passes.
- **Tests:** understand.test; E2E.
- **Depends on:** Search freeze lifted after ratings

### SRCH-07 — Unknown filter keys are silently ignored (panel Q021 'platforms' returned TikTok creators for an Instagram filter)

**Severity:** Medium · **Category:** functional defect · **Module:** Search contract · **Roles:** Searchers, API clients · **Status:** Conflicting · **Classification:** Required for the agreed MVP · **Owner decision:** No

- **Expected (source):** Request validation rejects malformed input (pack 06; OWASP API3/API8).
- **Actual (evidence):** [ran] Q021 filters {platforms:[instagram],...} → 88 results incl. TikTok rows in the rater sheet; contracts/search.ts z.object strips unknown keys.
- **Impact:** Typos or stale clients get unfiltered results and are charged for them; the evaluation behaviour case is mis-specified.
- **Resolution:** Make search filter schemas .strict() (400 on unknown keys); correct the panel query (platform) in a new protocol version.
- **Alternatives:** Accept and map known aliases (platforms→platform).
- **Acceptance criteria:** POST /v1/search with an unknown filter key → 400 validation_failed naming the key.
- **Tests:** Contract test.


## P2

### OPS-03 — No staging/production environment, error reporting, metrics or alert delivery

**Severity:** Critical · **Category:** operational readiness · **Module:** Deployment / observability · **Roles:** Staff · **Status:** Missing · **Classification:** Required for safe production operation · **Owner decision:** Vendor choice

- **Expected (source):** OPS-001..004; pack 15; launch gate 5.
- **Actual (evidence):** [doc][code] alerts computed in staffops (ALERT_THRESHOLDS) and logged only; no Sentry/OTel/uptime; no deploy config.
- **Impact:** Incidents (stuck queue, provider outage, credit mismatch) are invisible until a customer complains.
- **Resolution:** Staging environment on the chosen host; error reporting; uptime check on /health/ready; alert channel (email via Resend or a chat webhook) for the existing ALERT_THRESHOLDS and credit reconciliation mismatches.
- **Alternatives:** Host-provided logs + a single uptime monitor for the pilot.
- **Acceptance criteria:** A forced worker stop raises an alert within 10 minutes to a human; a thrown API error appears in the error tracker with request id.
- **Tests:** Game-day drill.
- **Depends on:** ARCH-01

### BIL-03 — Real payment path unverified; seller eligibility for a Pakistan-based business unconfirmed

**Severity:** High · **Category:** missing feature · **Module:** Payments · **Roles:** Owner · **Status:** Blocked · **Classification:** Required for the agreed MVP (paid launch) · **Owner decision:** Yes

- **Expected (source):** BILL-001..003; OD-009.
- **Actual (evidence):** [code] mock provider only; Paddle keys empty. [web] Paddle's public country list covers buyer countries; seller/payout eligibility must be confirmed with Paddle.
- **Impact:** No revenue path until confirmed; possible re-platform of billing.
- **Resolution:** Owner confirms seller onboarding with Paddle in writing; sandbox end-to-end (subscribe, renew, cancel, refund, failed payment) with signed webhooks.
- **Alternatives:** Local gateways (owner research) behind the same PaymentProvider interface.
- **Acceptance criteria:** Sandbox journey recorded; webhook replay and duplicate tests pass against real signatures.
- **Tests:** Sandbox E2E.
- **Depends on:** Paddle account

### OPS-04 — Backup/restore not established for the hosted database, storage objects or encryption key

**Severity:** High · **Category:** operational readiness · **Module:** Backup / DR · **Roles:** — · **Status:** Partial · **Classification:** Required for safe production operation · **Owner decision:** RPO/RTO and PITR budget

- **Expected (source):** OPS-002; pack 15 Backups/restore.
- **Actual (evidence):** [doc] local restore drill only. [web] Supabase Pro: daily backups 7 days (RPO up to a day); PITR add-on from about USD 100/month and needs ≥ Small compute; Storage API objects are NOT in database backups.
- **Impact:** Data loss up to 24 h; raw payloads/avatars unrecoverable; restore of a backup can resurrect erased creators and expired YouTube data.
- **Resolution:** Owner sets RPO/RTO; choose daily vs PITR; back up DATA_ENCRYPTION_KEY separately; document a restore procedure that re-applies erasures/suppressions and YouTube expiry after restore; run a hosted restore drill.
- **Alternatives:** Nightly logical dump to separate object storage in addition to Supabase backups.
- **Acceptance criteria:** Hosted restore drill restores to a new project, passes consistency checks and re-applies erasure list; times recorded vs RTO.
- **Tests:** Drill.
- **Depends on:** ARCH-01

### SRCH-10 — Every Brain 2 number since 13 Oct is replay; live provider behaviour is unverified

**Severity:** High · **Category:** testing · **Module:** Brain 2 live behaviour · **Roles:** — · **Status:** Blocked · **Classification:** Required for the agreed MVP · **Owner decision:** Yes (spend)

- **Expected (source):** Paid-provider gate (OD-008; release gate 3).
- **Actual (evidence):** [doc] search-quality.md labels all Brain 2 runs REPLAY; recordings from 13–14 Oct.
- **Impact:** Actor schema drift, Serper result changes, real costs and latency are unknown.
- **Resolution:** Capped live pilot (e.g. ≤ 25 briefs, USD cap set by owner, Serper ≤ N searches) after SRCH-04; compare live vs replay funnel per brief.
- **Alternatives:** —
- **Acceptance criteria:** Pilot report: per-brief funnel, cost per delivered eligible creator, latency, failures; delta vs replay explained.
- **Tests:** Pilot.
- **Depends on:** SRCH-04, OD-008

### ARCH-07 — SUPABASE_URL and JWKS_URI point to different Supabase projects in the developer .env

**Severity:** Medium · **Category:** operational readiness · **Module:** Configuration · **Roles:** — · **Status:** Conflicting · **Classification:** Required for safe production operation · **Owner decision:** No

- **Expected (source):** One project per environment.
- **Actual (evidence):** [ran] host comparison (values not printed).
- **Impact:** Real sign-in fails or validates against the wrong project.
- **Resolution:** Derive JWT_ISSUER and JWKS_URI from SUPABASE_URL in config validation; fail start-up on mismatch.
- **Alternatives:** —
- **Acceptance criteria:** Config refuses mismatched hosts.
- **Tests:** config.test.
- **Depends on:** SEC-01

### BIL-06 — Several live runs can run at once per workspace (unique only per search hash)

**Severity:** Medium · **Category:** reliability · **Module:** Live Discovery concurrency · **Roles:** Owner · **Status:** Conflicting · **Classification:** Required for safe production operation · **Owner decision:** Confirm default

- **Expected (source):** 1 active live job per workspace by default (pack 08 §3).
- **Actual (evidence):** [ran] index discovery_jobs_one_open_live on (workspace_id, search_hash).
- **Impact:** Provider concurrency spikes; a workspace can burn its balance in parallel runs.
- **Resolution:** Add partial unique index on (workspace_id) where kind='live' and status in (queued,running), or a plan-based limit.
- **Alternatives:** Queue extra runs.
- **Acceptance criteria:** Second concurrent live confirm → 409 with the open job.
- **Tests:** live-service.int.

### OPS-05 — Two DB round-trips per request for rate limiting on a 10-connection pool

**Severity:** Medium · **Category:** performance · **Module:** Rate limiter / DB load · **Roles:** — · **Status:** Implemented, not fully verified · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** Measure Postgres load before adding infrastructure (pack 08 §6).
- **Actual (evidence):** [code] ip bucket in onRequest + user bucket in guard, each `withSystem` transaction; pool max 10 (API) / 5 (worker).
- **Impact:** Under load, limiter writes compete with product queries; risk of pool exhaustion on Supabase pooler limits.
- **Resolution:** Load test at 2× pilot peak on staging; if needed combine buckets into one function call or move IP limiting to the edge (host/WAF).
- **Alternatives:** In-process token bucket in front of the DB limiter.
- **Acceptance criteria:** At 2× pilot peak, p95 search ≤ 800 ms and no pool timeouts.
- **Tests:** Load test.
- **Depends on:** Staging

### SEC-06 — Upstash limiter (fails open) is auto-selected whenever Upstash variables exist — including the current .env

**Severity:** Medium · **Category:** security · **Module:** Rate limiting · **Roles:** All · **Status:** Conflicting · **Classification:** Required for safe production operation · **Owner decision:** No

- **Expected (source):** Owner/Supabase-map target: PostgreSQL counters, fail closed (RATE-001; 0034).
- **Actual (evidence):** [code] core/config.ts rateLimitStore() → 'upstash' if UPSTASH vars set; rate-limit/upstash.ts allows requests on Redis errors; the uploaded .env sets both Upstash variables.
- **Impact:** The developer environment is not running the configuration the records describe; an Upstash outage disables all limits including paid-start limits.
- **Resolution:** Default to postgres unless RATE_LIMIT_STORE=upstash explicitly; refuse upstash in production or make paid-start buckets fail closed; remove Upstash access cache or make it explicit.
- **Alternatives:** Remove Upstash entirely (ARCH-03).
- **Acceptance criteria:** With Upstash vars present and no explicit store, the API uses postgres (startup log); paid starts fail closed on limiter error.
- **Tests:** config.test; limiter test.

### SEC-07 — First hardware key can be enrolled from a password + TOTP session

**Severity:** Medium · **Category:** security · **Module:** Staff WebAuthn enrolment · **Roles:** Admin, Super Admin · **Status:** Partial · **Classification:** Required for safe production operation · **Owner decision:** No

- **Expected (source):** Admin requires hardware key (DOC-029); TOTP is not phishing-resistant ([web] NIST SP 800-63B-4).
- **Actual (evidence):** [code] staff/webauthn.ts registrationOptions allows the first key without hwk.
- **Impact:** A phished password+TOTP for a not-yet-enrolled Admin lets the attacker enrol their own key and gain hwk privileges.
- **Resolution:** First enrolment requires an approval (Super Admin co-sign) or a one-time enrolment code issued out of band by the bootstrap script; alert on every enrolment.
- **Alternatives:** Enrol keys only at account creation via the CLI.
- **Acceptance criteria:** An Admin without keys cannot complete enrolment without the approval/code.
- **Tests:** webauthn.int.
- **Depends on:** SEC-02

### SEC-08 — Raw bios with emails/phone numbers are returned in profile payloads, bypassing the reveal control

**Severity:** Medium · **Category:** privacy · **Module:** Creator profile payloads · **Roles:** Customers, raters · **Status:** Conflicting · **Classification:** Required for the agreed MVP · **Owner decision:** Yes

- **Expected (source):** CONTACT-001: raw contact values absent from normal payloads; reveal is dedicated, audited, charged.
- **Actual (evidence):** [code] creators/service.ts returns bio verbatim; rules.ts has redactContacts but it is used only for LLM prompts and trails. [ran] Rater sheets contain a phone number and an email fragment in bio excerpts.
- **Impact:** Inconsistent privacy model; paid reveal can be bypassed; contact data spreads into exports and rater files.
- **Resolution:** Owner decides policy; recommended: redact contact patterns in bios in every customer payload and in evaluation sheets, and offer reveal for bio-derived contacts.
- **Alternatives:** Keep public bios verbatim and make reveal free for bio-sourced contacts.
- **Acceptance criteria:** No email/phone pattern appears in /v1/creators/:id or search payloads (test with fixtures).
- **Tests:** Contract test with contact-bearing bio fixture.

### SEC-09 — No key versioning for DATA_ENCRYPTION_KEY; rotation requires an unbuilt re-encryption tool

**Severity:** Medium · **Category:** security · **Module:** Encryption at rest · **Roles:** — · **Status:** Missing · **Classification:** Required for safe production operation · **Owner decision:** No

- **Expected (source):** Secrets rotation (pack 13).
- **Actual (evidence):** [code] core/crypto.ts AES-256-GCM with a single key; ciphertext has no key id.
- **Impact:** SEC-01 rotation cannot be completed safely without tooling.
- **Resolution:** Prefix ciphertext with a key version; support decrypt with old keys; batch re-encrypt script with dry-run and verification.
- **Alternatives:** Use Supabase Vault / pgsodium for column encryption.
- **Acceptance criteria:** Rotation script re-encrypts all contacts and TOTP secrets; old key removed; all decrypt.
- **Tests:** Unit + integration.

### SEC-10 — Staff audit log is append-only by grants only (not tamper-evident)

**Severity:** Medium · **Category:** security · **Module:** Staff audit · **Roles:** Super Admin · **Status:** Partial · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** Tamper-evident audit records (brief Stage 2 §12).
- **Actual (evidence):** [ran] mushin_worker INSERT/SELECT on staff.audit_log; database owner role can still alter rows.
- **Impact:** A compromised DB owner credential (SEC-01) can erase evidence.
- **Resolution:** Hash-chain each row (prev_hash) and export daily digests to separate storage.
- **Alternatives:** Ship audit events to an external log store.
- **Acceptance criteria:** Verification script detects any modified/deleted row.
- **Tests:** Unit + integration.

### SEC-11 — Supabase Data API exposure of wp/gcp/staff/platform schemas and anon/authenticated grants are unverified

**Severity:** Medium · **Category:** security · **Module:** Supabase configuration · **Roles:** — · **Status:** Blocked · **Classification:** Required for safe production operation · **Owner decision:** No

- **Expected (source):** RLS + least privilege (pack 13).
- **Actual (evidence):** [ran] Local DB has no Supabase roles; remote project never inspected.
- **Impact:** If those schemas are exposed via PostgREST with grants, the public anon key could read data.
- **Resolution:** Confirm Exposed schemas = public only; revoke all on MUSHIN schemas from anon/authenticated; run Supabase Security Advisor.
- **Alternatives:** —
- **Acceptance criteria:** Anonymous REST call to /rest/v1/<any MUSHIN table> fails; advisor clean.
- **Tests:** Staging probe.
- **Depends on:** OD-004

### SEC-13 — Account deletion leaves the identity-provider account; the person cannot re-register with that email

**Severity:** Medium · **Category:** privacy · **Module:** Account deletion · **Roles:** Customer · **Status:** Partial · **Classification:** Required by an applicable external obligation · **Owner decision:** Trial-after-deletion policy

- **Expected (source):** OD-013; pack 13 account deletion.
- **Actual (evidence):** [code] identity/privacy.ts returns identityProviderAccount:'not_deleted_requires_provider'; resolveTenant refuses status 'deleted' forever.
- **Impact:** Incomplete deletion; support burden.
- **Resolution:** On deletion call auth.admin.deleteUser (service role, server side) after the DB scrub; keep a hashed-email trial marker if trial-abuse protection must survive deletion (owner decision).
- **Alternatives:** Disable the Auth user instead of deleting.
- **Acceptance criteria:** After deletion the Supabase user no longer exists; re-sign-up creates a fresh account without a second trial (if policy says so).
- **Tests:** Staging test with real Supabase.
- **Depends on:** OD-004

### SEC-14 — No Content-Security-Policy or security headers defined for the SPA host

**Severity:** Medium · **Category:** security · **Module:** Static hosting headers · **Roles:** — · **Status:** Missing · **Classification:** Required for safe production operation · **Owner decision:** No

- **Expected (source):** pack 08 §1 CSP, nosniff, frame-ancestors, HSTS.
- **Actual (evidence):** [code] helmet CSP disabled on API (fine, JSON only); no host config for the SPA.
- **Impact:** XSS blast radius larger; clickjacking of staff console.
- **Resolution:** Host headers file: CSP (self + Supabase + API), frame-ancestors 'none', nosniff, Referrer-Policy, HSTS; immutable caching for /assets, no-cache for index.html.
- **Alternatives:** —
- **Acceptance criteria:** Header scan in staging passes.
- **Tests:** Staging header check.
- **Depends on:** ARCH-01

### SEC-16 — LLM-written relevance reasons are shown to customers

**Severity:** Medium · **Category:** trust · **Module:** Brain 2 result cards · **Roles:** Searchers · **Status:** Partial · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** LLM narratives must not add facts beyond supplied evidence (pack 10).
- **Actual (evidence):** [code] relevance.ts keeps model `reason` (≤160 chars) as the result reason shown on cards.
- **Impact:** Unsupported claims presented as MUSHIN's explanation.
- **Resolution:** Show deterministic reasons (matched topic words, city evidence) and keep the LLM reason staff-only, or label it 'AI note' and validate it only references snippet words.
- **Alternatives:** —
- **Acceptance criteria:** Customer cards show only template reasons derived from evidence fields.
- **Tests:** Unit test on reason builder.
- **Depends on:** Search freeze

### SRCH-05 — In-flight spend counters are per process; multiple workers can overshoot monthly caps

**Severity:** Medium · **Category:** reliability · **Module:** Provider spend guards · **Roles:** — · **Status:** Partial · **Classification:** Required for safe production operation · **Owner decision:** No

- **Expected (source):** Global provider caps fail closed (pack 08 §3).
- **Actual (evidence):** [code] scrapers/guard.ts and websearch/guard.ts keep `inFlight` in memory ('MUSHIN runs one worker').
- **Impact:** Scaling the worker horizontally breaks the cap.
- **Resolution:** Reserve provider budget atomically in PostgreSQL (a provider_budget_reservations row per run) and settle with actual cost.
- **Alternatives:** Enforce exactly one worker replica (document and check at start-up with an advisory lock).
- **Acceptance criteria:** Two workers racing near the cap cannot exceed it (test).
- **Tests:** Integration test with two guards on one DB.
- **Depends on:** SRCH-04

### SRCH-09 — LLM relevance-batch failures reduce yield without telling the customer

**Severity:** Medium · **Category:** UX · **Module:** Brain 2 transparency · **Roles:** Searchers · **Status:** Partial · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** Partial pipeline failures must not silently produce misleading results (brief Stage 4 Q11).
- **Actual (evidence):** [code] live/relevance.ts drops failed batches (stats.unreviewed); only logged and in the staff trail.
- **Impact:** Customer sees 'fewer creators than requested' and attributes it to the market.
- **Resolution:** Expose `unreviewedCandidates` in job progress and show 'Some candidates could not be checked; you were not charged for them'.
- **Alternatives:** Retry failed batches once more with a smaller batch.
- **Acceptance criteria:** Job API returns the count; UI shows the notice when > 0.
- **Tests:** live-runner.int.

### UX-03 — Workspace selection is global across tabs (localStorage)

**Severity:** Medium · **Category:** UX · **Module:** Workspace switcher · **Roles:** Multi-workspace users · **Status:** Partial · **Classification:** Required for the agreed MVP · **Owner decision:** No

- **Expected (source):** Clear tenant-bound state on switch (pack 06 §Frontend 4).
- **Actual (evidence):** [code] frontend api/workspace.ts.
- **Impact:** See SEC-04.
- **Resolution:** Per-tab selection + storage event listener that reloads or warns other tabs.
- **Alternatives:** Workspace in URL path.
- **Acceptance criteria:** Two-tab test: switching in tab A shows a banner in tab B and blocks writes until refreshed.
- **Tests:** E2E.
- **Depends on:** SEC-04

### ARCH-03 — Upstash is still wired (limiter + billing access cache) although the target removes it

**Severity:** Low · **Category:** architecture · **Module:** Dependencies · **Roles:** — · **Status:** Conflicting · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** No extra cache vendor for MVP (pack 08 §2).
- **Actual (evidence):** [code] server.ts/main.ts create Redis access cache and limiter when Upstash vars exist.
- **Impact:** Extra vendor, failure mode and secret.
- **Resolution:** Remove Upstash code paths after SEC-06; keep in-process 60 s access cache if measured necessary.
- **Alternatives:** Keep as explicit opt-in.
- **Acceptance criteria:** No Upstash dependency in package.json; tests pass.
- **Tests:** verify.
- **Depends on:** SEC-06

### BIL-04 — 'Top-ups never expire' is only half-enforced by the database

**Severity:** Low · **Category:** documentation · **Module:** Credit lots · **Roles:** — · **Status:** Partial · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** Owner decision 2026-10-14 #4; 0030 comment 'enforced by the database'.
- **Actual (evidence):** [code] constraint credit_lots_expiry_rule = (expires_at is not null or source='topup'): forbids null for non-top-ups, does not forbid an expiry on a top-up.
- **Impact:** A future code path could create expiring top-ups unnoticed.
- **Resolution:** Add check (source <> 'topup' or expires_at is null) for rows created after 0030 (NOT VALID + validate after backfill review).
- **Alternatives:** —
- **Acceptance criteria:** Inserting a top-up lot with expires_at fails.
- **Tests:** engine.int.

### DATA-03 — Workspace export silently truncates tables at 50,000 rows

**Severity:** Low · **Category:** functional defect · **Module:** Workspace export · **Roles:** Owner, Admin · **Status:** Partial · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** Complete export (OD-013).
- **Actual (evidence):** [code] identity/privacy.ts `limit 50000` per table, no truncation flag.
- **Impact:** Incomplete export without warning for large workspaces.
- **Resolution:** Stream export (NDJSON per table) or add `truncated: true` and paging.
- **Alternatives:** —
- **Acceptance criteria:** Export of > 50k ledger rows is complete or flagged.
- **Tests:** Integration test.


## P3

### SRCH-08 — 'Cursor' is an offset into a re-computed list (max 1,000)

**Severity:** Medium · **Category:** functional defect · **Module:** Brain 1 pagination · **Roles:** Searchers · **Status:** Partial · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** CAT-004 cursor bound to query/filter/ranker with stable tie-break.
- **Actual (evidence):** [code] creators/cursor.ts encodes {v,h,o}; each page re-runs retrieval and slices.
- **Impact:** Results can shift between pages if the catalogue changes; repeated work per page.
- **Resolution:** Keyset cursor on (rankingScore, updated_epoch, creator_id) or a short-lived snapshot of the ranked id list.
- **Alternatives:** Accept offset with documented limitation.
- **Acceptance criteria:** Inserting a higher-ranked creator between page 1 and 2 does not duplicate or skip results.
- **Tests:** Integration.
- **Depends on:** Search freeze

### SRCH-12 — Geography evidence is thin: no gazetteer IDs; city mostly unknown

**Severity:** Medium · **Category:** missing feature · **Module:** Geography · **Roles:** Searchers · **Status:** Partial · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** Versioned gazetteer with IDs (pack 07 extension concepts).
- **Actual (evidence):** [ran] city 'unknown' for all 353 rated rows; [code] aliases.ts static lists.
- **Impact:** City filters return little; 'Lahore' relevance relies on bio text.
- **Resolution:** Gazetteer table (PK cities/areas, aliases, Urdu forms) + per-field provenance (declared bio city vs inferred).
- **Alternatives:** —
- **Acceptance criteria:** City filter precision measured in round-2 evaluation.
- **Tests:** Evaluation.
- **Depends on:** SRCH-01

### UX-05 — Manual keyboard, screen-reader and zoom review not done (axe only)

**Severity:** Medium · **Category:** UX · **Module:** Accessibility · **Roles:** All · **Status:** Partial · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** WCAG 2.2 AA-compatible core flows (pack 17).
- **Actual (evidence):** [doc] readiness README 'partial'.
- **Impact:** Automated checks catch roughly a third of issues.
- **Resolution:** Manual review of search, profile, Live Discovery, billing, settings with NVDA/VoiceOver and keyboard only.
- **Alternatives:** —
- **Acceptance criteria:** Checklist in K §9 passes.
- **Tests:** Manual.
- **Depends on:** OPS-02

### ARCH-02 — Declared but unused environment variables (SQS/AWS, Sentry, PostHog, HuggingFace, Vercel, WORKER_SECRET, DATABASE_POOL_SIZE)

**Severity:** Low · **Category:** maintainability · **Module:** Configuration · **Roles:** — · **Status:** Partial · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** One source of truth for configuration.
- **Actual (evidence):** [doc] 14 Oct report; [code] .env.example still lists them.
- **Impact:** Confusion; secrets kept for no purpose (HuggingFace key populated).
- **Resolution:** Remove from .env.example; revoke unused keys.
- **Alternatives:** —
- **Acceptance criteria:** Every .env.example variable is read by code (test).
- **Tests:** Config coverage test.
- **Depends on:** SEC-01

### ARCH-04 — Meilisearch Cloud configured in development despite 'self-hosted comparison only'

**Severity:** Low · **Category:** architecture · **Module:** Search backend · **Roles:** — · **Status:** Conflicting · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** Pack 01: PostgreSQL default; no Meilisearch Cloud.
- **Actual (evidence):** [ran] MEILISEARCH_HOST is a Meilisearch Cloud host; README says Cloud is used 'also production'.
- **Impact:** Contradictory docs; an extra vendor holding creator data.
- **Resolution:** Delete the Cloud project/keys; README update; keep PostgreSQL only unless the rated comparison justifies otherwise.
- **Alternatives:** —
- **Acceptance criteria:** No Cloud host in any config; README corrected.
- **Tests:** —
- **Depends on:** SEC-01

### SEC-15 — Unused components contain fabricated testimonials and logos

**Severity:** Low · **Category:** trust · **Module:** Landing components · **Roles:** Visitor · **Status:** Partial · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** No fake reviews (pack 02 UX integrity).
- **Actual (evidence):** [code] landing/Testimonials.tsx, Testimonial.tsx, LogoCloud.tsx (not rendered by App.tsx).
- **Impact:** Easy to re-enable by mistake.
- **Resolution:** Delete the components.
- **Alternatives:** —
- **Acceptance criteria:** No such components in the tree.
- **Tests:** Lint rule/grep in CI.

### UX-04 — Single 1.1 MB JS bundle including the staff console

**Severity:** Low · **Category:** performance · **Module:** Frontend bundle · **Roles:** All · **Status:** Partial · **Classification:** Recommended improvement · **Owner decision:** No

- **Expected (source):** Performance budget (proposed).
- **Actual (evidence):** [ran] build output.
- **Impact:** Slow first load on Pakistani mobile networks; staff UI code shipped to every visitor.
- **Resolution:** Route-level code splitting; separate admin entry.
- **Alternatives:** —
- **Acceptance criteria:** Landing JS ≤ 250 kB gzip.
- **Tests:** Build size check in CI.
