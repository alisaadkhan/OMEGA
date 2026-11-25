import { describe, expect, it } from "vitest";
import { engagementScore, scoreTier } from "./engagement-score";

describe("Engagement Score 1.0–10.0 (owner, 25 Nov)", () => {
  it("anchors Instagram: medians read 5.0, band edges land where the owner set them", () => {
    expect([0, 0.1, 0.3, 0.55, 1, 3, 6, 20].map((r) => engagementScore(r, "instagram"))).toEqual([1, 2.5, 4.5, 5, 7, 9, 10, 10]);
    expect(engagementScore(0.099, "instagram")).toBe(2.5); // rounds up just below the edge
    expect(engagementScore(0.05, "instagram")).toBe(1.8);
  });

  it("anchors YouTube so a normal 0.15% is 5.0, not a poor score", () => {
    expect([0, 0.02, 0.08, 0.15, 0.4, 1.15, 2.5, 9].map((r) => engagementScore(r, "youtube"))).toEqual([1, 2.5, 4.5, 5, 7, 9, 10, 10]);
  });

  it("anchors TikTok on its per-follower rate", () => {
    expect([0, 0.09, 0.2, 0.25, 0.6, 2.5, 5, 40].map((r) => engagementScore(r, "tiktok")).every((s, i) => s === [1, 2.5, 4.5, 5, 7, 9, 10, 10][i])).toBe(true);
  });

  it("compares platforms fairly: each platform's median scores the same", () => {
    expect(engagementScore(0.55, "instagram")).toBe(engagementScore(0.15, "youtube"));
    expect(engagementScore(0.15, "youtube")).toBe(engagementScore(0.25, "tiktok"));
  });

  it("is null when the rate is unknown, and tiers the score", () => {
    expect(engagementScore(null, "instagram")).toBeNull();
    expect(engagementScore(undefined, "youtube")).toBeNull();
    expect(engagementScore(Number.NaN, "tiktok")).toBeNull();
    expect([9, 8.9, 7, 6.9, 4.5, 4.4, null].map(scoreTier)).toEqual(["top", "strong", "strong", "typical", "typical", "low", "unknown"]);
  });
});
