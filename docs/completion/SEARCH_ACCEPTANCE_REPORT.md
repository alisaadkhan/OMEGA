# Search acceptance report

**Decision: Search is NOT ACCEPTED.** Superseded in detail by `final-search-acceptance-report.md` (2026-10-20 campaign: 152 cases). The campaign found that 18 of 28 relevance cases return nothing, 15 of them with pooled candidates for raters; coverage is at high risk but depends on ratings. It also left two defects open under the freeze: D1 ("YouTubers" not read as a platform) and D2 (Roman Urdu live brief rejected by fit). No human relevance ratings exist. The owner's gates (two independent raters plus an
adjudicator; weighted kappa ≥ 0.60, strict precision@5 ≥ 0.80, nDCG@10 ≥ 0.75, coverage ≥ 0.90, every behaviour case
correct) have not been measured. Nothing in this report is evidence of relevance.

## Freeze status

- Search behaviour is frozen (owner decision 2026-10-15; mandate v3 §2.3). No retrieval, ranking, query-understanding,
  Live Discovery selection or Campaign Fit change was made in this work.
- Freeze check: `node --import tsx scripts/search-eval/freeze-check.ts ../MUSHIN_RECONCILED_DOCUMENTATION_CANDIDATE/testing/search_eval_queries_unlabeled.csv`
  reproduces the rating packets byte for byte (Brain 1: 35 queries, Brain 2: 25 briefs). Last runs: 2026-10-17 at
  `2373a31`, and the final run in Phase 7 (TEST_EXECUTION_REPORT.md).
- Search-adjacent changes made while frozen, each shown not to change outputs: paid-run records and resume (SRCH-04),
  shared spend reservations (SRCH-05), one open live run per workspace (BIL-06), pg_trgm schema move on Supabase only
  (SEC-11; full suite incl. catalogue search passed on Supabase with it), eraser journal re-apply (OPS-04).

## Software correctness (not relevance)

| Property | Evidence |
|---|---|
| Deterministic, query-sensitive results | customer E2E `search` (different queries give different results; partial handle; platform filter) |
| Eligibility (10k, 90 days) enforced before ranking | `eligibility.test`, `eligibility.int`, E2E `eligibility` |
| Charging: one charge per logical search, repeat and next page free, empty result charged (current rule) | `search-charge` tests; E2E `pricing` |
| Malformed input refused | E2E `search` (400) |
| LLM unavailable does not block search | E2E `search` (INT-002) |
| Live Discovery: quote → reserve → job atomic; one run per workspace; failure refunds; idempotent confirm | `live-service.int`, `live-runner.int`, E2E `discovery` |
| Provider runs recorded before waiting, resumed on retry, reconciled | `provider-runs.int`, `scrapers/provider-runs.test` |
| Index drift repaired at worker start-up | E2E `restart` (search answers after restart) |

Every Live Discovery result since 13 October is **replay** of recorded provider responses; the live provider path is
unverified (pilot envelope: owner decision D-09).

## Reporting and metrics (implemented, unit-tested)

`scripts/search-eval/metrics.ts` and `score.ts` (commit `5b52fef`):
- Gate: **weighted kappa** (quadratic, ordinal 0/1/2) ≥ 0.60, as the owner decision states; unweighted Cohen's kappa
  and raw agreement reported beside it.
- Strict precision@5 (gate), standard precision@5 (divides by 5), lenient precision@5/@10, nDCG@10 with pooled
  judgements, relevant-query coverage, behaviour cases.
- Seeded bootstrap 95% intervals for precision@5 and nDCG@10, so the width of the evidence is visible (audit SRCH-13).
- Tests: `scripts/search-eval/metrics.test.ts` (hand-worked kappa values, interval properties). `score.ts` itself runs
  only on completed rating sheets, so it is typechecked, not executed.

## Human rating status

| Item | State |
|---|---|
| Rating packets | `blind-b1-elig1` (Brain 1: 222 rows + 35 behaviour cases) and `blind-b2-elig1` (Brain 2 replay: 131 rows + 25 cases): 413 judgements per rater |
| Raters and adjudicator | **Not named** (owner; requested by 2026-10-20) |
| Evaluation data deletion | Owner, by **2026-11-12** (YouTube API data) |
| Protocol proposals (audit F §6, SRCH-13) | Waiting for owner approval |

## Acceptance decision

Not accepted. Acceptance requires completed, adjudicated ratings that pass every gate, recorded by the owner in the
progress record. Until then only frozen-output-compatible plumbing and reporting may change.
