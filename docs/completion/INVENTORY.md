# Catalogue inventory: `mushin_catalog_v3`, 27 October 2026

Measured by `scripts/catalog/inventory.ts` (read-only) against the local copy `mushin_catalog_v3` (migrated to 0061).
Eligibility is evaluated with the application's own rule, so the counts are what customer search shows.

- Before (rule elig-1, country not checked): `inventory/2026-10-27-mushin_catalog_v3-before/`
- After (rule elig-2: Pakistani profiles only, with the city-residence correction): `inventory/2026-10-27-mushin_catalog_v3-after/`
- Each folder: `summary.json`, `overall.csv`, `niches.csv`, `countries.csv`, `crosstab.csv` (platform × main niche ×
  profile country, with the 10,000 rule and eligibility), `coverage.csv` (23 labels × 3 platforms).
- Coverage targets: `inventory/coverage-targets-2026-10-27.csv`. Country run logs: `inventory/profile-countries-*.json`.
- Reproduce: `node --import tsx scripts/catalog/inventory.ts --db mushin_catalog_v3 --label <name>`.

The backfill figures in earlier reports are historical; everything below is measured from the database today.

## A. Creators and profiles

| Measure | All | YouTube | Instagram | TikTok |
|---|---|---|---|---|
| Creator records (all `active`) | 2,520 | | | |
| Platform profiles | 2,520 | 2,379 | 108 | 33 |
| Creators with 1 / 2 / 3 platforms | 2,520 / 0 / 0 | | | |
| Duplicate profile links; same handle on two creators | 0; 0 | | | |
| Suspected duplicate identities (same display name) | 14 | | | |
| Availability: available / private / not found / unconfirmed | 2,520 / 0 / 0 / 0 | | | |
| Meets 10,000 on its own profile (count ≤ 90 days old) | 720 | 635 | 71 | 14 |
| Follower count unknown | 17 | 17 | 0 | 0 |
| Below 10,000 | 1,783 | 1,727 | 37 | 19 |
| Country: Pakistan | 1,310 | 1,283 | 27 | 0 |
| Country: foreign | 297 | 297 | 0 | 0 |
| Country: unknown | 899 | 785 | 81 | 33 |
| Country: conflicting (review) | 14 | 14 | 0 | 0 |
| **Eligible for customer search** | **387** | **371** | **16** | **0** |
| Excluded (kept, not deleted) | 2,133 | 2,008 | 92 | 33 |

Every creator in this catalogue has exactly one platform profile: no creator is linked across platforms yet, so the
creator and profile counts coincide. A profile can have several exclusion reasons, so the reasons below overlap:
country unknown 899, foreign 297, conflicting 14, inactive (no post in 90 days) 720, possible minor/blocked 19.

### Before and after the Pakistan-only rule

| | All | YouTube | Instagram | TikTok |
|---|---|---|---|---|
| Eligible before (elig-1) | 658 | 574 | 70 | 14 |
| Eligible after (elig-2 + city residence) | 387 | 371 | 16 | 0 |

Instagram and TikTok lose most profiles because their bios rarely state a country and neither Apify Actor returns one.

## B. Niches (per profile; niche is stored per creator)

Main niche only (a secondary niche is never counted as a main one). The "eligible" column is after elig-2.

| Label | YouTube main (eligible) | Instagram main (eligible) | TikTok main (eligible) |
|---|---|---|---|
| Food | 244 (45) | 18 (6) | 9 (0) |
| Travel | 99 (14) | 8 (1) | 0 |
| Education & How-to | 98 (15) | 0 | 0 |
| Tech | 96 (19) | 0 | 0 |
| Business & Ecommerce | 95 (21) | 1 (0) | 2 (0) |
| Beauty | 81 (14) | 5 (1) | 1 (0) |
| Gaming | 75 (13) | 0 | 0 |
| Comedy | 53 (12) | 0 | 2 (0) |
| Lifestyle | 38 (5) | 4 (1) | 0 |
| History | 35 (7) | 0 | 0 |
| Entertainment | 33 (7) | 0 | 0 |
| Finance | 32 (9) | 3 (0) | 0 |
| Wellness | 30 (2) | 5 (0) | 0 |
| Fashion | 28 (5) | 5 (0) | 1 (0) |
| Automotive | 21 (5) | 0 | 0 |
| Literature | 20 (4) | 1 (0) | 0 |
| News & Commentary | 16 (5) | 0 | 0 |
| Sports | 16 (2) | 0 | 0 |
| Bridal | 13 (5) | 13 (2) | 0 |
| Religion | 11 (2) | 0 | 0 |
| Agriculture | 9 (6) | 0 | 0 |
| Real Estate | 7 (4) | 0 | 0 |
| Music | 5 (0) | 0 | 1 (0) |
| **Sum of the 23 labels (classified)** | **1,155 (221)** | **63 (11)** | **16 (0)** |
| Variety | 14 (1) | 17 (3) | 0 (0) |
| Unknown (assessed, no reliable niche) | 416 (53) | 26 (2) | 14 (0) |
| Not assessed under the 0054 model | 794 (96) | 2 (0) | 3 (0) |
| **Total (= profiles; = eligible)** | **2,379 (371)** | **108 (16)** | **33 (0)** |

Reconciliation (generated, `summary.json` → `reconciliation`, checked by the script on every run): every platform's
four statuses add up to its profile count, the 23 label counts add up to the classified count, and the eligible split
adds up to the eligible count. **Correction (2026-10-28):** the earlier version of this table showed "Unknown or not
assessed 1,150 / 25 / 17". Those numbers added the overlapping diagnostic "no niche evidence rows at all" (356 / 23 / 14)
to the not-assessed count instead of the real Unknown status (416 / 26 / 14), so YouTube appeared 60 short and Instagram
3 short; TikTok only matched because both figures are 14. No creator was missing; the report row was wrong. The
"221 eligible YouTube profiles with a main niche" was correct: the other 150 eligible YouTube profiles are Variety (1),
Unknown (53) or not assessed (96), and so count toward no niche target.

- Not assessed under the 0054 model: YouTube 794 (they keep niches earlier video-title evidence supported; video text is
  not re-read while `YOUTUBE_CONTENT_EVIDENCE` is off), Instagram 2, TikTok 3. Diagnostics that overlap the statuses
  above (never added to them): no niche evidence rows at all, YouTube 356, Instagram 23, TikTok 14.
- Main-niche source: YouTube and Instagram main niches all come from the bio/channel description; TikTok 6 of its 16 from
  recent post text. AI-decided main niches stored: 0. Low-confidence main niches: 0; conflicting niche evidence: 0.
- Confidence and secondary counts per label: `niches.csv`.

## C. Countries

Per profile (the customer rule), by source:

| | Creator-confirmed | Creator-stated (high: country named) | Creator-stated (medium: city residence or origin statement) | Platform-declared (low) |
|---|---|---|---|---|
| Pakistan | 0 | 51 | 90 | 1,169 |
| Foreign | 0 | 14 | 9 | 274 |

Unknown 899, conflicting 14, stale 0 (no country evidence is older than a year). No creator has confirmed a country yet.
Per-creator resolved countries (all stored ISO codes, Pakistan 1,295 at creator level before this work): `countries.csv`.
Cleared as unsupported in the 26 October backfill (historical): 234.

Pakistani-eligible profiles by platform and main niche: `crosstab.csv` (eligible column) and the table in B.

## D. Coverage matrix and targets (owner targets 2026-10-28; measured 2026-10-28)

`inventory/2026-10-28-mushin_catalog_v3-final/coverage.csv`: all 69 platform × label combinations with stored,
eligible, initial and long-term targets and deficits. Counts below are eligible profiles whose **main** niche is the
label (secondary niches are not counted as main; eligible profiles without a main niche are not in any label).

| Platform | Initial milestone | Long-term target | Labels meeting initial | Labels meeting long-term | Initial deficit | Long-term deficit |
|---|---|---|---|---|---|---|
| YouTube | 10 per niche | 20 per niche | 8 of 23 | 2 of 23 | 82 | 265 |
| Instagram | 10 per niche | 20 per niche | 0 of 23 | 0 of 23 | 219 | 449 |
| TikTok | 5 per niche | 10 per niche | 0 of 23 | 0 of 23 | 115 | 230 |

Initial milestone met: YouTube Food (45), Business & Ecommerce (21), Tech (19), Education & How-to (15), Beauty (14),
Travel (14), Gaming (13), Comedy (12). Long-term met: YouTube Food, YouTube Business & Ecommerce. Every Instagram and
TikTok label is below its initial milestone. Budget and blockers: `CATALOGUE_GROWTH_PROPOSAL.md`.

## E. Records added and updated in this work

- **New creator records added: 0.** No permitted source was used to fetch new creators: Apify and Serper calls need
  approval, YouTube collection is gated, and brand imports stay private to their workspace. The catalogue did **not**
  expand.
- **Updated:** every one of the 2,520 profiles received its own country decision (migration 0060, `profile-countries.ts`,
  run twice: the second run changed nothing). 22 profiles (14 Instagram, 8 YouTube) moved from unknown to Pakistan with
  the city-residence correction. Each change is a "location" lifecycle event.
- **Quality before/after:** country evidence per profile went from none to 1,621 profiles with a decided country
  (1,310 Pakistan, 297 foreign, 14 conflicting). Niche **accuracy is not measured** (no human ratings yet).

## F. Where growth is possible

| Source | What it can give | Status |
|---|---|---|
| Stored data (this catalogue) | Re-reading stored bios and channel countries | Done (no cost) |
| YouTube Data API (official) | Channel description, declared country, subscriber count | Free but **gated**: further collection waits for the owner's YouTube policy decision |
| Apify `apify/instagram-profile-scraper`, `clockworks/tiktok-profile-scraper` | Bio, followers, recent captions/hashtags, IG business category; **no country field** | Paid: needs approval and a budget (the account's US$5/month cap was exhausted earlier) |
| Serper web search (Live Discovery candidates) | Profile links to fetch | Paid: needs approval |
| Creator confirmation (claims) | Creator-confirmed country, the strongest source | Not built: needs the claims flow and consent wording |
| Brand CSV imports | Brand's own notes | Private to the workspace; never shared into the catalogue |
