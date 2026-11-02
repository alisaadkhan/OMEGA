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
