import { describe, expect, it } from "vitest";
import { cohensKappa, mean, ndcgAt, parseCsv, percentile, precisionAt, toCsv, type Rating } from "./metrics";

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
});
