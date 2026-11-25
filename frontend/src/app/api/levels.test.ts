import { describe, expect, it } from "vitest";
import { perViewLevel, erLevel, iqLevel } from "./levels";

describe("IQ and engagement colour levels", () => {
  it("bands the IQ score", () => {
    expect([95, 90, 80, 75, 60, 59, 10].map((s) => iqLevel(s).word)).toEqual(["High", "High", "Good", "Good", "Fair", "Low", "Low"]);
  });
  it("bands the engagement rate per platform (owner, 25 Nov): a normal YouTube 0.3% is Typical, not Low", () => {
    expect([3, 2.5, 2.4, 0.5, 0.49].map((r) => erLevel(r, "instagram").word)).toEqual(["High", "High", "Typical", "Typical", "Low"]);
    expect([0.8, 0.79, 0.3, 0.15, 0.14].map((r) => erLevel(r, "youtube").word)).toEqual(["High", "Typical", "Typical", "Typical", "Low"]);
    expect([1, 0.99, 0.2, 0.19].map((r) => erLevel(r, "tiktok").word)).toEqual(["High", "Typical", "Typical", "Low"]);
    expect([4, 3.9, 1.5, 1.49].map((r) => perViewLevel(r).word)).toEqual(["High", "Typical", "Typical", "Low"]);
  });
});
