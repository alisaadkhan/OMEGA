# MUSHIN progress record

Concise, current state of the work against the owner's 2026-10-14 decisions. Update it at every checkpoint. Evidence is
bound to commits; replay results are labelled as replay, never as live-provider measurements.

## Current objective

Search acceptance (Brain 1 catalogue, Brain 2 Live Discovery) on provisional gates: Precision@5 ≥ 0.80, nDCG@10 ≥ 0.75,
≥ 90% relevant-query coverage, from two-person human rating with adjudication. Then the Supabase target (blocked on
Docker), then the remaining customer modules.

## Owner decisions 2026-10-14: implementation state

| # | Decision | State | Evidence |
|---|---|---|---|
| 1 | TikTok-in-scope successful live run ≥ 100 credits (provisional) | Done; never above the quote; failed/empty/canceled unchanged; quote shows the minimum | live-runner.int "TikTok minimum" |
| 2 | Add-by-link 50 for a new import; duplicate without refresh 0; explicit refresh 50; failure 0 | Done; a link found to be a known creator mid-run is now free | discovery-runner.int |
| 3 | Base fee only when a qualified result is presented | Already true (known creators count only when they pass Campaign Fit); now tested | live-runner.int "known only → 50" |
| 4 | Top-ups never expire; monthly credits end at renewal | Done, migration 0030 | service.int, rules.test |
| 5 | City aliases approved (query expansion only) | Recorded | search-quality.md |
| 6 | Multipliers chosen by replay at 2×/3×/4× per platform; cost limit before each batch | Cost limit before every batch done; replay study: see the experiment log | live-runner.int |
| 7 | LLM cap: USD 5 local/staging; explicit production cap; no silent disable | Done | config.test, budget.test |
| 8 | YouTube: derived scores blocked; 30-day refresh-or-delete; document kept identifiers | Done for stored data, migration 0031; see below | source-policy.int |
| 9–13 | Search acceptance, regression, Supabase, customer workflows, staff security | In progress / blocked, below | — |

## YouTube retention: what is kept and why (decision 8)

Source: YouTube API Services Developer Policies, checked 2026-10-14. III.E.4.c/d: API Data at most 30 calendar days
unless refreshed. No exemption is listed for channel identifiers. III.E.4.h: no new or derived data or metrics from API
Data. III.L: extra derived-metric permissions only for audited analytics developers (from 2026-06-01).

After 30 days without refresh, for a YouTube-primary creator MUSHIN deletes or clears: metrics, bio, metric history,
display name (replaced by the handle), avatar (row and stored image), AI summary, niches, city, country, assessments and
Campaign Fit evidence on older results. Raw payloads are already deleted after 30 days.

Kept: the channel **handle and canonical URL**. Lawful only because MUSHIN obtains them outside the API (the Google result
link that found the channel, or the link a customer pasted), and they are needed to honour removal requests and
suppression. **Needs legal review before production.** Live Discovery uses YouTube data for Campaign Fit inside the 30-day
window only; whether that is itself a "derived metric" under III.E.4.h is an open legal question.

## Blocked items and the smallest unblocking action

| Item | Blocker | Unblock |
|---|---|---|
| Supabase target and its E2E | Docker/WSL not installed | Run `wsl --install` as admin, reboot, install Docker Desktop |
| Search acceptance numbers | No human ratings | Two raters fill the rater sheets; a third person adjudicates disagreements |
| Live-provider quality, real costs | No paid-test authorisation | Owner authorises a capped pilot (amount, providers) |
| Paddle, Resend, real Supabase Auth | Vendor accounts | Owner provides sandbox accounts |
| Staff privileged access | Hardware keys, Founder co-sign, consented impersonation not built | Keep blocked; implement after Search acceptance |

## Experiment log

See `search-quality.md` §"Experiment log" for Brain 1 and Brain 2 experiments (hypothesis, change, evidence, outcome).

## Next action

Brain 1: classify each of the 24 empty panel queries as missing data or defect; fix defects with regression tests.
