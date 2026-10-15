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
