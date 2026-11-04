import { describe, expect, it } from "vitest";
import { locationOutcome, performanceAssessment, performanceBadge } from "./profile-states";

const now = new Date("2026-11-04T00:00:00Z");
const base = {
  platform: "instagram" as const, followers: 50_000, following: 300, followersUpdatedAt: new Date("2026-11-01T00:00:00Z"), countryStatus: "pakistan",
  medianViews: 40_000, medianEngagementRate: 5, performanceViewsSample: 8, performanceEngagementSample: 8, performanceFormat: "reel",
};

describe("profile states (master directive Parts 4 and 8)", () => {
  it("gives one of five location outcomes, saying diaspora only from the profile's own words", () => {
    expect(locationOutcome("pakistan", null)).toBe("PAKISTAN_CONFIRMED");
    expect(locationOutcome("conflicting", null)).toBe("CONFLICTING_EVIDENCE");
    expect(locationOutcome("foreign", "Pakistani in Toronto")).toBe("PAKISTANI_DIASPORA");
    expect(locationOutcome("foreign", "Toronto food blogger")).toBe("NON_PAKISTANI_CONFIRMED");
    expect(locationOutcome("unknown", "Pakistani")).toBe("UNKNOWN");
    expect(locationOutcome(null, null)).toBe("UNKNOWN");
  });

  it("badges performance, and never claims one it cannot measure", () => {
    const badge = (o: Partial<typeof base>, restricted = false) => performanceBadge({ ...base, ...o }, { restricted, now });
    expect(badge({})).not.toBe("incomplete");
    expect(badge({ medianViews: 10, medianEngagementRate: 0.1 })).toBe("below_benchmark");
    expect(badge({ performanceViewsSample: 2, performanceEngagementSample: 2 })).toBe("incomplete");
    expect(badge({ followersUpdatedAt: new Date("2026-01-01T00:00:00Z") })).toBe("incomplete");
    expect(badge({}, true)).toBe("incomplete");
  });

  it("states soft quality signals in plain words, without changing the badge", () => {
    const a = performanceAssessment({ ...base, following: 9_000 }, { restricted: false, now });
    expect(a.signals).toEqual(["Follows many accounts for its size (following is over 10% of followers)"]);
    expect(a.badge).toBe(performanceBadge(base, { restricted: false, now }));
    expect(performanceAssessment({ ...base, following: 9_000 }, { restricted: true, now }).signals).toEqual([]);
  });
});
