# How MUSHIN decides a creator's niche (as the code works on 2026-10-27)

This describes the code in the working tree, not an ideal classifier. In one sentence: **deterministic evidence rules
read the bio first and recent posts second; Gemini is asked only when the rules' reading is not trivially clear; every AI
answer is checked against the taxonomy and the creator's own words before it can be stored.** It is neither purely
semantic nor dictionary-only.

## Where each step lives

| Step | File | Function |
|---|---|---|
| Provider fetch | `packages/integrations/src/scrapers/apify.ts`, `youtube.ts` | `fetchProfile` |
| Standardise the raw response | `apps/api/src/modules/creators/enrichment/standardize.ts` | `standardize` |
| Build the evidence (bio, category, posts) | `enrichment/attribute-evidence.ts` | `deriveAttributes` |
| Rules reading | `enrichment/niche-evidence.ts` | `classifyNiche`, `readPosts`, `labelsIn` |
| Taxonomy and word forms (English, Roman Urdu, Urdu) | `apps/api/src/modules/creators/terminology.ts` | `NICHE_TAXONOMY` (23 labels), `NICHES_V2` |
| Semantic (Gemini) reading and validation | `enrichment/semantic-niche.ts` | `semanticNiche`, `semanticSchema` |
| When the AI runs | `enrichment/pipeline.ts` | `deriveWithSemantics` |
| Store niche, confidence, evidence | `enrichment/repository.ts` | `placeAttributes`, `replaceAttributeEvidence`, `saveReassessment` |

## What each platform supplies (existing integrations only)

| | Instagram | TikTok | YouTube |
|---|---|---|---|
| Provider | Apify `apify/instagram-profile-scraper` (build 0.0.634) | Apify `clockworks/tiktok-profile-scraper` (build 0.99.2065) | Official YouTube Data API |
| Bio field | `biography` | `signature` | channel `description` |
| Platform category | `businessCategoryName` (often "None") | none | none |
| Recent post text | post `caption` + `hashtags` | video `text` + `hashtags` | video `title` + `tags` |
| Post text used for niche | yes | yes | **no** while `YOUTUBE_CONTENT_EVIDENCE` is off (policy gate) |
| Country field | none | none | `snippet.country` (declared by the channel owner) |
| Follower count | `followersCount` | `fans` | `subscriberCount` (hidden = unknown) |

Hashtags are read only as part of a post's text: a niche from posts needs the same subject in at least 3 posts and at
least 40% of the recent posts read (or 25% with a clear lead), so one hashtag or one video never decides it.

## Decision flow

```
standardised profile
  │
  ├─ bio + platform category → word forms of the 23 labels (contact boilerplate such as "for business inquiries" removed)
  │     one subject clearly ahead? ──yes──► main niche from the bio
  │                                          (unless ≥4 recent posts clearly show another subject: posts win, bio marked conflicting)
  │
  ├─ otherwise recent posts (max 12; YouTube: none while gated)
  │     one subject in ≥3 posts and ≥40% ──► main niche from posts (secondary: other subjects in ≥25%, at most two)
  │     exact tie between two subjects ──► the earlier AI assessment may break it, else Variety
  │     several subjects, none dominant ──► Variety
  │
  ├─ short bio (≤300 chars) listing several subjects, no posts ──► Variety
  ├─ long bio naming many things in passing, no posts ──► Unknown (BUG-09)
  └─ nothing usable ──► Unknown
        │
        ▼
  "clear"?  one structured category, or a short bio with one subject, no negation/contrast words, posts not pointing elsewhere
     yes ─► stored as is, no AI call
     no  ─► Gemini (if NICHE_SEMANTIC=on, an LLM is configured, and the text is permitted; never on gated YouTube text)
              reply rejected unless: labels ∈ taxonomy · every quote appears verbatim in the bio/posts · unknown has no niches
              a model "high" becomes "medium" unless the rules found the same main niche
              failure or invalid reply ─► the rules' reading stands
```

The display name is recorded as weak evidence only and never decides ("Marketing Mughal" is not a marketing creator).
"How to"/"tutorial" count for Education & How-to only when no other subject is named, so "how to make biryani" is Food.

## What is stored

- `gcp.creators`: `niche_main`, `niches` (main first, then up to two secondary), `niche_status` (`classified`, `variety`,
  `unknown`), `niche_confidence` (`high`, `medium`, `low`), `niche_assessed_at`.
- `gcp.creator_attribute_evidence`: one row per observation with its source (`profile_text`, `post_text`,
  `account_category`, `display_name`, `ai_assessment`), status (`supported`, `weak`, `conflicting`) and a quote.

## Failures and conflicts

- Provider failure or private/missing profile: nothing is re-derived; the last good reading stays (lifecycle rules).
- Gemini error, timeout or invalid JSON: the rules' reading is kept; Ollama is tried as the fallback model first.
- A later AI reassessment never overwrites evidence-based niches (`saveReassessment`, BUG-01).
- A low-confidence or unknown new reading never replaces earlier niches the text supported (`placeAttributes`).
- YouTube: 794 catalogue creators keep niches that earlier video-title evidence supported; their posts are not re-read
  while the policy gate is off (see the inventory).

## Country (for the Pakistan-only rule, 0060)

Per profile, from that profile's own bio and, for YouTube, the channel's declared country; a country the creator confirmed
applies to all their profiles and wins (`enrichment/country-evidence.ts` `deriveCountry`, `profileCountry`).

| Bio says | Result | Why |
|---|---|---|
| "Based in Pakistan", "Living in Islamabad, Pakistan" | Pakistan, creator-stated, high | residence with the country named |
| "Lives in Lahore", "Based in Karachi", "📍 Islamabad" | Pakistan, creator-stated, medium | explicit residence in a known city (`enrichment/city-country.ts`), not verified |
| "Based in Dubai", "Lives in Toronto" | that country (excluded) | same rule, city of another country |
| "Based in Hyderabad" | unknown | Hyderabad is in Pakistan and India; resolved only with the country named |
| "Pakistani food blogger", "I am from Pakistan" | Pakistan, creator-stated, medium | nationality attached to a creator role; origin stated about the creator |
| "From Lahore", "Born in Lahore", "Travelling in Dubai", "#lahore", "lahore_eats" | not residence | origin, travel, hashtags and usernames never establish where the creator lives |
| "Food vlogger in Lahore", "Lahore food vlogger" | unknown | no residence verb (deliberately conservative) |
| Bio says Pakistan, platform says another country; two places of residence | conflicting | kept visible for review, never silently overwritten |

Stored per profile: `country`, `country_source`, `country_confidence`, `country_status`
(pakistan/foreign/unknown/conflicting), `country_reason` (the creator's own words, and for a city which city and
country), `country_checked_at`; each change of status is a "location" lifecycle event. City list: the owner-maintained
Pakistani city concepts (search uses the same list) plus a curated list of foreign cities common in Pakistani creators'
bios; ambiguous names are marked as such.

## Accuracy

**Not measured.** The 150-row stratified review sheet (`eval-v2/niche-benchmark/review-mushin_catalog_v3.csv`) is
waiting for two human raters (instructions: `eval-v2/niche-benchmark/RATER-INSTRUCTIONS.txt`). On 28 October it was
regenerated with the same 150 profiles plus each profile's own country decision (`country_status`, `country_reason`), so
raters check the Pakistan-only rule customers see; 0 rater cells are filled. Until then no accuracy figure exists for the baseline or for the current algorithm, and
more labels or more confident labels are not evidence of better accuracy. See `INVENTORY.md` for what is measured.
