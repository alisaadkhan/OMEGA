import { describe, expect, it } from "vitest";
import { bandOf, evaluate, outcomeOf, SCENARIOS, type ShadowProfile } from "./shadow-policy";

const now = new Date("2026-10-29T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const scenario = (id: string) => {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
};
const profile = (over: Partial<ShadowProfile> = {}): ShadowProfile => ({
  platform: "tiktok",
  followers: 15_000,
  lastPostAt: daysAgo(5),
  engagementRate: 4,
  avgViews: 3_000,
  baseline: { qualifies: true, reasons: [], creatorReasons: [] },
  ...over,
});

describe("shadow eligibility policies (report-only)", () => {
  it("SH-01 the elig-2 scenario reproduces the active verdict: a qualifying profile stays eligible, a failing one keeps its reasons", () => {
    expect(evaluate(profile(), scenario("elig-2"), now)).toMatchObject({ outcome: "eligible", reasons: [] });
    const foreign = profile({ baseline: { qualifies: false, reasons: ["country_not_pakistan"], creatorReasons: [] } });
    expect(evaluate(foreign, scenario("elig-2"), now)).toMatchObject({ outcome: "ineligible", reasons: ["country_not_pakistan"] });
    const below = profile({ followers: 9_000, baseline: { qualifies: false, reasons: ["below_follower_minimum"], creatorReasons: [] } });
    expect(evaluate(below, scenario("elig-2"), now).outcome).toBe("ineligible");
  });

  it("SH-02 a TikTok floor only moves TikTok profiles, and only on a known fresh count", () => {
    expect(evaluate(profile(), scenario("cand-tt20k"), now)).toMatchObject({ outcome: "ineligible", reasons: ["below_follower_minimum"] });
    expect(evaluate(profile({ platform: "instagram" }), scenario("cand-tt20k"), now).outcome).toBe("eligible");
    const stale = profile({ baseline: { qualifies: false, reasons: ["followers_stale"], creatorReasons: [] } });
    expect(evaluate(stale, scenario("cand-tt20k"), now).reasons).toEqual(["followers_stale"]);
  });

  it("SH-03 missing evidence is unknown, never a pass or a failure by assumption", () => {
    const noCountry = profile({ baseline: { qualifies: false, reasons: ["country_unknown"], creatorReasons: [] } });
    expect(evaluate(noCountry, scenario("elig-2"), now).outcome).toBe("unknown");
    const noPost = profile({ lastPostAt: null });
    expect(evaluate(noPost, scenario("elig-2"), now)).toMatchObject({ outcome: "eligible", flags: ["activity_unverified"] });
    expect(evaluate(noPost, scenario("cand-strict-activity"), now)).toMatchObject({ outcome: "unknown", reasons: ["activity_unknown"] });
    expect(evaluate(profile(), scenario("shadow-research-posts"), now)).toMatchObject({ outcome: "unknown", reasons: ["per_post_data_missing"] });
  });

  it("SH-04 engagement sanity reviews 10K-500K accounts under 1.5%, flags under 1%, and ignores a missing rate", () => {
    expect(evaluate(profile({ engagementRate: 1.2 }), scenario("cand-engagement"), now)).toMatchObject({ outcome: "review", reasons: ["engagement_review"] });
    expect(evaluate(profile({ engagementRate: 0.5, followers: 800_000 }), scenario("cand-engagement"), now)).toMatchObject({ outcome: "eligible", flags: ["engagement_below_1pct"] });
    expect(evaluate(profile({ engagementRate: null }), scenario("cand-engagement"), now)).toMatchObject({ outcome: "eligible", flags: ["engagement_unknown"] });
  });

  it("SH-05 activity windows are per platform; a known fail outranks review and unknown", () => {
    expect(evaluate(profile({ platform: "youtube", lastPostAt: daysAgo(60) }), scenario("cand-yt45"), now).reasons).toEqual(["inactive"]);
    expect(evaluate(profile({ platform: "instagram", lastPostAt: daysAgo(60) }), scenario("cand-yt45"), now).outcome).toBe("eligible");
    expect(outcomeOf(["country_unknown", "minor_protected", "inactive"])).toBe("ineligible");
    expect(outcomeOf(["country_unknown", "minor_protected"])).toBe("review");
    expect(bandOf(24_999)).toBe("20K-25K");
    expect(bandOf(null)).toBe("unknown");
  });
});
