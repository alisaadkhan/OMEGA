import { describe, expect, it } from "vitest";
import { searchFiltersShape, type InterpretResponse } from "@mushin/contracts";
import { combineFollowUp } from "./follow-up";

const filters = (f: Record<string, unknown>) => searchFiltersShape.parse(f);
const reading = (chips: Record<string, unknown>, keywords: string[] = [], basis: Record<string, "stated" | "inferred"> = {}): InterpretResponse => ({
  chips: filters(chips),
  keywords,
  understood: { basis, notFilters: [] },
  followUp: null,
});

describe("follow-up searches (master prompt §13)", () => {
  const gaming = { text: "pakistani gaming creators", filters: filters({ creatorCountry: "PK", niches: ["Gaming"] }) };

  it("'At least 50k' keeps the gaming search and adds the follower minimum", () => {
    const r = combineFollowUp(gaming, reading({ followersMin: 50_000 }, [], { followers: "stated" }), "at least 50k");
    expect(r.followUp).toMatchObject({ mode: "refine", text: "pakistani gaming creators", kept: ["country", "niche"], replaced: [], cleared: [] });
    expect(r.chips).toMatchObject({ creatorCountry: "PK", niches: ["Gaming"], followersMin: 50_000 });
    expect(r.basis).toMatchObject({ followers: "stated", creatorCountry: "kept", niche: "kept" });
  });

  it("'Only YouTube' then updates the same search again", () => {
    const step1 = combineFollowUp(gaming, reading({ followersMin: 50_000 }), "at least 50k");
    const r = combineFollowUp({ text: step1.followUp.text, filters: filters(step1.chips) }, reading({ platform: "youtube" }, ["only"]), "only YouTube");
    expect(r.chips).toMatchObject({ creatorCountry: "PK", niches: ["Gaming"], followersMin: 50_000, platform: "youtube" });
    expect(r.followUp.text).toBe("pakistani gaming creators");
  });

  it("a different niche starts a new search: no old filters are carried into it", () => {
    const r = combineFollowUp({ text: "lahore food bloggers", filters: filters({ creatorCity: "Lahore", niches: ["Food"], platform: "instagram" }) }, reading({ niches: ["Fashion"] }, ["fashion"]), "now fashion creators");
    expect(r.followUp.mode).toBe("new");
    expect(r.chips.creatorCity).toBeUndefined();
    expect(r.chips.platform).toBeUndefined();
    expect(r.followUp.text).toBe("now fashion creators");
  });

  it("'start over' is a new search even without a niche", () => {
    expect(combineFollowUp(gaming, reading({ platform: "tiktok" }), "start over, tiktok creators").followUp.mode).toBe("new");
  });

  it("a contradiction replaces the old bound and says so; it is never silently kept or dropped", () => {
    const prev = { text: "beauty creators", filters: filters({ niches: ["Beauty"], followersMax: 50_000 }) };
    const r = combineFollowUp(prev, reading({ followersMin: 100_000 }), "at least 100k followers");
    expect(r.chips.followersMin).toBe(100_000);
    expect(r.chips.followersMax).toBeUndefined();
    expect(r.followUp.replaced).toEqual(["follower range"]);
  });

  it("'any platform' clears the platform; a changed platform is reported as replaced", () => {
    const prev = { text: "tech reviewers", filters: filters({ platform: "instagram", niches: ["Technology"] }) };
    const cleared = combineFollowUp(prev, reading({}), "any platform is fine");
    expect(cleared.chips.platform).toBeUndefined();
    expect(cleared.followUp.cleared).toEqual(["platform"]);
    const switched = combineFollowUp(prev, reading({ platform: "tiktok" }), "tiktok instead");
    expect(switched.chips.platform).toBe("tiktok");
    expect(switched.followUp.replaced).toEqual(["platform"]);
  });

  it("new topic words are added to the search text; steering words are not", () => {
    const r = combineFollowUp({ text: "tech creators", filters: filters({ niches: ["Technology"] }) }, reading({}, ["only", "smartphone", "reviews"]), "only smartphone reviews");
    expect(r.followUp.text).toBe("tech creators smartphone reviews");
  });

  it("keeps the customer's own switches (contact available, fresh only)", () => {
    const r = combineFollowUp({ text: "food", filters: filters({ hasContact: true, freshOnly: true, minAuthenticity: 70 }) }, reading({ platform: "youtube" }), "only youtube");
    expect(r.chips).toMatchObject({ hasContact: true, freshOnly: true, minAuthenticity: 70, platform: "youtube" });
  });
});
