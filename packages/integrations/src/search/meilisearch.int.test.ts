import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testSearchIndex } from "./testing";
import type { CreatorDocument } from "./types";

const index = testSearchIndex();
beforeAll(() => index.ensureSettings());
afterAll(() => index.drop());

const doc = (id: string, over: Partial<CreatorDocument>): CreatorDocument => ({
  id,
  display_name: "Creator",
  name_variants: [],
  primary_handle: id,
  handles: [id],
  platforms: ["instagram"],
  primary_platform: "instagram",
  city: "Lahore",
  country: "PK",
  niches: ["Bridal"],
  tags: [],
  bio: "",
  followers: 50_000,
  engagement_rate: 5,
  verified: false,
  authenticity_score: null,
  has_contact: false,
  audience_countries: [],
  followers_updated_epoch: 1_790_000_000,
  updated_epoch: 1,
  eligible: true,
  eligible_until: 4_000_000_000,
  eligibility_version: "elig-1",
  eligibility_reasons: [],
  eligibility_flags: [],
  qualifying_platforms: ["instagram"],
  ...over,
});

describe("Meilisearch", () => {
  it("indexes, filters, finds transliterated names, lists ids and removes", async () => {
    await index.upsert([
      doc("11111111-1111-4111-8111-111111111111", { display_name: "Ayesha Khan", name_variants: ["Aisha Khan", "Aysha Khan"] }),
      doc("22222222-2222-4222-8222-222222222222", { display_name: "Bilal Eats", platforms: ["tiktok"], niches: ["Food"], followers: 900_000 }),
    ]);
    const aisha = await index.search({ text: "Aisha", filter: [], limit: 10 });
    expect(aisha.hits.map((h) => h.id)).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(aisha.hits[0]?.rankingScore).toBeGreaterThan(0);
    const food = await index.search({ text: "", filter: ['platforms = "tiktok"', "followers >= 100000"], limit: 10 });
    expect(food.hits.map((h) => h.id)).toEqual(["22222222-2222-4222-8222-222222222222"]);
    expect([...(await index.listIds()).keys()].sort()).toEqual(["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]);
    await index.remove(["22222222-2222-4222-8222-222222222222"]);
    expect((await index.search({ text: "", filter: [], limit: 10 })).total).toBe(1);
    expect(await index.ping()).toBe("ok");
  });
});
