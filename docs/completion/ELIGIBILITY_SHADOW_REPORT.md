# Eligibility shadow report (29 October 2026)

Dry run over the local catalogue copy `mushin_catalog_v3`: 2,520 profiles (2,520 creators, one profile each).
**The active policy stays `elig-2`.** No status, search document, index, enrichment setting or migration was changed.
Reproduce: `node --import tsx scripts/catalog/eligibility-shadow.ts --db mushin_catalog_v3` (rules:
`scripts/catalog/shadow-policy.ts`, tests `shadow-policy.test.ts`). Data: `inventory/2026-10-29-eligibility-shadow-mushin_catalog_v3/`.
The script stops unless its `elig-2` scenario reproduces the application's own count (387 eligible profiles): it did.

Outcomes: **eligible**; **ineligible** (fails a rule on stored evidence); **review** (needs a person: conflicting country,
possible minor, engagement in a review band); **unknown** (a rule needs evidence MUSHIN does not store; never passed or
failed by assumption). Under every scenario only "eligible" is shown to customers.

## 1. Results per scenario and platform

Eligible / ineligible / review / unknown (YouTube 2,379; Instagram 108; TikTok 33 profiles):

| Scenario | YouTube | Instagram | TikTok |
|---|---|---|---|
| **elig-2 (active)**: 10K own profile, post within 90 days, Pakistani | **371** (15.6%) / 1,926 / 11 / 71 | **16** (14.8%) / 38 / 0 / 54 | **0** / 19 / 0 / 14 |
| TikTok floor 20K | 371 / 1,926 / 11 / 71 | 16 / 38 / 0 / 54 | 0 / 21 / 0 / 12 |
| TikTok floor 25K | same as 20K | same | 0 / 21 / 0 / 12 |
| 50K everywhere (comparison only) | 226 (9.5%) / 2,099 / 9 / 45 | 6 / 62 / 0 / 40 | 0 / 24 / 0 / 9 |
| YouTube upload within 45 days | 347 (14.6%) / 1,953 / 10 / 69 | unchanged | unchanged |
| Post within 30 days, all platforms | 336 (14.1%) / 1,970 / 10 / 63 | unchanged | unchanged |
| Activity must be shown (no post date = unknown) | unchanged | **3** / 38 / 0 / 67 | unchanged |
| Engagement sanity (review < 1.5% for 10K-500K) | 320 / 1,926 / **71** / 62 | 10 / 38 / **29** / 31 | unchanged |
| Research per-post rules (shadow) | **0** / 1,926 / 11 / **442** | **0** / 38 / 0 / **70** | 0 / 19 / 0 / 14 |

## 2. Why outcomes change (rule by rule, against elig-2)

| Scenario | Change | Profiles | Rule |
|---|---|---|---|
| TikTok 20K / 25K | unknown -> ineligible | 2 | follower floor (both were already not eligible: country unknown) |
| 50K everywhere | eligible -> ineligible | YouTube 145, Instagram 10 | follower floor |
| YouTube 45 days | eligible -> ineligible | 24 (+3 from unknown/review) | latest upload older than 45 days |
| 30 days everywhere | eligible -> ineligible | YouTube 35 (+9) | latest post older than 30 days |
| Strict activity | eligible -> unknown | Instagram 13 | no stored post date |
| Engagement sanity | eligible -> review | YouTube 51, Instagram 6 | engagement under 1.5% |
| Engagement sanity | unknown -> review | YouTube 9, Instagram 23 | review outranks missing evidence: these also have an unknown country |
| Research per-post rules | eligible -> unknown | YouTube 371, Instagram 16 | the metric is not stored |

Why profiles are not eligible today (elig-2; a profile can have several reasons): YouTube below 10K 1,727, country unknown
785, inactive 722, foreign 297, possible minor 19, follower count unknown 17, conflicting 14; Instagram country unknown 81,
below 10K 37, inactive 1; TikTok country unknown 33, below 10K 19.

## 3. Threshold and activity sensitivity (profiles that pass every other rule of elig-2)

Follower bands: YouTube <10K 534 · 10-20K 62 · 20-25K 20 · 25-50K 63 · 50-100K 71 · 100-500K 108 · 500K+ 47.
Instagram <10K 10 · 10-20K 4 · 20-25K 1 · 25-50K 5 · 50-100K 2 · 100-500K 4. TikTok: none (no TikTok profile has a
Pakistani country, so no threshold changes TikTok supply today).

Activity (of 408 YouTube profiles passing everything else): post within 30 days 336, 45 days 347, 60 days 355, 90 days 371.
Instagram: 17 pass everything else, but 13 have no stored post date (only 3 have one within 90 days).

**Reading:** a higher TikTok floor changes nothing today because TikTok has no Pakistani-country supply. The 10K-50K band
holds 145 of 371 eligible YouTube profiles and 10 of 16 Instagram ones, so a 50K floor would remove 39% and 63%. Shortening
activity to 45 or 30 days costs 24 or 35 YouTube profiles.

## 4. Data availability per metric

| Metric | YouTube | Instagram | TikTok | Used by |
|---|---|---|---|---|
| Follower count | 2,362 | 108 | 33 | all floors |
| Latest post date | 2,376 | **8** | **15** | activity windows |
| Engagement rate (aggregate) | 2,301 (23 at 0 or 100) | 108 (6 at 0 or 100) | 33 | sanity check |
| Average views (aggregate) | 2,300 | 8 | 15 | view-ratio proxy |
| Country decided | 1,594 | 27 | **0** | Pakistan rule |
| Per-post timestamps, engagement, views; long-form vs Shorts; Instagram post type | **0** | **0** | **0** | research per-post rules |

TikTok research rules, computed only as labelled proxies from aggregates (never applied): aggregate engagement >= 3.5% for
29 of 33; average views / followers >= 15% and >= 20% for 15 of the 15 with views; posting frequency: no data.

YouTube engagement rate and average views are computed by MUSHIN from YouTube API statistics: a derived metric under the
YouTube policy (see `YOUTUBE_RETENTION_REPORT.md`, section 4).

## 5. Review cases (ids in `review-cases.csv`; no handles or names)

| Kind | YouTube | Instagram | TikTok |
|---|---|---|---|
| Possible false positive: eligible, engagement under 1% | 24 | 6 | - |
| Possible false positive: eligible, no stored post date | 0 | 13 | - |
| Possible false positive: eligible, no upload in 45 days | 24 | - | - |
| Low confidence: Pakistan only from the platform-declared country | 345 | - | - |
| Possible false negative: passes everything except an unknown country | 61 | 54 | 14 |
| Possible false negative: 9,000-9,999 followers | 11 | 0 | 0 |
| Possible false negative: last post 91-120 days ago | 4 | 1 | 0 |
| Needs review: conflicting country evidence | 14 | 0 | 0 |

## 6. Policy result, missing evidence, commercial view (kept apart)

- **Policy result:** under elig-2, 387 profiles are eligible. None of the candidate scenarios adds supply; they only
  remove or move profiles to review or unknown.
- **Missing evidence:** the largest losses are missing evidence, not failed rules: 785 YouTube, 81 Instagram and 33 TikTok
  profiles have no Pakistani-country evidence (of which 61 / 54 / 14 pass everything else), and the research per-post rules
  cannot be evaluated at all (0 per-post records).
- **Commercial view (recommendation, not a policy result):** keep 10K and 90 days as the active rule; a 50K floor is not
  supported by this data (it removes most Instagram supply). Treat the engagement band as a staff review signal, not a
  gate, after fixing the 0%/100% values. Do not adopt the per-post rules until the data exists. The supply problem is
  country evidence on Instagram/TikTok and the YouTube retention deadline, not thresholds.

## 7. Missing fields and the decisions that need them (collection deferred)

| Field (per post) | Needed for | Possible source | Notes for the separate approval |
|---|---|---|---|
| Post timestamps (last 10-12) | posting frequency (TikTok 4/30d, Instagram 2/30d), accurate activity | Apify Instagram/TikTok profile actors (return latest posts) | paid; the current Apify budget cap was exhausted; Instagram/TikTok terms review |
| Per-post likes, comments, views | median engagement, median views/followers | same | store medians only, or keep posts with a retention limit |
| YouTube long-form vs Shorts | YouTube long-form activity | official API (video duration) | YouTube data: 30-day rule, refresh needed (YouTube report) |
| Instagram post type (Reel/post) | format tags | Apify | as above |

No collection, provider call or new retention obligation was started. A proposal with cost and retention design needs
separate approval.

## 8. Sequence (unchanged)

Review this report -> owner approves a policy version -> apply statuses, exclude ineligible creators from customer
search and routine enrichment -> validate Meilisearch and Catalogue Search -> Live Discovery end-to-end acceptance.
