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

## 10. Provider evaluation (2026-10-14) — Apify Actors and data vendors

Read-only research: public Apify Store listings, vendor help centres and platform API docs. **No Actor was run, no
provider was enabled and nothing was spent.** "Unknown" means the source does not say.

### 10.1 Baseline (current implementation, verified in code @ba8aad4)

The code matches §4–5: YouTube only; method `yt-commenter-country-v1`:
- 180-day window, 12 videos, 60 commenters per video, 600 commenters in all;
- at least 30 classified for an estimate;
- 95% Wilson intervals;
- age and gender always `not_estimable`.

Results and billing:
- Aggregates only are stored. The test asserts no commenter id or text is kept.
- Credits are reserved on confirmation, committed only for an estimate, and released otherwise. Duplicate requests share one job.
- Off unless `AUDIENCE_SOURCES=youtube`.

Fixed in this pass:
1. Expired estimates were hidden but never deleted. They are now deleted by the 5-minute sweep (Developer Policies III.E.4.b: non-authorised API data at most 30 days).
2. Every result now carries `provenance` (`mushin_estimate`; `provider_estimate` and `verified_analytics` reserved for future sources).

Offline tests: 55 passed (audience module, worker handler, contracts, UI mapping). Live baseline from 2026-10-13 (§6–7):
- estimates for 7 of 33 held-out Pakistani channels (21%);
- median coverage 13.7%;
- accuracy against ground truth not measured.

### 10.2 Candidate inventory

| Actor / source | Wraps | Platforms | Audience fields | How the figures are made | Access / cost | Adoption |
|---|---|---|---|---|---|---|
| `nabeelbaghoor/influencer-search-audience-demographics-api` | Upfluence API | IG, TT, YT (+X, Pinterest, Twitch) | gender, age groups, countries, states, cities; sample size + confidence flag | Upfluence's own model (method not published) | **Own Upfluence subscription required**; Actor $0.015 per audience report + Upfluence credits | 2 users, no ratings, update date not stated |
| `nabeelbaghoor/influencer-search-audience-analytics-api` | HypeAuditor API | IG, YT, TT, Twitch, X | age, gender, countries, languages, audience quality; city not stated | HypeAuditor: ML on followers/commenters; **age and gender by image recognition of profile photos**; no accuracy published | **Own HypeAuditor API plan required** (Basic from about $299/mo; API price unpublished); Actor $0.02 per report | 1 user, no ratings |
| `nabeelbaghoor/instagram-tiktok-youtube-influencer-discovery-api` | Modash API | IG, TT, YT | age, gender, countries, location ids | Modash: follower sample; age/gender by image recognition and profile analysis; location from bios, captions, tags | **Own Modash API plan required** (from about $299/mo; API price unpublished); Actor $0.02 per report | 1 user, no ratings |
| `nabeelbaghoor/influencer-analytics-sponsorship-brand-spend-api` | CreatorDB API | YT, IG, TT | countries, gender, average age, age breakdown | CreatorDB: unknown | **Own CreatorDB key required**; premium-row price not itemised | 2 users, no ratings |
| `seemuapps/tiktok-audience-demographics` | none (collects itself) | TikTok | **country only**; sample size, low-confidence flag | "based on the location of a sample of each creator's followers"; which field gives a follower's country: unknown | **$0.35 per creator**, no subscription; its example sampled 171 followers | 8 users, no ratings |
| `hypebridge/influencer-evaluation-agent-instagram-tiktok` | unknown | IG, TT | "age distribution, gender split", top locations | "Audience demographic estimation"; method unknown | from $0.15 per result; about 3 min per run | 66 users, 95.4% runs succeeded |
| `trysmartapi/youtube-ai-classifier` | none | YouTube | primary age, age distribution, gender split | Not stated. Third parties have no access to YouTube audience analytics, so these can only be **inferred from content**. Not audience analytics | $0.75 per 1,000 results | 52 users, 0 monthly |
| Instagram Graph API `follower_demographics` | Meta (first party) | IG Business/Creator | age, gender, country, city of **followers** | Platform analytics | Free; needs the **creator's authorisation**; at least 100 followers; up to 48 h delay | n/a |
| YouTube Analytics API | Google (first party) | YouTube | viewer age group and gender (signed-in viewers), views by country | Platform analytics | Free; needs the **channel owner's OAuth** | n/a |
| TikTok audience data | TikTok | TikTok | Not public ("TikTok does not expose follower age or gender publicly") | — | Partner programmes only (not verified) | n/a |

Sources:
- the Apify Store page of each Actor (read 2026-10-14);
- help.hypeauditor.com ("how do you detect audience age and gender"; "where does the data come from and how accurate are your reports");
- help.modash.io ("understanding audience demographics and insights");
- developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights.

### 10.3 Assessment against MUSHIN's requirements

- **PRIV-002 (canonical, P0)** excludes AI-estimated audience age, gender or location percentages from MVP outputs unless the data is creator-provided and authorised. Every vendor candidate's age and gender come from image recognition or other modelling of non-consenting followers, as does the YouTube classifier's content-inferred age/gender. They are excluded for the MVP regardless of quality.
- **Pakistan evidence:** no vendor publishes Pakistan coverage or accuracy. Unknown.
- **Wrapper risk:** the four `nabeelbaghoor` Actors are single-developer, 1–2-user, unrated wrappers. Using them sends a paid vendor API key through a community Actor. If a vendor were chosen, its own API is simpler and safer than the wrapper.
- **Terms:** Upfluence's terms restrict API data to "your own internal use", which conflicts with showing reports to MUSHIN's customers unless the contract allows it. HypeAuditor and Modash terms are not on the Actor pages and need contract review.
- **Cost:** vendor plans start around $299/month before per-report fees. That is unjustified while demographics is optional, there are no paying customers and the Apify budget is exhausted.
- **seemuapps (TikTok country):** the only transparent, subscription-free country source ($0.35 per creator). But it collects data about non-consenting followers (the same legal question as §3), the origin of a follower's country is unknown, and it has no age or gender.

### 10.4 Designs compared

| Design | Coverage | Trust | Cost | Policy exposure | Complexity | Verdict |
|---|---|---|---|---|---|---|
| A. Keep the current YouTube commenter-country estimate | YouTube; about 21% of channels; country only | Disclosed MUSHIN estimate | $0 provider | Needs the YouTube derived-metrics amendment | Built | Keep, **disabled** |
| B. One multi-platform vendor (Modash, HypeAuditor or Upfluence) | IG, TT, YT; age, gender, country (city for some) | Unvalidated vendor estimates; AI-inferred age and gender | At least about $299/mo plus per report | Conflicts with PRIV-002; vendor terms (internal use) | New adapter and contract | **Reject for the MVP** |
| C. Platform-specific providers (for example seemuapps for TikTok) | TikTok country only | Sample-based estimate, method partly unknown | $0.35 per creator | Non-consenting follower data | Another adapter and failure mode | **Not justified** |
| D. Creator-authorised analytics as the trusted source; public estimates only as a separate optional feature | IG followers, YouTube viewers, for creators who connect | Verified platform analytics | $0 provider; platform app review | Lowest (consented) | OAuth, token storage, creator flow (not built) | **Recommended direction** |

### 10.5 Recommendation

1. Adopt no Apify demographics Actor or vendor now.
2. Keep audience demographics unavailable by default. Keep the YouTube country estimate disabled until the derived-metrics amendment and a privacy review, and always label it a MUSHIN estimate.
3. Make creator-authorised analytics (design D) the only route to verified demographics. Build it when creators onboard, which is a product decision outside this task. It is also the only source of the consented ground truth needed to evaluate any estimate.
4. Revisit vendors only if the owner wants a paid estimate tier. Then evaluate one vendor's own API directly (not a wrapper), against consented ground truth.

### 10.6 Benchmark (prepared, not run)

What can be validated without paid runs (done):
- schemas and contracts;
- billing, refunds and duplicates;
- expiry deletion;
- provenance labelling;
- the existing harness `scripts/audience-eval.ts` on replay fixtures.

Nobody can measure accuracy without consented creator analytics. Without them, a paid benchmark could only compare candidates with each other (consistency), not against the truth.

Proposed dataset: 20 Pakistani creators per platform across four size bands, ideally creators who consent to share YouTube Analytics or Instagram Insights exports (ground truth). Questions:
- Pakistan share;
- top three countries;
- city or province where offered;
- age;
- gender;
- rate of insufficient data.

Plus: invalid or private profiles, a repeat run after 24 hours (consistency), and cost and latency per report.

**Authorisation required before any live run.** Only if the owner still wants a comparison:

| Run | Actor | Input | Max records | Expected cost | Hard cap |
|---|---|---|---|---|---|
| T1 | `seemuapps/tiktok-audience-demographics` | 5 public Pakistani TikTok creators from a consented list | 5 | $1.75 | Apify `maxTotalChargeUsd` 2.00 |
| T2 | repeat of T1 after 24 h | same | 5 | $1.75 | 2.00 |

Excluded until a vendor subscription is bought: the vendor wrappers ($299+ per month plans). Prerequisites:
- a legal decision that collecting non-consenting followers' locations is permitted (§3);
- re-enabling Apify within its $5 cap.

### 10.7 Migration plan (only if a provider is later approved)

1. Add a provider adapter behind `AUDIENCE_SOURCES` with its own timeout. It writes the same `audienceEstimateBodySchema` with `provenance` set correctly (`verified_analytics` only for creator-authorised data).
2. Acceptance criteria:
   - the decision-grade criteria in §6, against at least 20 consented creators;
   - schema-valid output;
   - refunds on failure and duplicate-safe charging (existing tests extended);
   - storage within the source's terms;
   - core Search unaffected while the provider is down (separate module and queue).
3. Rollout: staging, then an internal workspace, then customers, with the source flag per environment.
4. Rollback: remove the source from `AUDIENCE_SOURCES`. Queued jobs are refunded by the runner; stored results expire and are deleted by the sweep.

### 10.8 The three owner-named wrappers (documentation review 2026-10-14, no runs)

Checked on the Apify listings on 2026-10-14. All three are community Actors by the same author, bring-your-own-key
(the vendor account and subscription are separate and not priced on the listing), read-only, with 1–3 users and no
ratings; build dates are not stated. Example outputs on the listings are illustrative, not real data. Nothing was run.

| | HypeAuditor (`influencer-search-audience-analytics-api`) | Upfluence (`influencer-search-audience-demographics-api`) | Phyllo (`creator-data-connected-accounts-api`) |
|---|---|---|---|
| Data basis | Inferred from public signals (method not documented) | Inferred (method not documented); each field has sample size + confidence flag | Public analytics: inferred. **Connected accounts: from the platform itself, after the creator authorises** |
| Platforms | IG, TikTok, YouTube (+Twitch, X) | IG, TikTok, YouTube (+X, Pinterest, Twitch); audience filters IG/TikTok only | IG, YouTube, TikTok (+Twitch, X) |
| Age / gender | Yes / yes | Yes / yes | Yes / yes (connected: gender × age) |
| Countries / cities | Countries only, **no cities** | Countries, states, cities | Public: countries (cities named, keys not shown); connected: countries, cities |
| Actor fee | USD 0.02 per audience report | USD 0.015 per audience report | USD 0.02 public report; USD 0.01 connected audience report |
| Vendor cost | HypeAuditor plan + report credits (1 per report, unlocked a year) | Upfluence plan + monthly credit allowance | Phyllo plan (staging: 25 connections) |
| Free test | Sandbox rows free | Empty results free | **Sandbox: mock data, never charged** (shape only, not accuracy) |
| Rights | Not stated on listing; vendor terms needed | **Listing: Upfluence terms restrict API data to your own internal use**, which conflicts with showing reports to paying brands | Not stated; connected data needs creator consent and the provider's terms |
| Fit for MUSHIN | Blocked: vendor price, rights unknown, no cities, inferred | Blocked: internal-use restriction | Connected-accounts path matches design D (verified, consented); public inferred path has the same issues as the others |

Conclusion (unchanged in substance from 10.5, now covering these three): do not integrate an inferred-demographics
wrapper. The only route that can show audience age/gender/cities as measured data is creator-authorised analytics
(Phyllo connected accounts or the platforms' own creator APIs). Next free step, if wanted: a Phyllo **sandbox** shape test
(mock data, zero charge) to design the normalised schema; it proves integration shape only. A paid cohort comparison
(same approved creator cohort per provider, field-level coverage and agreement against creator-provided insights) needs:
vendor accounts and price quotes, the owner's spend cap, and a rights review confirming display to paying customers.
The feature stays disabled.
