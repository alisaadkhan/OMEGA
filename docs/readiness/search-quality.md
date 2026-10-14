# Catalogue search quality: aliases, query understanding and the human panel

Source of truth: `apps/api/src/modules/creators/aliases.ts` (shared by catalogue Search and Live Discovery). Language
identifier for Roman Urdu: `roman_urdu`. A query word in any listed form matches all forms of its concept; other words
are searched as typed. A city in the text matches the creator's own declared city field or their own bio, never another
person's content. The city filter accepts any listed form.

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
| Karachi | karachi, khi, کراچی | Urdu name reviewed; KHI common short form | In use, **confirm KHI** |
| Islamabad | islamabad, isb, اسلام آباد | Urdu name reviewed; ISB common short form | In use, **confirm ISB** |
| Rawalpindi | rawalpindi, pindi, rwp, راولپنڈی | Urdu name reviewed; Pindi/RWP common | In use, **confirm Pindi, RWP** |
| Peshawar | peshawar, پشاور | Urdu name reviewed | In use |
| Faisalabad | faisalabad, fsd, فیصل آباد | Urdu name reviewed; FSD common short form | In use, **confirm FSD** |
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
   and writes identical sheets `brain1-rater-A.csv` and `brain1-rater-B.csv` (top 10 per query).
3. Two people rate independently (2 relevant, 1 partly, 0 not), without seeing each other's sheet.
4. `score.ts <out>` reports agreement (Cohen's kappa) and writes the disagreements for a third person to adjudicate; with
   `brain1-adjudicated.csv` it writes `brain1-report.md`: precision@5/@10 (strict and lenient), nDCG@10 over the pooled
   judgements, zero-result and rejected rates, latency p50/p95. Recall is not reported (the pool is not a complete set).

Proposed thresholds, to be confirmed by the owner before the final run: mean lenient precision@5 ≥ 0.70, mean nDCG@10
≥ 0.65, zero results on at most 15% of answerable queries, kappa ≥ 0.6 before metrics are trusted.

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
