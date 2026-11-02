import { describe, expect, it } from "vitest";
import { groupEvidence, unknownReason, type EvidenceItem } from "./evidence-mapping";

const row = (o: Partial<EvidenceItem>): EvidenceItem => ({ attribute: "city", value: "Lahore", source: "profile_text", status: "supported", quote: "Food vlogger in Lahore", observedAt: "2026-10-21T00:00:00.000Z", ...o });

describe("creator attribute evidence", () => {
  it("groups by field, supported first, and names countries", () => {
    const groups = groupEvidence([
      row({ attribute: "country", value: "US", source: "platform_registration", status: "conflicting" }),
      row({ attribute: "country", value: "PK" }),
      row({ attribute: "niche", value: "Food" }),
      row({}),
    ]);
    expect(groups.map((g) => g.attribute)).toEqual(["city", "country", "niche"]);
    expect(groups[1]?.rows.map((r) => r.display)).toEqual(["Pakistan", "United States"]);
  });

  it("explains why a field is unknown", () => {
    expect(unknownReason({ rows: [row({})] })).toBeNull();
    expect(unknownReason({ rows: [row({ status: "conflicting" }), row({ value: "Karachi", status: "conflicting" })] })).toMatch(/more than one/);
    expect(unknownReason({ rows: [row({ source: "ai_assessment", status: "weak" })] })).toMatch(/weak signals/);
  });

  it("shows nothing when there is no evidence", () => {
    expect(groupEvidence([])).toEqual([]);
  });
});

describe("country with its source", () => {
  it("names any country and says where it comes from, and stays empty when unknown", async () => {
    const { countryWithSource } = await import("./evidence-mapping");
    expect(countryWithSource("CA", "creator_stated")).toBe("Canada · stated in the creator's bio");
    expect(countryWithSource("PK", "platform_declared")).toBe("Pakistan · declared on the platform");
    expect(countryWithSource("GB", null)).toBe("United Kingdom");
    expect(countryWithSource(null, null)).toBeNull();
  });
});
