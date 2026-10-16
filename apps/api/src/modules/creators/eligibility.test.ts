import { describe, expect, it } from "vitest";
import { creatorEligibility, ELIGIBILITY_VERSION, profileEligibility, type EligibilityProfile } from "./eligibility";

const now = new Date("2026-10-16T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const ig = (over: Partial<EligibilityProfile> = {}): EligibilityProfile => ({
  platform: "instagram",
  canonicalUrl: "https://instagram.com/sana.cooks",
  followers: 25_000,
  followersUpdatedAt: daysAgo(3),
  lastPostAt: daysAgo(5),
  ...over,
});
const active = { status: "active", isMinor: false, minorOverrideByStaffId: null };

describe("creator eligibility elig-1 (10,000 follower minimum)", () => {
  it("is exact at the threshold: 9,999 fails, 10,000 and 10,001 pass", () => {
    expect(profileEligibility(ig({ followers: 9_999 }), now)).toMatchObject({ qualifies: false, reasons: ["below_follower_minimum"] });
    expect(profileEligibility(ig({ followers: 10_000 }), now).qualifies).toBe(true);
    expect(profileEligibility(ig({ followers: 10_001 }), now).qualifies).toBe(true);
  });

  it("never passes an unknown or stale count by assumption", () => {
    expect(profileEligibility(ig({ followers: null }), now).reasons).toEqual(["followers_unknown"]);
    expect(profileEligibility(ig({ followersUpdatedAt: null }), now).reasons).toEqual(["followers_stale"]);
    expect(profileEligibility(ig({ followersUpdatedAt: daysAgo(91) }), now).reasons).toEqual(["followers_stale"]);
    expect(profileEligibility(ig({ followersUpdatedAt: daysAgo(89) }), now).qualifies).toBe(true);
  });

  it("qualifies a creator through one qualifying profile and names only that platform", () => {
    const yt = ig({ platform: "youtube", canonicalUrl: "https://youtube.com/@sanacooks", followers: 4_000 });
    const e = creatorEligibility(active, [yt, ig()], now);
    expect(e).toMatchObject({ version: ELIGIBILITY_VERSION, eligible: true, reasons: [], qualifyingPlatforms: ["instagram"] });
    expect(e.profiles.find((p) => p.platform === "youtube")).toMatchObject({ qualifies: false, reasons: ["below_follower_minimum"] });
  });

  it("excludes a creator whose only large profile is known to be inactive", () => {
    expect(creatorEligibility(active, [ig({ lastPostAt: daysAgo(120) })], now)).toMatchObject({ eligible: false, reasons: ["inactive"] });
    expect(profileEligibility(ig({ lastPostAt: daysAgo(90) }), now).qualifies).toBe(true);
  });

  it("flags activity it cannot see instead of inventing it, without excluding", () => {
    expect(creatorEligibility(active, [ig({ lastPostAt: null })], now)).toMatchObject({ eligible: true, flags: ["activity_unverified"] });
  });

  it("rejects profile links that are not a creator's own profile on a supported host", () => {
    for (const url of ["https://instagram.com/p/Cx1", "https://instagram.com/explore", "https://facebook.com/sana", "https://instagram.com/Sana.Cooks"]) {
      expect(profileEligibility(ig({ canonicalUrl: url }), now).reasons, url).toContain("invalid_profile_url");
    }
    expect(profileEligibility(ig({ platform: "tiktok" }), now).reasons).toContain("invalid_profile_url");
  });

  it("applies creator-level rules: removed, erased, merged, protected possible minors, no profile", () => {
    for (const status of ["removal_requested", "erased", "merged"]) expect(creatorEligibility({ ...active, status }, [ig()], now).reasons).toContain("creator_not_active");
    expect(creatorEligibility({ ...active, isMinor: true }, [ig()], now)).toMatchObject({ eligible: false, reasons: ["minor_protected"] });
    expect(creatorEligibility({ ...active, isMinor: true, minorOverrideByStaffId: "staff-1" }, [ig()], now).eligible).toBe(true);
    expect(creatorEligibility(active, [], now)).toMatchObject({ eligible: false, reasons: ["no_profile"] });
  });

  it("records until when the evidence holds: the earlier of count age and post age, the latest across qualifying profiles", () => {
    const e = creatorEligibility(active, [ig({ followersUpdatedAt: daysAgo(10), lastPostAt: daysAgo(80) })], now);
    expect(e.eligibleUntil?.toISOString()).toBe(daysAgo(80 - 90));
    const unknownActivity = creatorEligibility(active, [ig({ followersUpdatedAt: daysAgo(10), lastPostAt: null })], now);
    expect(unknownActivity.eligibleUntil?.toISOString()).toBe(daysAgo(10 - 90));
    const two = creatorEligibility(active, [ig({ followersUpdatedAt: daysAgo(60), lastPostAt: null }), ig({ platform: "youtube", canonicalUrl: "https://youtube.com/@sana", followersUpdatedAt: daysAgo(5), lastPostAt: null })], now);
    expect(two.eligibleUntil?.toISOString()).toBe(daysAgo(5 - 90));
    expect(creatorEligibility(active, [ig({ followers: 1 })], now).eligibleUntil).toBeNull();
  });

  it("lists every reason once when nothing qualifies", () => {
    const e = creatorEligibility(active, [ig({ followers: 500 }), ig({ platform: "youtube", canonicalUrl: "https://youtube.com/@x", followers: null })], now);
    expect(e).toMatchObject({ eligible: false, qualifyingPlatforms: [] });
    expect(e.reasons.sort()).toEqual(["below_follower_minimum", "followers_unknown"]);
  });
});
