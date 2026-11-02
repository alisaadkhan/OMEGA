import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { FixtureScraper, MemoryStorage, MockLlm, ProviderError, scraperFixture } from "@mushin/integrations";
import { isIndexable } from "../projection";
import * as repo from "../repository";
import { suppress } from "../suppressions";
import { TEST_KEY } from "../test-fixtures";
import { createEnrichmentPipeline, type EnrichJob, type EnrichResult } from "./pipeline";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
beforeEach(resetTables);
afterAll(() => db.close());

/** A valid assessment for whatever range the code measured. */
const llmReply = (req: { input: string }) => {
  const m = /Range: (\d+)–(\d+)/.exec(req.input);
  const score = m ? Math.round((Number(m[1]) + Number(m[2])) / 2) : null;
  const signal = /^(\w+) \(/m.exec(req.input.split("<signals>")[1] ?? "")?.[1] ?? "engagement_vs_tier";
  const verdict = score === null ? null : score >= 80 ? "genuine" : score >= 60 ? "mostly genuine" : score >= 40 ? "mixed signals" : "likely inflated";
  return {
    verdict,
    score,
    evidence: score === null ? [] : [{ signal, detail: "Measured by MUSHIN from recent posts." }],
    watchOuts: [],
    audience: { age: [], gender: null, cities: [], countries: [] },
    niches: ["Lifestyle"],
    creatorCity: null,
    creatorCountry: "PK",
    minorSigns: { likely: false, reason: "" },
  };
};

function setup(o: { scraper?: FixtureScraper; llm?: MockLlm } = {}) {
  const scraper = o.scraper ?? FixtureScraper.defaults();
  const storage = new MemoryStorage();
  const llm = o.llm ?? new MockLlm(llmReply);
  const pipeline = createEnrichmentPipeline({ db, scraper, storage, llm, encryptionKey: TEST_KEY, logger, fetchImage: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { headers: { "content-type": "image/jpeg" } }) });
  return { pipeline, scraper, storage, llm };
}

async function job(platform: EnrichJob["platform"] = "instagram"): Promise<EnrichJob> {
  const ws = await createTestWorkspace();
  const handle = platform === "instagram" ? "coke_studio" : platform === "tiktok" ? "@cokestudiopakistan" : "@cokestudio";
  const canonicalUrl = `https://${platform}.com/${handle}`;
  return { jobId: randomUUID(), workspaceId: ws.workspaceId, platform, handle, canonicalUrl, requestId: null };
}

function hooks() {
  const steps: string[] = [];
  const saved: EnrichResult[] = [];
  return { steps, saved, h: { onStep: async (s: string) => void steps.push(s), onSaved: async (_tx: unknown, r: EnrichResult) => void saved.push(r) } };
}

describe("enrichment pipeline", () => {
  it("creates a creator with metrics, history, archive, links, assessment and an index event", async () => {
    const raw = structuredClone(scraperFixture("instagram-profile.json")) as Record<string, unknown>[];
    (raw[0] as Record<string, unknown>)["profilePicUrlHD"] = "https://scontent-man2-1.cdninstagram.com/v/t51/coke_studio.jpg";
    const { pipeline, storage } = setup({ scraper: new FixtureScraper({ instagram: { provider: "apify", raw, costUsd: 0.0026 } }) });
    const j = await job();
    const { steps, saved, h } = hooks();
    const out = await pipeline.enrich(j, h);
    expect(out).toMatchObject({ kind: "saved", outcome: "created", assessment: "assessed" });
    expect(saved).toHaveLength(1);
    expect(steps).toEqual(["fetching", "archiving", "cleaning", "assessing", "saving"]);
    if (out.kind !== "saved") throw new Error("unreachable");
    const [c] = await ownerQuery<{ display_name: string; verified: boolean; assessment_status: string; authenticity_score: number; avatar_url: string; country: string }>(
      `select display_name, verified, assessment_status, authenticity_score, avatar_url, country from gcp.creators where id = '${out.creatorId}'`,
    );
    expect(c).toMatchObject({ display_name: "Coke Studio Pakistan", verified: true, assessment_status: "assessed", country: "PK" });
    expect(c?.authenticity_score).toBeGreaterThanOrEqual(0);
    expect(c?.avatar_url).toMatch(/^memory:\/\/creator-avatars\//);
    const counts = await ownerQuery<{ snaps: number; metrics: number; links: number; payloads: number; events: number }>(`
      select (select count(*)::int from gcp.enrichment_snapshots) snaps, (select count(*)::int from gcp.profile_metric_snapshots) metrics,
        (select count(*)::int from gcp.creator_links) links, (select count(*)::int from platform.raw_payloads where creator_id is not null) payloads,
        (select count(*)::int from platform.outbox where event_type = 'creator.changed') events`);
    expect(counts[0]).toEqual({ snaps: 1, metrics: 1, links: 1, payloads: 1, events: 1 });
    expect([...storage.objects.keys()].some((k) => k.startsWith("raw-payloads/instagram/"))).toBe(true);
  });

  it("persists a hidden YouTube subscriber count as unknown in profile and metric history", async () => {
    const channel = structuredClone(scraperFixture("youtube-channel.json")) as Record<string, unknown>;
    const channels = channel["items"] as Record<string, unknown>[];
    const statistics = channels[0]?.["statistics"] as Record<string, unknown>;
    statistics["hiddenSubscriberCount"] = true;
    statistics["subscriberCount"] = "0";
    const { pipeline } = setup({
      scraper: new FixtureScraper({ youtube: { provider: "youtube", raw: { channel: { ...channel, items: channels }, videos: [] }, costUsd: 0 } }),
    });
    const out = await pipeline.enrich(await job("youtube"), hooks().h);
    if (out.kind !== "saved") throw new Error("expected a saved profile");
    expect(out.profile.followers).toBeNull();
    const rows = await ownerQuery<{ profile_followers: number | null; snapshot_followers: number | null }>(`
      select p.followers profile_followers,
        (select s.followers from gcp.profile_metric_snapshots s where s.profile_id = p.id order by s.captured_at desc limit 1) snapshot_followers
      from gcp.creator_profiles p where p.creator_id = '${out.creatorId}'`);
    expect(rows).toEqual([{ profile_followers: null, snapshot_followers: null }]);
  });

  it("retries reuse the archived payload instead of scraping again (Review Focus 1)", async () => {
    const { pipeline, scraper } = setup();
    const j = await job();
    const crash = { onStep: async () => {}, onSaved: async () => Promise.reject(new Error("worker crashed")) };
    await expect(pipeline.enrich(j, crash)).rejects.toThrow(/worker crashed/);
    expect(await ownerQuery(`select 1 from gcp.creators`)).toHaveLength(0);
    const { h } = hooks();
    expect(await pipeline.enrich(j, h)).toMatchObject({ kind: "saved", outcome: "created" });
    expect(scraper.calls).toHaveLength(1);
  });

  it("refreshes the same creator, adds history, and never clears a minor flag (Review Focus 5)", async () => {
    const { pipeline } = setup();
    const first = await pipeline.enrich(await job(), hooks().h);
    if (first.kind !== "saved") throw new Error("unreachable");
    await ownerQuery(`update gcp.creators set is_minor = true, minor_reason = 'staff saw a school uniform' where id = '${first.creatorId}';
      update gcp.creator_profiles set last_scraped_at = now() - interval '2 days';`);
    const again = await pipeline.enrich(await job(), hooks().h);
    expect(again).toMatchObject({ kind: "saved", outcome: "refreshed", creatorId: first.creatorId });
    const [c] = await ownerQuery<{ is_minor: boolean; minor_reason: string; n: number }>(
      `select is_minor, minor_reason, (select count(*)::int from gcp.profile_metric_snapshots) n from gcp.creators where id = '${first.creatorId}'`,
    );
    expect(c).toEqual({ is_minor: true, minor_reason: "staff saw a school uniform", n: 2 });
  });

  // Owner 2026-10-22: Update info re-scrapes the whole profile, and every scrape keeps the profile photo.
  it("re-copies the profile photo on a refresh, also when the stored one was cleared", async () => {
    const raw = structuredClone(scraperFixture("instagram-profile.json")) as Record<string, unknown>[];
    (raw[0] as Record<string, unknown>)["profilePicUrlHD"] = "https://scontent-man2-1.cdninstagram.com/v/t51/coke_studio.jpg";
    const { pipeline, storage } = setup({ scraper: new FixtureScraper({ instagram: { provider: "apify", raw, costUsd: 0.0026 } }) });
    const first = await pipeline.enrich(await job(), hooks().h);
    if (first.kind !== "saved") throw new Error("unreachable");
    await ownerQuery(`update gcp.creators set avatar_url = null, avatar_key = null where id = '${first.creatorId}';
      update gcp.creator_profiles set last_scraped_at = now() - interval '2 days';`);
    for (const k of [...storage.objects.keys()]) if (k.startsWith("creator-avatars/")) storage.objects.delete(k);
    expect(await pipeline.enrich(await job(), hooks().h)).toMatchObject({ kind: "saved", outcome: "refreshed" });
    const [c] = await ownerQuery<{ avatar_url: string | null; avatar_key: string | null }>(`select avatar_url, avatar_key from gcp.creators where id = '${first.creatorId}'`);
    expect(c?.avatar_url).toMatch(/^memory:\/\/creator-avatars\/instagram\//);
    expect([...storage.objects.keys()]).toContain(`creator-avatars/${c?.avatar_key}`);
  });

  it("reuses a profile scraped minutes ago (another workspace) without scraping", async () => {
    const { pipeline, scraper } = setup();
    const first = await pipeline.enrich(await job(), hooks().h);
    const second = await pipeline.enrich(await job(), hooks().h);
    expect(second).toEqual({ kind: "reused", creatorId: first.kind === "saved" ? first.creatorId : "" });
    expect(scraper.calls).toHaveLength(1);
  });

  it("reports private and missing accounts without saving a creator, but keeps the archive", async () => {
    const priv = setup({ scraper: new FixtureScraper({ instagram: { provider: "apify", raw: scraperFixture("instagram-private.json"), costUsd: 0.0026 } }) });
    expect(await priv.pipeline.enrich(await job(), hooks().h)).toMatchObject({ kind: "unavailable", code: "PRIVATE_ACCOUNT" });
    const gone = setup({ scraper: new FixtureScraper({ tiktok: { provider: "apify", raw: [], costUsd: 0 } }) });
    expect(await gone.pipeline.enrich(await job("tiktok"), hooks().h)).toMatchObject({ kind: "unavailable", code: "NOT_FOUND" });
    const rows = await ownerQuery<{ creators: number; payloads: number }>(`select (select count(*)::int from gcp.creators) creators, (select count(*)::int from platform.raw_payloads) payloads`);
    expect(rows[0]).toEqual({ creators: 0, payloads: 2 });
  });

  it("passes provider errors through for the runner to judge", async () => {
    const down = setup({ scraper: new FixtureScraper({ instagram: new ProviderError(true, "provider", "Apify answered HTTP 502") }) });
    await expect(down.pipeline.enrich(await job(), hooks().h)).rejects.toMatchObject({ retryable: true });
  });

  it("saves the data when only the AI fails, marks the assessment pending, then reassesses", async () => {
    const failing = new MockLlm(() => ({ score: "nope" }));
    const { pipeline } = setup({ llm: failing });
    const out = await pipeline.enrich(await job(), hooks().h);
    expect(out).toMatchObject({ kind: "saved", assessment: "pending" });
    if (out.kind !== "saved") throw new Error("unreachable");
    const ev = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'creator.assessment_requested'`);
    expect(ev[0]?.n).toBe(1);
    // The archive lives in the first pipeline's storage; reassess reads it from there.
    const sameStore = createEnrichmentPipeline({ db, scraper: FixtureScraper.defaults(), storage: getStorage(pipeline), llm: new MockLlm(llmReply), encryptionKey: TEST_KEY, logger });
    expect(await sameStore.reassess(out.creatorId)).toBe("assessed");
    const [c] = await ownerQuery<{ assessment_status: string; n: number }>(
      `select assessment_status, (select count(*)::int from gcp.enrichment_snapshots) n from gcp.creators where id = '${out.creatorId}'`,
    );
    expect(c).toEqual({ assessment_status: "assessed", n: 1 });
  });

  // Regression (audit 2026-10-26): saveReassessment wrote the AI's niches over the evidence-based classification.
  it("keeps evidence-based niches when the AI reassesses later (evidence policy), and still stores them under legacy", async () => {
    const failing = new MockLlm(() => ({ score: "nope" }));
    const storage = new MemoryStorage();
    const make = (llm: MockLlm, attributePolicy: "evidence" | "legacy") =>
      createEnrichmentPipeline({ db, scraper: FixtureScraper.defaults(), storage, llm, encryptionKey: TEST_KEY, logger, attributePolicy, fetchImage: async () => new Response("", { status: 404 }) });
    const out = await make(failing, "evidence").enrich(await job(), hooks().h);
    if (out.kind !== "saved") throw new Error("expected a saved creator");
    const before = await ownerQuery<{ niches: string[]; niche_status: string | null }>(`select niches, niche_status from gcp.creators where id = '${out.creatorId}'`);
    expect(before[0]?.niche_status).not.toBeNull();
    // The AI now answers, choosing Lifestyle (its usual fallback), which the creator's text does not support.
    expect(await make(new MockLlm(llmReply), "evidence").reassess(out.creatorId)).toBe("assessed");
    const after = await ownerQuery<{ niches: string[]; niche_status: string | null; assessment_status: string }>(`select niches, niche_status, assessment_status from gcp.creators where id = '${out.creatorId}'`);
    expect(after[0]).toMatchObject({ niches: before[0]?.niches, niche_status: before[0]?.niche_status, assessment_status: "assessed" });
    expect(after[0]?.niches).not.toContain("Lifestyle");
    // The legacy policy (rollback setting) keeps the earlier behaviour: the AI's niches are stored.
    expect(await make(new MockLlm(llmReply), "legacy").reassess(out.creatorId)).toBe("assessed");
    expect((await ownerQuery<{ niches: string[] }>(`select niches from gcp.creators where id = '${out.creatorId}'`))[0]?.niches).toEqual(["Lifestyle"]);
  });

  it("stores no contacts from a YouTube channel description while the policy gate is off", async () => {
    const storage = new MemoryStorage();
    const p = createEnrichmentPipeline({ db, scraper: FixtureScraper.defaults(), storage, llm: new MockLlm(llmReply), encryptionKey: TEST_KEY, logger, attributePolicy: "evidence", youtube: { contentEvidence: false, descriptionContacts: false }, fetchImage: async () => new Response("", { status: 404 }) });
    const out = await p.enrich(await job("youtube"), hooks().h);
    if (out.kind !== "saved") throw new Error("expected a saved creator");
    expect(await ownerQuery(`select 1 from gcp.creator_contacts where creator_id = '${out.creatorId}'`)).toEqual([]);
    // Without video text the niche comes from the channel description only.
    const [c] = await ownerQuery<{ niche_status: string | null }>(`select niche_status from gcp.creators where id = '${out.creatorId}'`);
    expect(c?.niche_status).not.toBeNull();
  });

  it("flags a possible minor from the bio and keeps them out of the search index", async () => {
    const raw = structuredClone(scraperFixture("instagram-profile.json")) as Record<string, unknown>[];
    (raw[0] as Record<string, unknown>)["biography"] = "15 y/o dancer from Lahore";
    const { pipeline } = setup({ scraper: new FixtureScraper({ instagram: { provider: "apify", raw, costUsd: 0.0026 } }) });
    const out = await pipeline.enrich(await job(), hooks().h);
    if (out.kind !== "saved") throw new Error("expected saved");
    const [c] = await ownerQuery<{ is_minor: boolean; minor_reason: string }>(`select is_minor, minor_reason from gcp.creators where id = '${out.creatorId}'`);
    expect(c).toEqual({ is_minor: true, minor_reason: 'Text says "15 y/o"' });
    const rows = await db.withSystem((tx) => repo.indexRows(tx, [out.creatorId]));
    expect(rows.filter(isIndexable)).toEqual([]);
  });

  it("stores bio contacts encrypted and masked", async () => {
    const raw = structuredClone(scraperFixture("instagram-profile.json")) as Record<string, unknown>[];
    (raw[0] as Record<string, unknown>)["biography"] = "Bookings: studio@coke.pk";
    const { pipeline } = setup({ scraper: new FixtureScraper({ instagram: { provider: "apify", raw, costUsd: 0.0026 } }) });
    const out = await pipeline.enrich(await job(), hooks().h);
    if (out.kind !== "saved") throw new Error("expected saved");
    const [k] = await ownerQuery<{ masked: string; trust: string; value_encrypted: string }>(`select masked, trust, value_encrypted from gcp.creator_contacts where creator_id = '${out.creatorId}'`);
    expect(k).toMatchObject({ masked: "s***@c***.pk", trust: "unverified" });
    expect(k?.value_encrypted).not.toContain("studio");
  });

  it("purges archived payloads past their retention date, files included", async () => {
    const { pipeline, storage } = setup();
    await pipeline.enrich(await job(), hooks().h);
    await ownerQuery(`update platform.raw_payloads set delete_after = now() - interval '1 day'`);
    expect(await pipeline.purgeExpiredPayloads()).toBe(1);
    expect([...storage.objects.keys()].some((k) => k.startsWith("raw-payloads/"))).toBe(false);
    expect(await ownerQuery(`select 1 from platform.raw_payloads`)).toHaveLength(0);
  });
  it("archives each profile of a batch on its own and processes a pre-fetched profile (live discovery)", async () => {
    const { pipeline, storage } = setup();
    const j = await job();
    const raw = scraperFixture("instagram-profile.json");
    const payloadId = await pipeline.archive(j, "apify", raw);
    expect(await pipeline.archived(j.jobId, j.canonicalUrl)).toEqual({ payloadId, raw });
    expect(await pipeline.archived(j.jobId, "https://instagram.com/someone_else")).toBeNull();
    const saved: EnrichResult[] = [];
    const out = await pipeline.processProfile(j, payloadId, raw, { onSaved: async (_tx, r) => void saved.push(r) });
    expect(out).toMatchObject({ kind: "saved", outcome: "created" });
    expect(saved).toHaveLength(1);
    const [p] = await ownerQuery<{ storage_key: string; creator_id: string | null }>(`select storage_key, creator_id from platform.raw_payloads where id = '${payloadId}'`);
    expect(p?.storage_key).toContain(j.jobId);
    expect(p?.creator_id).not.toBeNull();
    expect([...storage.objects.keys()].some((k) => k.includes(j.jobId))).toBe(true);
  });

  it("refuses a profile link on the do-not-re-add list, even when the data was fetched", async () => {
    const { pipeline } = setup();
    const j = await job();
    await db.withSystem((tx) => suppress(tx, [{ canonicalUrl: j.canonicalUrl, platform: "instagram" }], null));
    const raw = scraperFixture("instagram-profile.json");
    const out = await pipeline.processProfile(j, await pipeline.archive(j, "apify", raw), raw, { onSaved: async () => undefined });
    expect(out).toMatchObject({ kind: "unavailable", code: "NOT_FOUND" });
    expect(await ownerQuery(`select 1 from gcp.creators`)).toEqual([]);
  });
});

/** Test-only access to the storage a pipeline was built with. */
function getStorage(p: unknown): MemoryStorage {
  return (p as { storage: MemoryStorage }).storage;
}

describe("semantic niche reading in the pipeline (2026-10-26)", () => {
  const igRaw = (handle: string, biography: string) => [{ username: handle, fullName: handle, biography, followersCount: 50_000, followsCount: 10, postsCount: 20, latestPosts: [] }];
  const ytRaw = (description: string) => ({ channel: { items: [{ snippet: { title: "Channel", description, country: "PK" }, statistics: { subscriberCount: "50000", videoCount: "10" } }] }, videos: { items: [] } });
  const semanticReply = { status: "classified", main: "Tech", secondary: [], confidence: "high", reason: "Reviews phones; explicitly not food.", evidence: [{ quote: "Honest phone reviews", source: "bio", supports: "Tech" }] };
  const make = (features: string[], youtube = { contentEvidence: false, descriptionContacts: false }) => {
    const llm = new MockLlm((req) => {
      features.push(req.feature);
      return req.feature === "niche_classification" ? semanticReply : llmReply(req as { input: string });
    });
    return createEnrichmentPipeline({ db, scraper: FixtureScraper.defaults(), storage: new MemoryStorage(), llm, encryptionKey: TEST_KEY, logger, attributePolicy: "evidence", semanticNiche: true, youtube, fetchImage: async () => new Response("", { status: 404 }) });
  };
  const run = async (p: ReturnType<typeof make>, platform: "instagram" | "youtube", handle: string, raw: unknown) => {
    const ws = await createTestWorkspace();
    const j: EnrichJob = { jobId: randomUUID(), workspaceId: ws.workspaceId, platform, handle, canonicalUrl: `https://${platform}.com/${platform === "youtube" ? "@" : ""}${handle}`, requestId: null };
    const payloadId = await p.archive(j, platform === "youtube" ? "youtube" : "apify", raw);
    const out = await p.processProfile(j, payloadId, raw, { onSaved: async () => {} });
    if (out.kind !== "saved") throw new Error("not saved");
    return (await ownerQuery<{ niche_main: string | null; niches: string[] }>(`select niche_main, niches from gcp.creators where id = '${out.creatorId}'`))[0];
  };

  it("reads an unclear bio semantically (negation), with grounded evidence; a clear bio needs no extra AI call", async () => {
    const features: string[] = [];
    const p = make(features);
    expect(await run(p, "instagram", "notfood", igRaw("notfood", "Not a food channel! Honest phone reviews"))).toMatchObject({ niche_main: "Tech", niches: ["Tech"] });
    expect(features.filter((f) => f === "niche_classification")).toHaveLength(1);
    const rows = await ownerQuery<{ source: string; status: string; evidence: string }>(`select e.source, e.status, e.evidence from gcp.creator_attribute_evidence e join gcp.creator_profiles p on p.creator_id = e.creator_id where p.handle = 'notfood' and e.attribute = 'niche'`);
    expect(rows).toContainEqual(expect.objectContaining({ source: "profile_text", status: "supported", evidence: expect.stringContaining("Honest phone reviews") }));
    expect(rows.some((r) => r.status === "weak" && r.evidence.startsWith("Keyword reading, not used"))).toBe(true);
    features.length = 0;
    expect(await run(p, "instagram", "cooks", igRaw("cooks", "Home cooking recipes and baking"))).toMatchObject({ niche_main: "Food" });
    expect(features).not.toContain("niche_classification");
  });

  it("never sends YouTube text for a semantic reading while the YouTube policy gate is off", async () => {
    const features: string[] = [];
    await run(make(features), "youtube", "ytnotfood", ytRaw("Not a food channel! Honest phone reviews"));
    expect(features).not.toContain("niche_classification");
  });

  it("keeps the rules' reading when the semantic reading fails", async () => {
    const llm = new MockLlm((req) => (req.feature === "niche_classification" ? { status: "classified", main: "Gadgets" } : llmReply(req as { input: string })));
    const p = createEnrichmentPipeline({ db, scraper: FixtureScraper.defaults(), storage: new MemoryStorage(), llm, encryptionKey: TEST_KEY, logger, attributePolicy: "evidence", semanticNiche: true, fetchImage: async () => new Response("", { status: 404 }) });
    const ws = await createTestWorkspace();
    const raw = igRaw("mixed", "Not a food channel! Honest phone reviews");
    const j: EnrichJob = { jobId: randomUUID(), workspaceId: ws.workspaceId, platform: "instagram", handle: "mixed", canonicalUrl: "https://instagram.com/mixed", requestId: null };
    const out = await p.processProfile(j, await p.archive(j, "apify", raw), raw, { onSaved: async () => {} });
    expect(out.kind).toBe("saved");
  });
});
