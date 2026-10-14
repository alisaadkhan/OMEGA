import { describe, expect, it } from "vitest";
import type { CreatorCard, DiscoveryJob } from "@mushin/contracts";
import { isOpenJob, jobStatusText, jobTitle, liveFoundText, liveMaxCost, livePlatformsText, liveSummary, mergeResults, newlyFinished } from "./discovery-mapping";
import { creatorStub } from "./search-mapping";

const cardFor = (id: string): CreatorCard => ({
  id,
  displayName: "C",
  handle: "c",
  platform: "instagram",
  avatarUrl: null,
  city: null,
  country: null,
  niches: [],
  tags: [],
  verified: false,
  followers: 1000,
  engagementRate: 1,
  authenticityScore: null,
  fakeFollowerPct: null,
  hasContact: false,
  followersFreshness: "current",
  fitScore: 50,
  fitLabel: "Possible match",
});

const job = (over: Partial<DiscoveryJob> = {}): DiscoveryJob => ({
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
  live: null,
  ...over,
});

describe("job wording", () => {
  it("names the job and its current step", () => {
    expect(jobTitle(job())).toBe("Adding @coke_studio");
    expect(jobTitle(job({ kind: "refresh" }))).toBe("Refreshing @coke_studio");
    expect(jobStatusText(job())).toBe("Assessing authenticity and audience…");
    expect(jobStatusText(job({ status: "queued", step: null }))).toBe("Waiting to start…");
  });

  it("explains outcomes, always saying when credits came back", () => {
    expect(jobStatusText(job({ status: "completed", outcome: "created" }))).toBe("Added to MUSHIN");
    expect(jobStatusText(job({ status: "completed", outcome: "refreshed" }))).toBe("Profile updated");
    expect(jobStatusText(job({ status: "completed", outcome: "reused" }))).toBe("Fresh data was already available. Your credits were returned.");
    expect(jobStatusText(job({ status: "failed", error: { code: "PRIVATE_ACCOUNT", message: "This account is private, so we can't assess it." } }))).toBe(
      "This account is private, so we can't assess it. Your credits were returned.",
    );
    expect(jobStatusText(job({ status: "failed", error: { code: "TIMED_OUT", message: "This took too long and was stopped. Your credits were returned." } }))).toBe(
      "This took too long and was stopped. Your credits were returned.",
    );
  });

  it("finds jobs that just finished", () => {
    const a = job();
    const b = job({ id: "7f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10" });
    expect(isOpenJob(a)).toBe(true);
    expect(newlyFinished([a, b], [{ ...a, status: "completed", outcome: "created" }, b]).map((j) => j.id)).toEqual([a.id]);
    expect(newlyFinished([], [{ ...a, status: "completed", outcome: "created" }])).toEqual([]);
  });

  it("builds a profile-panel stub for a creator known only by id", () => {
    expect(creatorStub(job().id, "tiktok", "cokestudiopakistan")).toMatchObject({ id: job().id, platform: "tiktok", handle: "cokestudiopakistan", name: "@cokestudiopakistan" });
  });
});

describe("live runs", () => {
  const costs = { search_existing: 0, find_new: 12, reveal_contact: 5, refresh_data: 10, refresh_tiktok: 30, audience_estimate: 5 };
  const L = {
    search: { text: "bridal makeup", filters: { niches: [], creatorCity: "Lahore", verifiedOnly: false, hasContact: false, freshOnly: false } }, maxNew: 10, found: 0, new: 0, known: 0, maxCost: 312, creditsCharged: 0,
    progress: { serpResultsSeen: 0, profileCandidates: 0, afterDedupe: 0, snippetGatePass: 0, ambiguousCandidates: 0, extractedProfiles: 0, validIndividualCreators: 0, qualifiedCreators: 0, persistedResults: 0, billableCreators: 0 },
  };
  const liveJob = (over: Partial<DiscoveryJob> = {}): DiscoveryJob => job({ kind: "live", platform: null, handle: null, live: L, ...over });

  it("prices the maximum like the server: TikTok's price whenever TikTok is in scope", () => {
    expect(liveMaxCost(costs, "instagram", 10)).toBe(112);
    expect(liveMaxCost(costs, "youtube", 5)).toBe(62);
    expect(liveMaxCost(costs, undefined, 10)).toBe(312);
    expect(liveMaxCost(costs, "tiktok", 20)).toBe(612);
  });

  it("splits the results header into new (charged) and already-known (free) creators", () => {
    // Regression: a size-5 run delivering 4 new + 2 known showed "6 found", which read as exceeding the requested 5.
    const cards = [true, true, true, true, false, false].map((isNew) => ({ discovery: { isNew } }));
    expect(liveFoundText(cards, false)).toBe("6 found by Find New Creators · 4 new (charged) · 2 already in MUSHIN (free)");
    expect(liveFoundText(cards.slice(0, 2), true)).toBe("2 found by Find New Creators so far · 2 new (charged)");
    expect(liveFoundText([], true)).toBe("0 found by Find New Creators so far");
  });

  it("names the run and explains its progress and outcome", () => {
    const j = liveJob();
    expect(liveSummary(L.search)).toBe("bridal makeup · Lahore");
    // The quote dialog names the platform scope the server will price and search.
    expect(livePlatformsText({ ...L.search, filters: { ...L.search.filters, platform: "youtube" } })).toBe("YouTube");
    expect(livePlatformsText({ ...L.search, filters: { ...L.search.filters, platform: undefined } })).toBe("Instagram, TikTok and YouTube (all platforms)");
    expect(jobTitle(j)).toBe("Finding creators: bridal makeup · Lahore");
    expect(jobStatusText(liveJob({ status: "running", step: "searching" }))).toBe("Searching Google…");
    expect(jobStatusText(liveJob({ status: "running", step: "assessing", live: { ...L, found: 4, progress: { ...L.progress, serpResultsSeen: 12, qualifiedCreators: 2, persistedResults: 1 } } }))).toBe("Assessing authenticity and audience… · 12 searched · 2 qualified · 1 saved");
    expect(jobStatusText(liveJob({ status: "completed", live: { ...L, found: 9, new: 6, known: 3, creditsCharged: 72 } }))).toBe("Found 9 creators (6 new) · 72 credits used, 240 returned");
    expect(jobStatusText(liveJob({ status: "completed", outcome: "completed_empty", live: { ...L, found: 0 } }))).toBe("No eligible creators were delivered. Your credits were returned.");
    expect(jobStatusText(liveJob({ status: "completed", outcome: "insufficient", live: { ...L, found: 0 } }))).toBe("Too few eligible profiles were found to continue. Your credits were returned.");
    expect(jobStatusText(liveJob({ status: "completed", outcome: "partial", live: { ...L, found: 1, creditsCharged: 22 } }))).toBe("Some creators were saved. 22 credits used; remaining credits returned.");
  });

  it("merges polled results without duplicates, best rank first", () => {
    const r = (seq: number, rank: number, id = `00000000-0000-4000-8000-00000000000${seq}`) => ({ ...cardFor(id), seq, rank, isNew: true, reason: null });
    expect(mergeResults([r(1, 2), r(2, 1)], [r(2, 1), r(3, 3)]).map((x) => x.seq)).toEqual([2, 1, 3]);
  });
});
