# Final Search acceptance report

**Final Search acceptance report (2026-10-20). Overall: NOT ACCEPTED** (see section H at the end). The first part is the Stage 2 read-only architecture map and baseline, kept as historical evidence; the acceptance campaign follows it.

**Stage 2 of the acceptance mandate (2026-10-20): read-only architecture map, baseline and initial blocker register.**
No acceptance gate has been executed yet. Gates 0–8 start only after the other editing session explicitly confirms that
it has finished (mandate A4/A5). Every status below is therefore **NOT TESTED**, or **BLOCKED** where a prerequisite is
already known to be missing.

## 1. Baseline (observed 2026-10-20, read-only)

| Item | Value |
|---|---|
| Repository | `D:\New folder (2)\New folder (2)\MUSHIN`, branch `master`, HEAD `32e1960` (2026-10-19 23:14 +05:00) |
| Working tree | Clean except long-standing items not created by this work: `.env.example` deleted, untracked `.claude-flow/`, `docs/readiness/MUSHIN_ACTUAL_IMPLEMENTATION_AND_READINESS_REPORT.md`, `scripts/test-local-pg.mjs` |
| Other worktrees | `MUSHIN-team` on `team-privacy` at `12302d0` (2026-10-16), clean, already merged into `master`. No sign of active editing; explicit confirmation still required |
| Runtime | Node 24.20.0, npm 11.19.0, PostgreSQL 17 (portable) |
| Migrations in repo | 0001–0051 (next free 0052) |
| Local PostgreSQL :54330 | Was stopped after a reboot; started for this inspection (crash recovery completed, no data changed) |
| Meilisearch | Not running (optional backend; default catalogue backend is PostgreSQL) |
| Hosted Supabase `yknp…` (staging) | 51/51 migrations, 0 creators, 2 Auth users (2026-10-19) |
| Provider keys in `.env` (presence only) | Apify, Serper, YouTube, Groq, Ollama, Resend present; Paddle absent. **Any app started with `.env` can spend money**: acceptance runs must blank provider keys unless spending is authorised |

### Catalogues available (read-only counts)

| Database | Creators | Search documents | Eligible | Notes |
|---|---|---|---|---|
| `mushin_eval_disposable` (frozen evaluation corpus, migration 0042) | 455 | 455 | 204 | The only realistic catalogue. Must not be modified |
| `mushin_e2e*`, `mushin_local` | 21 | 20 | 0–15 | Synthetic fixtures |
| `mushin_test_claude` | 179 | 0 | 0 | Leftover integration-test data |
| Staging `yknp…` | 0 | 0 | 0 | — |

**Evaluation corpus profile:**
- **Platforms:** YouTube 328 (124 eligible), Instagram 104 (67 eligible), TikTok 23 (13 eligible).
- **No duplicates:** 0 duplicate canonical URLs and 0 duplicate handles.
- **Structured data is empty:**
  - 0 of 455 have a city;
  - 0 have a niche;
  - 0 have contact details;
  - all have `assessment_status = null`.
- **Why:** they were never AI-assessed, and that assessment is the only thing that sets city and niche.
- **Text coverage of cities and topics:** Lahore 29, Karachi 23, Islamabad 7, "food" 75, Urdu script 22.

**Consequence:** structured city and niche filters, and contact display and reveal, cannot be evaluated on realistic data. Location and topic recall rely only on bio and handle text.

## 2. Implementation map (from the code)

### Brain 1: catalogue search
- **Route:** `POST /v1/search` (`creators/routes.ts`).
- **Service:** `CreatorsService.search` (`creators/service.ts`).
- **Steps:**
  1. `understandQuery` (`understand.ts`) is deterministic. It drops filler words, keeps role words for ranking only, and turns a stated platform or follower or engagement range into a filter. Explicit filters always win.
  2. The PostgreSQL search runs (`postgres-search.ts`) over `gcp.creator_search_documents`, the projection described below.
     - Eligibility applies first: the creator is active, not a protected minor, and `eligible_until` is in the future.
     - Recognised niche and city words, in English, Roman Urdu and Urdu script (`aliases.ts`), are expanded to their reviewed forms and matched as phrases. A city also matches the declared city.
     - If whole words match nothing, a trigram typo fallback runs.
     - For name-like queries, a name-skeleton fallback runs.
     - Meilisearch is optional (`CATALOG_SEARCH_BACKEND`), with PostgreSQL as the fallback.
  3. `cardRows` loads the cards under tenant row-level security, `toCards` ranks them (`ranking.ts`), and the server paginates by cursor.
  4. **Charge** (`search-charge.ts`), after the search has answered:
     - 50 credits through `engine.spendInstant`;
     - one charge per (workspace, user, hash of trimmed lowercase text plus filters as sent) within 30 minutes, serialised by an advisory lock;
     - a zero-result search is charged (decision D-05 still open).
- **Caches:** search settings, niche list and prices are cached in process for 60 seconds. There is no result cache.

### Brain 2: Live Discovery
1. **Quote:** `POST` estimate (`discovery/service.ts`, `createEstimate`) prices from `platform.credit_action_costs`:
   - base fee `find_new` 50, plus `live_creator` 10 × size;
   - a TikTok minimum of 100;
   - stored with a price version and the brief hash (text, filters, size).
2. **Confirm:** `startLive` runs in one tenant transaction. It checks the estimate's owner, expiry and hash, and validates the brief (`validateLiveBrief`). It refuses if another live run is open in the workspace. It reserves the quoted maximum (`reserveAmount`), inserts the job and writes the outbox event `discovery.live_requested`. Repeated confirms return the same job (one-open-job index and `mayBeDuplicate`).
3. **Run** (worker, `live-runner.ts`):
   - plan queries, then search through `live/cache.ts`. Serper and YouTube results are cached globally for 15 minutes, holding only public web results;
   - collect candidates and apply the cheap gate (`MIN_POOL` 8, otherwise the outcome is `insufficient` and everything is released);
   - extract with Apify (provider runs are recorded before waiting and resumed on retry);
   - `pipeline.processProfile` standardises, scores signals, runs the AI assessment and saves.
4. **Persistence and delivery are atomic.** `pipeline.ts` runs one `withWorkspace` transaction that does all of the following:
   - `saveEnrichment`: insert or update the creator and profile, identified by `unique(platform, canonical_url)`;
   - writes the outbox event `creator.changed`;
   - calls `onSaved`, which inserts the delivery row (`repo.insertResult`) and re-ranks.

   A delivered result therefore cannot exist without its committed creator row, if the code behaves as read. **Gate 2.1 must verify this against the database.**
5. **Settlement:** `commitPartial` charges the base fee plus new creators (TikTok minimum, never above the quote) only if at least one visible creator was delivered; otherwise 0. The rest of the reservation is released.
   - Cancel, partial and failure have their own settlement branches.
   - If the 15-minute cleanup already released the reservation, the run keeps its creators and charges 0.
6. **Identity:**
   - The canonical URL comes from `normalizeProfileUrl`: lowercase, `www.` and `m.` stripped, and only `instagram.com/<user>`, `tiktok.com/@<user>` and `youtube.com/@<handle>` are accepted.
   - YouTube channels without an `@handle` are skipped, so there are no channel-ID duplicates. A renamed handle becomes a new identity (limitation).
   - There is no cross-platform merging (one creator per platform profile) unless the code links profiles. To be verified.

### Searchability after Brain 2 (persistence vs indexing)
- **Database persistence:** synchronous, in the delivery transaction.
- **Searchability:** asynchronous.
  1. The outbox relay publishes `creator.changed` to pg-boss.
  2. The worker handler `creator-handlers.ts` calls `indexer.sync([id])`.
  3. That upserts the PostgreSQL search document (and Meilisearch if configured).
  4. Drift is repaired by `reconcile()` at worker start and on `creator.reindex_all`.
- **No documented freshness target exists** for the commit-to-searchable delay. This is a specification blocker.

### Credits (one ledger)
- **Code:** `billing/engine.ts`, with `reserve`, `reserveAmount`, `spendInstant`, `commitPartial`, `release`, `extend`, `releaseAbandoned` (15-minute cleanup) and `grant`, on `wp.credit_lots`, `wp.credit_ledger` and `wp.credit_reservations`. A per-workspace lock (`locked`) serialises them.
- **Prices:** in `platform.credit_action_costs`.

| Action | Credits |
|---|---|
| `search_existing` | 50 |
| `find_new` | 50 |
| `live_creator` | 10 |
| `refresh_data` | 50 |
| `refresh_tiktok` | 50 |
| `reveal_contact` | 5 |
| `audience_estimate` | 5 |
| TikTok live minimum | 100 (in contracts) |

- **Plans:** Starter 2,500 credits / Rs 4,900, Growth 12,000 / Rs 12,900, Scale 35,000 / Rs 24,900. Trial: 14 days, 2,500 credits (0050).
- **Conflict:** the mandate's "annual 20% saving" contradicts the owner decision "annual not approved" (2026-10-16). It is not implemented.

### Authorisation and isolation
- **Customers:** the Supabase JWT (ES256, via JWKS) goes to `resolveTenant`. The `X-Workspace-Id` header must be a membership, otherwise 403 with no fallback.
- **Database:** tenant transactions run as `mushin_app` with `app.workspace_id` and `app.user_id`, under FORCE row-level security. System and worker transactions run as `mushin_worker`.
- **Catalogue (gcp):** global. Visibility is checked under tenant row-level security; contacts are encrypted and revealed per workspace (`contact_reveals`).

### Evaluation assets
- **Frozen queries:** `../MUSHIN_RECONCILED_DOCUMENTATION_CANDIDATE/testing/search_eval_queries_unlabeled.csv`. The freeze check reproduced the packets byte for byte on 2026-10-19.
- **Packets:** `eval-data/packets/blind-b1-elig1` (222 rows plus 35 behaviour cases) and `blind-b2-elig1` (131 rows plus 25 cases).
  - **No ratings recorded:** the rater A and B sheets are identical in size and unchanged since 2026-10-16.
- **Gates:** quadratic weighted kappa ≥ 0.60, strict precision@5 ≥ 0.80, nDCG@10 ≥ 0.75, coverage ≥ 0.90, all behaviour cases correct.
- **Brain 2 replay:** every Brain 2 result since 13 October is a replay of recorded provider responses; the live path is unverified.

### TikTok "5 extracted, 0 delivered" (recorded, not yet reproduced)
`docs/superpowers/specs/2026-10-09-live-discovery-erasure-design.md` line 327 records the run:
- 30 Serper results became 28 unique profiles; 5 were extracted.
- Rejections: 4 `individual_creator_unverified`, 1 `off_topic`.
- Outcome `completed_empty`: 162 credits reserved, 0 charged, 162 released.

Per that record, this was validation rejection, not a persistence or delivery failure. Reproducing it needs the recorded payloads. The packets note that some TikTok briefs are "replay misses" (`docs/readiness/search-quality.md` line 244).

## 3. Initial blocker register

| # | Blocker | Affects | Type | Next step |
|---|---|---|---|---|
| B1 | No human ratings; raters and adjudicator not named | Gate 5, overall Search | Owner | Name two raters and an adjudicator; packets are ready |
| B2 | Realistic catalogue has no city, niche or contact data (never AI-assessed) | Gates 1, 2.2 (location and niche variations), contact checks | Data / owner (LLM spend) | Decide whether to assess the corpus (LLM cost) or accept text-only location and niche matching for the evaluation |
| B3 | No live provider evidence since 13 Oct; paid calls not authorised (Apify cap exhausted) | Gates 2, 3 (live), 6 (provider latency) | Owner (D-09) | Authorise the pilot envelope, or accept fixture and replay evidence only |
| B4 | No documented target for commit-to-searchable delay, nor for latency or throughput | Gates 2.2, 4, 6 | Specification | Owner sets targets, or the report records observed values only |
| B5 | Zero-result search charging undecided (D-05) | Gate 3 | Owner | Decide |
| B6 | Annual billing: the mandate says 20% saving, the owner says not approved | Gate 3 pricing oracle | Owner | Confirm which applies |
| B7 | Hosted genuine-token check pending (`CHECK_ACCESS_TOKEN`) | Gate 0.2, 7 | Owner | Sign in once on staging |
| B8 | Explicit confirmation that the other editing session has finished | All gates | Coordination | **Required before Gate 0** |

## 4. Gate status (Stage 2)

| Gate | Status |
|---|---|
| 0 Preconditions | NOT TESTED (waits for B8) |
| 1 Brain 1 | NOT TESTED |
| 2 Brain 2, persistence, variations | NOT TESTED |
| 3 Credits | NOT TESTED |
| 4 Caching, indexing | NOT TESTED |
| 5 Human evaluation | **BLOCKED** (B1) |
| 6 Performance | NOT TESTED (targets missing: B4) |
| 7 Security | NOT TESTED |
| 8 End-to-end | NOT TESTED |
| Overall Search | **NOT ACCEPTED** |


---

# Acceptance campaign (Stages 4–9, 2026-10-20)

The sections above (Stage 2) are kept as the historical baseline.

## A. Build and environment

| Item | Value |
|---|---|
| Handoff | Owner instruction 2026-10-20: treat the previous session as finished. Final read-only check: HEAD `32e1960`; the `MUSHIN-team` worktree was stale (2026-10-16), merged and clean; the only file modified in the previous 10 hours was this report |
| Report status | The Stage 2 baseline was taken before this report existed. The report was then an ordinary untracked file (`??`, not ignored), so `git status` showed five items |
| Tested code | `32e1960` plus this campaign's changes: acceptance suites, logger redaction fix, E2E runner clean-up. All are committed together (see PROGRESS.md for the commit) |
| Databases | Disposable `mushin_test_claude` (reset per suite); the frozen corpus `mushin_eval_disposable`, read-only; one throw-away `mushin_disposable_acc_*` (ENV-01, dropped) |
| Services | Local PostgreSQL 17 on :54330 (restarted after a reboot, no data change) and Meilisearch (restarted for the browser suite); hosted staging `yknp…`, read-only |
| Providers | **Fixtures only.** Every acceptance suite installs a network guard that refuses and records any request to a non-localhost host: **0 external attempts** across all suites. Provider keys were blanked in every test process; ENV-05 proves that blank keys make 0 network calls |
| Real external actions | **None**: no paid provider call, email, payment, deployment or production write |
| Commands | `ACCEPTANCE_EVIDENCE=1 TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54330/mushin_test_claude TEST_DATABASE_SSL_CA_FILE= APIFY_TOKEN= SERPER_API_KEY= YOUTUBE_API_KEY= GROQ_API_KEY= OLLAMA_API_KEY= RESEND_API_KEY= npx vitest run apps/api/src/acceptance apps/api/src/modules/creators/acceptance-corpus.int.test.ts`; `npm run e2e:customer -- 1`; `npm run e2e:staff -- 1` (with `PG_BIN` set) |
| Evidence | `docs/completion/acceptance-evidence/`:<br>- `records/<ID>.json`: inputs, parsed filters, results, balances, ledger rows and timings per test ID;<br>- `corpus-hash-before.json` and `corpus-hash-after.json`;<br>- `connect-check-staging.txt`;<br>- `e2e-results.jsonl`;<br>- `acceptance-evidence/Q-COVERAGE-BOUND.txt` |

## B. Test inventory and results

**Levels:**
- **F**: automated test on a real local PostgreSQL with SYNTHETIC data and fixture providers.
- **R**: real data, read-only (the frozen corpus).
- **E2E**: real browser plus API.
- **H**: hosted staging, read-only.
- **HUM**: independent human evaluation.
- **RP**: real provider.

**KNOWN DEFECT cases** run as `it.fails`. They pass only while the defect persists, which keeps the suite runnable, and this report lists them as **FAIL**.

### Counts

| Area | Planned | Executed | PASS | FAIL | BLOCKED | NOT TESTED |
|---|---:|---:|---:|---:|---:|---:|
| Environment, migrations, safety (ENV) | 9 | 9 | 8 | 0 | 1 | 0 |
| Brain 1 catalogue (B1) | 19 | 19 | 19 | 0 | 0 | 0 |
| Catalogue variations (VAR-C) | 18 | 18 | 17 | 1 | 0 | 0 |
| Brain 2 pipeline (B2) | 16 | 16 | 16 | 0 | 0 | 0 |
| Persistence and deduplication (P) | 9 | 9 | 9 | 0 | 0 | 0 |
| Live variations (VAR-L) | 5 | 5 | 4 | 1 | 0 | 0 |
| Credits (CR) | 21 | 21 | 21 | 0 | 0 | 0 |
| Caching, indexing, outbox (IDX) | 14 | 14 | 13 | 1 | 0 | 0 |
| Security and isolation (SEC) | 13 | 13 | 13 | 0 | 0 | 0 |
| Performance and resilience (PERF) | 10 | 10 | 10 | 0 | 0 | 0 |
| Frozen corpus, real data (CORPUS) | 7 | 7 | 7 | 0 | 0 | 0 |
| Browser journeys (E2E) | 3 | 2 | 2 | 0 | 0 | 1 |
| Human evaluation (HUM) | 5 | 1 | 0 | 1 | 4 | 0 |
| Real-provider integration (RP) | 3 | 0 | 0 | 0 | 3 | 0 |
| **Total** | **152** | **144** | **139** | **4** | **8** | **1** |

How cases were counted:
- B2-10/11/12 share one test and count once.
- VAR-L01/L02/L04 are one test with three briefs and count once.
- SEC-12b is the logger regression test added with the fix.
- Each browser suite counts as **one** case (E2E-01 customer, E2E-02 staff), although they contain 162 and 31 checks.

### Inventory

#### Environment (ENV)

| ID | Requirement | Level | Result | Evidence / note |
|---|---|---|---|---|
| ENV-01 | All 51 migrations apply to a brand-new database; a second run applies none | F | PASS | records/ENV-01 |
| ENV-02 | The test database carries every repository migration | F | PASS | records/ENV-02 |
| ENV-03 | Truncating test helpers refuse the frozen corpus, `_corpus` databases and hosted URLs | F | PASS | records/ENV-03 |
| ENV-04 | Mixed Supabase projects are refused at start-up | F | PASS | records/ENV-04 |
| ENV-05 | Blank provider keys give `not_configured` and 0 network calls (Serper, YouTube search, Apify, YouTube API, LLM) | F | PASS | records/ENV-05 |
| ENV-06 | The frozen corpus is unchanged by the campaign | R | PASS | corpus-hash before/after: 11 tables, 0 changed, 455 creators |
| ENV-07 | The freeze check reproduces the rating packets byte for byte | R | PASS | `freeze-check.ts` intact before and after |
| ENV-08 | No acceptance suite makes an external network request | F | PASS | every suite asserts `externalAttempts == []` |
| ENV-09 | Hosted staging connectivity and token checks | H | **BLOCKED** | See below |

ENV-09 detail (connect-check-staging.txt):
- HTTPS to Supabase timed out from this network during the campaign (curl to supabase.com: 3 of 3 timeouts), while raw TCP to both poolers succeeded in about 360 ms.
- The 2026-10-19 run passed 13 of 13 stages. The genuine-token stage needs `CHECK_ACCESS_TOKEN`.

#### Brain 1 catalogue (B1)

Level F: through the API, on the SYNTHETIC catalogue (15 designed creators plus 30 for pagination).

| ID | Requirement | Result |
|---|---|---|
| B1-01 | Search terms change the results | PASS |
| B1-02 | Results come from persisted, indexed rows; a hidden creator disappears | PASS |
| B1-03 | A multi-word concept matches as a phrase ("skin care") | PASS |
| B1-04 | Platform filter | PASS |
| B1-05 | Follower range as a filter and as text | PASS |
| B1-06 | City filter and short form (khi) | PASS |
| B1-07 | Niche filter | PASS |
| B1-08 | Roman Urdu concept (khana) | PASS |
| B1-09 | Urdu script (لاہور فوڈ بلاگر) | PASS |
| B1-10 | No suitable creator: empty, flagged, never padded | PASS |
| B1-11 | Under-10k and possible-minor creators excluded | PASS |
| B1-12 | Pagination disjoint and complete (24 + 6); next page free | PASS |
| B1-13 | Deterministic ordering over 5 runs | PASS |
| B1-14 | Malformed, oversized, instruction-like and SQL-like input fails safely; no contact leak | PASS |
| B1-15 | A creator with two platforms appears once | PASS |
| B1-16 | Card and profile agree | PASS |
| B1-17 | Typo tolerance for names | PASS |
| B1-18 | Contact availability shown without the value; has-contact filter | PASS |
| B1-19 | Signed-out request refused | PASS |

#### Catalogue query variations (VAR-C)

Method, fixed before running: R is the 8 eligible adult Food creators in Lahore.
- Supported wordings must return exactly R.
- Wordings outside the documented vocabulary are gated on precision only (no result outside R), with recall recorded.
- Controls must return their own set.

| ID | Input | Parsed (text / filters) | Result | Recall vs R | Outcome |
|---|---|---|---|---|---|
| C01 | food vloggers in Lahore | food lahore | = R | 8/8 | PASS |
| C02 | food bloggers in Lahore | food lahore | = R | 8/8 | PASS |
| C03 | food content creators based in Lahore | food lahore | = R | 8/8 | PASS |
| C04 | creators who review restaurants in Lahore | review restaurants lahore | F1 only | 1/8 | PASS on precision; **limitation L1** |
| C05 | YouTubers covering food in Lahore | food lahore, **no platform filter** | Instagram and TikTok included | — | **FAIL (D1)** |
| C06 | food review influencers in Lahore | food review lahore | F1 only | 1/8 | PASS on precision; **limitation L1** |
| C07 | Lahore mein khana walay vloggers | lahore khana | = R | 8/8 | PASS |
| C08 | لاہور کے کھانے والے | لاہور کھانے | empty | 0/8 | PASS (nothing wrong returned); **limitation L1**: inflected Urdu not recognised |
| C09 | exact repeat of C01 | food lahore | = R, same order | 8/8 | PASS |
| C10 | … on TikTok | platform tiktok | F3, F15 | — | PASS (control) |
| C11 | … in Karachi | food karachi | F5 | — | PASS (control) |
| C12 | fashion vloggers in Lahore | fashion lahore | F6 | — | PASS (control) |
| C13 | … with over 100k followers | followersMin 100000 | F1, F8 | — | PASS |
| C14 | … in Quetta | food quetta | empty | — | PASS (control) |
| C15 | LHR foodie | lhr foodie | = R | 8/8 | PASS |
| C16 | food vlogers in lahor | food lahor | = R | 8/8 | PASS |
| C17 | text plus explicit platform filter | platform youtube | F2, F8 | — | PASS |
| C18 | Exact repeat free and same order; equivalent wording charged as a new search | — | — | — | PASS |

#### Brain 2 pipeline (B2)

Level F, with FIXTURE providers.

| ID | Requirement | Result |
|---|---|---|
| B2-01 | A brief without a topic and a place is refused before any hold | PASS |
| B2-02 | Quote = 50 + 10 × size; TikTok minimum 100 | PASS |
| B2-03 | Confirmation reserves exactly the quote; job and outbox event are written together | PASS |
| B2-04 | An estimate is refused for another person, for a second use and after expiry | PASS |
| B2-05 | Insufficient balance: no job, no hold | PASS |
| B2-06 | Provider not configured: honest failure, every credit returned | PASS |
| B2-07 | Transient failure retried; charged once (100) | PASS |
| B2-08 | Pool under 8: `insufficient`, nothing fetched or charged | PASS |
| B2-09 | Every candidate off-topic: nothing delivered, 0 charged | PASS |
| B2-10/11/12 | Private, possible-minor and under-10k profiles are never delivered or charged | PASS |
| B2-13 | Partial delivery (3 of 10) charged 80 = 50 + 3 × 10 | PASS |
| B2-14 | Cancelled before start: no provider call, 0 charged | PASS |
| B2-15 | Cancelled during extraction: only delivered creators charged (0 here) | PASS |
| B2-16 | TikTok, recorded response shape: extracted, none deliverable | PASS |
| B2-17 | Contacts never invented: only an address in the bio is stored (source `bio`, unverified) and never shown in results | PASS |
| B2-18 | Every delivered creator traces to an archived payload and a source URL | PASS |

B2-16 detail: the outcome is `completed_empty`, 0 credits are charged, and every candidate has a terminal decision. This reproduces the reported "extracted 5, delivered 0" pattern: verification gives `individual_creator_unverified`, which is a validation outcome, not a persistence failure.

#### Persistence and deduplication (P)

Level F. Database checks use the owner's own connection.

| ID | Requirement | Result | Evidence |
|---|---|---|---|
| P-01 | Every delivered creator has a committed row that matches the delivery (independent connection) | PASS | 8 of 8 match: id, URL, followers |
| P-02 | A failure inside the save rolls back the creator **and** its delivery row together; others stay committed | PASS | failed creator: 0 rows, 0 results; 3 delivered = 3 committed. The job stays "running" with its credits held until the queue retries it or the stuck-job sweep fails and refunds it (CR-14) |
| P-03 | A known creator is reused (same id, no new row) and delivered free | PASS | |
| P-04 | Duplicate URL forms (www, m., case, tracking parameters) become one candidate and one creator | PASS | |
| P-05 | Different people with the same display name stay separate | PASS | |
| P-06 | The same handle on Instagram and TikTok gives two creators (no cross-platform merge is claimed) | PASS | |
| P-07 | Rediscovery keeps contacts, niche and city, and does not refetch a known creator | PASS | metrics refresh is a separate paid action |
| P-08 | Crash after a committed delivery, then retry: no duplicate creators or results, one spend (130) | PASS | |
| P-09 | Delivered creators reach Brain 1 only after the outbox event is processed | PASS | 0 found before, 8 of 8 after; commit to searchable 215 ms |

#### Live query variations (VAR-L)

Level F.

| ID | Requirement | Result | Note |
|---|---|---|---|
| L01/L02/L04 | Equivalent briefs (food vlogger, food blogger, exact repeat) | PASS | L01 delivers 8 new; L02 and L04 reuse the same 8 as known (no new rows); each charge equals the balance change |
| L03 | The Roman Urdu brief "khana" (Lahore) delivers the same food creators | **FAIL (D2)** | 0 delivered; all 8 rejected at fit as `off_topic`; 0 charged |
| L05 | A changed city means different provider queries and different creators | PASS | |
| L06 | Exact repeat within 15 minutes | PASS | provider searches served from cache (0 web calls), but it is a new run, charged 80 |
| L07 | A changed size gives a different estimate (100 vs 150) | PASS | |

#### Credits (CR)

Level F. Every case reads balances and ledger rows from the tables, not from API messages.

| ID | Requirement | Result |
|---|---|---|
| CR-01 | A search costs 50 once: one spend row; the displayed balance equals the tables | PASS |
| CR-02 | Exact repeat (different case and spacing) is free | PASS |
| CR-03 | The same search after 30 minutes is charged again | PASS |
| CR-04 | Equivalent wording is charged (pricing contract) | PASS |
| CR-05 | A different filter is charged | PASS |
| CR-06 | A zero-result search is charged (current rule; D-05 open) | PASS |
| CR-07 | Insufficient balance: 402, no results, nothing charged | PASS |
| CR-08 | A stale confirmed price is refused (409); the new price applies | PASS |
| CR-09 | 10 simultaneous identical searches produce one charge | PASS |
| CR-10 | 3 searches racing for the last 50 credits: exactly one succeeds, 0 remain, never negative | PASS |
| CR-11 | 5 simultaneous confirmations give 1 job and 1 hold (150) | PASS |
| CR-12 | Live ledger: hold, spend and release reconcile | PASS |
| CR-13 | Provider failure: the run nets to zero | PASS |
| CR-14 | Worker died after the hold: the sweep fails the job (TIMED_OUT) and refunds it | PASS |
| CR-15 | An abandoned hold is released by the cleanup | PASS |
| CR-16 | Duplicate settlement: one charge (the second is a no-op) | PASS |
| CR-17 | One live run per workspace; the second brief holds nothing | PASS |
| CR-18 | A reveal costs 5 once; a key replay and a second reveal are free | PASS |
| CR-19 | Add-by-link: 50 on success, full refund when the provider is not configured | PASS |
| CR-20 | The UI balance equals the tables after mixed operations | PASS |
| CR-21 | Reading or spending another workspace's credits is refused (403) | PASS |

#### Caching, indexing, outbox (IDX)

Level F. Uses the worker's real outbox relay and creator handler.

| ID | Requirement | Result | Note |
|---|---|---|---|
| IDX-01 | The event is written in the save transaction; a rollback leaves neither | PASS | |
| IDX-02 | The relay publishes the event, marks it published, and the handler builds the document | PASS | |
| IDX-03 | A duplicate event leaves one identical document | PASS | |
| IDX-04 | Broker outage: the event is marked failed and retried; the creator row is never lost | PASS | |
| IDX-05 | A handler failure is repaired by reconciliation | PASS | |
| IDX-06 | A leftover document is removed | PASS | |
| IDX-07 | An outdated document is refreshed (change made more than 1 s later) | PASS | |
| IDX-07b | A change in the same second is repaired | **FAIL (D3)** | |
| IDX-08 | A document from an old eligibility version is rebuilt | PASS | |
| IDX-09 | Commit to searchable, with the relay polling as in production | PASS (measured) | n=10: p50 113 ms, p95 202 ms. **No documented target (B4)** |
| IDX-10 | Live-search cache hit within 15 minutes | PASS | |
| IDX-11 | Cache entry expires after the window | PASS | |
| IDX-12 | The cache key covers city, result count and language | PASS | |
| IDX-13 | The shared cache stores no workspace or user | PASS | |

#### Security and isolation (SEC)

Level F. These are limited checks, not a full security audit.

| ID | Requirement | Result |
|---|---|---|
| SEC-01 | No token: 401 on every customer endpoint | PASS |
| SEC-02 | Token signed by a forged key: 401 | PASS |
| SEC-03 | Expired token: 401 | PASS |
| SEC-04 | Wrong issuer or audience: 401 | PASS |
| SEC-05 | Another workspace in the header: 403 `workspace_access_denied` | PASS |
| SEC-06 | Another workspace's job, results or estimate: 404 | PASS |
| SEC-07 | Row-level security blocks cross-tenant reads and writes | PASS |
| SEC-08 | Idempotency keys are scoped per person and workspace | PASS |
| SEC-09 | Contact values appear only in the paid reveal and are stored encrypted | PASS |
| SEC-10 | Paid starts are rate-limited (quotes count too); nothing held when refused (429) | PASS |
| SEC-11 | Malformed JSON 400, oversized body 413, `javascript:` and metadata-IP links refused; no stack or SQL in errors | PASS |
| SEC-12 | Logs redact tokens, secrets, contacts and URL passwords | **FAIL at baseline (D4)**, PASS after the fix |
| SEC-12b | Logger regression test (`packages/core/src/logger.test.ts`) | PASS |

#### Performance and resilience (PERF)

Profile fixed in advance:
- 2,000 SYNTHETIC creators;
- local PostgreSQL 17 on the developer laptop;
- an in-process API;
- no documented targets (B4), so only functional properties are gated.

| ID | Requirement | Result | Measured |
|---|---|---|---|
| PERF-01 | Cold first search succeeds | PASS | 56 ms |
| PERF-02 | 300 warm sequential searches over 20 query shapes | PASS | p50 18.8, p95 40.3, p99 49.2, max 131.9 ms; 0 errors; RSS 337 MB |
| PERF-03 | 20 concurrent clients × 10 searches | PASS | 112 req/s; p50 164, p95 296, p99 345 ms; 0 errors |
| PERF-04 | 300-character query | PASS | |
| PERF-05 | A broad query returns a bounded page | PASS | total 2,000; 24 per page; 21.9 ms |
| PERF-06 | The full-text index exists; query plan recorded | PASS | GIN present; at 2,000 rows the planner chose a sequential scan (1.1 ms), which is expected at this size |
| PERF-07 | 50 racing spends on 100 credits | PASS | exactly 20 succeeded, 0 left, 220 ms |
| PERF-08 | Database outage: readiness reports 503 safely | PASS | 6 ms, no stack |
| PERF-09 | Live run on fixtures (size 10) | PASS | quote 23 ms, run 419 ms, excluding provider latency |
| PERF-10 | A provider failing on every attempt | PASS | failed after 3 attempts; credits restored |

#### Frozen corpus, real data, read-only (CORPUS)

Level R. These are software-behaviour probes, not relevance judgements.

| ID | Requirement | Result | Note |
|---|---|---|---|
| CORPUS-01 | 6 supported equivalent wordings return the identical set on real data | PASS | 7 creators each |
| CORPUS-02 | Outside-vocabulary and control wordings on real data | PASS | See below |
| CORPUS-03 | Text-only coverage probe over the frozen query texts | PASS (probe ran) | See below |
| CORPUS-04 | No duplicate creators in any result list | PASS | |
| CORPUS-05 | Every returned creator is eligible; no contacts are claimed | PASS | |
| CORPUS-06 | Platform filter on real data | PASS | 0 wrong (TikTok 1, YouTube 9, Instagram 23) |
| CORPUS-07 | Deterministic ordering | PASS | |

CORPUS-02 detail (result counts):
- "review restaurants": 1; "review influencers": 2; inflected Urdu: 0.
- Karachi: 7, with 0 overlap with Lahore. Fashion: 1, with 0 overlap. TikTok: 0. Quetta: 0.
- "YouTubers…" returns all 7, which shows D1 on real data.

CORPUS-03 detail: there are 34 texts, because Q021 is filters-only. Q022 is refused as a contradictory range, as the API does. Of the 33 texts searched, 23 returned nothing.

#### Browser journeys (E2E)

These ran on this code with the synthetic template and blank providers.

| ID | Requirement | Result | Evidence |
|---|---|---|---|
| E2E-01 | Customer journeys | **PASS** | 108 + 54 = 162/162, customer-20261020-095047-1 (e2e-results.jsonl) |
| E2E-02 | Staff journeys: per-role sign-in, step-up, refusals | **PASS** | 31/31, staff-20261020-094549-1 |
| E2E-03 | Live Discovery delivered results in the browser | **NOT TESTED** | the browser harness has no fixture-provider mode (providers blank) |

E2E-01 covers sign-in, session expiry, search, pricing, discovery quote and refund, reveal, lists, campaigns, roles, isolation, the trial page, phone width, accessibility and restart persistence.

The first customer attempt failed before testing because Meilisearch was down after the reboot. That is an environment issue, but it exposed a harness defect: the runner left its API running on :4000. This is fixed (D5).

#### Human evaluation (HUM)

| ID | Requirement | Result | Note |
|---|---|---|---|
| HUM-01 | Brain 1: two raters, weighted kappa ≥ 0.60 | **BLOCKED** | no raters or adjudicator |
| HUM-02 | Brain 1: strict precision@5 ≥ 0.80 | **BLOCKED** | |
| HUM-03 | Brain 1: nDCG@10 ≥ 0.75 | **BLOCKED** | |
| HUM-04 | Brain 1: coverage ≥ 0.90 | **FAIL (upper bound)** | See below |
| HUM-05 | Brain 2 human evaluation | **BLOCKED** | |

HUM-04 detail (`acceptance-evidence/Q-COVERAGE-BOUND.txt`):
- In the official frozen run, only 10 of the 28 relevance cases return any result at all.
- So coverage cannot exceed **0.357**, even if raters judged every returned result relevant.

#### Real-provider integration (RP)

| ID | Requirement | Result |
|---|---|---|
| RP-01 | Serper, Apify, YouTube and LLM live runs | **BLOCKED**: not authorised (D-09) |
| RP-02 | TikTok live extraction | **BLOCKED** |
| RP-03 | Live indexing delay through pg-boss on staging | **BLOCKED**: needs an authorised live run |

### Test-design corrections (not product defects)

The original failures were analysed before each correction. The final evidence comes from the corrected tests.

| Case | Original failure | Cause | Correction |
|---|---|---|---|
| B2-09 | Off-topic run delivered creators | The fixture always put food hashtags on posts | Hashtags now follow the bio |
| B2-17 | Bio email not stored | `example.com` is reserved and rejected by design | Non-reserved fixture domain |
| P-03, P-07 | Known creator not delivered or refreshed | A known creator needs an archived sample; known creators are reused, not refetched (by design) | Created through the real pipeline; expectation corrected |
| CR-14 | No stuck job found | The sweep keys on `created_at` | Aged `created_at` |
| CR-16 | Expected a refusal | The duplicate settlement is an idempotent no-op | Assert a single charge |
| IDX-07 | `bigint` returned as a string | Driver type | Numeric compare; same-second case split into IDX-07b |
| SEC-10 | 400, then an unexpected 429 | Estimates need an idempotency key, and quotes count toward the paid-start limit | Header added; limit set to 2 |
| PERF-10 | Run succeeded | The shared 15-minute search cache answered from an earlier test | Uncached brief |
| CORPUS-03 | Crash; 34 texts | Q022 is deliberately contradictory (API returns 400); Q021 has no text | Recorded as refused and as filters-only |
| VAR-L | L03 not asserted in the combined test | Test gap | Split into its own case (D2) |

### Final regression

Full suite in the working tree (`npx vitest run`, `mushin_test_claude`, provider keys blank, Meilisearch running): **137 files: 132 passed, 5 skipped; 1,090 tests: 1,080 passed, 0 failed, 3 expected failures (D1, D2, D3 as `it.fails`), 7 skipped (live-provider suites, need paid keys)**. Browser: customer 162/162, staff 31/31. Clean-clone `npm run verify` at `df23a63` (no `.env`): lint, typecheck and boundaries pass; **1,080 passed, 0 failed, 3 expected failures, 7 skipped**.

## C. Search quality

**Official frozen evaluation:** Brain 1 has 35 cases and Brain 2 has 25 briefs. **No human judgements exist**, so precision@5, nDCG@10, kappa and the relevant-result rate cannot be computed (BLOCKED).

What *can* be computed without judgements comes from the official frozen Brain 1 run (`brain1-results.json`):

| Measure | Value |
|---|---|
| Cases | 35 (7 behaviour-only, 28 relevance) |
| Zero-result rate, all cases | 24 of 35 = 0.686 |
| Relevance cases with any result | 10 of 28 |
| **Coverage upper bound** | **0.357**, against a required 0.90: **FAIL**, independent of ratings |
| Latency in the frozen run | p50 26 ms, max 153 ms |

The real corpus explains this. Of its 455 creators, only 204 are eligible, and none has a structured city, niche or contact. Sentence queries require every topic word, so many queries match nothing.

**Supplementary variation suite:** these results are kept separate from the official metrics.
- **Synthetic catalogue (VAR-C):**
  - Every supported equivalent wording returns exactly the intended set.
  - Controls (city, niche, platform, empty) behave correctly.
  - Wordings outside the vocabulary are precise but recall poorly (1 of 8, 1 of 8, 0 of 8).
  - "YouTubers…" ignores the platform (D1).
- **Real corpus (CORPUS-01/02):** the same pattern holds. The six supported wordings return the identical 7 creators.
- **Live (VAR-L):**
  - Equivalent English briefs reuse the same creators with no duplicate rows.
  - The Roman Urdu brief delivers nothing (D2).
  - City changes are not served from another brief's cache.
- **Duplicates:** 0 duplicate identities across all suites and the real corpus.
- **Unsupported contacts:** 0. Only bio-sourced addresses are stored, labelled unverified, and never shown before a paid reveal.

## D. Credit integrity

**Pricing oracle:** `platform.credit_action_costs`.

| Action | Credits |
|---|---|
| Catalogue search | 50 |
| Live Discovery base | 50 |
| Each live creator | 10 |
| TikTok live minimum | 100 |
| Refresh / add-by-link | 50 |
| Contact reveal | 5 |

All 21 CR cases pass, together with B2-13 and P-08. Every scenario was verified against lots, reservations and ledger rows:
- **Reservations:** quote equals hold; holds are released after failure or cancellation.
- **Partial settlement:** base fee plus delivered creators.
- **Duplicate settlement:** a no-op.
- **Abandoned holds:** expired by the cleanup.
- **Stuck jobs:** swept and refunded.
- **Concurrency:** identical searches pay once; racing for the last credits never goes negative; confirmations are idempotent.
- **Isolation:** cross-workspace access is refused.
- **Display:** the UI balance equals the tables.

Open decisions:
- **D-05:** zero-result searches are charged; CR-06 confirms the current rule.
- **Annual billing:** the mandate says 20%, but the owner said it is not approved; it is not implemented.
- **Observation O2:** quotes count toward the paid-start rate limit, so "20 starts per hour" allows about 10 quote-and-start pairs.

## E. Persistence and indexing

| Measure | Value |
|---|---|
| Creators delivered by Brain 2 across the B2, P and VAR-L fixture runs | every delivery checked |
| Committed rows confirmed through an independent connection | 100% (P-01 8/8; VAR-L rows = results; P-02 3/3) |
| Discrepancies | 0. An injected failure inside the save rolled back both the creator and its delivery (P-02) |
| Duplicate records | 0 (P-04, P-08, VAR-L, CORPUS-04) |
| Known creators reused | P-03, VAR-L02/L04 (8 of 8 reused) |

**Persistence happens before delivery.** The creator save, the `creator.changed` event and the delivery row are written in one transaction (pipeline `onSaved`), proven by P-02 and IDX-01.

**Searchability is asynchronous**, through the outbox relay and worker handler:
- not searchable before processing (P-09);
- commit to searchable: p50 113 ms, p95 202 ms in-process (IDX-09); 215 ms for P-09;
- recovers from a broker outage (IDX-04), duplicate events (IDX-03) and handler failure (IDX-05).

Not established here:
- **No documented freshness target exists (B4).**
- The real pg-boss delay on staging was not measured (RP-03).

## F. Performance and reliability

See PERF-01 to PERF-10. The measurements come from a laptop with 2,000 synthetic creators. They say nothing about hosted latency or real provider timing. **No targets are documented**, so target-based acceptance is not established.

Reliability verified:
- worker crash and retry (P-08);
- stuck-job sweep (CR-14);
- broker outage (IDX-04);
- database outage reporting (PERF-08);
- provider failure and retry budget (B2-07, PERF-10, CR-13).

## G. Defects and residual blockers

| # | Defect | Severity | Root cause | Status |
|---|---|---|---|---|
| D1 | "YouTubers …" does not limit results to YouTube (VAR-C05; also on real data) | Medium | `understand.ts`: "youtuber(s)" is a role word, not a platform word | **Open**. Query understanding is frozen with Search; fix after the rating round. Regression case is in place (`it.fails`) |
| D2 | A Roman Urdu live brief ("khana") delivers none of the food creators an English brief delivers (VAR-L03) | Medium | Brain 1 aliases khana to food, but the Live Discovery fit check does not | **Open**. Campaign Fit is frozen; regression case is in place |
| D3 | Reconciliation misses a change made without an event in the same second as the last indexing (IDX-07b) | Low | Freshness is compared in whole seconds (`extract(epoch)::int`) | **Open**. The value is also a ranking tie-breaker (frozen); normal writes always emit an event |
| D4 | Logs did not redact credential-like keys (`apiKey`, `api_key`, `serviceRoleKey`, `webhookSecret`, `privateKey`) or URL passwords in messages and errors | Low–Medium (no current call site logged them) | Fixed key list only | **Fixed**: pattern-based redaction plus URL-credential masking in `packages/core/src/logger.ts`. Regression: `logger.test.ts` and SEC-12. Full suite rerun |
| D5 | The customer E2E runner left its API and worker running when readiness failed, blocking the next run on :4000 | Low (test tooling) | `start … || exit 1` without cleanup | **Fixed** in `scripts/e2e-customer/run.sh`. Customer suite rerun: 162/162 |
| Q1 | Brain 1 coverage on the frozen set is at most 0.357, against the 0.90 gate | **High: blocks acceptance** | Small, never-assessed corpus (no city, niche or contact data); all-words matching of sentence queries | **Open**. Owner decision on corpus assessment or coverage (paid LLM and provider work) and Search work after ratings |

Limitations and observations:
- **L1:** wordings outside the documented vocabulary ("review", "restaurants", inflected Urdu) recall poorly.
- **O1:** known creators are reused from stored samples, not refreshed during live runs.
- **O2:** quotes count toward the paid-start rate limit.
- **O3:** the 15-minute search cache is shared across workspaces; it holds only public results.
- **O4:** at 2,000 documents the GIN index is not used (expected); behaviour at 100k is not measured here.

Residual blockers:
- **B1:** raters and adjudicator.
- **B3:** live-provider authorisation.
- **B4:** freshness, latency and throughput targets.
- **B5:** D-05.
- **B6:** annual pricing.
- **B7:** hosted genuine-token check, plus the HTTPS network instability seen today.
- **Q1:** coverage.

## H. Verdicts

| # | Area | Verdict | Basis |
|---|---|---|---|
| 1 | Brain 1 catalogue search (software behaviour) | **PASS with defects**: D1 open; L1 limitation | B1 19/19, VAR-C 17/18, CORPUS 7/7 |
| 2 | Brain 2 Live Discovery | **PASS on fixtures only**: D2 open; real providers BLOCKED | B2 16/16, VAR-L 4/5, RP blocked |
| 3 | Creator data integrity and relevance | Integrity **PASS** (no invented contacts or duplicates; eligibility and minors enforced); relevance **NOT ACCEPTED** | B2-17, CORPUS-04/05; HUM |
| 4 | Immediate database persistence and later catalogue availability | **PASS (fixtures)**: persistence is atomic with delivery; searchable after asynchronous indexing (about 0.1–0.2 s here). The freshness target is missing (B4) | P-01, P-02, P-09, IDX-01, IDX-09 |
| 5 | Search variations and cross-search duplicate prevention | Duplicate prevention **PASS**; variation consistency **FAIL** (D1, D2) | VAR-C, VAR-L, P-04 |
| 6 | Credit ledger and financial integrity | **PASS** (fixtures and local database); Paddle not verified (separate gate) | CR 21/21 |
| 7 | Caching, indexing and persistence | **PASS with D3** (low) | IDX 13/14 |
| 8 | Independent search-quality evaluation | **BLOCKED**: no raters. The coverage gate **FAILs** on its upper bound | HUM |
| 9 | Security and permissions (limited scope) | **PASS after the D4 fix** | SEC 13/13 |
| 10 | Performance and reliability | Measured, no targets: **target acceptance not established**; functional resilience PASS | PERF 10/10 |
| 11 | End-to-end integration and user experience | **PASS** for covered journeys (customer 162/162, staff 31/31); live delivery in the browser NOT TESTED | E2E |
| 12 | **Overall Search acceptance** | **NOT ACCEPTED** | HUM blocked; the coverage gate fails on its upper bound; D1 and D2 open; no real-provider evidence |

**Single next action for the most consequential blocker (Q1 + B1).** Brain 1 cannot reach the 0.90 coverage gate on the current corpus, even with perfect ratings. The owner must therefore decide how the catalogue gets structured coverage before a rating round is worth running:
- authorise the AI assessment (city, niche) of the evaluation corpus and a broader catalogue build (paid LLM and provider work); or
- re-scope the frozen query set to the catalogue that exists.

Then name the two raters and the adjudicator. **Owner: the product owner.**
