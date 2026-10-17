# MUSHIN progress record

Current state against the owner's 2026-10-14 decisions. Evidence is bound to commits. Replay results are labelled as
replay, never as live-provider measurements. Updated 2026-10-15 (second phase).

## Current objective and gates

Search acceptance comes first, on the provisional gates (unchanged): Precision@5 ≥ 0.80, nDCG@10 ≥ 0.75 and ≥ 90%
relevant-query coverage, from two-person human rating with adjudication. Brain 1 (catalogue) and Brain 2 (Live
Discovery) are measured separately. After that come the Supabase target (blocked on Docker) and the remaining customer
modules.

**Search is not accepted.** The pipeline work that does not need people is done (below). The quality numbers need human
ratings.

## Owner decisions 2026-10-14: state

| # | Decision | State | Evidence |
|---|---|---|---|
| 1 | TikTok-in-scope successful run ≥ 100 credits (provisional) | Done; never above the quote; the quote shows it; no margin claimed | live-runner.int; credit-economics.md |
| 2 | Add-by-link 50 new / 0 duplicate / 50 explicit refresh / 0 failed | Done (a creator found to be known mid-run is now free) | discovery-runner.int |
| 3 | Base fee only with a presented qualified result | Already true, now tested (known-only → 50) | live-runner.int |
| 4 | Top-ups never expire; monthly credits end at renewal | Done, migration 0030 (DB constraint) | service.int, rules.test |
| 5 | City aliases approved, expansion only | Recorded | search-quality.md |
| 6 | Multipliers chosen by replay; cost limit before each batch | Done: cap before every batch; replay study gives Instagram 2×, YouTube 3×, TikTok 1× (provisional, relevance pending) | search-quality.md (Brain 2 log) |
| 7 | LLM cap: USD 5 local/staging, explicit in production, never silently off | Done | config.test, budget.test |
| 8 | YouTube: scores blocked; 30-day refresh-or-delete; document identifiers | Done for stored data (0029, 0031) | source-policy.int; section below |
| 9 | Investigate empty results; human rating; gates | Investigated and fixed what was a defect (below); ratings blocked on people | search-quality.md |
| 10 | Full verification and 3 E2E after the cost cap, phone and accessibility | Done; phone and axe checks added; 3 × 73/73 | customer-e2e-report.md |
| 11 | Supabase staged migration | Blocked: Docker/WSL not installed | — |
| 12 | Customer workflows after Search acceptance; Resend only for confirmed emails; never fabricate delivery | Waiting on Search acceptance. Outreach today is a manual log with no "sent/delivered" state (verified) | campaigns contracts |
| 13 | Staff: no hardware-key claim from TOTP; privileged access blocked until proven | Done: admin-only actions need a hardware-key factor; TOTP admins get 403 | ops.int, live-api.int |

## Owner decisions 2026-10-15: state

| # | Decision | State | Evidence |
|---|---|---|---|
| 1 | Approve cooking, skincare, literature, agriculture with verified Urdu forms; test coverage, not ranking rules | Done: vocabulary only (no ranking weight, not sent to Live Discovery); every form tested. Urdu spellings checked against standard orthography; the corpus confirms only ریسپی, so a native-speaker check is still advisable | aliases.test; search-quality.md "Concept vocabulary" |
| 2 | LLM hard cap USD 5 for the pilot, warning at 80%; no paid calls | Already enforced: default 5, warning at 80% once a month, 0 blocks all calls, production must set the cap explicitly. No paid calls made | budget.test, config.test |
| 3 | Two-rater evaluation and adjudication first; no acceptance claim without the criteria | Blind packets ready (Brain 1: 273 rows, Brain 2: 207 rows, with pooled candidates so coverage is measurable), behaviour sheets, rater instructions, adjudication and gate report. No ratings yet | search-quality.md "Evaluation protocol log" |
| 4 | Investigate intermittent API test failures; rerun verify and 3 E2E | The 3 skeleton-test failures (2026-10-14) did not recur: 3 targeted and 2 full runs under heavy CPU load passed (first app build 0.4–0.8 s against a 5 s limit); their error text was lost because the output was filtered, so full verify logs are now kept. Found and fixed a real cross-run defect: `search.int` restored a default price of 0 into the shared price table when its setup failed (Meilisearch down), failing 6 billing and pricing tests in the next run. It now captures prices first (`pinActionCosts`); a deliberately failed setup leaves the price at 50. Verify: 732 passed, 7 skipped; 3 consecutive E2E runs 73/73 each (final1015-1..3) | search.int; verify log; E2E results |
| 5 | Supabase migration once Docker/WSL exists; keep current implementation until parity | Blocked: WSL and Docker still not installed (checked 2026-10-15) | — |
| 6 | Supabase Auth as target identity; keep the hardware-key requirement for privileged staff actions | Recorded. Hardware-key (WebAuthn) step-up not built; TOTP-only admins stay refused | ops.int |
| 7 | Removal requests under owner review; auditable process | Done: `npm run removal-review` (list, approve, reject) for the owner, same audit actions as the console plus channel, operator and reason; approval needs --confirm. Creators are hidden from customers as soon as a request arrives | erasure.int |
| 8 | YouTube-derived metrics off; policy review before keeping disputed identifiers or enabling scores | Unchanged and in force (0029, 0031); legal review outstanding | source-policy.int |
| 9 | TikTok price and multipliers provisional; no paid pilot | Unchanged; replay harness now uses the production multipliers by default | search-quality.md P4 |

## Search phase 2026-10-15 (finish Search, contact availability): evidence

- Code and pipeline tests: verify 751 passed, 7 skipped (live-provider tests); frontend build passes; 3 consecutive E2E
  journeys 75/75 each (search1015-1..3), including the two new contact-availability checks.
- Replay (recorded responses, not live): Brain 2 77 delivered over 25 briefs, 1,790 credits, deterministic order.
- Human-validated Search quality: **pending** (no ratings). Search is not accepted.
- Details: search-quality.md "Search iteration 2026-10-15" and "Contact availability".

## Search: baseline versus now

| Measure | Baseline | Now | How measured |
|---|---|---|---|
| Brain 1 queries with results (35-query panel) | 11 | 15 | Corpus v2, 455 real recorded profiles, same data for both |
| Brain 1 latency p95 | ~88 ms | 58 ms | Same runs |
| Brain 1 empty queries explained | — | 20/20: 13 nothing suitable in the corpus, 7 not creator searches or refused | diagnose-brain1.ts |
| Brain 2 delivered (25 recorded briefs, size 5) | 51 | 77 | Replay, Instagram 2× / YouTube 3× |
| Brain 2 empty briefs | 8 | 5 | Replay; 2 are replay misses (TikTok), 1 is an insufficient pool, 2 are spec-rule rejections |
| Brain 2 settlement | exact | exact | No credits left reserved, no pending trail rows |
| Brain 1 / Brain 2 determinism | — | identical results on repeated runs (35/35 queries, 25/25 briefs), no duplicates | search-quality.md E12, P6 |
| Precision@5, nDCG@10, coverage | not measured | not measured | Needs two raters (blind packets: 273 Brain 1 and 207 Brain 2 rows) |

## YouTube retention: what is kept and why (decision 8)

Source: YouTube API Services Developer Policies, checked 2026-10-14.
- III.E.4.c/d: API Data may be kept for at most 30 calendar days unless refreshed. No exemption is listed for channel
  identifiers.
- III.E.4.h: no new or derived data or metrics may be made from API Data.
- III.L: extra derived-metric permissions apply only to audited analytics developers (from 2026-06-01).

After 30 days without a refresh, for a YouTube-primary creator MUSHIN deletes or clears:
- metrics, bio and metric history;
- the display name (replaced by the handle);
- the avatar (row and stored image);
- the AI summary, niches, city, country and assessments;
- Campaign Fit evidence on older results.

Raw payloads are already deleted after 30 days.

Kept: the channel **handle and canonical URL**. This is lawful only because MUSHIN obtains them outside the API (the
Google result link that found the channel, or the link a customer pasted). They are needed to honour removal requests
and suppression. **This needs legal review before production.** Live Discovery uses YouTube data for Campaign Fit only
inside the 30-day window. Whether that is itself a "derived metric" under III.E.4.h is an open legal question.

## Blocked items and the smallest unblocking action

| Item | Blocker | Unblock |
|---|---|---|
| Supabase target and its E2E | Docker/WSL not installed | Run `wsl --install` as admin, reboot, install Docker Desktop |
| Search acceptance numbers | No human ratings | Two raters fill the blind packets (`brain1-rater-A/B.csv` 273 rows, `brain2-rater-A/B.csv` 207 rows, plus the behaviour sheets); a third person adjudicates. The packets hold YouTube API data: finish and delete by 2026-11-12 |
| Live-provider quality, TikTok yield, real costs | No paid-test authorisation | Owner authorises a capped pilot (amount, providers) |
| Paddle, Resend, real Supabase Auth | Vendor accounts | Owner provides sandbox accounts |
| Admin console actions (removal review, provider usage, audit) | No WebAuthn hardware-key step-up | Build WebAuthn step-up for staff (fits Supabase Auth as identity). Meanwhile the owner decides removal requests with `npm run removal-review` |
| Founder co-sign, two-person rule, consented impersonation | Not built (staff UI deferred) | Implement after Search acceptance |

## Owner decisions still needed

- Confirm the provisional multipliers (Instagram 2×, YouTube 3×) once the Brain 2 ratings exist.
- Production `LLM_MONTHLY_BUDGET_USD`: USD 5 is set for the controlled pilot; the production value is still to be set.
- Legal review of keeping YouTube handles and URLs, and of Campaign Fit inside the 30-day window.
- Who the Search raters and adjudicator are.

## Next action

Rate the search sheets (people needed). Meanwhile, the next code work is the WebAuthn staff sign-in and, once Docker is
installed, `supabase init` and porting migrations 0001–0031.

## 2026-10-15 (evening): Search evidence, Supabase-target rate limits, deadline

Two Claude sessions now work in this repository with split ownership. This one owns Search, Live Discovery, rate limits,
Supabase preparation and the progress and traceability records. The staff-operations session owns staff, admin UI,
identity, team and privacy, and outreach email (see `staff-operations.md`). Integration tests here run on
`mushin_test_claude`.

| Commit | What | Evidence |
|---|---|---|
| `10637c8` (other session) | Staff operations: Super Admin, WebAuthn step-up, approvals, ops controls, consented support access | its own verify, 775 passed |
| `ef03156` | Rate limits in PostgreSQL (`rate_limit_hit`, 0034): the Supabase-map target already running; default when Upstash is not set; fails closed | verify 784 passed, 7 skipped |
| `2b43654` | Catalogue match explanations (CAT-005); Brain 2 funnel cost per delivered creator | verify 792 passed; Brain 1 panel identical 35/35 to the rating packets; Brain 2 sheets byte-identical |
| `feb3f17` | Per-job Live Discovery deadline (LIVE-004, default 20 min, provisional) | live-runner.int 32/32; E2E 3 × 76/76 |

Databases: `mushin_e2e_template` and `mushin_local` migrated to 0034 (forward only, nothing removed).

Unchanged blockers: Search acceptance needs two raters and an adjudicator (packets in `eval-data/packets`, YouTube rows to
delete by 2026-11-12). The Supabase stack needs WSL 2 + Docker (still not installed on 2026-10-15). Real providers,
Paddle, Resend and Supabase Auth need owner authorisation or accounts. Demographics: the 10.8 documentation review stands;
the next free step (Phyllo sandbox shape test) needs a Phyllo account.

Owner decision needed: the two sessions received different orders. This one: Search acceptance before other customer
modules. The other: continue invitations, privacy, Resend test mode and billing now, without waiting for ratings.

## 2026-10-16: creator eligibility elig-1 (owner requirement), in progress

Earlier the same day: `2dd9b69` fixed the campaign fee double-save found by E2E (D-7), dashboard badges (F-7/F-8), the
invented top-bar identity, the template page metadata and the favicon 404s (F-10); E2E 3 × 79/79, verify 804 passed.
The staff-operations session ended; its unmerged work is safe on branch `team-privacy` in `MUSHIN-team`.

**Hypothesis and measurable outcome.** A shared server-side policy (`creators/eligibility.ts`, version `elig-1`)
filters creators before ranking. It requires at least one own profile with a known count of 10,000 or more followers
or subscribers, observed within 90 days, on a valid supported profile URL, and not known to be inactive for more than
90 days. Unknown activity is flagged `activity_unverified`, never invented. Applied in Search, Live Discovery delivery,
list and campaign additions and the profile API, so only qualifying creators reach customers and saved records are
labelled, not deleted. Results shrink by the measured share and are never padded.

**Baseline before enforcement** (`scripts/eligibility-report.ts`, counts only):

| Catalogue | Eligible creators | Instagram profiles | TikTok profiles | YouTube profiles |
|---|---|---|---|---|
| mushin_local | 12 of 21 active (9 below 10k, 1 protected minor) | none | 2 of 3 | 10 of 18 |
| corpus v2 (evaluation) | 204 of 455 (243 below 10k, 8 unknown count) | 67 of 104 | 13 of 23 | 124 of 328 |

Every eligible creator is currently `activity_unverified`, because post dates were not stored before this change. The
rating packets made under the pre-eligibility policy must be regenerated and labelled; human ratings are still
required.

**Result (elig-1 implemented).** Enforced in catalogue Search (both backends, expiry without re-indexing), Live Discovery
delivery (rejected with the reason; not delivered or charged), list and campaign additions (`creator_ineligible`, direct
API calls included), profiles (per-profile verdicts) and the UI (banner, disabled save/add with the reason, saved members
labelled and kept). Evidence: verify 826 passed, 7 skipped; E2E 3 × 82/82; local "food" search 9 → 5 results. Not yet
done: rating packets regenerated under elig-1 (next step), catalogue creator/business classification as a gate, a staff
coverage view (report script only).

## 2026-10-16: state at the end of this session (resume here)

Master commits this session: `2dd9b69` (campaign fee double-save D-7, dashboard badges F-7/F-8, placeholder identity,
page metadata, favicons F-10), `9503764` (creator eligibility elig-1), `947a464` (evaluation pools and packets under
elig-1; tag `search-freeze-2026-10-16-elig1`), `0df288e` (bundle secret scan, prepared CI, restore drill, API security
tests, multi-instance rate limits), `d35763e` (WCAG 2.2 axe across every customer page; fixes A-1..A-3;
release-readiness checklist), `d018bdd` (staff eligibility coverage endpoint; bounded local load check), plus this
record and the hosting recommendation. Last full verify: 836 passed, 7 skipped (live-provider suites). Last E2E: 3 × 90/90.

**Next actions, in order:**
1. Owner: give the rater kits in `eval-data/kits` (elig-1 packets) to two raters and an adjudicator; score with
   `scripts/search-eval/score.ts`; delete the evaluation data by 2026-11-12 (`purge-eval-data.ts --confirm`; also the old
   copies in the earlier Claude temp folders). Run `freeze-check.ts` before any merge that touches Search.
2. Owner decision: finish and integrate branch `team-privacy` (one commit `a5faa1e` and uncommitted invitation/team UI
   in `../MUSHIN-team`). It needs a review, a verify run and E2E before merging into master. It reserves migrations 0035 and 0036.
3. When WSL 2 and Docker exist: `supabase init`, port migrations 0001–0034, 0037 (plus 0035/0036 when merged), then follow
   the migration map §7.
4. With accounts: real Supabase Auth test project, Paddle sandbox, Resend test domain; a capped paid Brain 2 pilot only
   with owner authorisation.
5. E2E fixture refresh before about 2027-01-11 (template follower counts expire under the 90-day rule).

## 2026-10-16 (afternoon): owner decisions carried out (resume here)

Owner decisions: Search stays the primary gate and frozen; finish, review, test and merge `team-privacy`; the 90-day
count rule is confirmed (activity stays separate); inventory the YouTube evaluation copies now and purge them after
the evaluation; WSL 2, Docker and test accounts are the owner's; no paid calls, real email, payments or deploys.

| Item | Result | Evidence |
|---|---|---|
| team-privacy merged | `master` fast-forwarded to the reviewed branch (rollback tag `pre-team-privacy-merge-2026-10-16` = `596b0c5`). Peer WIP committed as `d221be8` before review | verify 846/7 skipped on the branch and on master; E2E below |
| Review defect R-1 (high) | Deleting a workspace or leaving every workspace re-provisioned a new workspace with a **second free trial and credits**, repeatably. Fixed: one trial per person (`0036_trial_once_per_user.sql`, `wp.users.trial_granted_at`, backfilled) | `team.int.test.ts`: both new tests fail without the fix and pass with it |
| Review fixes R-2..R-4 | Erase-coverage guard test (every `wp` table with `workspace_id` is erased or deliberately kept); account deletion offers Sign out; a raw workspace-id debug line removed; dead invitation links no longer redirect later sign-ins | `team.int.test.ts`; E2E 10b |
| Staff console contrast A-4 | Header `mushin.io / admin` (about 3.7:1), "Not pausable…" and workspace ids raised to ≥ 4.5:1 | staff E2E axe, every section |
| Team browser journey | Invitation link in Settings; another signed-in person cannot join (UI and API 403); the invited confirmed email joins and switches workspace; link single-use; owner removes them; export download; account deletion and sign-out; axe on the new pages | customer E2E 3 × 102/102 on master (72 main + 30 after restart) |
| Staff browser smoke (new) | `scripts/e2e-staff/run.sh`: password + authenticator sign-in for Super Admin and Support; role sections; key registration and step-up with Chrome's virtual authenticator; audit shows both bootstraps; Support and keyless Admin refused (403); eligibility coverage card equals the API (12 of 20); axe on all sections | 3 × 31/31 on master |
| Eligibility coverage UI | Overview card over `/admin/v1/ops/eligibility` (counts only); says "not evaluated yet" when documents predate the worker reconcile | staff E2E |
| 90-day rule | Confirmed by the owner; a test pins that count freshness and posting activity are independent | `eligibility.test.ts` |
| Evaluation data | Inventory of every copy: [youtube-eval-data-inventory.md](youtube-eval-data-inventory.md). `purge-eval-data.ts --also <dir>` covers the old temp copies; `--verify` exits 1 while anything remains. Nothing deleted yet (rating data still needed) | dry run and verify run |
| Rating process | Independence rules, workload (413 judgements per rater) and a timetable ending 2026-11-10 in search-quality.md | |
| Search freeze | `freeze-check.ts`: Brain 1 and Brain 2 reproduce the packets byte for byte | |

Final evidence on `master`: verify 847 passed, 7 skipped; customer E2E 3 × 102/102; staff E2E 3 × 31/31; production
build and bundle secret scan pass. Not exercised: real Supabase sign-up and email confirmation (stub tokens carry
`email_verified`), real invitation email (links are shown to copy; no email provider), identity-provider account
deletion (reported as not done), a physical security key.

Environment notes: the machine restarted. Local PostgreSQL was started again with its own data directory, and
Meilisearch with `npm run meili:start`. `mushin_local` is migrated to 0037 but its search documents show 0 eligible
until the worker next starts. The disposable databases `mushin_test_team_claude`, `mushin_e2e_team` and
`mushin_e2e_team_template` and the worktree `../MUSHIN-team` (branch `team-privacy`, merged) can be removed. An
untracked `supabase/` folder (created 14:36, Supabase CLI state including `.temp/start-secrets`) was left untouched
and is not committed.

**Next actions, in order:**
1. Owner: name rater A, rater B and the adjudicator by 2026-10-20 and send the kits (timetable in search-quality.md).
2. After the reports: run the purge with both `--also` folders, then `--verify`, and collect written deletion
   confirmations, by 2026-11-10.
3. When WSL 2 and Docker are ready: Supabase port of 0001–0037 (migration map); only then run the Supabase integration tests.
4. With test accounts: real sign-up and email confirmation through invitations, Paddle sandbox, Resend test domain.

## 2026-10-16 (evening): owner plan model, entitlements and Supabase stages 1–3 (resume here)

Commits: `2f83a68` (server: catalogue, entitlements, refunds, outreach email, export), `50b8b04` (pricing page and UI
from the catalogue; E2E 10c), `aad0dce` (Supabase stages 1–3).

| Plan cell (owner screenshot) | Starter | Growth | Scale | Enforced / proven by |
|---|---|---|---|---|
| Price per month (PKR) | 4,900 | 12,900 | 24,900 | `platform.plans` (0038); `entitlements.int` exact table; E2E pricing page = API |
| Monthly credits | 2,500 | 12,000 | 35,000 | same; monthly credits end at renewal, top-ups never expire (existing billing tests) |
| Campaigns | 3 not archived | unlimited | unlimited | `campaigns.int` (limit, archive frees a slot, restore checked, concurrency lock, downgrade keeps data); E2E |
| Audience details | not included | entitled, globally off | entitled, globally off | `audience.int` (`plan_required`, server switch); pricing shows "Coming soon" |
| Outreach emails per billing period | 0 | 500 | 2,000 | `outreach.int` (quota under concurrency, idempotency, failures free slots, webhooks, suppression); E2E |
| Data export | no | no | yes (CSV, 24 h) | `exports.int` (plan, role, switch, expiry, purge, isolation, downgrade); E2E download |
| Annual billing | not offered | not offered | not offered | `entitlements.int`: yearly checkout/change refused until approved (OD-002) |

Defect found and fixed: concurrent campaign creation could pass the plan limit (no lock); the regression test fails
without the fix. Refunds/chargebacks (Paddle adjustments) are handled under a provisional policy pending OD-009.
Mocked only: Paddle (mock provider), outreach email (test mode; nothing sent), Resend (adapter present, never called).

Supabase (local stack): stage 1 schema parity (suite 873 passed on Supabase PostgreSQL), stage 2 CLI migration workflow
(`supabase db reset` from scratch), stage 3 Auth (10/10 with the API). Stages 4 (Edge Functions) and 5 (pgmq/pg_cron)
not started; Fastify and pg-boss remain. Finding: Supabase access tokens stay valid until expiry after sign-out.

Final evidence on `aad0dce`: verify 875 passed, 7 skipped; build and bundle secret scan pass; customer E2E
3 × (86 + 30) = 116/116; staff E2E 3 × 31/31.

Next: the owner's audit `MUSHIN_AUDIT_2026-10-16` (credential containment and P0 fixes) is the next task.

## 2026-10-17: audit MUSHIN_AUDIT_2026-10-16 (security and release readiness) (resume here)

Audit snapshot 1398cee; work on `master` from `5fc412f` to `HEAD`. Every fix has a regression test that fails without
it, or a recorded drill. New migrations 0041–0047.

| Audit item | State | Evidence |
|---|---|---|
| SEC-01 credential containment | **Owner action**: rotate every credential in `MUSHIN.zip` (it holds `.env`, `.env.meilisearch`, Supabase start secrets); then `scripts/revoke-staff-sessions.ts` | tooling: `scripts/package-source.ts` (git archive + secret scan, CI step), revoke-all |
| SEC-02 staff step-up proven on the server | Fixed | 0041 `staff.step_ups`; webauthn.int |
| SEC-03 invitations trust only the Auth record | Fixed | auth-admin; auth-check 17/17 on local Supabase |
| SEC-04 foreign `X-Workspace-Id` refused | Fixed | 403 `workspace_access_denied`; per-tab selection |
| SEC-05 trusted proxies | Fixed | `TRUSTED_PROXIES` (default none); app.test |
| SEC-06 rate limits fail closed | Fixed | PostgreSQL store by default; config.test |
| SEC-07 first security key | Fixed | 0047 one-time enrolment codes (CLI only), alert on every enrolment; webauthn.int; staff E2E |
| SEC-13 account deletion removes the Auth user | Fixed | team.int; auth-check (re-sign-up with the same address) |
| SEC-14 SPA security headers | Fixed | `dist/_headers` (CSP, frame-ancestors none, HSTS…); csp-check 7/7 in Chrome. Found and fixed: Google Fonts (visitor IPs to Google), development React in local builds (root `.env` NODE_ENV), zod eval probe |
| BIL-01 Live Discovery pricing copy | Fixed | plans.ts `liveDiscoveryRule`; E2E quote text |
| BIL-04 top-ups never expire (database) | Fixed | 0045 check; service.int |
| BIL-05 financial records survive workspace deletion | Fixed | 0042 RESTRICT + trigger |
| BIL-06 one live run per workspace | Fixed | 0045 index; 409 `live_run_in_progress` before any hold; live-service.int |
| SRCH-04/05 paid-run records, shared spend caps | Fixed | 0043; reconciler hourly |
| UX-01 legal pages and consent | Fixed (drafts) | `#/terms` etc., recorded acceptance (0044). **Counsel review (D-13)** |
| UX-02 password recovery | Fixed | PKCE, `#/reset-password`, failed-link screen; recovery-check 10/10 (Chrome + Mailpit, local Supabase). Sign-up confirmation with real SMTP: staging |
| OPS-01 CI without `.env` | Fixed locally | clean clone passes; **hosted remote needed** to run CI |
| OPS-02 reproducible E2E | Fixed | `npm run e2e:template` (synthetic catalogue, fixed non-secret env); old real-data template left for the owner to delete |
| OPS-03 alert delivery | Fixed | `ALERT_WEBHOOK_URL` (required in production), worker heartbeat, events, test alert; drill: worker stopped → critical in 289 s |
| ADR-0001 target architecture | Proposed | `adr-0001-target-architecture.md`; **owner decides D-01** |
| SEC-08, SRCH-06/07/08, SEC-16 | Waiting | touch Search, frozen until ratings |

### Release-readiness matrix

| Area | Feature complete | Integration verified | Release candidate | Production deployed |
|---|---|---|---|---|
| Customer app (search, lists, campaigns, outreach log, billing UI) | Yes | Yes, locally (E2E, mock payments) | No: Search not rated; Paddle sandbox untested | No |
| Live Discovery | Yes | Replay and one live run (13 Oct) | No: Search not rated | No |
| Billing and entitlements | Yes | Mock provider only | No: Paddle account, refund policy (OD-009), retention (OD-013) | No |
| Sign-in (Supabase Auth) | Yes | Local Supabase stack (auth-check, recovery-check) | No: hosted project, SMTP | No |
| Staff console and security | Yes | Local (staff E2E, virtual key) | No: real hardware keys untested | No |
| Alerts and operations | Yes | Local drill | No: webhook channel, error tracker, uptime check, host | No |
| Legal and privacy | Drafts | — | No: counsel review, legal entity name | No |
| Hosting, backups, restore | Restore and key-rotation tooling yes; hosting no | Local restore and rotation drills | No: host choice (D-01), hosted Supabase, backups/PITR, hosted drill | No |

Nothing is production deployed. No paid calls, real email, payments or deploys were made.

Final evidence on HEAD (2026-10-17): verify 915 passed, 7 skipped; frontend build, bundle secret scan and csp-check
7/7 pass; Search freeze check intact (35 + 25, byte for byte); customer E2E 3 × (91 + 40) = 393/393 and staff E2E 3 × 31/31, all on the synthetic template.

Incident (2026-10-17, fixed): a freeze check run with `TEST_DATABASE_URL` set to the eval database truncated the
evaluation corpus; it was rebuilt with its original ids (freeze check intact) and test helpers now refuse `mushin_eval*`.

### DOC-01: documentation discrepancies (audit B, DIS-01..26), 2026-10-17

| DIS | Resolution |
|---|---|
| 01 Top-up expiry | Fixed: never expire, enforced by the database (0030 + 0045, BIL-04) |
| 02 Target architecture | ADR-0001 (proposed): keep Fastify + pg-boss; migration map stages 4–5 "not planned". Owner decides D-01 |
| 03 Rate-limit store | Fixed: PostgreSQL only; Upstash removed (SEC-06, ARCH-03); README updated |
| 04 Serper cache TTL | Fixed in README (15 min, as the code). The 0012 comment ("7 days") stays: migrations are immutable |
| 05 Meilisearch | Fixed in README: PostgreSQL default; Meilisearch optional, self-hosted only, no Cloud. Owner: remove the Cloud key from `.env` |
| 06, 07, 08 Invitations, export/deletion, staff console | Built; the pack's "absent/deferred" status is superseded (pack is the owner's document; update it there) |
| 09 Staff authentication | **Owner decision**: keep MUSHIN's own staff login (now hardened: SEC-02/07/10) or move to Supabase Auth |
| 10 Search status | Fixed: readiness README says Built, **not accepted** |
| 11 Test totals | Fixed: totals only with their commit (this file); README no longer quotes a number |
| 12 Live Discovery price | Fixed: one rule everywhere (BIL-01); README updated |
| 13 Catalogue search price | **Owner decision** (BIL-02): empty searches still cost 50 |
| 14 Live run sizes | Fixed in README: 5, 10, 15 |
| 15 Plan names/entitlements | Done per owner decision 2026-10-16 (0038–0040); annual billing not offered |
| 16 Paid-start limits | **Owner decision**: confirm 20/h per user, 100/h per workspace (code) or the pack's values |
| 17 Catalogue pagination | Waits for Search ratings (SRCH-08) |
| 18 API path model | **Owner decision** (OD-012): approve the `X-Workspace-Id` header model (now with SEC-04: no silent fallback) |
| 19 Audience estimates | Fixed in README: off unless an approved source; the AI never estimates percentages |
| 20 Eligibility requirement | Fixed: traceability ELIG-001 complete (90-day rule confirmed 16 Oct). Add ELIG to the pack (owner's document) |
| 21 Stale traceability rows | Fixed: CREDIT-003, OPS-001, STAFF-001, PLAN-001, PERF-002 updated with evidence |
| 22 14 Oct report | Kept as is (owner's file, preserved); superseded by this record |
| 23 YouTube identifiers | **Owner / counsel** (legal review) |
| 24 Rating workload numbers | Fixed: 413 per rater (222 + 35 + 131 + 25); 273/207 superseded |
| 25 Remote / CI | **Owner**: create a private hosted remote after SEC-01 |
| 26 Who may buy | **Owner decision**: Admins can purchase today (`BILLING_ROLES = {owner, admin}`); confirm or restrict to Owner |

### 2026-10-17 (evening): remaining audit items that need no owner decision

The first pass above stopped short: these items were in the register, needed no decision, and were not done. Now done.

| Audit item | State | Evidence |
|---|---|---|
| SEC-09 key rotation | Fixed | Values carry a key id (v2; v1 still read); `npm run rotate-encryption-key` (dry run, apply, refuses on unreadable values, audited); key-rotation.int; drill: 10 v1 contacts re-encrypted |
| SEC-11 Data API exposure | Fixed | `scripts/supabase/exposure-check.ts` found pg_trgm in Supabase's exposed `public` schema (31 functions, 2 RPC paths); 0048 moves it to `extensions` on Supabase; 0 problems after; full suite on a Supabase cluster DB with it moved: 920 passed |
| ARCH-07 one Supabase project | Fixed | The API refuses `JWT_ISSUER`/`JWKS_URI` on another project than `SUPABASE_URL`. **Owner: the developer `.env` mixes two projects and now fails to start until one is chosen** |
| OPS-04 restore | Fixed (local) | Erasure journal (hashes only) + `ops:after-restore` (re-applies erasures, YouTube expiry, migration and credit checks); `scripts/ops/restore-drill.sh` passes. Hosted backups/PITR, RPO/RTO: owner |
| SEC-10 audit log | Fixed | 0049 hash chain; `ops:verify-audit` + daily digest; staff-audit-chain.int (edit, delete, rewritten head) |
| SEC-15 fabricated content | Fixed | Testimonials and logo components deleted |
| ARCH-03 Upstash | Fixed | Removed (limiter, access cache, packages) |
| DATA-03 export truncation | Fixed | `truncated` list, note and UI warning |
| UX-04 bundle | Fixed | Landing 243 kB gzip (was 320); dashboard and staff console load on demand |
| OPS-05 load | Measured locally | `scripts/load-check.ts`, 200 requests per endpoint: concurrency 10 search p95 160 ms, CRM reads p95 ≤ 96 ms; concurrency 20 search p95 187 ms, reads p95 ≤ 153 ms; all 200, no pool errors. Staging at 2× pilot peak: owner (pilot peak unknown) |
| DOC-01 documentation | Fixed | See the DIS table above |
| Export filename date | Fixed (found on the way) | A test failed after midnight UTC: `createdAt` now uses the service clock |
| ARCH-02 `.env.example` | **Not done** | Reading or editing `.env*` files is blocked by the owner's permission rule. Owner: remove SQS/AWS, Sentry, PostHog, HuggingFace, Vercel, WORKER_SECRET, DATABASE_POOL_SIZE and now UPSTASH_*; revoke the HuggingFace key |
| UX-05 manual accessibility | **Not done** | Needs a person with NVDA/VoiceOver and keyboard (axe checks pass in E2E) |

Final evidence on HEAD (2026-10-17 evening): verify 924 passed, 7 skipped; frontend build, bundle secret scan and
csp-check 7/7; Search freeze check intact; customer E2E 3 × (91 + 40) = 393/393 and staff E2E 3 × 31/31 on the rebuilt synthetic template (0049).
