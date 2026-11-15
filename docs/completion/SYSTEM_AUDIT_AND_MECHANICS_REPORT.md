# MUSHIN — System audit, mechanics and pilot (14–15 November 2026)

Owner plans of 2026-11-14 (unified plan Phases 1–7; complete master implementation plan Phases 1–8). Local catalogue
`mushin_catalog_v4` only; nothing pushed; live untouched. **The full-database re-verification has NOT been run: it
waits for the owner's go-ahead after this pilot.**

## 1. Self-audit findings and fixes

| # | What was broken | Where | Affected | Fix |
|---|---|---|---|---|
| 1 | Instagram category "Artist" counted as a creator, so actresses/actors who pick it (Ayeza Khan, Sarah Khan, Danish Taimoor) were "individual creators" | `account-type.ts` category table | searchable 1M+ accounts | "Artist" alone no longer decides; creator words do |
| 2 | Traditional celebrities with no category and no role word in the bio (Hania Aamir, Sajal Aly, Mahira Khan, Maya Ali, Farhan Saeed) cannot be told apart by any rule | — | 71 searchable accounts of 1M+ with type UNKNOWN | **Open, owner decision** (see §4) |
| 3 | AI niche reading thrown away whole when one quote differed by punctuation | `semantic-niche.ts` | every such reply | quotes checked one by one (60% word overlap); no grounded quote, no niche |
| 4 | Bio hashtags deleted before niche/location reading (`#TechBlogger`, `#Lahore` lost) | `attribute-evidence.ts` | all bios with tags | words kept (camelCase split); location ignores 3+-tag SEO lists |
| 5 | YouTube video descriptions, category ids, channel keywords never read; captions cut at 500 chars | `standardize.ts`, `youtube.ts` | all YouTube | kept (captions 2,000) |
| 6 | Reel views given only as `videoPlayCount`/`playCount` missed; TikTok `bioLink` objects dropped | `standardize.ts` | some Reels / TikTok links | read |
| 7 | Contacts only in video descriptions never captured | `links.ts` | **41 YouTube channels** (e.g. J FF, ReviewsPK) | last-5 fallback, `video_description` source |
| 8 | Rate limits silently dropped AI work: Groq 2,494 and Ollama 1,498 refused assessment calls in bulk runs; ~190 unusable replies | `openai-compatible.ts` | October bulk runs | 5-model chain, per-model cooldowns, reset headers, no same-model retry |
| 9 | One-way links let a look-alike account merge into a real creator; minors and open removal requests could be merged | `identity-merge.ts`, 0085 | 14 of 58 local merges | strict rules; 14 merges reversed |
| 10 | Live Discovery did not apply the account-type exclusion | `live-runner.ts` | live runs | same exclusion before delivery or charge, and already on the search results (pre-screen) |
| 11 | YouTube retention did not clear description-derived contacts/evidence or a non-primary YouTube profile's photo | 0084, 0087 | merged creators | cleared |
| 12 | `merged_from_creator_id` missing from the Drizzle model | `schema/creators.ts` | — | added |
| 13 | Reprocessing a stored answer stamped "fetched today" (false freshness) | `build.ts reprocess` | pilot only | real fetch time kept |
| 14 | **"Apify refused the token" was wrong: the token was valid.** The publishers deleted the pinned builds (Instagram 0.0.634, TikTok 0.99.2065); Apify answers 403 `build-not-found` and the client called every 403 a token problem | `config.ts`, `apify.ts` | **every Instagram/TikTok fetch, live too once pushed** | re-pinned to 0.0.689 / 0.0.522 (checked live through the pipeline); the error now names the missing build |
| 15 | **Instagram no longer gives view counts** to the profile scraper (builds 0.0.689 and 0.99.2889 both return Reels with no views) | provider | Instagram typical views on every refresh from now | the profile says "No view counts on recent videos" instead of "Not enough recent posts"; **owner decision** (see §4) |
| 16 | The profile and card said "Policy restricted for YouTube" for any missing YouTube metric, although YouTube metrics are on by owner override | `CreatorProfilePanel.tsx`, `SearchCreatorCard.tsx` | YouTube channels with too few videos | the API's own reason is shown (`metricsNote`, new card `engagementNote`) |
| 17 | The profile opened on the platform of the card clicked, not the creator's main platform, and other platforms were only in "Full profile" | `CreatorProfilePanel.tsx` | 38 multi-platform creators | opens on the main platform; a tab per platform switches every number, the tick and the handle |
| 18 | "Not publicly listed" printed twice; "confirmed" printed twice in the location line | `CreatorProfilePanel.tsx` | every profile | once each |

Checked and fine: **0 tag pills** anywhere in the frontend (removed in earlier commits; the unused `tags` field is now
gone from the frontend model too); freshness parity — `followers_updated_at` equals `last_scraped_at` on all 3,424
profiles (0 differ by more than a day), so the 30-day "current/aging" rule reads the last successful fetch; 10K–99K
creators with no bio niche stay searchable (niche Unknown only); elig-3 is only a profile badge; contact redaction runs
only in AI prompts, after extraction; `migrations/` and `supabase/migrations/` identical.

**Not done here:** the overdue deletion of YouTube Search-evaluation data (owner deadline 12 Nov) — the purge tool was
blocked by the safety classifier; run `PG_BIN=<pg bin> node --import tsx scripts/search-eval/purge-eval-data.ts --confirm`.
The Instagram post actor's pin (0.0.812, live discovery "content resolution", off by default) is also deleted upstream;
it needs its own review before being re-pinned. No live discovery run was made for Phase 1 (paid searches); the changes
are covered by unit and database tests.

## 2. System mechanics

**A. Accept / drop**

| Stage | Instagram | YouTube | TikTok |
|---|---|---|---|
| 1 Discovery | role queries ("food vlogger", "tech reviewer") in round 1; 20 results per search; rounds continue until the pool holds max(20, 2 × requested); a post or reel result becomes its author's profile when the title names the author | same | video links resolve to the profile |
| 2 Pre-screen (search results) | brand, game, media, shop, fan page, celebrity → dropped before any paid fetch | same | same |
| 3 Account type (fetched profile) | same list → `account_not_individual_creator` (creator words always keep a creator) | same | same |
| 4 Location | Pakistan or Pakistani diaspora (own words) kept; links, post locations and caption evidence read; non-Pakistani excluded; unknown/conflicting kept but not searchable | + channel country, descriptions | same |
| 5 Eligibility | Pakistani profile, 10K+, counted in 90 days, active | count within 30 days | 90 days |

**B. Attributes:** blue tick = the platform's own badge per profile (YouTube's API has none, so never inferred) ·
photo = copied on every fetch, per profile · niche = Tier 1 bio/About; Tier 2 only at 100K+: 5 YouTube titles+tags or
6 Instagram/TikTok posts' tags+captions, 2 hits needed; else Unknown · freshness = under 30 days Current, else Aging ·
ER = median of 10 non-pinned posts (per follower on Instagram, per view on TikTok/YouTube), 0 never stored · typical
views = median of comparable videos (Reels; YouTube long-form and Shorts apart) · IQ/authenticity = signals + AI,
labelled an estimate.

**C. Contacts (one state, same on cards and profiles):** Email & mobile available · Email available (Unverified /
Verified) · Mobile available · Collab route in bio ("DM for collab": nothing to reveal) · Not publicly listed. Each
email and mobile line says where it was found: bio/About, business contact button, or video descriptions. Active
catalogue: none 2,679 · mobile 314 · email 252 · collab route 91 · email & mobile 44 (searchable: none 451 · mobile 116 ·
email 76 · collab route 25 · email & mobile 21).

## 3. Pilot (10 accounts, 14–15 Nov)

Fetched live: YouTube on 14 Nov (official API); Instagram and TikTok on 15 Nov (Apify, re-pinned builds). Every field
from `scripts/catalog/pilot-report.ts` (the API's own functions); the full output is kept out of git (YouTube API data).

| Creator | Main profile (fetched) | Followers | ER | Typical views | Tick | Niche | Contact | Type / search |
|---|---|---|---|---|---|---|---|---|
| Ducky Bhai | [youtube.com/@duckybhai](https://youtube.com/@duckybhai) (14 Nov); tab: [Instagram](https://instagram.com/duckybhai) (2 Nov) | YouTube figures removed¹ | — | — | — | Unknown | Email (bio/About) | creator · shown |
| ReviewsPK | [youtube.com/@reviewspk](https://youtube.com/@reviewspk) (14 Nov) | YouTube figures removed¹ | — | — | — | Tech (bio) | Email (video descriptions) | unknown · shown |
| AJ FF | [youtube.com/@ajffbt](https://youtube.com/@ajffbt) (14 Nov) | YouTube figures removed¹ | — | — | — | Gaming (bio) | Email (video descriptions) | creator · shown |
| SAMAA TV | [youtube.com/@samaatv](https://youtube.com/@samaatv) (14 Nov) | YouTube figures removed¹ | — | — | — | News (posts) | Not publicly listed | brand/media · **excluded** |
| Sajal Ali | [instagram.com/sajalaly](https://instagram.com/sajalaly) (15 Nov) | 12.07M | 0.49% | — no view counts | ✓ | Unknown | Not publicly listed | unknown · shown (§4.2) |
| Kamal Hussain Sadiq | [tiktok.com/@tastebykamal](https://tiktok.com/@tastebykamal) (15 Nov); tabs: [Instagram](https://instagram.com/tastebykamal) (3 Nov), [YouTube](https://youtube.com/@tastebykamal) (20 Oct) | 185.6K | 2.94% | 39.6K (6) | — | Food (posts) | Mobile (bio/About) | unknown · shown |
| Jannat Mirza | [tiktok.com/@jannatmirza](https://tiktok.com/@jannatmirza) (15 Nov) | 25.6M | 8.78% | 893K (6) | ✓ | Unknown | Email (bio/About) | creator · shown |
| Ghana Ali Umair | [instagram.com/ghanaaliofficial](https://instagram.com/ghanaaliofficial) (15 Nov); tab: [TikTok](https://tiktok.com/@ghanaaliraza) | 1.26M | — likes hidden | — | ✓ | Lifestyle (posts) | Not publicly listed | celebrity · **excluded** |
| Marryam Mughal | [instagram.com/foodcreationsbymarryam](https://instagram.com/foodcreationsbymarryam) (15 Nov) | 142K | 0.29% | — no view counts | — | Food (bio) | **Collab route in bio** | creator · shown |
| Farhan Saeed | [instagram.com/farhan_saeed](https://instagram.com/farhan_saeed) (15 Nov) | 4.30M | — likes hidden | — | ✓ | Fashion (posts; check) | **Email & mobile** (bio/About) | unknown · shown (§4.2) |

¹ Per-channel YouTube figures (subscribers, ER, views) were removed from this file on 15 Nov: YouTube API data may be kept 30 days at most
(Developer Policies III.E.4.b), and git keeps it for ever. All ten: location Pakistan (confirmed), photo stored, freshness Current. Spend this pilot: Apify about $0.05, Groq
about $0.01; recorded catalogue spend about $6.06 of the $15 cap. Apify account month: $3.32 of its $5 limit.

## 4. Catalogue snapshot and go/no-go

Active 3,380 (44 merged into others; 38 multi-platform). Searchable 689: Instagram 311, YouTube 376, TikTok 19.
Account types (stored, before re-verification): individual 1,153 · unknown 1,938 · shop 159 · celebrity 67 · brand 31 ·
fan page 17 · media 8 · company 7. Verified profiles 502; diaspora 14; ER exactly 0: none.

Owner decisions before the full run:
1. Go-ahead for the full re-verification (reassessment + evidence backfill on all creators, from stored data; no paid
   fetch).
2. The 71 searchable 1M+ accounts of unknown type (e.g. Sajal Ali, Farhan Saeed): AI world-knowledge check, staff
   review queue, or leave.
3. Instagram typical views: accept "no view counts" from now on, or add a Reels actor for views (extra Apify cost per
   creator; Apify's free plan allows $5 a month and $3.32 is used).
4. Run the eval-data purge (overdue since 12 Nov).
5. Live sync of migrations 0074–0087 and push (every push deploys to Vercel Production; the Apify re-pin fixes live
   Instagram/TikTok fetching once deployed).
