# C — Module, feature, page and role inventory with verified implementation matrix

Statuses (brief §3): **Verified** · **Implemented, not fully verified** · **Partial** · **Missing** · **Conflicting** ·
**Blocked**. "Verified" here means *directly inspected and supported by tests that this audit re-ran* (847 passing tests
on a clean local PostgreSQL 16 + Meilisearch). Browser-E2E claims could not be reproduced (OPS-02), so anything whose
only proof is a browser journey is at most "Implemented, not fully verified".

## 1. The four separate requirement lists the brief asks for

1. **Requirements explicitly documented** — pack `contracts/requirements.csv` (68 IDs) + repo `traceability.csv`
   (65 IDs, overlapping) + owner rules in `progress.md`. Union used for §3 below.
2. **Decisions already made by the owner** — §2.
3. **Verified in code and tests** / 4. **implemented but not adequately verified** / 5. **documented but missing** —
   the Status column of §3–§4.
6. **Conflicting, obsolete or ambiguous** — register B (DIS-01…26).
7. **Decisions that require the owner** — `I_IMPLEMENTATION_ROADMAP.md` §8 (decision list D-01…).

## 2. Owner decisions on record (from `progress.md`, dated)

| Date | Decision | Implemented? |
|---|---|---|
| 14 Oct #1 | TikTok-in-scope successful run ≥ 100 credits (provisional) | Yes (`TIKTOK_LIVE_MINIMUM_CREDITS`) |
| 14 Oct #2 | Add-by-link 50 new / 0 duplicate / 50 refresh / 0 failed | Yes |
| 14 Oct #3 | Base fee only with a presented qualified result (known-only → 50) | Yes — public copy contradicts it (BIL-01) |
| 14 Oct #4 | Top-ups never expire; monthly credits end at renewal | Yes (0030) |
| 14 Oct #5 | City aliases approved, expansion only | Yes |
| 14 Oct #6 | Extraction multipliers by replay; cost limit before each batch | Yes (IG 2×, YT 3×, TT 1× provisional) |
| 14 Oct #7 / 15 Oct #2 | LLM cap USD 5 local/staging, 80 % warning, explicit in production | Yes |
| 14 Oct #8 / 15 Oct #8 | YouTube: derived scores off; 30-day refresh-or-delete | Yes (0029, 0031); legal review open |
| 14 Oct #11 / 15 Oct #5 | Supabase staged migration once Docker exists | Not started (blocked) — conflicts with pack (DIS-02) |
| 14 Oct #12 | Customer workflows after Search acceptance; Resend only for confirmed emails | Partly overtaken: team/privacy built in parallel and merged 16 Oct |
| 14 Oct #13 | No hardware-key claim from TOTP; privileged access blocked until proven | Yes — with SEC-02/SEC-07 caveats |
| 15 Oct #1 | Vocabulary for cooking, skincare, literature, agriculture (no ranking weight) | Yes |
| 15 Oct #3 | Two-rater evaluation and adjudication before any acceptance claim | Kits ready; no ratings |
| 15 Oct #6 | Supabase Auth as the target identity; keep hardware-key requirement | Target recorded; not migrated |
| 15 Oct #7 | Removal requests under owner review via CLI | Yes (`npm run removal-review`) |
| 15 Oct #9 | TikTok price and multipliers provisional; no paid pilot | Yes |
| 16 Oct | 10,000-follower minimum (elig-1) | Yes, everywhere |
| 16 Oct | 90-day follower-count freshness, activity separate | Yes |
| 16 Oct | Search stays primary and frozen; merge team-privacy; inventory YouTube copies; no paid calls/emails/payments/deploys | Yes |
| 16 Oct | Two independent raters + one adjudicator | Kits ready; people not named |

## 3. Implementation matrix — items the brief §3 names explicitly

| Area | Status | Evidence | Impact if left | Remaining tests | Next action |
|---|---|---|---|---|---|
| **Team invitations** (create, revoke, expire 7 d, max 50 pending, role ceiling, one-time accept) | **Implemented, not fully verified** | [code] `identity/team.ts`, 0035 `accept_invitation` (row lock, status, expiry, email match); [ran] `team.int` 8/8 | Verified-email check trusts user-editable metadata (SEC-03); no email delivery — links are copied by hand | Real Supabase token with unconfirmed email; forwarded-link test | Fix SEC-03; integrate email when Resend is approved |
| **Workspace membership, switching, removal, ownership transfer** | **Partial** | [code] `team.ts` role rules; `findMembership` fallback; localStorage selection; [ran] team.int | Silent cross-workspace writes (SEC-04, UX-03) | 403 on non-member header; two-tab test | Fix SEC-04 |
| **Workspace export** | **Implemented, not fully verified** | [code] `privacy.ts` exports 17 `wp` tables via RLS, no contact values, no staff notes; [ran] team.int | 50,000-row silent truncation (DATA-03); JSON in one response | Large-workspace test | Stream export |
| **Workspace deletion** | **Verified** (local) | [code] owner-only, name confirmation, refuses with active subscription / running job / held credits; `erase_workspace` keeps billing + audit; [ran] team.int; erase-coverage guard test | Retention period for retained billing data undefined (OD-013); FK cascade risk (BIL-05) | Hosted test; backup implications (OPS-04) | Owner sets retention; BIL-05 |
| **Account deletion** | **Partial** | [code] `delete_account()` refuses while owning a shared or paid workspace; scrubs profile; IdP account not deleted (reported honestly) | Incomplete deletion (SEC-13) | Staging with real Supabase | Call `auth.admin.deleteUser` server-side |
| **Repeated free-trial prevention** | **Verified** (per identity) | [code] 0036 `trial_granted_at`, `claimTrial` in the provisioning transaction under an advisory lock; [ran] team.int R-1 tests | A new email gets a new trial (inherent); invited people get their own trial once | — | Owner decides whether email-domain/phone limits are wanted |
| **Super Admin bootstrap** | **Implemented, not fully verified** | [code] CLI-only `bootstrapSuperAdmin` (operator + reason, audited, `--recovery` when one exists); Super Admins cannot be changed via approvals | — | — | Document the recovery runbook |
| **Staff console authorisation** | **Implemented, not fully verified** | [code] `STAFF_PERMISSIONS` deny-by-default; role + status re-checked per request; [ran] ops.int, staff-session.int | Step-up bypass with the exposed secret (SEC-02) | Forged-amr test | SEC-02 |
| **Authenticator (TOTP) sign-in** | **Verified** | [code] argon2 password, 5-attempt lockout, constant-work failures, TOTP step claimed once (replay-safe) under row lock; refresh rotation with reuse detection; [ran] staff-login.int | TOTP is not phishing-resistant ([web] NIST) — acceptable for Support only | — | — |
| **Security-key registration and step-up** | **Partial** | [code] `webauthn.ts` (@simplewebauthn, UV required, single-use challenges, counter CAS, cannot revoke last key); [ran] webauthn.int | First key from TOTP session (SEC-07); hwk not bound server-side (SEC-02); no physical key ever tested | Physical key test; forged-amr test | SEC-02, SEC-07 |
| **Two-person approvals** | **Implemented, not fully verified** | [code] `approvals.ts`: requester ≠ approver, Super Admin co-sign for staff changes, self-target refused, 24 h expiry, executes once (idempotent source_ref), audited; offered actions: credits.grant, staff.role.change, staff.suspend | Two colluding Admins can grant credits (by design); approvals list expires rows on read only | Race of two approvers | Add amount ceiling for credits.grant without Super Admin |
| **Audit logs** | **Partial** | [ran] grants make `staff.audit_log` append-only for runtime roles; [code] login, step-up, approvals, ops actions audited | Not tamper-evident (SEC-10) | — | Hash chain |
| **Administrative actions** (provider pause, job retry/cancel, removal review, support assignment, consented support access) | **Implemented, not fully verified** | [code] `staffops/actions.ts` with reasons, idempotency, audit; consented access in `staffops/access.ts` | Staff UI is in the public bundle (UX-04) | Staff E2E reproducibility | OPS-02 |
| **Credit accounting** (lots, append-only ledger, reservations, settlement, release, expiry) | **Verified** | [code] `billing/engine.ts` per-workspace advisory lock, integer amounts, CHECK sign rules, unique source_ref, RLS-restricted insert policy for reservations bound to approved prices; [ran] engine.int, service.int, partial-commit.int | — | Concurrency at hosted scale | — |
| **Top-ups** | **Implemented, not fully verified** | [code] 0030; mock checkout only | Real payment path unverified (BIL-03); constraint half-enforced (BIL-04) | Paddle sandbox | BIL-03 |
| **Refunds** | **Partial** | [code] credit releases on failed/empty/insufficient runs; money refunds via Paddle not implemented beyond webhook types | Customer money refunds untested | Sandbox | BIL-03 |
| **Expiry policy** | **Verified** for monthly/trial lots; top-ups never expire (owner) | [ran] engine.int "database refuses a never-expiring lot for anything but a top-up" | — | — | BIL-04 |
| **PostgreSQL rate limiting across instances** | **Implemented, not fully verified** | [code] 0034 atomic upsert, sliding-window estimate, hashed keys, unlogged table, fail closed; [ran] postgres limiter tests incl. "shared across instances" | Not the active store when Upstash variables exist (SEC-06); IP derivation behind proxy (SEC-05); 2 DB writes per request (OPS-05) | Staging load test | SEC-05, SEC-06 |
| **90-day follower-count freshness** | **Verified** | [code] `eligibility.ts` (unknown/stale never pass; activity separate, `activity_unverified` flag); applied in search SQL (`eligible_until_epoch`), Live delivery, lists, campaigns, profile; [ran] eligibility.test/int | Catalogue decay with no refresh (SRCH-02) | Pinned-clock decay test | SRCH-02 |
| **Global creator data vs workspace CRM privacy** | **Verified** (database) / **Conflicting** (payloads) | [ran] `gcp` read-only to app, no grant on `creator_contacts`; 28/28 `wp` tables forced RLS; [code] raw bios with contact strings returned (SEC-08) | Reveal control bypassable via bio | Payload contract test | SEC-08 |
| **Export, deletion, retention, backup implications** | **Partial** | YouTube 30-day expiry job, raw payload purge, search-cache purge, removal-email purge (schedules.ts); backups undefined | Restores can resurrect erased/expired data (OPS-04) | Hosted restore drill with erasure replay | OPS-04 |

## 4. Module inventory (customer, staff, platform)

| Module | Roles | Backend | Frontend | Status | Key gaps |
|---|---|---|---|---|---|
| Landing, pricing, FAQ | Visitor | `/v1/billing/plans` (prices also hard-coded in `plans.ts`, tested to match) | `components/landing/*` | Partial | BIL-01 copy; UX-01 legal pages; unused fake testimonials (SEC-15) |
| Sign-up, sign-in, recovery | Visitor | Supabase Auth (JWKS verify, RS256/ES256) | `auth/*` | Blocked | UX-02; real Supabase never exercised; custom SMTP needed ([web]) |
| Onboarding / workspace provisioning | New user | `resolveTenant` auto-provisions + trial | `WorkspaceOnboarding.tsx` (not rendered) | Partial | No onboarding step (owner may not need it) |
| Dashboard / overview | All | analytics/activity endpoints | `Overview*.tsx` | Implemented, not fully verified | — |
| **Brain 1 catalogue search** | Owner/Admin/Member | `creators/service.ts`, `postgres-search.ts`, `understand.ts`, `aliases.ts`, `ranking.ts`, `match-reasons.ts`, `search-charge.ts` | `SearchModule.tsx` | **Implemented, not fully verified — NOT ACCEPTED** | SRCH-01/02/03/06/07/08, BIL-02 |
| Saved searches | Workspace | `/v1/search/saved` | Search page | Verified (int) | — |
| **Brain 2 Live Discovery** | Owner/Admin/Member | `discovery/service.ts` (brief gate, estimate, confirm), `live-runner.ts`, `live/*`, `fit.ts` | `FindNewDialog.tsx`, `JobTray.tsx` | **Implemented, not fully verified — NOT ACCEPTED** | SRCH-04/05/09/10, BIL-06, SEC-16 |
| Add by link / refresh | Workspace | `discovery/runner.ts`, enrichment pipeline | `AddByLinkDialog.tsx` | Implemented, not fully verified | Live provider path not re-run |
| Creator profile & evidence | Workspace | `GET /v1/creators/:id` | `CreatorProfilePanel.tsx`, `ScoreWithEvidence`, `FreshnessLabel` | Implemented, not fully verified | SEC-08; DATA-001 per-field provenance partial |
| Contact reveal & availability | Workspace (credits) | reveal routes, `contact-checks.ts` (MX/A lookup only) | Profile panel | Verified (int) | — |
| Lists | Workspace | `modules/lists` | `Lists.tsx`, `SaveToListMenu` | Verified (int) | Export not offered (honest) |
| Compare | Workspace | client-side over loaded cards | `Compare.tsx` | Partial | No test |
| Campaigns, stages, fees, manual outreach log | Workspace | `modules/campaigns` (optimistic version, plan limit enforced) | `Campaigns.tsx`, `CampaignDetail`, `CampaignOutreach` | Verified (int) | No email sending (honest) |
| Analytics, activity, notifications | Workspace | analytics/activity | `Analytics`, `ActivityLog`, `NotificationCenter` | Implemented, not fully verified | Notifications in-app only |
| Billing & credits | Owner (buy), Admin (ledger), Member (summary) | `modules/billing`, mock Paddle | `Billing.tsx`, `CreditConfirm` | Verified (mock) / Blocked (real) | BIL-03 |
| Team & privacy settings | Owner/Admin | team + privacy routes | `TeamSettings.tsx`, `Settings.tsx`, `InviteAccept.tsx` | See §3 | SEC-03/04 |
| Customer support | Workspace | `modules/support` (20 open tickets cap) | `Support.tsx` | Verified (int) | — |
| Public removal request | Creator (no account) | `/v1/public/removal-requests` | `RemoveMyData.tsx` | Verified (int) | Owner reviews by CLI |
| Staff console | Support, Admin, Super Admin | `modules/staff`, `staffops`, `ops` | `components/admin/*` | Implemented, not fully verified | SEC-02/07/10 |
| Worker & schedules | System | `apps/worker` (outbox → pg-boss, 9 queues, DLQ, 15 schedules) | — | Verified (int) | SRCH-04/05; OPS-03 alerting |
| Audience estimates | — | `modules/audience` | `AudienceEstimate.tsx` | Disabled by policy | Keep disabled |

## 5. Page inventory (actual routes)

Hash routes in `App.tsx`: `#/` landing · `#/login` · `#/signup` · `#/forgot` · `#/dashboard` · `#/invite/<token>` ·
`#/remove-my-data` · `#/admin/login` · `#/admin`. Dashboard views: overview, search, lists, campaigns, analytics,
activity, billing, settings (tabs incl. profile, workspace & team, access), support, inbox (shown as planned).
**Missing pages** that the product needs: Terms, Privacy Policy, Refund policy (UX-01); set-new-password after recovery
(UX-02); email-confirmation result page; 404/maintenance page; status/degraded banner page (see K).

## 6. Role inventory

| Domain | Role | Capabilities (server-enforced) |
|---|---|---|
| Workspace | Owner | everything; billing; delete workspace; transfer ownership; change roles; invite admins |
| Workspace | Admin | invite members; remove members; rename workspace; export; **manage billing and purchase** ([code] `billing/service.ts` `BILLING_ROLES = {owner, admin}` — the pack says billing actions are owner-only: DIS-26) |
| Workspace | Member | search, save, campaigns; balance summary only; may leave |
| Staff | Support | tickets, redacted lookups, read-only diagnostics, consented read-only workspace access |
| Staff | Admin (operations profile) | + provider pause, job retry/cancel, removal review, audit read, approvals (request/decide) — hardware-key step-up required |
| Staff | Super Admin | + staff administration; co-sign staff role/suspension approvals; created only by CLI bootstrap |
| System | `mushin_app`, `mushin_worker` DB roles | RLS-bound tenant role; worker role for system/cross-tenant jobs through security-definer functions |

Customer roles never grant staff permissions and vice versa ([code] separate guards, separate token issuers).
