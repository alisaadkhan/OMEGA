import { describe, expect, it } from "vitest";
import { erLevel, iqLevel } from "./levels";

describe("IQ and engagement colour levels", () => {
  it("bands the IQ score", () => {
    expect([95, 90, 80, 75, 60, 59, 10].map((s) => iqLevel(s).word)).toEqual(["High", "High", "Good", "Good", "Fair", "Low", "Low"]);
  });
  it("bands the engagement rate (percent per follower)", () => {
    expect([5, 3, 2.9, 1, 0.99, 0.5, 0.49, 0].map((r) => erLevel(r).word)).toEqual(["High", "High", "Good", "Good", "Fair", "Fair", "Low", "Low"]);
  });
});
