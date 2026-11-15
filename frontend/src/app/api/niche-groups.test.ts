import { describe, expect, it } from "vitest";
import { NICHE_TAXONOMY } from "../../../../apps/api/src/modules/creators/terminology";
import { toFilters } from "./search-mapping";
import { NICHE_GROUPS, expandNiche, nicheGroupLabel } from "./niche-groups";

describe("niche filter groups (owner directive 2026-11-15 §4)", () => {
  it("covers every catalogue niche exactly once, so no creator's niche is unreachable", () => {
    const grouped = NICHE_GROUPS.flatMap((g) => [...g.niches]);
    expect([...grouped].sort()).toEqual([...NICHE_TAXONOMY].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("searches every niche of the chosen group, and maps a single catalogue niche to its group", () => {
    expect(expandNiche("Fashion & Beauty")).toEqual(["Fashion", "Beauty", "Bridal"]);
    expect(expandNiche("Beauty")).toEqual(["Fashion", "Beauty", "Bridal"]); // from the AI reading or an older saved search
    expect(nicheGroupLabel("Wellness")).toBe("Fitness & Health");
    expect(expandNiche("Not a niche")).toEqual(["Not a niche"]);
  });

  it("sends the group's niches in the search request", () => {
    const filters = toFilters({ platform: "all", city: null, niche: "Education & Finance", followerBand: null, minEng: null, minScore: null, verifiedOnly: false, contactOnly: false, freshOnly: false, extra: {} });
    expect(filters.niches).toEqual(["Education & How-to", "Finance", "Business & Ecommerce", "Real Estate"]);
  });
});
