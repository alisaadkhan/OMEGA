import { describe, expect, it } from "vitest";
import { creatorProfileSchema, searchFiltersSchema, searchRequestSchema } from "./search";

describe("search contracts", () => {
  it("fills filter defaults and rejects inverted ranges and bad country codes", () => {
    expect(searchFiltersSchema.parse({})).toEqual({ niches: [], verifiedOnly: false, hasContact: false, freshOnly: false });
    expect(searchFiltersSchema.safeParse({ followersMin: 5000, followersMax: 10 }).success).toBe(false);
    expect(searchFiltersSchema.safeParse({ engagementMin: 9, engagementMax: 2 }).success).toBe(false);
    expect(searchFiltersSchema.safeParse({ creatorCountry: "Pakistan" }).success).toBe(false);
    expect(searchRequestSchema.parse({ filters: {} })).toMatchObject({ text: "", page: 1 });
  });

  it("never accepts an authenticity score without evidence", () => {
    const base = {
      id: "6f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10",
      displayName: "A",
      handle: "a",
      platform: "instagram",
      avatarUrl: null,
      city: null,
      country: null,
      niches: [],
      tags: [],
      verified: false,
      profiles: [],
      summary: { status: "generating", text: null, model: null, generatedAt: null },
      contacts: [],
      revealed: false,
      revealCost: 5,
      minorProtected: false,
      hasContacts: false,
      mergedInto: null,
    };
    expect(creatorProfileSchema.safeParse({ ...base, authenticity: { status: "assessed", score: 80, fakeFollowerPct: null, evidence: [], assessedAt: new Date().toISOString() } }).success).toBe(false);
    expect(creatorProfileSchema.safeParse({ ...base, authenticity: { status: "not_assessed" } }).success).toBe(true);
  });
});
