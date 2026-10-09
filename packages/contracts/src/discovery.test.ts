import { describe, expect, it } from "vitest";
import { creditActionSchema } from "./billing";
import { discoveryJobSchema, startDiscoveryJobResponseSchema, startDiscoveryJobSchema } from "./discovery";
import { creatorProfileSchema, lookupResponseSchema } from "./search";

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
