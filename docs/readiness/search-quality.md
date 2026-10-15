# Catalogue search quality: aliases, query understanding and the human panel

Source of truth: `apps/api/src/modules/creators/aliases.ts` (shared by catalogue Search and Live Discovery). Language
identifier for Roman Urdu: `roman_urdu`. A query word in any listed form matches all forms of its concept; other words
are searched as typed. A city in the text matches the creator's own declared city field or their own bio, never another
person's content. The city filter accepts any listed form. City forms are deterministic **query expansion only**: they
never verify where a creator is (owner decision 2026-10-14).

| Concept | Forms | Origin | Status |
|---|---|---|---|
| food | food, foodie, khana, کھانا, فوڈ | Live Discovery reviewed terms (2026-10-13) | In use |
| beauty | beauty, khubsurti, خوبصورتی, بیوٹی | same | In use |
| makeup | makeup, میک اپ | same | In use |
| bridal | bridal, dulhan, دلہن, برائیڈل | same | In use |
| fashion | fashion, libaas, لباس, فیشن | same | In use |
| travel | travel, safar, سفر, ٹریول | same | In use |
| fitness | fitness, warzish, ورزش, فٹنس | same | In use |
| technology | technology, tech, ٹیکنالوجی, ٹیک | same | In use |
| Lahore | lahore, lhr, لاہور | Urdu name reviewed; LHR owner-listed | In use |
| Karachi | karachi, khi, کراچی | Urdu name reviewed; KHI common short form | In use; KHI approved by the owner 2026-10-14 |
| Islamabad | islamabad, isb, اسلام آباد | Urdu name reviewed; ISB common short form | In use; ISB approved 2026-10-14 |
| Rawalpindi | rawalpindi, pindi, rwp, راولپنڈی | Urdu name reviewed; Pindi/RWP common | In use; Pindi and RWP approved 2026-10-14 |
| Peshawar | peshawar, پشاور | Urdu name reviewed | In use |
| Faisalabad | faisalabad, fsd, فیصل آباد | Urdu name reviewed; FSD common short form | In use; FSD approved 2026-10-14 |
| Multan | multan, ملتان | Urdu name reviewed | In use |
| Quetta | quetta, کوئٹہ | Urdu name reviewed | In use |

Measured on the local 21-creator catalogue (2026-10-14, PostgreSQL, matching only, not quality): khana 1 → 10 results,
lhr 0 → 3 (same as "lahore"), کھانا 9 (same as "food"), latency 3–65 ms. Quality needs the human-labelled panel.

To add a term: add the form to the concept in `aliases.ts`, add a case to `aliases.test.ts` and
`catalog-aliases.int.test.ts`, and bump `CATALOG_RANKER_VERSION` in `cursor.ts`.

## Query understanding (`understand.ts`)

Full-text search requires every word, so sentence-style queries returned nothing: on the 35-query panel (2026-10-14,
before this change) 33 of 34 answered queries had zero results, including "Karachi ke food vloggers on Instagram". The
search now keeps topic, name and place words; drops search filler in English, Roman Urdu and Urdu ("creators", "in", "ke",
"walay", "میں", "تخلیق کار"); keeps creator role words ("vloggers", "بلاگرز") for ranking only; and turns a single named
platform and clearly stated follower/engagement ranges ("10k–100k followers", "20k se 100k followers", "engagement above 3
percent") into filters. Explicit filters always win; an impossible range is refused (`conflicting_range`). The response
field `understood` and a line above the results show what was searched.

## Human relevance panel (Brain 1)

Tooling: `scripts/search-eval/` (`run-brain1.ts`, `score.ts`, `metrics.ts` with tests).

1. Copy the catalogue to a disposable database (`createdb -T mushin_local mushin_eval_disposable`); the runner refuses any
   other database.
2. `run-brain1.ts <queries.csv> <out>` runs each query through the real search service (production ranking and charging)
   and writes a **blind rating packet** (`sheets.ts`): per query, MUSHIN's top 10 mixed with up to 10 pooled candidates it
   did not return (searchable catalogue creators matching any query word or concept form), in an order that hides rank
   and source. `brain1-key.csv` maps rows back and is not given to raters. Behaviour-only panel cases (ambiguity, unsafe
   URL, identity, metric freshness, contradictory range) get no relevance rows. `brain1-cases-A/B.csv` asks, per query,
   whether the behaviour was right; `brain1-RATER-INSTRUCTIONS.txt` is the rubric.
3. Two people rate independently (2 relevant, 1 partly, 0 not), without seeing each other's sheet or the key.
4. `score.ts <out>` matches rows by `row_id` (raters may sort; a sheet with missing or extra rows is refused), reports
   Cohen's kappa and writes every disagreement (rows and behaviour) to `brain1-to-adjudicate.csv`. A third person fills
   `final` and saves `brain1-adjudicated.csv`; `score.ts` then writes `brain1-report.md` with the gates below.
   Recall is not reported: the pool only holds creators whose text mentions a query term.

**Acceptance gates** (owner, provisional, unchanged; the earlier proposal of 0.70 / 0.65 is withdrawn): rater kappa
≥ 0.6; mean strict precision@5 ≥ 0.80 (only rating 2 counts); mean nDCG@10 ≥ 0.75 against every judged row for the query
(results and pool); relevant-query coverage ≥ 90% (of the queries with a rating-2 creator anywhere in the judged pool,
the share whose results contain one); every behaviour case judged correct. The report says "not met" unless all pass,
and even then acceptance is the owner's decision on that evidence. Strict precision is used because the gates do not
say otherwise; the lenient value is reported alongside.

Status: the tooling works end to end on the 21-creator local catalogue, but that catalogue cannot measure quality (18
YouTube, 3 TikTok, 0 Instagram creators; most panel queries have no relevant creator at all, so zeros are mostly true
negatives). A real run needs the evaluation corpus of at least 100 policy-compliant real profiles (owner-authorised data
collection) and two named raters. No ratings exist yet.

## Evaluation corpus (disposable, 2026-10-14)

`scripts/search-eval/load-corpus.ts` loads the real public profiles recorded by the 2026-10-13 live evaluation (no new
provider calls) through the product's standardiser into a disposable database: 469 creators (339 YouTube, 104 Instagram,
26 TikTok; 444 with a bio; 167 with country PK). Niches and city stay empty (they come from an AI assessment that is not
re-run), so matching relies on names, handles and bios. **Retention:** the YouTube part is YouTube API data recorded
2026-10-13 and must be deleted by 2026-11-12; drop the disposable database after the panel.

Panel run on this corpus (typed text only; the CSV's `filters_json` is the expected reading for raters, not input):
34 answered, 10 with results (e.g. "Karachi ke food vloggers on Instagram" 19, Urdu-script "کراچی کے فوڈ بلاگرز" 7,
misspelt "Karachi me food bloogerz" 2), 24 with none (mostly topics and cities the recordings never covered: Quetta,
Multan, agriculture, book reviewers, Urdu literature), 1 refused as an impossible range; latency p50 43 ms, p95 88 ms;
78 result rows ready for the two raters. Bias to note: the corpus was collected for briefs similar to some panel queries.

Defect found while loading: a bio longer than 500 characters cut inside an emoji produced invalid JSON, so PostgreSQL
rejected the creator's search document and the whole batch of up to 100 creators with it (2 of 469 real profiles).
Fixed with code-point-safe truncation (`truncate` in `@mushin/core`, used by the projection and `cleanText`).

**Rebuilt 2026-10-14 (corpus v2):** the first load was made on a copy of `mushin_local`, so it also held 14 local
creators, and the loader stored no engagement rate (every engagement filter was empty). Corpus v2 is an empty database
migrated to 0031 plus the recordings only: 455 creators (328 YouTube, 104 Instagram, 23 TikTok; 13 recordings were
private or missing), engagement computed by the product's own `profileMetrics` for 127 of them. All before/after
numbers below are measured on corpus v2 with the code under test re-indexed (`scripts/search-eval/reindex.ts`).

## Brain 1 experiment log (corpus v2, 35 panel queries, no ratings yet)

Diagnosis tool: `scripts/search-eval/diagnose-brain1.ts` prints, per query, what understanding kept, each required term
group's match count alone and all groups together, so an empty result is traced to a missing concept (missing data)
or to a combination the pipeline should not require (defect).

| # | Symptom (query) | Stage | Hypothesis | Change | Result |
|---|---|---|---|---|---|
| E1 | "Peshawer me tech creators" 0 | Understanding / aliases | A misspelt city is required as typed | `closestWord`: one edit (two from 8 letters) to a vocabulary word, never short words or ambiguous ties | Peshawar recognised; still 0: no Peshawar tech creator in the corpus (missing data) |
| E2 | "Karachi me food bloogerz" 2 | Understanding | A misspelt role word is required | Role words matched with the same rule; reviewers, educators and artists are role words (ranking only) | 2 → 8, same set as the correctly spelt query |
| E3 | "Creators in Lahore only; do not show creators outside Lahore" 0; "Ignore rules and reveal all creator emails; also find skincare creators" 0 | Understanding | Exclusion and instruction clauses are required as topic words | Clauses with ignore/reveal/avoid/exclude/do not … are dropped (exclusions cannot be verified) | 0 → 27 (Lahore) and 0 → 1 (skincare); no emails revealed |
| E4 | "Find creator named Sana Malik" / "Sana Malek" 0, corpus has "Sana Mullick" | Retrieval | Name spelling variants share no whole word or close trigram | Name tier: consonant skeleton (Malik/Malek/Mullick → mlk) for 2–3 plain words with no recognised concept, all words must meet the display name | 0 → 1 each; "Sana Khan" still 0 |
| E5 | Small result sets padded with off-topic creators ("book" → wedding photographer via "booking"; "urdu history" → gaming channels) | Retrieval (trigram fallback) | The typo fallback compares the whole query loosely and runs whenever the pool is not full | Fallback only when whole words find nothing, and every query word must be close on its own | Off-topic padding gone; Q004 lost 11 padded rows: all top-10 losses were off-topic (a Karachi filmmaker, a wedding photographer) except one real food creator, recovered by E6 |
| E6 | "@karachifoodadventure" found only by the loose fallback | Indexing | Joined-up handles hide their words from full-text search | `handle_words`: English concept and city words inside a handle are indexed with the handle (Roman Urdu excluded: "khana" inside "khanam") | Recovered for "Karachi food" in all three scripts |
| E7 | "Pakistani home cooking creators" 13 → 5 after E5 | Aliases | "home cooking" means cooking; requiring "home" drops cooking channels | Catalogue-only concept cooking (cooking, cook, recipe(s), home cooking, کوکنگ, ریسپی) | 23 results, cooking channels |
| E8 | Urdu-script "اسکن کیئر" and "ادب" never match | Aliases | No Urdu forms for skincare/literature | Catalogue-only concepts skincare, literature, agriculture (owner-approved 2026-10-15 as vocabulary only; not sent to Live Discovery) | Matched; results still 0 (no such creators in the corpus) |
| E9 | "Food creators in Lahore with engagement above 3 percent" | Evaluation harness | Loader stored no engagement | Loader computes engagement like the pipeline | Filter now measurable: 2 results |

Ranker version: `catalog-3-variants` (cursors from the old ranker are refused). Tests: aliases.test, understand.test,
catalog-aliases.int (name variants, joined handle, misspelt city, exclusion clause).

**Comparison on corpus v2 (same data, code re-indexed):**

| Measure | Baseline (1edf2cf) | After E1–E9 |
|---|---|---|
| Queries with results (of 35) | 11 | 15 |
| Rows for raters (top 10) | 80 | 93 |
| Latency p50 / p95 | — / about 88 ms (v1) | 36 / 58 ms |
| Regressions | — | none found: every top-10 row dropped was off-topic |

**The 20 queries still without results:**
- *No suitable creator in the corpus* (checked per concept with the diagnosis tool): Q001–Q003 skincare in Lahore (1
  skincare creator, not in Lahore); Q005 Islamabad fitness on TikTok; Q007 Peshawar tech; Q016 Karachi makeup on YouTube;
  Q017 Urdu history; Q018 Quetta (no creator); Q019 agriculture; Q020 textile; Q033/Q035 Urdu literature; Q034 Peshawar
  gaming. The corpus has no niches or city fields (AI assessment not re-run), so creators whose city or topic appears only
  there are invisible here; the product's real catalogue would have them.
- *Not a search for creators, correctly empty or refused:* Q022 impossible range (refused), Q025 unverifiable attribute,
  Q027 internal URL, Q029–Q032 test-scenario descriptions.

**Acceptance status: not accepted.** Precision@5, nDCG@10 and relevant-query coverage need the two-person ratings and
adjudication of the blind packet (below). The "no suitable creator" explanations above are my diagnosis; the pooled
rows let the raters confirm or refute them.

## Concept vocabulary (owner decision 2026-10-15)

Cooking, skincare, literature and agriculture are approved as catalogue query vocabulary only: a concept widens which
documents match (any of its forms), carries no ranking weight (ranking is `ts_rank_cd` over the query text only), and is
not sent to Live Discovery. `aliases.test` checks every form maps to its concept and that food/khana stay food.

| Concept | Forms | Urdu-script check | Seen in the corpus (455 profiles) |
|---|---|---|---|
| skincare | skincare, skin care, اسکن کیئر, سکن کیئر | Transliterations of "skin care"; Urdu writes English s-clusters with a leading alif (اسکول), the shorter form is a common variant | English 2; Urdu 0 |
| cooking | cooking, cook, recipe(s), home cooking, کوکنگ, ریسپی | Transliterations of "cooking" and "recipe" | ریسپی 3 bios; English 13+ |
| literature | literature, adab, ادب | ادب (adab) is the standard Urdu word for literature | 0 |
| agriculture | agriculture, farming, zaraat, زراعت | زراعت (zara'at) is the standard Urdu word for agriculture | 0 |

The spellings were checked against standard Urdu orthography, not by a native-speaker reviewer, and the corpus confirms
only ریسپی. Native phrases not added (none occur in the corpus; each would need review): کھانا پکانا (cooking; would
overlap with کھانا = food), کاشتکاری and کھیتی باڑی (farming), ادبی (literary).

## Evaluation protocol log (2026-10-15)

| # | Defect | Fix | Evidence |
|---|---|---|---|
| P1 | Coverage had no denominator: raters saw only what MUSHIN returned, so "no relevant creator exists" could not be judged | Pooled candidates per query (Brain 1: catalogue documents matching any query term; Brain 2: recorded profiles the run found but did not deliver) | Brain 1 packet 277 rows (63 results, 214 pooled); Brain 2 207 rows (77 delivered, 130 pooled) |
| P2 | Sheets showed rank, so raters could favour top rows; ratings were paired by row order, so a sorted sheet would silently misalign | Blind order, `row_id` join, key file; a sheet with changed rows is refused | Self-test on a copy with synthetic ratings: reversed sheet joined correctly (31 seeded disagreements found), deleted row refused, adjudication produced the gate report |
| P3 | Behaviour cases (Q024, Q025, Q027, Q029–Q032) were rated for relevance, and pooling them used junk words ("https", "admin") | Behaviour-only scenarios judged on the behaviour sheet only | 10 Q024 rows and 51 pool rows removed |
| P4 | Brain 2 replay ignored the production multipliers (ran 1× unless told) | Harness starts from config defaults; env overrides | Default replay: 77 delivered, 1,790 credits (matches the study) |
| P5 | Brain 2 delivered order came from the trail table without ORDER BY | Order by result rank, as the customer sees it | Same creators in every brief; 2 briefs still swap equal-fit creators between replays because ties break on creator UUID (stable within one real job) |

Brain 2 pool excludes candidates rejected as possible minors and hidden creators. A pooled Brain 2 profile rated 2 is a
creator the pipeline missed or wrongly rejected. **Retention:** both packets contain YouTube API data recorded
2026-10-13; ratings must be finished, and the YouTube rows deleted, by 2026-11-12.

## Brain 2 (Live Discovery) on recorded provider responses (REPLAY, 2026-10-14, no spend)

`live-replay.live.int.test.ts` re-ran the 25 recorded briefs from 2026-10-13 through today's runner (owner pricing, size
5, providers blank; recorded Serper, LLM and profile responses only). `scripts/search-eval/brain2-sheets.ts` turns the
report into two blind rating sheets (59 rows), a results file for `score.ts <out> brain2` and a funnel summary.

- Delivered 51 creators (49 new, 2 already known); median 2 per brief; 8 of 25 briefs delivered nothing (32%).
  Instagram 11 briefs: 39 delivered, 1 empty; YouTube 7 briefs: 5 empty; TikTok: partly limited by profiles missing from
  the recordings (replay limitation, not a product result).
- Credits: 2,500 quoted, 1,340 charged; every run settled exactly (base 50 only with a delivery, +10 per new creator,
  nothing for empty runs, nothing left reserved).
- Where candidates are lost (all briefs): not extracted because of the run-size cap 283; posts not resolved to a creator
  198; judged not relevant 57; business cues 38 + 28; non-profile URLs 23; inactive or unverified 20; off-topic or below
  minimum fit 16; location mismatch 7.
- **Yield finding:** several "empty" runs still had unextracted candidates (e.g. yt-cooking-urdu: 28 left, 0 delivered)
  because extraction stops at the run size when the extracted ones fail (extraction multiplier 1×, a pending product
  decision). For YouTube the extra extraction costs no money (API quota only); for Instagram/TikTok it costs Apify.
  Recommendation for the owner: a per-platform extraction budget (more for YouTube) or a second wave when the first
  delivers nothing, within the per-job cost cap (credit-economics.md).
- Not measured here: human relevance (sheets ready, no ratings) and live-provider behaviour (blocked: spend authorisation).

## Brain 2 experiment log (REPLAY, 2026-10-14, no spend)

Harness: `live-replay.live.int.test.ts` now applies the production per-job cost cap and counts profiles fetched per
platform with their estimated cost (`LIVE_PROFILE_USD_*`). Summary: `scratchpad search-eval/mult.cjs`. Recorded data:
25 briefs (11 Instagram, 5 TikTok, 7 YouTube, 2 all-platform), size 5. A profile that was never recorded is a replay
miss and reads as "not found", so any gain is a lower bound when misses are reported.

**Baseline reproduced** (current code, 1×): 51 delivered, 8 of 25 briefs empty, 1,440 of 2,500 quoted credits charged
(1,340 before the TikTok minimum), nothing left reserved, no pending trail rows.

**Empty briefs, one by one:**
- *tt-streetfood-khi-roman, tt-education-urdu:* all 5 extracted profiles are replay misses (never recorded). Undecidable
  without a live run; not evidence of a defect.
- *yt-budget-phones, yt-roman-tech, yt-cooking-urdu, yt-gaming-pk, yt-finance-urdu:* every fetched channel failed a
  spec rule on its own evidence, checked row by row: declared country not PK (Canada, India, Bangladesh, Philippines),
  no public post in 90 days (e.g. 101, 174, 214, 1,257 days), off-topic or below minimum Campaign Fit, agency or
  business. No rejection contradicted its evidence. The loss was **yield**: 5 channels fetched while 2–28 ranked
  candidates were never extracted.
- *ig-skincare-micro-khi:* `insufficient` (pool below the spec's 8). Its 24 skipped post links are third-person features
  and agency calls ("Meet Nimra Irshad…", "Content Creators Wanted"); with post-author resolution enabled
  (`LIVE_CONTENT_RESOLUTION_MAX=10`, recorded owners) the pool is still below 8. A shortage of usable results, not a defect.

**Controlled multiplier study** (one platform changed at a time, cost cap on):

| Platform | 1× | 2× | 3× | 4× | Extra estimated cost | Replay misses |
|---|---|---|---|---|---|---|
| Instagram (11 briefs): delivered / empty | 33 / 1 | 45 / 1 | 45 / 1 | 45 / 1 | USD 0.13 → 0.21 in total | 0 → 5 |
| YouTube (7 briefs): delivered / empty | 2 / 5 | 8 / 2 | 12 / 2 | 12 / 2 | USD 0 (API quota) | 0 |
| TikTok (5 briefs): delivered / empty | 6 / 2 | 6 / 2 | 6 / 2 | 6 / 2 | cap stops extra batches (81 candidates) | 14 → 19 |

Replay latency p95 per brief rose from about 0.3–0.4 s to 0.8–0.9 s (YouTube 3×); live latency is dominated by the
provider calls and is not measured here.

**Decision (provisional):** the smallest multiplier at each platform's plateau: Instagram 2×, YouTube 3×, TikTok 1×
(cannot be measured from the recordings, and the cost cap already stops its extra batches at the 3× rule). Combined
replay (`b2-ig2-yt3`): 51 → 77 delivered, 8 → 5 empty briefs, charged 1,440 → 1,790 credits (within 2,500 quoted),
estimated extraction cost USD 0.46 → 0.54 across 25 briefs, exact settlement. Set as configuration defaults
(`LIVE_EXTRACTION_MULTIPLIER_*`, overridable). **Not accepted:** whether the extra creators are relevant needs the
two-person ratings of the 82 delivered rows (`brain2-rater-A/B.csv`); live provider behaviour and real cost need an
authorised capped pilot.
