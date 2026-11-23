import { describe, expect, it } from "vitest";
import { consistency } from "./CreatorProfilePanel";

const now = Date.parse("2026-11-23T12:00:00Z");
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

describe("content consistency on the creator card (owner, 23 Nov: every card complete)", () => {
  it("uses the measured posting rate on the profile first", () => {
    expect(consistency([], { platform: "instagram", postsPerWeek: 4, lastPostAt: daysAgo(1) }, now)).toEqual({ value: "High", note: "~4 posts per week" });
    expect(consistency([], { platform: "tiktok", postsPerWeek: 0.5, lastPostAt: daysAgo(3) }, now)).toEqual({ value: "Low", note: "~0.5 posts per week" });
  });
  it("falls back to the assessment's evidence, then to the newest post date", () => {
    expect(consistency([{ signal: "posting_regularity", detail: "Posts about 2 times a week recently" }], { platform: "instagram", postsPerWeek: null, lastPostAt: null }, now).value).toBe("Medium");
    expect(consistency([], { platform: "instagram", postsPerWeek: null, lastPostAt: daysAgo(5) }, now)).toEqual({ value: "Active", note: "Last post 5 days ago" });
  });
  it("says inactive after 90 quiet days, and why a value is missing otherwise", () => {
    expect(consistency([], { platform: "instagram", postsPerWeek: 3, lastPostAt: daysAgo(120) }, now)).toEqual({ value: "Inactive", note: "No new posts for 120 days" });
    expect(consistency([], { platform: "youtube", postsPerWeek: null, lastPostAt: null }, now).note).toBe("Policy restricted for YouTube");
    expect(consistency([], null, now).note).toBe("No recent posts to measure");
  });
});
