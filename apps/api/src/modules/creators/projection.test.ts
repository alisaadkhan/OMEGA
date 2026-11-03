import { describe, expect, it } from "vitest";
import type { IndexRow } from "./repository";
import { toDocument } from "./projection";

const row: IndexRow = {
  id: "6f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10",
  status: "active",
  isMinor: false,
  minorOverrideByStaffId: null,
  organisation: false,
  displayName: "Hidden Subscribers",
  nameVariants: [],
  primaryHandle: "hidden",
  primaryPlatform: "youtube",
  city: null,
  country: null,
  niches: [],
  tags: [],
  verified: false,
  authenticityScore: null,
  hasContact: false,
  profiles: [{ platform: "youtube", handle: "hidden", canonicalUrl: "https://youtube.com/@hidden", followers: 0, engagementRate: null, bio: null, followersUpdatedAt: "2026-10-10T00:00:00Z", lastPostAt: null }],
  audience: null,
  updatedEpoch: 1,
};

describe("creator index projection", () => {
  it("does not publish a legacy YouTube zero as a known follower count", () => {
    expect(toDocument(row).followers).toBeNull();
  });

  it("does not index demographic guesses without an audience analytics source", () => {
    const withLegacyEstimate: IndexRow = {
      ...row,
      audience: {
        age: [], gender: null, cities: [], countries: [{ code: "AE", value: 65, confidence: "low" }], source: "estimated from public content",
      },
    };
    expect(toDocument(withLegacyEstimate).audience_countries).toEqual([]);
  });

  it("cuts a long bio without splitting an emoji, so the document is valid JSON for PostgreSQL (real creator 2026-10-14)", () => {
    const bio = "x".repeat(499) + String.fromCodePoint(0x1f4da) + " more";
    const doc = toDocument({ ...row, profiles: row.profiles.map((p) => ({ ...p, bio })) });
    expect(doc.bio).toBe("x".repeat(499));
    const json = JSON.stringify(doc);
    const loneHighSurrogateEscape = new RegExp(`${String.fromCharCode(92)}u[dD][89abAB][0-9a-fA-F]{2}`);
    expect(loneHighSurrogateEscape.test(json)).toBe(false);
  });

  // Security hardening 2026-11-03: an email or phone number in a bio cannot be searched for or read from match reasons.
  it("keeps emails and phone numbers out of the searchable bio", () => {
    const bio = "Bridal looks, Lahore. Bookings: sana@example.com / 0300-1234567";
    const doc = toDocument({ ...row, profiles: row.profiles.map((p) => ({ ...p, bio })) });
    expect(doc.bio).toContain("Bridal looks, Lahore.");
    expect(doc.bio).not.toMatch(/example\.com|1234567/);
  });
});
