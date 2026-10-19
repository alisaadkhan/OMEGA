import { describe, expect, it } from "vitest";
import { blindOrder, bootstrapMeanCI, cohensKappa, gate, mean, ndcgAt, parseCsv, percentile, precisionAt, rawAgreement, relevantCoverage, standardPrecisionAt, toCsv, weightedKappa, type Rating } from "./metrics";

describe("search evaluation metrics", () => {
  it("precision@k: strict counts only fully relevant results; no results is not a precision", () => {
    const r: Rating[] = [2, 1, 0, 2, 0, 2];
    expect(precisionAt(r, 5, true)).toBeCloseTo(2 / 5);
    expect(precisionAt(r, 5, false)).toBeCloseTo(3 / 5);
    expect(precisionAt([2, 2], 10, true)).toBe(1); // fewer than k results: divide by what was returned
    expect(precisionAt([], 5, true)).toBeNull();
  });

  it("nDCG@k against the pooled judgements, undefined when nothing relevant was judged", () => {
    expect(ndcgAt([2, 1, 0], [2, 1, 0], 10)).toBe(1);
    expect(ndcgAt([0, 1, 2], [2, 1, 0], 10)).toBeLessThan(1);
    expect(ndcgAt([0, 0], [0, 0], 10)).toBeNull();
  });

  it("Cohen's kappa: 1 for identical ratings, about 0 for chance agreement", () => {
    expect(cohensKappa([2, 1, 0, 2], [2, 1, 0, 2])).toBe(1);
    expect(cohensKappa([2, 2, 0, 0], [2, 0, 2, 0])).toBeCloseTo(0);
    expect(cohensKappa([2], [2, 1])).toBeNull();
  });

  it("mean ignores undefined values; percentile is nearest-rank", () => {
    expect(mean([1, null, 0])).toBe(0.5);
    expect(mean([null])).toBeNull();
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
  });

  it("CSV round-trips quotes, commas, new lines and Urdu text", () => {
    const rows = [["q", "text"], ["Q002", 'لاہور، "اسکن کیئر"\nline two']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("coverage counts only queries with a relevant creator somewhere in the judged pool", () => {
    expect(relevantCoverage([
      { judged: [2, 0, 2], returned: [2, 0] }, // covered
      { judged: [0, 2], returned: [0] }, // relevant creator pooled but not returned: a miss
      { judged: [0, 1], returned: [] }, // nothing fully relevant exists: not answerable
    ])).toEqual({ answerable: 2, covered: 1, share: 0.5 });
    expect(relevantCoverage([{ judged: [1], returned: [1] }]).share).toBeNull();
  });

  it("a gate passes only at or above its threshold and never without a value", () => {
    expect(gate("p", 0.8, 0.8).pass).toBe(true);
    expect(gate("p", 0.79, 0.8).pass).toBe(false);
    expect(gate("p", null, 0.8).pass).toBe(false);
  });

  it("blind order is stable and does not follow the input order", () => {
    const keys = Array.from({ length: 20 }, (_, i) => `Q001:${i}`);
    const once = blindOrder(keys, (k) => k);
    expect(blindOrder([...keys].reverse(), (k) => k)).toEqual(once);
    expect(once).not.toEqual(keys);
  });
});

describe("reporting additions (audit SRCH-13; no ranking change)", () => {
  it("weighted kappa matches hand-worked values and penalises far disagreements more", () => {
    // [0,1,2] vs [0,2,1]: quadratic observed 1/6, expected 1/3 -> 0.5; linear 1/3 vs 4/9 -> 0.25; unweighted 0.
    expect(weightedKappa([0, 1, 2], [0, 2, 1])).toBeCloseTo(0.5, 10);
    expect(weightedKappa([0, 1, 2], [0, 2, 1], "linear")).toBeCloseTo(0.25, 10);
    expect(cohensKappa([0, 1, 2], [0, 2, 1])).toBeCloseTo(0, 10);
    expect(weightedKappa([2, 1, 0, 2], [2, 1, 0, 2])).toBe(1);
    expect(weightedKappa([2, 2], [2, 2])).toBe(1);
    expect(weightedKappa([], [])).toBeNull();
    // Off by one everywhere beats off by two everywhere.
    expect(weightedKappa([0, 1, 2, 1], [1, 2, 1, 0]) ?? 0).toBeGreaterThan(weightedKappa([0, 2, 0, 2], [2, 0, 2, 0]) ?? 0);
  });

  it("raw agreement and standard precision@5", () => {
    expect(rawAgreement([2, 1, 0, 2], [2, 0, 0, 1])).toBe(0.5);
    expect(rawAgreement([2], [2, 1])).toBeNull();
    // Two results, both relevant: shown-results precision says 1, standard precision@5 says 0.4.
    expect(precisionAt([2, 2], 5, true)).toBe(1);
    expect(standardPrecisionAt([2, 2], 5, true)).toBe(0.4);
    expect(standardPrecisionAt([2, 1, 0, 2, 2, 2], 5, false)).toBe(0.8);
    expect(standardPrecisionAt([], 5, true)).toBeNull();
  });

  it("bootstrap confidence intervals are reproducible, contain the mean, and widen with fewer queries", () => {
    const values = [1, 0.8, 0.6, 0.4, 1, 0.2, null, 0.6];
    const a = bootstrapMeanCI(values, { seed: 7 });
    expect(a).toEqual(bootstrapMeanCI(values, { seed: 7 }));
    expect(a?.n).toBe(7);
    expect(a?.low).toBeLessThanOrEqual(a?.mean ?? 0);
    expect(a?.high).toBeGreaterThanOrEqual(a?.mean ?? 0);
    expect(bootstrapMeanCI([0.6, 0.6, 0.6])).toMatchObject({ low: 0.6, high: 0.6 });
    expect(bootstrapMeanCI([null, null])).toBeNull();
    const few = bootstrapMeanCI([1, 0], { seed: 3 });
    const many = bootstrapMeanCI(Array.from({ length: 200 }, (_, i) => (i % 2 ? 1 : 0)), { seed: 3 });
    expect((few?.high ?? 0) - (few?.low ?? 0)).toBeGreaterThan((many?.high ?? 0) - (many?.low ?? 0));
  });
});
