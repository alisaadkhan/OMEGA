# Catalogue growth: budget proposal for the owner (28 October 2026)

**Nothing here is approved or spent.** No Apify, Serper or Gemini call was made. This proposal uses the measured
catalogue (`inventory/2026-10-28-mushin_catalog_v3-final/`), the costs MUSHIN recorded for past runs
(`platform.provider_calls`), and the providers' public pricing pages read on 28 October 2026.

## Where the catalogue stands

| Platform | Eligible now | Combinations meeting the initial milestone | Initial deficit | Long-term deficit |
|---|---|---|---|---|
| YouTube (10 / 20 per niche) | 371 (221 with a main niche) | 8 of 23 | 82 | 265 |
| Instagram (10 / 20 per niche) | 16 (11 with a main niche) | 0 of 23 | 219 | 449 |
| TikTok (5 / 10 per niche) | 0 | 0 of 23 | 115 | 230 |

Measured yield (eligible ÷ stored profiles): YouTube 15.6%, Instagram 14.8%, TikTok 0%.

Only eligible profiles **with a main niche** count toward a niche target. The other eligible profiles are Variety,
Unknown or not assessed: YouTube 1 / 53 / 96, Instagram 3 / 2 / 0 (reconciled in `INVENTORY.md`). Re-assessing the 96
not-assessed YouTube profiles would need their video text, which stays gated by the YouTube policy decision.

## What each source can and cannot supply (checked, not assumed)

| Source | Country evidence | Cost (public page, 28 Oct 2026) | Recorded by MUSHIN | Status |
|---|---|---|---|---|
| Apify `apify/instagram-profile-scraper` (build 0.0.634) | Bio only. An "About" country exists only with the paid `includeAboutSection` add-on, and only if the creator filled it in. Not enabled; none of the 12 stored payloads has it | US$2.60 per 1,000 profiles (free plan), US$2.30 (Starter), "from" US$1.60 on higher plans | 4 runs, US$0.0234 total | Paid: needs approval |
| Apify `clockworks/tiktok-profile-scraper` (build 0.99.2065) | Bio only. The page's sample shows `authorMeta.region`, but the pinned build does not return it: none of the 16 stored payloads has the field | The page says both "from US$1.00" and "US$5 per 1,000 results" (a result is a video, so one profile costs several results) | 6 runs, US$0.273 total (about US$0.046 per run) | Paid: needs approval |
| Serper web search (Live Discovery candidates) | none | — | 1,925 searches, US$1.04 (about US$0.00054 each) | Paid: needs approval |
| YouTube Data API (official) | Channel country (platform-declared) and description | Free within quota | — | **Gated** by the pending YouTube policy decision |
| Creator confirmation (claims) | Creator-confirmed country (strongest) | Build cost only | — | Not built (needs consent wording) |

## Estimate to reach the initial milestone

Assumes the measured yield holds for new candidates, which is uncertain: Live Discovery already targets Pakistani
queries, so the real yield may be higher; niches with few stored creators may be harder.

| Platform | Profiles to fetch | Profile cost | Discovery searches | Total (estimate) |
|---|---|---|---|---|
| Instagram | about 1,480 | US$3.40–3.85 | about 150–500 (if 3–10 new candidates each) → US$0.08–0.27 | **about US$3.50–4.10** |
| YouTube | about 530 | US$0 (quota) | as above | US$0.03–0.10, **but blocked** until the YouTube policy decision |
| TikTok | cannot be estimated | — | — | **Blocked:** no stored TikTok profile has Pakistani country evidence and the Actor returns none; creators would have to state or confirm their country |

Long-term target, same assumptions: Instagram about 3,030 profiles (about US$7–8 plus searches); YouTube about 1,700.

## Decisions needed

1. An Apify budget for Instagram (about US$4 for the initial milestone, about US$8 for the long-term target, plus a
   margin; the account's earlier US$5/month cap was exhausted). Whether to also pay for `includeAboutSection`
   (extra cost per profile, not priced here) to get the creator-entered country.
2. The YouTube policy decision (collection and content evidence).
3. Whether to build creator confirmation (claims), the only route to Pakistani TikTok profiles under the current rule.
4. A Serper budget for discovery searches (small: well under US$1 at the recorded average).
