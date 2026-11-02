import { describe, expect, it } from "vitest";
import { contentPerformance, evaluateV3, type V3Input } from "./eligibility-v3";
import type { StandardPost, StandardProfile } from "./enrichment/standardize";

const day = (n: number) => new Date(Date.UTC(2026, 10, 1) - n * 86_400_000);
const post = (n: number, o: Partial<StandardPost> = {}): StandardPost => ({ postedAt: day(n), likes: 300, comments: 20, views: 3_000, isVideo: true, isPinned: false, caption: "", hashtags: [], ...o });
const profile = (platform: StandardProfile["platform"], posts: StandardPost[], followers = 10_000): StandardProfile =>
  ({ platform, handle: "h", displayName: "H", bio: "", followers, following: 200, posts: 50, verified: false, websiteUrls: [], businessEmail: null, businessPhone: null, country: null, avatarUrl: null, recentPosts: posts }) as StandardProfile;
const input = (o: Partial<V3Input> = {}): V3Input => ({ platform: "instagram", followers: 10_000, following: 200, followersFresh: true, countryStatus: "pakistan", available: true, performance: contentPerformance(profile("instagram", Array.from({ length: 10 }, (_, i) => post(i)))), ...o });

describe("elig-3 (owner thresholds 2026-11-02, evaluated only)", () => {
  it("E3-01 median of the latest 10 non-pinned items: one viral post does not decide, pinned posts are left out", () => {
    const posts = [post(0, { views: 5_000_000 }), post(1, { views: 1_000_000, isPinned: true }), ...Array.from({ length: 11 }, (_, i) => post(i + 2, { views: 1_500 }))];
    const p = contentPerformance(profile("instagram", posts));
    expect(p).toMatchObject({ medianViews: 1_500, viewsSample: 10, format: "reel" });
    // Engagement: (300 + 20) / 10,000 = 3.2% per post.
    expect(p?.medianEngagementRate).toBe(3.2);
  });

  it("E3-02 Instagram boundaries: 5,000 followers, 2,000 median Reel views, 2.5% median engagement", () => {
    expect(evaluateV3(input())).toMatchObject({ status: "eligible", reasons: [] });
    expect(evaluateV3(input({ followers: 4_999 })).reasons).toEqual(["below_audience_minimum"]);
    const lowViews = contentPerformance(profile("instagram", Array.from({ length: 10 }, (_, i) => post(i, { views: 1_999 }))));
    expect(evaluateV3(input({ performance: lowViews })).reasons).toEqual(["below_median_views"]);
    const lowEr = contentPerformance(profile("instagram", Array.from({ length: 10 }, (_, i) => post(i, { likes: 200, comments: 40 }))));
    expect(evaluateV3(input({ performance: lowEr })).reasons).toEqual(["below_median_engagement"]);
  });

  it("E3-03 TikTok: 10,000 followers and 15,000 median views; below 1.5x followers is only a warning", () => {
    const perf = contentPerformance(profile("tiktok", Array.from({ length: 10 }, (_, i) => post(i, { views: 15_000 })), 20_000));
    const r = evaluateV3({ ...input({ platform: "tiktok", followers: 20_000, performance: perf }) });
    expect(r).toMatchObject({ status: "eligible", warnings: ["tiktok_views_below_1_5x_followers"] });
    expect(evaluateV3({ ...input({ platform: "tiktok", followers: 9_999, performance: perf }) }).status).toBe("below_minimum");
  });

  it("E3-04 missing evidence is awaiting assessment, never a failure: no posts, too few posts, unknown country, stale count", () => {
    expect(evaluateV3(input({ performance: null })).status).toBe("awaiting_assessment");
    const thin = contentPerformance(profile("instagram", [post(0), post(1)]));
    expect(evaluateV3(input({ performance: thin })).reasons).toEqual(["views_sample_too_small", "engagement_sample_too_small"]);
    expect(evaluateV3(input({ countryStatus: "unknown" })).reasons).toEqual(["country_unknown"]);
    expect(evaluateV3(input({ followersFresh: false })).reasons).toEqual(["followers_stale"]);
    expect(evaluateV3(input({ available: false })).status).toBe("awaiting_assessment");
  });

  it("E3-05 a foreign country is below minimum; a known failure outranks missing evidence", () => {
    expect(evaluateV3(input({ countryStatus: "foreign" })).status).toBe("below_minimum");
    expect(evaluateV3(input({ followers: 3_000, performance: null })).status).toBe("below_minimum");
  });

  it("E3-06 YouTube metrics are not computed or used while YouTube-derived metrics are not permitted", () => {
    expect(contentPerformance(profile("youtube", Array.from({ length: 10 }, (_, i) => post(i))))).toBeNull();
    expect(evaluateV3(input({ platform: "youtube", followers: 50_000, performance: null })).reasons).toEqual(["youtube_metrics_restricted"]);
    const allowed = contentPerformance(profile("youtube", Array.from({ length: 10 }, (_, i) => post(i, { views: 6_000 }))), { youtubeDerived: true });
    expect(evaluateV3(input({ platform: "youtube", followers: 50_000, performance: allowed, youtubeDerivedPermitted: true })).status).toBe("eligible");
  });

  it("E3-07 following more than 10% of followers is a warning, not a status", () => {
    expect(evaluateV3(input({ following: 2_000 }))).toMatchObject({ status: "eligible", warnings: ["following_over_10pct_of_followers"] });
  });
});
