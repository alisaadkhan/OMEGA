import { describe, expect, it } from "vitest";
import { creatorEligibility } from "./eligibility";
import { organisationCategory } from "./rules";

// Owner decision 2026-11-03 (0072): organisations are not creators and are hidden from search; people never are.
describe("organisation accounts", () => {
  it.each(["Restaurant", "Clothing (Brand)", "Magazine", "Marketing Agency", "Gym/Physical Fitness Center", "Hospitality Service", "Retail company", "Cafe"])("%s is an organisation", (c) => {
    expect(organisationCategory(c)).toBe(c);
  });
  it.each(["Digital creator", "Blogger", "Artist", "Actor", "Public figure", "Makeup Artist", "Health/beauty", "Beauty, cosmetic & personal care", "Social Media Agency", "Food & Drink", null, ""])("%s stays a creator", (c) => {
    expect(organisationCategory(c)).toBeNull();
  });
  it("an organisation is not eligible (reason organisation_account) unless staff override it", () => {
    const profile = { platform: "instagram" as const, canonicalUrl: "https://instagram.com/burgeroclock", followers: 100_000, followersUpdatedAt: new Date(), lastPostAt: new Date(), availability: null, country: { code: "PK", status: "pakistan" as const, checkedAt: new Date() } };
    const base = { status: "active", isMinor: false, minorOverrideByStaffId: null };
    expect(creatorEligibility({ ...base, organisation: false }, [profile], new Date()).eligible).toBe(true);
    const org = creatorEligibility({ ...base, organisation: true }, [profile], new Date());
    expect(org).toMatchObject({ eligible: false, reasons: ["organisation_account"] });
  });
});
