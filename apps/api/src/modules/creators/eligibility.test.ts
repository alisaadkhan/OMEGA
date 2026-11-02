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
  country: { code: "PK", status: "pakistan", checkedAt: daysAgo(3) },
  ...over,
});
const active = { status: "active", isMinor: false, minorOverrideByStaffId: null };

describe("creator eligibility (10,000 follower minimum)", () => {
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

  it("keeps count freshness and posting activity independent (owner rule confirmed 2026-10-16)", () => {
    // Exactly 90 days old still counts; one day more needs a refresh.
    expect(profileEligibility(ig({ followersUpdatedAt: daysAgo(90) }), now).qualifies).toBe(true);
    // A recent post does not refresh an old or unknown count.
    expect(profileEligibility(ig({ followersUpdatedAt: daysAgo(91), lastPostAt: daysAgo(1) }), now)).toMatchObject({ qualifies: false, reasons: ["followers_stale"] });
    expect(profileEligibility(ig({ followers: null, lastPostAt: daysAgo(1) }), now)).toMatchObject({ qualifies: false, reasons: ["followers_unknown"] });
    // An old post makes the creator inactive, not the count stale; unknown activity is a flag, never a stale count.
    expect(profileEligibility(ig({ followersUpdatedAt: daysAgo(1), lastPostAt: daysAgo(120) }), now)).toMatchObject({ qualifies: false, reasons: ["inactive"] });
    expect(profileEligibility(ig({ followersUpdatedAt: daysAgo(1), lastPostAt: null }), now)).toMatchObject({ qualifies: true, reasons: [] });
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
    // The YouTube count holds 30 days (YouTube API policy, YT-RET-01), the Instagram one 90: 80 days old leaves it 10.
    const two = creatorEligibility(active, [ig({ followersUpdatedAt: daysAgo(80), lastPostAt: null }), ig({ platform: "youtube", canonicalUrl: "https://youtube.com/@sana", followersUpdatedAt: daysAgo(5), lastPostAt: null })], now);
    expect(two.eligibleUntil?.toISOString()).toBe(daysAgo(5 - 30));
    expect(creatorEligibility(active, [ig({ followers: 1 })], now).eligibleUntil).toBeNull();
  });

  it("lists every reason once when nothing qualifies", () => {
    const e = creatorEligibility(active, [ig({ followers: 500 }), ig({ platform: "youtube", canonicalUrl: "https://youtube.com/@x", followers: null })], now);
    expect(e).toMatchObject({ eligible: false, qualifyingPlatforms: [] });
    expect(e.reasons.sort()).toEqual(["below_follower_minimum", "followers_unknown"]);
  });
});

describe("creator eligibility elig-2 (Pakistan-only catalogue, 2026-10-27)", () => {
  it("qualifies only a profile whose own country resolves to Pakistan", () => {
    expect(ELIGIBILITY_VERSION).toBe("elig-2");
    expect(profileEligibility(ig(), now).qualifies).toBe(true);
    expect(profileEligibility(ig({ country: { code: "GB", status: "foreign", checkedAt: daysAgo(3) } }), now).reasons).toEqual(["country_not_pakistan"]);
    expect(profileEligibility(ig({ country: { code: null, status: "unknown", checkedAt: null } }), now).reasons).toEqual(["country_unknown"]);
    expect(profileEligibility(ig({ country: { code: null, status: "conflicting", checkedAt: daysAgo(3) } }), now).reasons).toEqual(["country_conflicting"]);
  });

  it("never qualifies a profile whose country was not provided (no assumption)", () => {
    expect(profileEligibility(ig({ country: undefined }), now).reasons).toEqual(["country_unknown"]);
    expect(profileEligibility(ig({ country: null }), now).reasons).toEqual(["country_unknown"]);
  });

  it("treats Pakistani evidence older than a year as stale, and dates eligibility by it", () => {
    expect(profileEligibility(ig({ country: { code: "PK", status: "pakistan", checkedAt: daysAgo(366) } }), now).reasons).toEqual(["country_stale"]);
    const e = profileEligibility(ig({ followersUpdatedAt: daysAgo(1), lastPostAt: daysAgo(1), country: { code: "PK", status: "pakistan", checkedAt: daysAgo(360) } }), now);
    expect(e.qualifiesUntil?.toISOString()).toBe(new Date(new Date(daysAgo(360)).getTime() + 365 * 86_400_000).toISOString());
  });

  it("YT-RET-01 a YouTube count older than 30 days is stale even if the retention job has not cleared it; other platforms keep 90", () => {
    const yt = (days: number) => ig({ platform: "youtube", canonicalUrl: "https://youtube.com/@sana", followersUpdatedAt: daysAgo(days), lastPostAt: daysAgo(1) });
    expect(profileEligibility(yt(31), now).reasons).toEqual(["followers_stale"]);
    const fresh = profileEligibility(yt(29), now);
    expect(fresh.qualifies).toBe(true);
    expect(fresh.qualifiesUntil?.toISOString()).toBe(new Date(new Date(daysAgo(29)).getTime() + 30 * 86_400_000).toISOString());
    expect(profileEligibility(ig({ followersUpdatedAt: daysAgo(60), lastPostAt: daysAgo(1) }), now).qualifies).toBe(true);
  });

  it("CTY-FRESH-01 a Pakistani country with no check time is stale, never fresh forever", () => {
    const p = profileEligibility(ig({ country: { code: "PK", status: "pakistan", checkedAt: null } }), now);
    expect(p).toMatchObject({ qualifies: false, reasons: ["country_stale"], qualifiesUntil: null });
  });

  it("judges each platform profile on its own: a Pakistani YouTube channel never qualifies a foreign or unknown Instagram profile", () => {
    const yt = ig({ platform: "youtube", canonicalUrl: "https://youtube.com/@sana", country: { code: "PK", status: "pakistan", checkedAt: daysAgo(3) } });
    const foreignIg = ig({ country: { code: "AE", status: "foreign", checkedAt: daysAgo(3) } });
    const e = creatorEligibility(active, [yt, foreignIg], now);
    expect(e.eligible).toBe(true);
    expect(e.qualifyingPlatforms).toEqual(["youtube"]);
    expect(e.profiles.find((p) => p.platform === "instagram")).toMatchObject({ qualifies: false, reasons: ["country_not_pakistan"] });
    const reverse = creatorEligibility(active, [ig(), ig({ platform: "youtube", canonicalUrl: "https://youtube.com/@sana", country: { code: "GB", status: "foreign", checkedAt: daysAgo(3) } })], now);
    expect(reverse.qualifyingPlatforms).toEqual(["instagram"]);
  });

  it("lists the country reason with the others when nothing qualifies", () => {
    const e = creatorEligibility(active, [ig({ followers: 5_000, country: { code: "IN", status: "foreign", checkedAt: daysAgo(3) } })], now);
    expect(e.eligible).toBe(false);
    expect(e.reasons).toEqual(expect.arrayContaining(["below_follower_minimum", "country_not_pakistan"]));
  });
});
