import { describe, expect, it } from "vitest";
import { creditActionSchema } from "./billing";
import { createLiveEstimateSchema, discoveryJobSchema, discoveryResultsResponseSchema, liveEstimateSchema, liveSearchSchema, startDiscoveryJobResponseSchema, startDiscoveryJobSchema, validateLiveBrief } from "./discovery";
import { creatorProfileSchema, lookupResponseSchema, searchFiltersSchema } from "./search";

const job = {
  id: "6f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10",
  kind: "add_by_url",
  status: "running",
  step: "assessing",
  outcome: null,
  creatorId: null,
  platform: "instagram",
  handle: "coke_studio",
  error: null,
  createdAt: "2026-10-09T10:00:00.000Z",
  finishedAt: null,
  cancelRequested: false,
  live: null,
};

describe("discovery contracts", () => {
  it("accepts an add-by-URL or refresh request and nothing else", () => {
    expect(startDiscoveryJobSchema.parse({ kind: "add_by_url", url: "instagram.com/coke_studio", confirmedCost: 10 })).toMatchObject({ kind: "add_by_url" });
    expect(startDiscoveryJobSchema.parse({ kind: "refresh", creatorId: job.id, confirmedCost: 30 })).toMatchObject({ kind: "refresh" });
    expect(() => startDiscoveryJobSchema.parse({ kind: "live", query: "x", confirmedCost: 12 })).toThrow();
    expect(() => startDiscoveryJobSchema.parse({ kind: "refresh", creatorId: job.id, confirmedCost: 0 })).toThrow();
  });

  it("describes a job, and the three start answers", () => {
    expect(discoveryJobSchema.parse(job)).toEqual(job);
    expect(() => discoveryJobSchema.parse({ ...job, step: "dancing" })).toThrow();
    expect(startDiscoveryJobResponseSchema.parse({ status: "started", job })).toMatchObject({ status: "started" });
    expect(startDiscoveryJobResponseSchema.parse({ status: "known", creatorId: job.id })).toMatchObject({ status: "known" });
    expect(startDiscoveryJobResponseSchema.parse({ status: "up_to_date", creatorId: job.id, updatedAt: job.createdAt })).toMatchObject({ status: "up_to_date" });
  });

  it("adds the TikTok price, the addable lookup answer and the new profile fields", () => {
    expect(creditActionSchema.parse("refresh_tiktok")).toBe("refresh_tiktok");
    expect(lookupResponseSchema.parse({ matches: [], addable: { platform: "tiktok", handle: "@cokestudiopakistan", url: "https://tiktok.com/@cokestudiopakistan", cost: 30 } }).addable?.cost).toBe(30);
    expect(lookupResponseSchema.parse({ matches: [] }).addable).toBeNull();
    const authenticity = creatorProfileSchema.shape.authenticity;
    expect(authenticity.parse({ status: "pending" })).toEqual({ status: "pending" });
    expect(authenticity.parse({ status: "insufficient_data" })).toEqual({ status: "insufficient_data" });
    expect(creatorProfileSchema.shape.linkedAccounts.parse([{ platform: "website", url: "https://cokeurl.com/Nu.WAV" }])).toHaveLength(1);
  });
});

describe("live discovery contracts", () => {
  const search = { text: "bridal makeup", filters: { niches: ["Bridal"], creatorCity: "Lahore" } };

  it("creates estimates for 5, 10 or 20 creators and requires the estimate to start a run", () => {
    for (const maxNew of [5, 10, 20]) {
      expect(createLiveEstimateSchema.safeParse({ search, maxNew }).success).toBe(true);
    }
    expect(createLiveEstimateSchema.safeParse({ search, maxNew: 7 }).success).toBe(false);
    expect(liveSearchSchema.safeParse({ text: "x".repeat(501), filters: {} }).success).toBe(false);
    expect(startDiscoveryJobSchema.safeParse({ kind: "live", search, maxNew: 10, confirmedCost: 112 }).success).toBe(false);
    expect(startDiscoveryJobSchema.safeParse({ kind: "live", estimateId: "00000000-0000-4000-8000-000000000001" }).success).toBe(true);
    expect(liveEstimateSchema.safeParse({ estimateId: "00000000-0000-4000-8000-000000000001", maxCredits: 112, priceVersion: "price-v1", expiresAt: job.createdAt }).success).toBe(true);
  });

  it("rejects empty and generic briefs and requires a topic plus location or language", () => {
    const mk = (text: string, filters: Record<string, unknown> = {}) => ({ text, filters: searchFiltersSchema.parse(filters) });
    expect(validateLiveBrief(mk("")).missingRequirements).toEqual(["topic", "location_or_language"]);
    expect(validateLiveBrief(mk("best creators and influencers")).missingRequirements).toEqual(["topic", "location_or_language"]);
    expect(validateLiveBrief(mk("bridal makeup creators")).missingRequirements).toEqual(["location_or_language"]);
    expect(validateLiveBrief(mk("creators in Lahore")).missingRequirements).toEqual(["topic"]);
    expect(validateLiveBrief(mk("bridal makeup creators in Lahore")).ok).toBe(true);
    expect(validateLiveBrief(mk("find creators in Pakistan", { niches: ["Bridal"] })).ok).toBe(true);
    expect(validateLiveBrief(mk("food creators in Roman Urdu")).ok).toBe(true);
  });

  it("describes a live job without a single profile, and its results as creator cards", () => {
    const job = discoveryJobSchema.parse({
      id: "6f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10",
      kind: "live",
      status: "running",
      step: "searching",
      outcome: null,
      creatorId: null,
      platform: null,
      handle: null,
      error: null,
      createdAt: "2026-10-09T10:00:00.000Z",
      finishedAt: null,
      cancelRequested: false,
      live: {
        search: { text: "bridal makeup", filters: { niches: ["Bridal"] } }, maxNew: 10, found: 3, new: 2, known: 1, maxCost: 112, creditsCharged: 0,
        progress: { serpResultsSeen: 0, profileCandidates: 0, afterDedupe: 0, snippetGatePass: 0, ambiguousCandidates: 0, extractedProfiles: 0, validIndividualCreators: 0, qualifiedCreators: 0, persistedResults: 0, billableCreators: 0 },
      },
    });
    expect(job.live?.search.filters.niches).toEqual(["Bridal"]);
    expect(discoveryResultsResponseSchema.safeParse({ results: [], done: false }).success).toBe(true);
  });
});
