# Report: Pakistan-only catalogue, inventory, testing credits and testing (27 October 2026)

Branch `feat/internal-completion-and-search-acceptance` (HEAD e292915), uncommitted. Local databases only
(`mushin_catalog_v3`, `mushin_test_claude`, `mushin_e2e`). No commit, push, deploy, paid provider call, real email,
real payment, production change, or new YouTube collection. Meilisearch was not started. `.env` and `.env.example`
were not touched.

## 1–4. Catalogue totals, eligibility and exclusions (measured; details in `INVENTORY.md`)

- 2,520 creators = 2,520 platform profiles (YouTube 2,379, Instagram 108, TikTok 33). No creator is linked across
  platforms; 14 display names repeat (possible duplicates, not merged).
- 720 profiles meet the 10,000-follower minimum on their own profile.
- Country per profile: Pakistan 1,310 · foreign 297 · unknown 899 · conflicting 14 · stale 0.
- **Eligible for customer discovery: 387** (YouTube 371, Instagram 16, TikTok 0), down from 658 under the old rule.
- **Excluded and kept (locked, not deleted): 2,133.** Reasons overlap: country unknown 899, foreign 297, conflicting 14,
  no post in 90 days 720, below 10,000 or unknown count 1,800, possible minor 19.

## 5. How niche detection works

See `NICHE_METHOD.md`: rules read the bio first and up to 12 recent posts second (YouTube video text gated off);
Gemini only when the rules' reading is not trivially clear, checked against the taxonomy and verbatim quotes; failures
keep the rules' reading. Per-platform fields and Actors are listed there.

## 6. Coverage gaps (23 labels × 3 platforms)

`inventory/coverage-targets-2026-10-27.csv`. Proposed targets: 20 eligible profiles per label on YouTube and Instagram,
10 on TikTok (one page of results). Met today: 2 of 69. Deficit 944. TikTok has no profile with Pakistani country
evidence, so every TikTok label is a gap until creators state or confirm their country.

## 7–8. Records added or updated, and the basis

- **No new creator records were added. The catalogue did not expand.** The permitted sources that could add creators
  need approval (Apify, Serper: paid) or a policy decision (YouTube collection).
- Updated: all 2,520 profiles received their own country decision from data already stored (bio, YouTube channel
  country), logged as lifecycle events; 22 more profiles resolved to Pakistan with the city-residence correction.
  Retention: a YouTube profile's derived country is cleared with the other YouTube data after 30 days (migration 0060).

## 9. Data quality before and after

| | Before | After |
|---|---|---|
| Profiles with a decided country | 0 (only per creator) | 1,621 |
| Eligible for customers | 658 | 387 |
| Country evidence stored per profile with source, confidence and quote | no | yes |
| Niche accuracy against human labels | not measured | **not measured** (two raters needed) |

## 10. Tests

| Suite | Result |
|---|---|
| Unit | 580 passed |
| Integration (`mushin_test_claude`) | 684 passed, 0 failed, 3 known failures marked in advance, 33 skipped; 4 files **blocked** (need Meilisearch) |
| Browser (real UI → API → worker → PostgreSQL) | **final run 22: journey 108/108, break-it 49/49, after restart 54/54** (runs 17–21 failed on test assumptions and one flaky check, each fixed in the test; see TEST_REGISTER). Meilisearch index sync was not exercised (stopped) |
| v1 search freeze check | **not run**: it would need migrating the frozen corpus (not allowed), and the approved Pakistan-only rule changes which creators may appear; ranking and query code are unchanged |

New bugs found and fixed: BUG-26 (exhausted testing credits said "choose a plan"), BUG-27 (country source not refreshed),
BUG-28 (erasure kept lifecycle events), BUG-29 (lookup by link revealed excluded creators), BUG-30 (a flaky browser check). All with regression tests.

Exploratory notes (not defects): one person with several email addresses can claim one allowance per address; sign-up still needs a confirmed email and the existing rate limits apply. If that matters, an allowance per verified phone number or per company domain would close it (owner decision).

## 11. Blockers

| Blocker | Action needed |
|---|---|
| Catalogue growth | Approve an Apify budget (Instagram/TikTok) and/or decide the YouTube policy; Serper budget for discovery |
| TikTok has no Pakistani country evidence | Creator confirmation flow (claims) or creators stating their country in bios |
| Niche accuracy | Two raters on `eval-v2/niche-benchmark/review-mushin_catalog_v3.csv` |
| Meilisearch suites | Start Meilisearch when you want those four integration files run |
| Live Gemini check | Key and approval for a paid call |
| Azure staging worker | `az login`, staging settings, Docker running |

## 12. Owner actions and decisions

1. Turn on Supabase **Secure password change** (SF-19). Not done by me; no proof it is on.
2. **Revoke the unused Groq key** and delete its `.env` line. Not done by me.
3. Decide the **zero-result search charge** (kept at 50 credits; the Search page now says so before searching).
4. Confirm that **testing credits without a plan pay only for catalogue search and contact reveal**.
5. Confirm the **coverage targets** (20/20/10) or set your own.
6. Approve deployment of migrations 0060 and 0061 when ready (the allowance would start granting at sign-up).
