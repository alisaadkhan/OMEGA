# On-demand audience estimates — design, method and evaluation (2026-10-13)

Status: **implemented, OFF by default** (`AUDIENCE_SOURCES` empty). Validated locally on YouTube only as internal
pre-launch testing. Not decision-grade: no ground truth exists yet. Evidence labels: **live** = real YouTube Data API
calls (quota only, $0); **test** = automated tests on a disposable PostgreSQL.

## 1. Decision and scope

Brands can request an estimate of a creator's audience without the creator joining MUSHIN. It is optional, explicit,
quoted and confirmed before any work, separate from Brain 2 (own module `apps/api/src/modules/audience`, own queue,
own credit action), and never runs automatically for search results. Creator-authorised analytics and paid demographics
providers remain later ways to improve accuracy, not prerequisites.

## 2. Data sources investigated (what each actually returns)

| Source | Commenter location | Age / gender | Cost | Status |
|---|---|---|---|---|
| YouTube Data API `commentThreads` + `channels` | Channel's self-declared `snippet.country` (optional setting) | None | $0, ~15–26 quota units per estimate (10,000/day) | Implemented, gated |
| Apify `apify/instagram-comment-scraper` (build 0.0.629) | None (id, text, timestamp, username, picture) | None | $0.0026/comment | Not built |
| + `apify/instagram-profile-scraper` per commenter | Bio text only; "About account" add-on gives a country only "if the user filled in this information" | None | $0.0026 + $0.007/profile | Not built |
| Apify `clockworks/tiktok-comments-scraper` (build 0.0.472) | None (text, uniqueId, uid, cid, avatar) | None | $0.00125/comment | Not built |
| + TikTok profile scraper per commenter | Bio text only (no region field in recorded data) | None | ~$0.003/profile | Not built |

Measured feasibility (live, dev channels): 16 Pakistani YouTube channels, 5 recent videos each, 121 quota units —
136 of 780 unique commenters (17.4%) declare a country; **0 of 780** self-disclose an age or pronouns in their channel
description. Channels under ~50K subscribers rarely have enough comments.

Not used, by design: names, profile photos, writing style, comment language, the creator's own location, or LLM output
as evidence of a commenter's country, age or gender.

## 3. Platform policy (blocker for enabling in production)

YouTube API Services Developer Policies (read 2026-10-13): III.E.2.a forbids aggregating API data across channels of
different content owners; III.E.4.h forbids using API data "to create new or derived data or metrics". Section L allows
derived metrics only for developers who accept the "Additional policies for derived metrics and data storage"
amendment (Analytics & Reporting use case, via the YouTube API contact form). That amendment also forbids inferring or
estimating "sensitive protected attributes of the audience", naming age. Therefore:

- The YouTube source may be enabled in production **only after MUSHIN accepts that amendment**. Until then it stays off.
- Age and gender are never estimated from YouTube data, even after the amendment.
- Pre-existing exposure: MUSHIN's YouTube engagement rate (likes/views) is also a derived metric under III.E.4.h.
- Instagram/TikTok commenter collection needs a legal decision on scraping non-creator individuals' profiles, plus
  Apify budget (the user authorised up to $2 for a probe only after that permission is confirmed).

## 4. Method `yt-commenter-country-v1`

Population: **sampled recent commenters**, never "followers" or "viewers".

1. Sample: the creator's uploads from the last 180 days, up to 12 videos, up to 100 newest top-level comments each.
2. Deduplicate: each commenter counted once; the creator's own comments skipped; at most 60 new commenters per video
   (no single viral upload dominates); at most 600 overall.
3. Likely spam removed: commenters who posted a link, or text copied word for word by ≥3 commenters.
4. Classify: a commenter's country = the country their channel declares; unknown stays unknown (counted in coverage).
5. Calculate: share per country among classified commenters with 95% Wilson intervals; countries with <2 commenters
   grouped as "Other"; at most 6 listed.
6. Thresholds (starting values, versioned, evaluated in §6 — not proven): fewer than 30 classified → "Insufficient
   public evidence"; shares shown to 5 points below 100 classified; "moderate" sampling precision only when every listed
   interval is within ±10 points, otherwise "low"; never "high" before validation.
7. Age and gender: always "not estimable" with the reason.
8. Stored: aggregates only (counts, shares, intervals, sample sizes, coverage, dates, method version, quota, duration).
   Commenter ids and texts exist only in worker memory during the run.

Comment order: "time" (newest) chosen over YouTube's "relevance" to avoid favouring popular commenters; the
evaluation found no material coverage difference (§6).

## 5. Product, billing and data handling

- API: `GET /v1/creators/:id/audience` (free: availability, quote, latest job, any unexpired result) and
  `POST /v1/creators/:id/audience/estimate` (`confirmedCost`, Idempotency-Key, `jobs` rate limit).
- Credit action `audience_estimate`, provisional **5 credits** (≈ $0.04–0.05 at plan/top-up prices; provider cost $0;
  the smallest existing paid action). Editable in `platform.credit_action_costs`.
- Settlement: reserve exactly the confirmed quote with the job and outbox event in one transaction; **commit only when a
  country estimate is produced**; release on insufficient evidence, provider failure, disabled source, stuck job
  (sweeper, 15 min) or creator becoming unavailable. Never more than the quote. Commit/release are idempotent; a
  duplicate queue delivery cannot charge twice.
- Duplicates: one open job per workspace and creator (unique index); simultaneous clicks share one job and one
  reservation. An unexpired result the workspace already has is reused free.
- Caching: results are stored per creator (`gcp.audience_estimates`): estimated 30 days (also YouTube's 30-day limit
  for non-authorised data), insufficient 7 days. Another workspace requesting within that window reuses the stored
  result without new collection and pays the same price for access (as with contact reveals); an insufficient result
  is free.
- Plan entitlement (spec D5): the first request per creator per month counts as an audience view (trial/Explorer 5).
- Access: workspace RLS on jobs; a workspace sees only estimates it requested. Possible minors are excluded. Creator
  erasure deletes estimates and all workspaces' jobs.
- Search filtering by audience country stays disabled: estimates are not eligibility filters.

## 6. Evaluation

Harness: `scripts/audience-eval.ts` (panel with dev/test split, both comment orders, optional consented ground-truth
file; aggregates only). Panel: recorded Pakistani channels; dev = the 16 probe channels; test = 33 held-out channels
(10 per band, 3 available at 1M+).

Acceptance criteria for **decision-grade** (defined before any ground truth exists): ≥20 consented test creators across
size bands with creator-provided YouTube Analytics geography; mean absolute error of the top country's share ≤ 10
points; median total-variation distance ≤ 0.20; top country correct in ≥ 90%. Until met, output is labelled
experimental.

Results (live, test split, 2026-10-13, order "time"; "relevance" in brackets):

| Band | Channels | Estimated | Median classified | Median coverage |
|---|---|---|---|---|
| <10K | 10 | 1 (1) | 0.5 | 15% |
| 10K–100K | 10 | 1 (1) | 7 | 14% |
| 100K–1M | 10 | 3 (3) | 10 | 12% (14%) |
| 1M+ | 3 | 2 (2) | 37 | 13% |
| All | 33 | 7 (7), 21% | 4 | 13.7% (14.5%) |

Among estimated channels: median 95% half-width of the top country 10.8 points; split-half (odd vs even videos)
median difference of the top country's share 5.1 points (3.2). Failures 0/66. Collection ~4 s median per channel,
474 quota units for 33 channels. **Accuracy against ground truth: not measured** (no consented data available).

## 7. End-to-end verification (local UI, real YouTube data)

| Scenario | Result |
|---|---|
| Decline the quote | No request sent; balance unchanged (116 → 116) |
| Confirm, sizeable channel (@ajffbt) | ~13 s; PK 75% (likely 65–83%), US 10%, IN 5%, PA <5%, other 5%; 87 of 589 commenters (15%); 5 credits charged; UI equals stored evidence |
| Confirm, thin evidence (@haseebee) | 11 of 230 state a country → insufficient; 5 reserved → released; "No credits used" |
| Revisit | Stored result shown, no request, no charge |
| Provider failure (invalid key) | Failed, message shown, 5 released, retry offered |
| No recent comments | Insufficient, clear reason, no charge |

## 8. Limitations

Commenters are not followers; those who state a country may differ from those who don't; channel country is
self-declared and unverified; small and mid-size channels mostly return insufficient evidence; Instagram and TikTok are
not supported; age and gender are not estimated; the price is provisional; the method is not validated against
ground truth.

## 9. To enable in production

1. Accept YouTube's derived-metrics amendment (Analytics & Reporting); 2. confirm the privacy notice covers it;
3. set `AUDIENCE_SOURCES=youtube` for API and worker; 4. collect consented ground truth and run the harness on the
test split before any decision-grade positioning.
