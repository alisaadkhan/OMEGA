# F — Search quality and evaluation report

> **Search status: NOT ACCEPTED.** No human relevance rating exists. Nothing in this report — unit tests, integration
> tests, replay results, packet generation or this audit's code reading — is evidence of search quality.

Evidence labels: **measured** (counted from data in the archive, this audit) · **reported** (repo records, not re-run)
· **replay** (recorded provider responses run through current code, not live) · **code** (behaviour read from source).

## 1. Brain 1 — catalogue search: traced pipeline

```
POST /v1/search {text, filters, confirmedCost}
 └ creators/routes.ts → service.search()
    1 understandQuery(text)            understand.ts  NFKC, lower-case; reads follower/engagement ranges and one platform
                                                    word into filters; drops filler words (EN/Roman Urdu/Urdu); keeps role
                                                    words for ranking only; DROPS any clause containing ignore/avoid/
                                                    exclude/except/do not (SRCH-06)
    2 searchFiltersSchema.safeParse   contracts     min>max → 400 conflicting_range; unknown keys silently stripped (SRCH-07)
    3 fromIndex → PostgreSQL          postgres-search.ts
        a eligibility gate (elig-1)   d.eligible and d.eligible_until_epoch > now   (before ranking)
        b expandQuery(text)           aliases.ts    reviewed niche + city forms (EN, Roman Urdu, Urdu script); phrase match
        c full-text (simple config)   ts_rank_cd ×8 capped at 1; city word also matches declared city column
        d only if 0 hits: trigram     word_similarity, every word must be near a text word
        e name-like 2–3 word query:   consonant-skeleton name variants (Malik/Malek/Mullick)
        f filters                     platform, country, city forms, followers, engagement, niches, verified,
                                      authenticity, hasContact, freshOnly
        g order                       rankingScore desc, updated_epoch desc (creator_id tie-break in no-text case)
    4 cardRows + toCards              ranking.ts   fit score from engagement/authenticity/followers; RLS hydration
    5 decodeCursor                    cursor.ts    offset ≤ 1,000 bound to query hash + ranker version (SRCH-08)
    6 chargeCatalogSearch             search-charge.ts  50 credits once per (user, normalised text+filters) per 30 min;
                                                    advisory lock; charged even for 0 results (BIL-02)
    7 matchReasons                    match-reasons.ts  why each page result matched (name/handle/niche/city/tag/bio)
```

No LLM is on the required path ([code]); `/v1/search/interpret` is optional, budget-capped and editable.

### Brain 1 answers to the brief's questions

| # | Question | Answer and evidence |
|---|---|---|
| 1 | Does a new query change the request and results? | **Yes** (code): text → tsquery and filters are rebuilt per request; no fixed or demo responses in the path. |
| 2 | Real, fixture, replay or preloaded? | Results come only from persisted `gcp.creator_search_documents`. In development that catalogue is 21 creators (reported); the evaluation corpus is 455 creators (204 eligible) loaded from recorded provider responses. |
| 3 | Can it find creators not in the database? | **No, by design** — that is Brain 2. |
| 4 | Business vs creator confusion? | Not gated in Brain 1 (no creator/business classifier as a gate; reported as "not yet done" on 16 Oct). Panel Q010 "book reviewers" returns a bridal shop ("Book your appointment") — measured. |
| 5 | Platform/URL/handle/niche accuracy | Canonical URL per profile; niche from enrichment; accuracy unmeasured. |
| 6 | Same person vs similar names | Canonical platform ID/URL per profile; conservative merge; name-variant matching is for **retrieval** only, never merge (code). Cross-platform merge (ID-002) deferred. |
| 7 | Traceable claims | Match reasons name the field; follower counts carry `followersUpdatedAt`; per-field provenance is partial (DATA-001). |
| 8 | Evidence vs LLM confidence | Ranking is deterministic SQL + formula; LLM not involved. |
| 9 | Engagement, authenticity, geography, niche, stale metrics | Eligibility drops stale/unknown counts (90 days); authenticity score from deterministic signals with "insufficient" state; geography = declared/bio city only (city "unknown" in all rated rows — SRCH-12). |
| 10–11 | Provider failure / partial failure | N/A for Brain 1 except Meilisearch → PostgreSQL fallback (Postgres is the default anyway). |
| 12 | Charging | 50 credits per logical search, including empty results (BIL-02); repeats/pages within 30 min free. |
| 14 | Pakistan/Urdu/Roman Urdu | Reviewed alias lists for selected niches and cities in three scripts; "pakistan/پاکستان" treated as market words; only 4 of 35 panel queries are Urdu script; Roman Urdu misspellings handled by trigram only when nothing else matches. |
| 15 | Volume | Pure SQL; reported p95 58–95 ms locally; 100k synthetic corpus reported 89 ms p95 for a common word. Not load-tested on hosted DB. |

## 2. Brain 2 — Live Discovery: traced pipeline

```
POST /v1/discovery/estimates {search, maxNew ∈ {5,10,15}}
 └ validateLiveBrief (contracts/discovery.ts): topic + (city|country|language), specificity ≥ 2.5, else 422 QUERY_TOO_BROAD
   → estimate row: prices {base 50, per-creator 10, tiktokMinimum 100 if TikTok in scope}, maxCredits, priceVersion,
     searchHash, expires 15 min                                              (no provider call)
POST /v1/discovery/jobs {kind:"live", estimateId}  (paid-start limits: 20/h user, 100/h workspace)
 └ one transaction: lock estimate → re-validate brief → hash unchanged → reserve maxCredits (RLS policy only allows the
   approved price set) → insert job → consume estimate → outbox "discovery.live_requested"
worker (pg-boss "discovery-high", concurrency 3) → createLiveRunner.run(job)
 1 rounds 1..3 (stop when ≥ 8 candidates pass G1):  buildQueries → Serper (site:instagram.com / tiktok.com/@ /
   youtube.com/@, num 10, gl=pk) via 15-min cache; round 1 also YouTube-native video search
 2 collectCandidates (cap 60) → URL normalisation → dedupe → trail rows (wp.discovery_candidates)
 2b Instagram post/reel authors (paid resolution, capped) and @mentions as leads
 3 G1 cheap gate: business cue without creator cue → reject; topic cue → possible; else ambiguous → LLM relevance in
   batches of 12 (schema-validated, snippets fenced and contact-redacted); failed batches dropped (SRCH-09)
   pool < 8 → outcome "insufficient", charge 0
 4 suppression list → known creators reuse archived sample → Campaign Fit (deterministic, fit.ts) + elig-1 → free result
 5 new candidates ranked by snippet evidence, spread by platform; waves: size first, extra waves per platform multiplier
   (IG 2×, YT 3×, TT 1×); per-job USD cap (3× rule) and 20-min deadline checked before every batch
 6 Apify (IG/TT) or YouTube Data API per platform batch; raw payload archived per profile (retry reuses it)
 7 4A pipeline per profile: standardise → signals → AI assessment → minors check → save; Campaign Fit + elig-1 → result
   row (isNew → 10 credits) → rerank → monotonic progress counters
 8 settle once (job row lock): visible > 0 → charge min(quote, max(tiktokMinimum, 50 + Σ new)); else 0; release rest
   cancel → base + new delivered; provider failure after retries → partial (charged as delivered) or failed (0)
```

### Brain 2 answers

| # | Question | Answer and evidence |
|---|---|---|
| 1 | New query → new provider requests? | **Yes** (code): deterministic templates from the brief's chips + topic words; user text can never become operators (`words()` strips them). |
| 2 / 13 | Live or replay? | The code path is live when keys exist. **All quality/yield/cost numbers since 13 Oct are replay** (reported, labelled so). The last live run evidence is the 13 Oct evaluation (25 briefs, about USD 1.02 Apify, one rater). |
| 3 | Finds creators not in DB? | Yes — that is its purpose; replay delivered 53 creators over 25 briefs under elig-1 (reported). |
| 4 | Business vs creator? | Snippet business/creator cue lists before extraction; LLM for ambiguous; no post-extraction business classifier as a gate (reported as not done). |
| 5 | Identity accuracy | Canonical URL from the result link; Instagram post URLs need author resolution (paid) or are dropped — no guessing (code). |
| 6 | Same person / similar names | Per-profile identity; no display-name merges (code). |
| 7 | Traceability | Every search link and its stop stage stored in `wp.discovery_candidates` with reason codes (code, reported). |
| 8 | LLM confidence | LLM decides only *relevance of ambiguous snippets*; Campaign Fit and charges are deterministic. The LLM's free-text reason is shown on customer cards (SEC-16). |
| 9 | Metrics/eligibility | elig-1 applied to the profile actually found; activity window 90 days; YouTube hidden-count 0 treated as unknown (code). |
| 10 | Provider block/schema change/timeout/no results | Serper 400 with "credit" → quota; 401/403 → not_configured; 5xx/429 retryable; Apify non-SUCCEEDED or timeout → abort + cost recorded; **crash mid-run orphans the Apify run** (SRCH-04). Schema drift: zod `catch` defaults on Serper rows; Apify items parsed by standardiser (unknown fields ignored). |
| 11 | Silent misleading partial results | LLM batch failures silently shrink yield (SRCH-09); otherwise outcomes are explicit (`insufficient`, `completed_empty`, `partial`, `failed`, `canceled`). |
| 12 | Credits | Settlement verified by integration tests; public copy misstates it (BIL-01). |
| 14 | Pakistan/Urdu | Round 2/3 Roman Urdu/Urdu terms for reviewed topics and cities; Urdu-script recall on Instagram measured as near zero and therefore skipped (reported). |
| 15 | Scale/cost control | Monthly caps (Apify USD, Serper count, LLM USD) + per-job cap + deadline + paid-start limits. Caps are per process (SRCH-05); several live runs per workspace allowed (BIL-06). |

## 3. Interaction between the brains

Brain 2 writes accepted creators into the shared catalogue, so Brain 1 coverage grows only through paid Live Discovery,
add-by-link and refreshes — and shrinks through the 90-day/30-day rules (SRCH-02). The internal catalogue lookup inside a
live run is not charged as a search (code: `chargeCatalogSearch` is never called from the runner) — **verified by
reading; covered by `search-charge.int`** (reported).

## 4. Evaluation data — measured composition (read-only)

| | Brain 1 (`blind-b1-elig1`) | Brain 2 (`blind-b2-elig1`) |
|---|---|---|
| Cases (queries/briefs) | 35 | 25 |
| Relevance rows per rater | **222** (53 returned + 169 pooled) | **131** (53 delivered + 78 pooled) |
| Behaviour rows per rater | 35 | 25 |
| Total judgements per rater | **413** (222 + 35 + 131 + 25) — reconciles the readiness figure | |
| Superseded pre-eligibility packets | 273 rows (`blind-b1`) | 207 rows (`blind-b2`) |
| Cases with ≥ 1 returned/delivered row to rate | **10** | **16** |
| Cases returning results but none sampled | 1 (Q024 "Find popular creators": 204 results, behaviour-only) | — |
| Cases with no rows at all | 10 | 3 |
| Platform of rated rows | Instagram 152 · YouTube 65 · **TikTok 5** | Instagram 63 · YouTube 55 · **TikTok 13** |
| Query script | Latin 31 · Urdu 4 | Latin 23 · Urdu 2 |
| City column in sheets | "unknown" in all 222 | "unknown" in all 131 |
| Distinct creators | 86 (47 appear in more than one case) | 111 (14 in more than one) |
| Rater A vs B sheets | identical content and order | identical content and order |
| Brain 2 outcomes (replay) | — | 8 completed_empty, 1 insufficient, 16 succeeded (1–5 of 5 delivered) |

Notable behaviour cases visible in the sheets: Q010 "book reviewers 5,000–50,000" → one result, a bridal shop; Q021 filter
key `platforms` (should be `platform`) → 88 results including TikTok profiles (SRCH-07); Q022 contradictory range →
correctly refused; Q026 prompt-injection text → injection ignored, skincare search ran.

## 5. What can and cannot be concluded

**Can be concluded now (measured/code):** pipelines are deterministic and reproducible on fixed data (reported freeze
check); charges and settlement follow coded rules; eligibility is enforced before ranking; empty results are not padded.

**Cannot be concluded from the current dataset, even after ratings:**
- anything about **TikTok** quality (5 and 13 rows);
- **Urdu-script** query quality (4 and 2 cases);
- **city-level geographic accuracy** (no city values shown to raters; judgements rely on bio text);
- **live** Brain 2 behaviour (rows are replay of 13–14 Oct recordings);
- market-wide **recall** (pools come from MUSHIN's own corpus and query variants);
- performance at hosted scale.

**After ratings, Brain 1 P@5 will average over at most 10 queries** — a single query moves the mean by ≥ 0.1.

## 6. Protocol review and proposals (owner approval required; thresholds unchanged)

| # | Observation (measured/code) | Proposal | Effect |
|---|---|---|---|
| P1 | `precisionAt` divides by min(k, returned): a query returning one relevant creator scores P@5 = 1.0 | Report **both** the current metric and standard P@5 (÷ 5) and the number of contributing queries | Prevents sparse result lists looking perfect |
| P2 | Means over ≤ 10 (B1) and ≤ 16 (B2) queries | Report bootstrap 95 % confidence intervals; pre-commit an **"inconclusive"** outcome when the CI spans the threshold | Avoids accepting/rejecting on noise |
| P3 | Unweighted 3-class Cohen's kappa; likely skewed prevalence | Also report **raw agreement, linearly weighted kappa and the rating distribution**; keep kappa ≥ 0.6 as the gate | Interpretable agreement ([E] Feinstein & Cicchetti) |
| P4 | Coverage counts "answerable" queries using MUSHIN-built pools | Label coverage as "coverage of MUSHIN-pooled relevant creators", not recall | Honest wording ([E] pooling bias) |
| P5 | Brain 2 rows are replay | Title the Brain 2 report "offline (replay) evaluation"; a live pilot (SRCH-10) is a separate gate | Keeps replay ≠ live |
| P6 | Q021 uses an invalid filter key | Fix the panel row in a new protocol version **only after** this round, or exclude Q021's behaviour verdict and explain | Avoids rating a harness defect as product behaviour |
| P7 | Same 47 creators recur across B1 cases | Report per-case and per-creator agreement; raters judge each row in its query context (already instructed) | Detects order/fatigue effects |
| P8 | 413 judgements ≈ 3.5 h assumed at 30 s each | Pilot 20 rows with each rater first; check timing and instruction clarity before the full round; one written clarification to both | Reduces kappa failure risk |
| P9 | Rater qualification undefined | Record rater background (market knowledge), conflicts of interest and independence statement | Auditability |
| P10 | Raters receive contact strings in bios | Redact contact patterns in future sheets (SEC-08) | Data minimisation |

**Decision rule (proposed for the owner to adopt before scoring):**
- **Pass** — every approved gate met (kappa ≥ 0.6, strict P@5 ≥ 0.80, nDCG@10 ≥ 0.75, coverage ≥ 0.90, all behaviour
  cases) **and** each metric's lower CI bound ≥ threshold − 0.05.
- **Fail** — any gate's upper CI bound below its threshold, or kappa < 0.6, or any behaviour case failed.
- **Inconclusive** — otherwise; Search stays NOT ACCEPTED and a second round on fresh data is planned (after 12 Nov the
  current packets must be deleted).

## 7. Timeline and data handling

| Date | Step | Note |
|---|---|---|
| **2026-10-20** | Owner names rater A, rater B, adjudicator; approves P1–P10 or rejects them in writing | Raters must not have built/tuned Search |
| 2026-10-31 | Raters return sheets | — |
| 2026-11-05 | Adjudication done; reports generated | — |
| 2026-11-08 | Owner decision Pass / Fail / Inconclusive | — |
| **2026-11-10** | Purge with `--also` for every copy, `--verify`, written deletion confirmations | Add **this uploaded archive and every place it was shared** to the inventory |
| **2026-11-12** | Hard deletion deadline (YouTube API data) | Do not run the purge earlier "to test it" |

## 8. Safe, cost-capped live evaluation (requires explicit authorisation — not run)

Pre-requisites: SRCH-04 fixed (run IDs persisted, `maxTotalChargeUsd` set). Proposed envelope for the owner to approve or
change: 15 briefs (5 per platform, including 3 Urdu-script and 5 TikTok), size 5, Serper ≤ 200 searches, Apify ≤ USD 3,
LLM ≤ USD 1, one run per brief, all on a dedicated staging workspace with pilot credits. Report per brief: funnel counts,
delivered eligible creators, cost per delivered eligible creator, wall time, failures, and live-vs-replay deltas. Rated by
the same two raters with the same protocol.
