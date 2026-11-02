# Final report: search, catalogue, testing credits and verification (28 October 2026)

Branch `feat/internal-completion-and-search-acceptance`, HEAD e292915, **all changes uncommitted and undeployed**.
Local databases only: `mushin_catalog_v3` (catalogue copy), `mushin_test_claude` (integration), `mushin_e2e` (browser).
No paid Apify, Serper or Gemini call; no real email or payment; no YouTube collection; `.env` not read; the unrelated
`.env.example` deletion left as it was. The persistent Meilisearch (:7700) stayed stopped; the Meilisearch tests ran
against a throwaway instance (127.0.0.1:7711, data in the session scratch folder, random key never printed, only test
indexes), stopped afterwards.

**Migrations 0060 and 0061** are applied only to local databases on localhost:54330 (checksums equal the repository files;
Supabase copies identical): `mushin_catalog_v3`, `mushin_test_claude`, `mushin_e2e` and its template (rebuilt from
0001 on every browser run, so the clean path is exercised), and `mushin_frz_elig2_disposable` (upgrade path 0042 → 0061
on real catalogue data). The frozen corpus `mushin_eval_disposable` is unchanged at 0042. **No hosted or production
database was migrated.**

## 1. Catalogue size and Pakistani-eligible counts (measured 2026-10-28)

| | All | YouTube | Instagram | TikTok |
|---|---|---|---|---|
| Creators / platform profiles | 2,520 / 2,520 | 2,379 | 108 | 33 |
| Meet 10,000 followers on their own profile | 720 | 635 | 71 | 14 |
| Country: Pakistan / foreign / unknown / conflicting / stale | 1,310 / 297 / 899 / 14 / 0 | 1,283 / 297 / 785 / 14 / 0 | 27 / 0 / 81 / 0 / 0 | 0 / 0 / 33 / 0 / 0 |
| **Eligible for customer discovery** | **387** | **371** | **16** | **0** |

Niche status per platform, from one snapshot (classified + variety + unknown + not assessed = profiles): YouTube
1,155 + 14 + 416 + 794 = 2,379; Instagram 63 + 17 + 26 + 2 = 108; TikTok 16 + 0 + 14 + 3 = 33. Eligible split (main niche
+ variety + unknown + not assessed): YouTube 221 + 1 + 53 + 96 = 371; Instagram 11 + 3 + 2 + 0 = 16. The earlier
"1,169 + 1,150" figures mixed in an overlapping diagnostic; the generator now checks these sums on every run
(`summary.json` → `reconciliation`), and `INVENTORY.md` records the correction.

Every creator has exactly one platform profile (no cross-platform links yet). Excluded profiles are kept (locked), each
with its reason. Files: `inventory/2026-10-28-mushin_catalog_v3-final/`, `INVENTORY.md`.

## 2–3. Coverage by niche and target milestones

Targets (owner, 2026-10-28): YouTube and Instagram 10 per niche initially, 20 long-term; TikTok 5 and 10.

- Initial milestone met: **8 of 69** combinations, all YouTube: Food 45, Business & Ecommerce 21, Tech 19, Education &
  How-to 15, Beauty 14, Travel 14, Gaming 13, Comedy 12.
- Long-term target met: **2 of 69** (YouTube Food, YouTube Business & Ecommerce).
- Deficits, initial / long-term: YouTube 82 / 265, Instagram 219 / 449, TikTok 115 / 230.
- Per-label figures for all 23 labels × 3 platforms: `coverage.csv` (main-niche counts only; secondary niches are not
  counted as main).

## 4. Records added or updated

- **No new creator records were added; the catalogue did not grow.** Every permitted growth source needs a budget or
  the YouTube decision (see `CATALOGUE_GROWTH_PROPOSAL.md`).
- Updated (27 Oct, from stored data only): every profile's own country decision; 22 profiles resolved to Pakistan by
  the city-residence rule. No new updates today; the second run changes nothing.
- Checked today, at no cost: the stored Apify payloads contain no country field (TikTok `authorMeta` has no `region` in
  the pinned build; Instagram has no About section), so there is no free country evidence left to mine.

## 5. Monthly testing credits: exact behaviour

- 500 credits per Asia/Karachi calendar month for an account's **first provisioned workspace**, granted only when the
  Auth server confirms the email (`verifyEmail`, the same check invitations use). Unverified at sign-up → no grant; the
  first visit after verifying grants it (on `/v1/me`, under the person's lock).
- One allowance per account (`users.testing_allowance_at`); invited memberships and later workspaces never receive one;
  distinct email accounts each receive their own. One ledger grant per workspace and month (unique reference
  `testing:<workspace>:<YYYY-MM>`).
- The month's lot expires at 00:00 PKT on the 1st; unused credits become `expire` ledger rows; the next month's grant is
  a new lot. Purchased (`topup`) and `adjustment` lots are never touched; testing lots are a separate source throughout.
- Without a plan, trial or top-up: testing credits pay for catalogue search and contact reveal only; Find New Creators and
  Update info are refused by the server and disabled in the UI with "Needs a plan or trial: testing credits cover
  catalogue searches and contact reveals only." The Billing page shows what is left and when it renews.
- The API role may create only this month's bounded testing lot at sign-up (row-level security, migration 0061).

## 6. Zero-result search charging (final)

- A completed search with **no eligible creator costs 0** and records no charge.
- A search with results costs **50 credits once per logical search**; pages, sorting, repeats and retries after a lost
  response within 30 minutes are free (the charge row and the window now use one clock, BUG-33).
- A failed search is never charged (the charge runs after the answer).
- When more creators matched than were ranked, the response says `complete: false` and the page says the results are the
  best matches, not all of them. When few match, the page says MUSHIN's catalogue has limited coverage.
- Free empty probing is limited by the existing per-IP and per-user rate limits (unchanged).

## 7. Tests (see `TEST_REGISTER.md` for every case)

| Suite | Result |
|---|---|
| Backend unit | 580 passed |
| Frontend unit | 74 passed |
| Integration (`mushin_test_claude`) | **726 passed, 0 failed**, 3 known failures marked in advance, 7 skipped (live-provider suites, no paid call); **0 files blocked**: the four Meilisearch files ran on a throwaway instance |
| Browser, PostgreSQL search (real UI → API → worker → PostgreSQL) | journey **108/108**, break-it **54/54** (incl. country lock CTY-0..7, zero-result ZR-1..3, fee FEE-1, allowance TA-1..2), after full restart **54/54** |
| Browser, Meilisearch search (throwaway instance) | journey **108/108**, break-it **54/54**, after restart **54/54** (first run 53/54: ZR-3's query matched every fixture on Meilisearch; test fixed, no product change, BUG-34) |

Rechecked in this pass: zero-result and charge rules (`search-charge`, `credits`, testing-allowance suites, 83 tests);
Pakistan-only lock by id, link lookup, reveal, Update info, add-by-link and across workspaces (CTY-I05/06 extended,
browser CTY-0..7). Search freeze: see section 8 and FRZ-02.

Defects found in this round, each reproduced, fixed and retested with a regression test: BUG-31 (billing banner said
search and reveal were lost), BUG-32 (reveal, Update info and add-by-link bypassed the Pakistan-only lock), BUG-33
(charge window used two clocks). Test-only fixes: CR-02..10 and CR-10 searched an empty catalogue; three unit tests timed
out once under load and passed on rerun.

## 8. Blocked or not run

| Item | Why | Action |
|---|---|---|
| v1 search freeze as an acceptance test | the frozen packets were rated under elig-1. Rerun on a migrated **copy** (FRZ-02): 24 of 35 queries identical; the 11 that differ lost only creators whose country is now unknown (29) and gained only Pakistani ones (18); shared creators kept their order in every query (no ranking change). Expectations not edited | owner decision: re-rate the 75-row pooled packet (`eval-data/runs/frz-elig2-copy/`) as the new baseline |
| Niche accuracy | two human raters needed; sheet regenerated with each profile's own country decision, instructions added (`eval-v2/niche-benchmark/`); 0 labels filled, none invented | raters |
| Live Gemini, Azure worker, creator claims | approval, `az login`, consent wording | as listed before |

## 9. Security and owner actions

Rechecked: route guards (every route guarded or listed public), workspace isolation and RLS (testing-credit inserts
bounded by policy), ledger integrity (`reconcile` checked in every allowance test), webhook, reveal and outreach paths
unchanged, the new Pakistan-only lock enforced on every per-creator action (BUG-32). Still manual, **not done by me**:

1. Turn on Supabase **Secure password change** (SF-19).
2. Revoke the unused **Groq key** and delete its `.env` line.

## 10. Catalogue growth and later decisions

`CATALOGUE_GROWTH_PROPOSAL.md`: Instagram about US$3.50–4.10 for the initial milestone (Apify, at the measured yield),
YouTube blocked by the policy decision, TikTok blocked by missing country evidence (needs creator confirmation).
Decisions: Apify budget; YouTube policy; build creator confirmation; Serper budget; whether to re-rate search under the
Pakistan-only rule; allowance abuse by many email addresses (no phone/card/domain checks in this phase, by decision).

## 11. Conclusion

**Ready for staging validation; not ready for a controlled pilot; not production-ready.**

- Staging validation can start once the owner approves applying 0060 and 0061 to staging (`yknp…`, pooler only) and
  deploying this uncommitted branch there; every local suite passes on both search backends.
- A controlled pilot additionally needs: the two manual security actions (section 9); a search baseline re-rated under
  the Pakistan-only rule (FRZ-02); measured niche accuracy (raters); and enough eligible creators where pilot brands
  search (Instagram 16 and TikTok 0 eligible today; growth needs the budget and policy decisions in section 10).
- A large green test count is not production readiness: these runs use fixtures, local databases and blank providers.
