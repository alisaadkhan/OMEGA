import { describe, expect, it } from "vitest";
import { youtubeDeclaredForeign } from "./pipeline";
import type { StandardProfile } from "./standardize";

const yt = (country: string | null, bio = ""): StandardProfile =>
  ({ platform: "youtube", handle: "h", displayName: "H", bio, followers: 50_000, following: null, posts: 100, verified: false, websiteUrls: [], businessEmail: null, businessPhone: null, country, avatarUrl: null, recentPosts: [] }) as StandardProfile;

describe("YouTube location pre-screen (owner 2026-11-02)", () => {
  it("YT-PRE-01 a channel declaring a non-Pakistani country is flagged foreign before any AI call", () => {
    expect(youtubeDeclaredForeign(yt("IN"))).toBe(true);
    expect(youtubeDeclaredForeign(yt("US", "Gaming videos every week"))).toBe(true);
  });
  it("YT-PRE-02 a Pakistani or undeclared channel is not pre-screened out (undeclared stays unknown, never passed by default)", () => {
    expect(youtubeDeclaredForeign(yt("PK"))).toBe(false);
    expect(youtubeDeclaredForeign(yt(null))).toBe(false);
    expect(youtubeDeclaredForeign(yt(null, "Lahore, Pakistan"))).toBe(false);
  });
  it("YT-PRE-03 only YouTube is pre-screened this way", () => {
    expect(youtubeDeclaredForeign({ ...yt("IN"), platform: "instagram" } as StandardProfile)).toBe(false);
  });
});
