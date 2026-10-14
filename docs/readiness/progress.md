# MUSHIN progress record

Current state against the owner's 2026-10-14 decisions. Evidence is bound to commits. Replay results are labelled as
replay, never as live-provider measurements. Updated 2026-10-15.

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

## Search: baseline versus now

| Measure | Baseline | Now | How measured |
|---|---|---|---|
| Brain 1 queries with results (35-query panel) | 11 | 15 | Corpus v2, 455 real recorded profiles, same data for both |
| Brain 1 latency p95 | ~88 ms | 58 ms | Same runs |
| Brain 1 empty queries explained | — | 20/20: 13 nothing suitable in the corpus, 7 not creator searches or refused | diagnose-brain1.ts |
| Brain 2 delivered (25 recorded briefs, size 5) | 51 | 77 | Replay, Instagram 2× / YouTube 3× |
| Brain 2 empty briefs | 8 | 5 | Replay; 2 are replay misses (TikTok), 1 is an insufficient pool, 2 are spec-rule rejections |
| Brain 2 settlement | exact | exact | No credits left reserved, no pending trail rows |
| Precision@5, nDCG@10, coverage | not measured | not measured | Needs two raters (93 Brain 1 and 82 Brain 2 rows ready) |

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
| Search acceptance numbers | No human ratings | Two raters fill `brain1-rater-A/B.csv` (93 rows) and `brain2-rater-A/B.csv` (82 rows); a third person adjudicates |
| Live-provider quality, TikTok yield, real costs | No paid-test authorisation | Owner authorises a capped pilot (amount, providers) |
| Paddle, Resend, real Supabase Auth | Vendor accounts | Owner provides sandbox accounts |
| Admin console actions (removal review, provider usage, audit) | No WebAuthn hardware-key sign-in | Build WebAuthn sign-in for staff. Until then, removal requests cannot be approved in the console: the owner must decide how erasure deadlines are met meanwhile |
| Founder co-sign, two-person rule, consented impersonation | Not built (staff UI deferred) | Implement after Search acceptance |

## Owner decisions still needed

- Approve or change the catalogue-only concepts added from the panel diagnosis: cooking, skincare, literature and
  agriculture, with their Urdu forms.
- Confirm the provisional multipliers (Instagram 2×, YouTube 3×) once the Brain 2 ratings exist.
- Set the production `LLM_MONTHLY_BUDGET_USD` (production now refuses to start without it).
- Legal review of keeping YouTube handles and URLs, and of Campaign Fit inside the 30-day window.
- Staff identity: keep MUSHIN's own staff login or move it to Supabase.
- How creator removal requests are processed while admin console actions are blocked.

## Next action

Rate the search sheets (people needed). Meanwhile, the next code work is the WebAuthn staff sign-in and, once Docker is
installed, `supabase init` and porting migrations 0001–0031.
