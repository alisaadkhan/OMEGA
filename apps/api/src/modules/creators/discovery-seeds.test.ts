import { describe, expect, it } from "vitest";
import { rotationQueries, SEED_CITIES, SEED_VERTICALS, seedMatrix } from "./discovery-seeds";
import { NICHE_TAXONOMY } from "./terminology";

describe("catalogue expansion seed matrix (owner, 24 Nov)", () => {
  const cells = seedMatrix();

  it("covers all 16 verticals, 16 cities and the regional languages, on all three platforms", () => {
    expect(SEED_VERTICALS).toHaveLength(16);
    expect(new Set(cells.map((c) => c.vertical)).size).toBe(17); // 16 verticals + the regional-language rows
    expect(new Set(cells.map((c) => c.city).filter(Boolean))).toEqual(new Set(SEED_CITIES));
    for (const lang of ["Urdu", "Punjabi", "Pashto", "Sindhi", "Saraiki", "Pakistani diaspora"]) expect(cells.some((c) => c.text.startsWith(lang))).toBe(true);
    expect(new Set(cells.map((c) => c.platform))).toEqual(new Set(["tiktok", "instagram", "youtube"]));
  });

  it("maps every cell to a canonical main niche and keeps queries to three or more words", () => {
    for (const c of cells) {
      expect(NICHE_TAXONOMY).toContain(c.mainNiche);
      expect(c.secondaryNiche.length).toBeGreaterThan(2);
      expect(c.text.trim().split(/\s+/).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("is deterministic, has unique keys, puts TikTok and Instagram first and covers every vertical before any city", () => {
    expect(seedMatrix()).toEqual(cells);
    expect(new Set(cells.map((c) => c.key)).size).toBe(cells.length);
    expect(cells.slice(0, 3).map((c) => c.platform)).toEqual(["tiktok", "instagram", "youtube"]);
    const firstCity = cells.findIndex((c) => c.city !== null);
    expect(new Set(cells.slice(0, firstCity).map((c) => c.vertical)).size).toBe(17);
  });

  it("can be limited to some platforms", () => {
    expect(new Set(seedMatrix({ platforms: ["tiktok"] }).map((c) => c.platform))).toEqual(new Set(["tiktok"]));
  });

  it("rotates a small wave evenly over all 16 verticals and many cities, Arts & Design included", () => {
    const q = rotationQueries(78);
    expect(q).toHaveLength(78);
    const per = new Map<string, number>();
    for (const x of q) per.set(x.vertical, (per.get(x.vertical) ?? 0) + 1);
    expect(per.size).toBe(16);
    expect(Math.max(...per.values()) - Math.min(...per.values())).toBeLessThanOrEqual(1);
    expect(new Set(q.map((x) => x.city).filter(Boolean)).size).toBeGreaterThanOrEqual(12);
    expect(q.some((x) => x.mainNiche === "Arts & Design")).toBe(true);
    expect(new Set(q.map((x) => x.text)).size).toBe(78);
  });
});
