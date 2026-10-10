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
    audience: { age: [{ label: "18–24", value: 60, confidence: "medium" }], gender: null, cities: [], countries: [{ code: "PK", value: 90, confidence: "medium" }] },
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
  const pipeline = createEnrichmentPipeline({ db, scraper, storage, llm, encryptionKey: TEST_KEY, logger, fetchImage: async () => new Response("img", { headers: { "content-type": "image/jpeg" } }) });
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
