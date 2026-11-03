# Overnight completion report: 2–3 November 2026

Branch `feat/internal-completion-and-search-acceptance`. Everything below is **committed locally and not pushed**: the
code relies on migrations 0067–0071, which are applied only to local databases (`mushin_test_claude`,
`mushin_catalog_v4`). Pushing would auto-deploy to Vercel Production against the live database, so it waits for the
owner's go-ahead (see "Sync and deploy", below).

## Catalogue (local catalogue `mushin_catalog_v4`)

| | Before this run | After |
|---|---|---|
| Instagram profiles: Pakistan / unknown / foreign | 233 / 94 / 8 | 263 / 168 / 9 |
| Instagram profiles in search (eligible) | 136 | 178 |
| YouTube profiles in search | 384 | 382 |
| TikTok profiles in search | 5 | 5 |
| Foreign-only creators in search | 0 | 0 |
| Search documents holding an email or phone number | not checked | 0 (367 bios show "[contact hidden]") |

- **Expansion by reference** (`build.ts expand`): 105 Instagram accounts that 3 or more Pakistani creators already in the
  catalogue list as related or @mention were added through the add-by-link path. 30 resolve Pakistani from their own
  bios; 74 stay unknown (mostly celebrities whose bios name no place) and are **not searchable** until a public record
  or staff review confirms them; 1 is foreign. Nothing was asserted from names, faces or language.
- Provider spend: cumulative since 2026-10-20 is **USD 3.33 of the 7.00 cap** (≈ USD 0.0037 per account). About
  USD 3.67 of the approved budget remains. A further 223 candidates referenced by exactly 2 creators are queued; the
  run resumes where it stopped.
- **Quality issue found:** about 15 Pakistani Instagram profiles are organisations, not creators, by Instagram's own
  category (Restaurant, Clothing (Brand), Magazine, Marketing Agency, Gym, Hospitality Service, Dessert Shop and similar,
  e.g. `burgeroclock`, `mkwears_pk`, `divamagazinepakistan`, `elitepr_agency`). They are currently searchable. Excluding
  them is a catalogue rule change and is **left for the owner** (see decisions).

## Security hardening

| Item | Change | Evidence |
|---|---|---|
| Zero-credit search oracle | A search the workspace cannot pay for is refused before it runs, whether or not it would find anyone | `search-charge.int.test.ts` ZR-05 (rewritten), 14/14 |
| Rate-limiter self-lock | Refused requests are no longer counted (migration 0069) | `postgres.int.test.ts` 9/9, new retry-storm test |
| `/v1/creators/lookup` | 30 per user per minute | `creators-api.int.test.ts` (needs Meilisearch, CI) |
| Contacts in bios | Emails and phones hidden in unrevealed bios and evidence quotes, never indexed; links kept | `mask-bio.test.ts`, `projection.test.ts` |
| CSV formula injection | Leading `= + - @` also after spaces and in full-width form; the staff trial-feedback CSV had no protection and now has it | `csv.test.ts` 14/14, `exports.int.test.ts` 5/5 |
| Config cache | Checked: holds only platform-wide values (search settings, niche list, action prices), never workspace data. No change | — |
| Search indexes | GIN on `qualifying_platforms`, btree on `lower(city)`, both partial on `eligible` (0070); planner uses them | EXPLAIN in session |
| `indexState()` / `cardRows()` | Measured: 9 ms for the whole local catalogue (≈ 0.2 s projected at 60K, nightly) and 4 ms for the 1,000-creator pool ceiling. No change needed | EXPLAIN ANALYZE in session |
| Gemini free tier | Providers pause on 429 and 503, honour Retry-After (≤ 15 min) and double the pause on repeats | `llm.test.ts` 16/16 |

## Staff and product (addendum items)

- **Super Admin self-approval (item 5, 0071):** only `credits.grant`, only an active Super Admin; flagged
  `self_approved`, audited, and enforced by a database constraint and trigger. All other approvals keep two people.
- **Catalogue review tab (item 4):** queues for unknown or conflicting countries (5,000+ followers), possible minors
  and pending assessments. Admins set a country only with evidence (stored as a public record, never as the creator's
  own confirmation) or clear a minor flag with a reason; search re-projects automatically. Support can view only.
- **Support queue:** "Credits" on a ticket adds credits in one click (Super Admin) or requests them (Admin), and writes
  an internal note.
- **Search (item 6):** city filter on again (Karachi, Lahore, Islamabad, Rawalpindi, Peshawar, Multan, Faisalabad,
  Quetta); saved searches can be removed.
- **Navigation (item 8):** Inbox, Activity log and "Leave a review" in the sidebar; the "Workspace" heading is now
  "Account".

## Test results (latest runs)

| Suite | Result |
|---|---|
| Unit (Vitest) | 91 files, 622 tests passed (before the city/nav batch); frontend API + lib 80 passed after it |
| Integration, run locally | search-charge 14, rate-limit 9, staffops + staff 45, exports 5: all passed |
| Integration needing Meilisearch | `search.int.test.ts`, `creators-api.int.test.ts`: **not run locally** (no Meilisearch here; downloading the binary was blocked). They run in CI |
| Typecheck (API + frontend), lint | clean |
| Browser, customer | main 108/0, break-it 55/0, after restart 54/0 |
| Browser, staff (incl. axe on every tab) | 34/0, after two fixes: the suite now blanks Gemini like the customer suite, and the review-tab counts met contrast |

## Decisions for the owner

1. **Go-ahead to sync live**: apply 0067–0071 to the live database, run the backfills, then push.
2. **Non-creator accounts**: exclude Instagram profiles whose platform category is an organisation (restaurants, brands,
   agencies, magazines, venues) from search? Proposed as a reviewable flag, not a deletion.
3. **More budget** for the 20K-per-platform target: the expansion averages ≈ USD 0.004 per account, but most famous
   accounts land "unknown" and need public-record research before they count.
4. Earlier open items still stand: CSV/JSON export versus the no-export rule, YouTube decision (due 12 November).

## Sync and deploy (only after approval)

```bash
# 1. Preflight and migrations on the live database (pooler only)
node --env-file=.env --import tsx scripts/ops/migration-preflight.ts
npm run db:migrate            # applies 0067–0071
# 2. Backfills against live (dry run first, then --apply)
node --env-file=.env --import tsx scripts/catalog/engagement-backfill.ts --live
node --env-file=.env --import tsx scripts/catalog/profile-countries.ts --live
node --env-file=.env --import tsx scripts/catalog/public-record.ts --live --manifest docs/completion/seed/owner-named-2026-11-03.json
npm run search:reindex        # plus a full re-sync so bios are re-masked
# 3. Push (auto-deploys to Vercel Production)
git push github feat/internal-completion-and-search-acceptance
```

## Live sync done (owner approval 2026-11-03: "push, hide business accounts")

1. Preflight on yknp…: safe after fixing a stale check (testing credit lots are valid from 0061 on). Schema snapshot
   taken first (`scratchpad/yknp-schema-before-0067.sql`).
2. Migrations **0067–0072 applied**, including **0072 organisation accounts**: an Instagram category that names an
   organisation (restaurant, brand, retail, magazine, agency, gym, salon, venue, school, company...) keeps the account
   out of search; ambiguous categories people also use stay creators; staff restore a person in Catalogue review →
   Organisations. Locally 24 accounts marked (e.g. khaadi, sapphirepakistan, burgeroclock, divamagazinepakistan).
3. Catalogue loaded from `mushin_catalog_v4` (idempotent; no contacts or payloads): live 2,503 → **2,835 creators**.
4. Backfills on live: public record (8 named creators matched), profile countries (146 changed), organisations,
   engagement (118 unsupported rates cleared to empty), full search re-sync, avatars (355 uploaded and linked).
5. Live search now: **Instagram 169, TikTok 5, YouTube 382** creators; 0 organisations, 0 emails, 0 phone numbers in the
   index.
6. Checks before push: unit 657/657, lint clean, typecheck clean, frontend build passes.

## After the push (3 November, continued)

| | Live after the push | Local now (`mushin_catalog_v4`) |
|---|---|---|
| Instagram searchable | 169 → 197 (public records) | 239 |
| TikTok searchable | 5 | 24 |
| YouTube searchable | 382 | 382 |

- **Public records**: 26 Pakistani public figures added by expansion, each with the English Wikipedia article that
  calls them Pakistani, checked against the account's display name (`seed/expansion-public-record-2026-11-03.json`);
  applied locally and live. Accounts without such an article stay hidden; international brands (Huda Beauty, MAC, NYX,
  Too Faced) stay hidden.
- **Own linked accounts**: 92 Instagram/TikTok accounts that Pakistani creators link as their own; 71 created, 21 gone or
  private. A full country pass carried the creators' country to 47 of them (TikTok 9 → 24 searchable). The build now
  runs that pass after every seed and expand run.
- **Customer copy**: "workspace" no longer appears to customers (screens, landing page, API messages); it is "team".
  Staff pages and the legal text are unchanged (a legal wording change needs a new terms version).
- **Expansion resilience**: a provider outage no longer marks a candidate as tried; three in a row stop the run.
- Checks: unit 657/657; integration 729 passed (the 4 Meilisearch files run in CI only); customer browser suite
  108/55/54 with no failures; VAR2-L04 updated to the storefront-city rule.
- Spend: cumulative USD 4.43 of the 7.00 cap. Apify account: USD 2.11 of its USD 5 monthly limit.

**Blocked (network):** from 08:30 this machine lost its connection to Apify, Vercel, Wikipedia, the live database and
finally GitHub. Not pushed yet: the copy change, the build fixes and the public-record manifests (commits after
`c7eeac3`). The next expansion batch (250 candidates, ≈ USD 1), loading the new local creators to live, and the push
resume as soon as the connection returns.

## Second live sync (3 November, later)

- Loaded from `mushin_catalog_v4`: **295 new creators** (live 2,835 → 3,130), 367 links, 1,325 evidence rows; 263 photos
  uploaded and linked.
- Public records now cover **41** Pakistani public figures (Wikipedia, checked against display names; "British
  Pakistani" and redirects to a TV series were left out).
- Live search: **Instagram 288, TikTok 24, YouTube 382** (was 169 / 5 / 382 this morning); 0 organisations, 0 emails,
  0 phone numbers in the index. Spend cumulative ≈ USD 4.9 of the 7.00 cap.
- The machine restarted several times and the network dropped repeatedly; the expansion run now pauses and backs off
  on outages, and every interrupted step was re-run from its idempotent start.

## Third live sync (3 November, evening)

- Migration **0073 ticket priority** applied live (schema snapshot first). Staff set low / normal / high / urgent; the
  queue lists urgent first; customers never see it.
- Owner-named creators: Jannat Mirza (TikTok 25.6M, Instagram 6.3M) added and searchable. instagram.com/mooroo and
  /masoomana turned out to be other people's small accounts: no Pakistan record kept, listed as unresolved.
- Photos: searchable creators without a photo fell from 34 to 9 (Instagram) and 5 to 1 (TikTok) after a re-fetch
  (`build.ts refresh --missing-avatars`); 97 more photos linked live.
- elig-3 dry run on today's catalogue: Instagram 29, TikTok 8, YouTube 0 eligible (elig-2: 342 / 25 / 382). elig-2 stays.
- Live: **3,199 creators; searchable Instagram 297, TikTok 25, YouTube 382**; 0 organisations, 0 emails, 0 phone numbers
  in the index. The expansion keeps running inside the USD 7 cap; its additions go live in the next sync.

## Fourth live sync and navigation (3 November, night)

- Navigation (owner direction): the sidebar shows only Dashboard, Search & Discovery, Shortlists, Campaigns and Inbox
  on the darker navy of the design; Settings, Credits & billing, Activity log, Support, Leave a review, Back to site and
  Sign out are in the profile menu. The Analytics page and the omni bar are removed. The Add to Campaign panel uses the
  mockup's navy and cyan. Settings follows the owner's mockup; the current password is checked before a change; the
  welcome card waits for the Terms dialog (it used to sit under it for brand-new users).
- Catalogue: the expansion added 271 more accounts before Claude Code stopped it for low system memory (not restarted).
  Loaded live: **3,402 creators; searchable Instagram 346, TikTok 25, YouTube 382**; 0 organisations, 0 emails, 0 phone
  numbers in the index; 201 more photos linked.
- Browser suites: customer 108 / 55 / 54 passed, 0 failed; staff 34 passed.

# Master directive 2026-11-03: creator intelligence (4 November)

Commits `86501f0` to `HEAD` on `feat/internal-completion-and-search-acceptance`, **not pushed** (see "Waiting for the
owner"). Migrations 0074–0079 are applied to the local test and catalogue databases only; live is at 0073.

## Implemented

- **Freshness (Part 1)**: under 30 days Current, 30+ Aging, no fetch time Unknown, per platform profile.
- **Search and profile (Part 2)**: City filter removed from search (cities stay on profiles); Refresh profile beside the
  IQ score; free "Reassess" (stored data, no niche, never a discovery run, once per creator per 24 h); every missing
  metric says why (YouTube policy, not collected, too few posts).
- **Niche (Part 3, 0074)**: bio first (role words such as educator, journalist, developer), else 6–9 recent posts read
  together, hashtags only as support; source and posts read stored and shown as "Estimated niche · Based on N recent
  posts". Unknown never matches a niche filter.
- **Location (Part 4)**: five outcomes per profile (Pakistan confirmed, outside Pakistan, Pakistani abroad, unknown,
  conflicting) in the API and the profile; "abroad" only from the profile's own words.
- **Account types (Part 5, 0075)**: individual creator, public figure, company, brand, shop, media, fan page, unknown;
  rules on platform category, bio and handle with a famous-creator safeguard; non-target types leave search (reviewable
  staff override); owner-named creators stay creators.
- **Metrics (Part 7)**: typical views = median of recent comparable non-pinned videos (was the mean); ER = median of
  recent non-pinned posts (per follower on Instagram, per view on TikTok/YouTube); authenticity labelled "Estimate from
  public signals"; contact routes (business/other enquiries, links, linked profiles) from masked bios.
- **Owner decisions (Part 8)**:
  - Attachments (0076): JPG/PNG/WebP/PDF ≤ 5 MB for customers and staff; private bucket with storage-enforced size and
    type limits; signed upload and 60-second download links (always a download); real type from magic bytes; PDF scan
    hook (dictionary tokenizer, Flate/ASCII85/hex decoding, active content refused); 90-day purge after close unless
    legal hold; files removed when a ticket, team or account is erased; no uploads on a closed request.
  - Exports (0077): team owner and admins export every list or campaign; any other member only one they created; members
    see and download only their own exports; every download recorded; contacts never exported.
  - YouTube: audit in `docs/completion/youtube-audit-2026-11-04.md`; retention (0078) now also clears the columns added
    after 0063 (843 account types and 1,197 niche sources locally would have outlived 30 days). No API call made.
  - elig-3 badge: "Meets High-Performance Standard" / "Below View/ER Benchmark" / "Performance Assessment Incomplete" on
    the profile; elig-2 stays the gate. Mooroo = @mooroosicity.
- **Continuous reassessment (Phase 5, 0079)**: bump `REASSESSMENT_VERSION` and the worker re-derives account type,
  performance and country for every active creator, 200 every 15 minutes, resuming from its cursor; stored answers only.
- **Groq** (gpt-oss-120b) between Gemini and Ollama. No OpenRouter variable exists in `.env`, so none is wired.

## Dry run and database updated (local `mushin_catalog_v4`)

Version `reassess-2026-11-04`, report `docs/completion/inventory/2026-11-04-reassessment-mushin_catalog_v4.json`:
below follower minimum 1,071 · location unknown 982 · retained, account type unknown 473 · confirmed non-Pakistani 312 ·
retained individual creators 299 · shops 158 · public figures 63 · brands 28 · fan pages 16 · media 8 · companies 7 ·
possible minors 5. Searchable after apply: Instagram 312, TikTok 25, YouTube 377 (the drop is non-target accounts).
elig-3 badges: Instagram 33 meet / 834 below / 111 incomplete; TikTok 9 / 41 / 15; YouTube all incomplete (policy).

## Five records (Part 9)

`docs/completion/inventory/2026-11-04-metrics-audit-five-records.md`, post by post:

| Record | Stored before | Now | Note |
|---|---|---|---|
| Instagram @duckybhai | typical views 2.52M (mean) | 1.03M median of 9 Reels; ER 6.34% median of 10 | one viral Reel inflated the mean |
| Instagram @mooroosicity | 1.07M (mean) | 185K median of 10 Reels; ER 4.94% | mean was 5.8× the typical Reel |
| Instagram @zaidalit | 3.30M (mean) | 3.15M median; ER 9.58% | consistent creator: mean ≈ median |
| TikTok @jannatmirza | 1.01M (mean) | 901K median of 6 videos; ER 8.79% per view | matches stored |
| YouTube @ajffbt | ER 5.44%, authenticity 98 hidden | shown as "not calculated for YouTube under its API rules" | policy, not missing data |

## Search synchronised

Local only: the reassessment apply re-projected search documents (reconcile). Live search is unchanged until the sync.

## Tested

| Suite | Result |
|---|---|
| Unit | 674 passed |
| Integration (local) | 739 passed, 3 expected-fail, 34 skipped; the 4 Meilisearch files run only in CI. The RLS guard caught that attachments lacked forced RLS: fixed in 0076, rerun 30/30 |
| Typecheck, lint, frontend build | clean |
| Browser, customer | main 108/0, break-it 55/0, after restart 54/0 (first run caught the missing contact-availability line in the profile; fixed) |
| Browser, staff (axe on every tab) | 34/0 |
| PDF scan on real PDFs in the repo | 4/4 accepted; crafted bypasses (escaped names, object streams, hex/ASCII85 chains, indirect filters, predictors) refused |

Verified: the stored ER and typical views of the five records match the post-by-post medians.

## Waiting for the owner

1. **Live sync and push**: apply 0074–0079 to the live database (preflight and schema snapshot first), run the
   reassessment there (it hides shops, brands, media, companies and fan pages from search), then push. The pushed code
   needs those migrations, so the two go together.
2. **PDF scanning**: the built-in scan is strict and passes the real PDFs tried, but a real scanner (e.g. ClamAV) is the
   lasting answer; the scan hook accepts one without code changes elsewhere.
3. Still open: Masoom Ana's handle; Atif Aslam's "Travel" niche (from older post evidence); the YouTube decision due
   12 November; OpenRouter key not present.
