import { describe, expect, it } from "vitest";
import { creatorEligibility } from "./eligibility";
import { locationState, MISSING_CONFIRM_MS, nextAvailability, permittedActions } from "./lifecycle";

const now = new Date("2026-10-26T12:00:00Z");
const earlier = (ms: number) => new Date(now.getTime() - ms);

describe("profile availability transitions", () => {
  it("never concludes anything from a provider failure", () => {
    expect(nextAvailability("available", null, "provider_error", now)).toEqual({ state: "temporarily_unavailable", missingSince: null });
    expect(nextAvailability("not_found", earlier(1), "provider_error", now).state).toBe("not_found");
    expect(nextAvailability("private", null, "provider_error", now).state).toBe("private");
  });
  it("needs two 'not found' answers at least 24 hours apart before a profile counts as removed", () => {
    const first = nextAvailability("available", null, "not_found", now);
    expect(first).toEqual({ state: "missing_unconfirmed", missingSince: now });
    expect(nextAvailability("missing_unconfirmed", earlier(3_600_000), "not_found", now).state).toBe("missing_unconfirmed");
    expect(nextAvailability("missing_unconfirmed", earlier(MISSING_CONFIRM_MS), "not_found", now).state).toBe("not_found");
    // The clock of a pending check is not reset by a repeat.
    expect(nextAvailability("missing_unconfirmed", earlier(3_600_000), "not_found", now).missingSince).toEqual(earlier(3_600_000));
  });
  it("returns a profile to available as soon as the provider returns it", () => {
    expect(nextAvailability("not_found", earlier(1), "found", now)).toEqual({ state: "available", missingSince: null });
  });
});

describe("eligibility with availability, per platform", () => {
  const p = (platform: "instagram" | "youtube", followers: number, availability?: "available" | "temporarily_unavailable" | "missing_unconfirmed" | "not_found" | "private") => ({
    platform,
    canonicalUrl: platform === "youtube" ? "https://youtube.com/@sana" : "https://instagram.com/sana",
    followers,
    followersUpdatedAt: earlier(86_400_000),
    lastPostAt: earlier(86_400_000),
    country: { code: "PK", status: "pakistan" as const, checkedAt: earlier(86_400_000) },
    ...(availability ? { availability } : {}),
  });
  const active = { status: "active", isMinor: false, minorOverrideByStaffId: null };

  it("removes only the profile that is gone; the other platform keeps the creator eligible", () => {
    const e = creatorEligibility(active, [p("instagram", 50_000, "not_found"), p("youtube", 40_000)], now);
    expect(e).toMatchObject({ eligible: true, qualifyingPlatforms: ["youtube"] });
    expect(e.profiles.find((x) => x.platform === "instagram")?.reasons).toEqual(["profile_not_found"]);
  });
  it("keeps a profile on its last evidence through an outage or a first 'not found', flagged", () => {
    for (const a of ["temporarily_unavailable", "missing_unconfirmed"] as const) {
      const e = creatorEligibility(active, [p("instagram", 50_000, a)], now);
      expect(e).toMatchObject({ eligible: true, flags: ["availability_unconfirmed"] });
    }
    expect(creatorEligibility(active, [p("instagram", 50_000, "private")], now)).toMatchObject({ eligible: false, reasons: ["profile_private"] });
  });
  it("one platform below 10,000 never affects another; counts are never added", () => {
    const e = creatorEligibility(active, [p("instagram", 2_000), p("youtube", 50_000)], now);
    expect(e.qualifyingPlatforms).toEqual(["youtube"]);
    expect(creatorEligibility(active, [p("instagram", 6_000), p("youtube", 6_000)], now).eligible).toBe(false);
  });
  it("derives permitted actions from the one decision; a removal request hides without deleting", () => {
    const e = creatorEligibility({ ...active, status: "removal_requested" }, [p("youtube", 50_000)], now);
    expect(permittedActions({ ...active, status: "removal_requested" }, e)).toMatchObject({ showInSearch: false, addToListOrCampaign: false, sendOutreach: false, refresh: false });
  });
});

describe("location state", () => {
  const base = { country: "PK", countrySource: "creator_stated", platformCountry: null, statedCountry: "PK", countryCheckedAt: earlier(86_400_000) };
  it("separates confirmed, stated, platform-reported, conflicting, stale and unknown", () => {
    expect(locationState({ ...base, countrySource: "creator_confirmed" }, now)).toBe("creator_confirmed");
    expect(locationState(base, now)).toBe("creator_stated");
    expect(locationState({ ...base, countrySource: "platform_declared", statedCountry: null, platformCountry: "PK" }, now)).toBe("platform_reported");
    expect(locationState({ ...base, platformCountry: "US" }, now)).toBe("conflicting");
    expect(locationState({ ...base, countryCheckedAt: earlier(400 * 86_400_000) }, now)).toBe("stale");
    expect(locationState({ ...base, country: null, countrySource: null, statedCountry: null }, now)).toBe("unknown");
    // A legacy country without any source or check date is not presented as known.
    expect(locationState({ country: "PK", countrySource: null, platformCountry: null, statedCountry: null, countryCheckedAt: null }, now)).toBe("stale");
  });
});
