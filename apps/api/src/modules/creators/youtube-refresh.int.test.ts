import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { FixtureScraper, MemoryStorage, MockLlm, ProviderError } from "@mushin/integrations";
import { createEnrichmentPipeline, type EnrichJob } from "./enrichment/pipeline";
import { TEST_KEY } from "./test-fixtures";
import { refreshDueYoutube } from "./youtube-refresh";

// Scheduled YouTube refresh at 20 days, inside the 30-day YouTube API Services limit (owner design, 2026-11-02).
const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
beforeEach(resetTables);
afterAll(() => db.close());

const reply = () => ({ verdict: null, score: null, evidence: [], watchOuts: [], audience: { age: [], gender: null, cities: [], countries: [] }, niches: ["Food"], creatorCity: null, creatorCountry: "PK", minorSigns: { likely: false, reason: "" } });
const URL_ = "https://www.youtube.com/@refreshme";

function setup(scraper: FixtureScraper = FixtureScraper.defaults()) {
  const llm = new MockLlm(reply);
  const pipeline = createEnrichmentPipeline({ db, scraper, storage: new MemoryStorage(), llm, encryptionKey: TEST_KEY, logger, fetchImage: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { headers: { "content-type": "image/jpeg" } }) });
  return { llm, pipeline };
}
/** A YouTube profile saved through the normal enrichment path, then aged by `days`. */
async function storedChannel(days: number) {
  const { pipeline } = setup();
  const ws = await createTestWorkspace();
  const job: EnrichJob = { jobId: randomUUID(), workspaceId: ws.workspaceId, platform: "youtube", handle: "refreshme", canonicalUrl: URL_, requestId: null };
  const out = await pipeline.enrich(job, { onStep: async () => {}, onSaved: async () => {} });
  if (out.kind !== "saved") throw new Error(`fixture not saved: ${out.kind}`);
  await ownerQuery(`update gcp.creator_profiles set last_scraped_at = now() - interval '${days} days', created_at = now() - interval '${days} days' where canonical_url = '${URL_}'`);
  await ownerQuery(`delete from platform.outbox`);
  return out.creatorId;
}
const lastFetch = async () => (await ownerQuery<{ age_days: number }>(`select extract(day from now() - last_scraped_at)::int age_days from gcp.creator_profiles where canonical_url = '${URL_}'`))[0]?.age_days;
const outbox = async () => (await ownerQuery<{ event_type: string }>(`select event_type from platform.outbox order by created_at`)).map((r) => r.event_type);

describe("scheduled YouTube refresh (20-day target, 30-day limit)", () => {
  it("RF-01 a channel 21 days old is fetched again: the clock resets, search is told, no AI call and no new assessment is requested", async () => {
    await storedChannel(21);
    const { llm, pipeline } = setup();
    const r = await refreshDueYoutube({ db, refresh: pipeline.refreshKnown });
    expect(r).toMatchObject({ due: 1, attempted: 1, refreshed: 1, failed: 0 });
    expect(await lastFetch()).toBe(0);
    expect(llm.calls).toHaveLength(0);
    const events = await outbox();
    expect(events).toContain("creator.changed");
    expect(events).not.toContain("creator.assessment_requested");
    // The new raw answer is archived and deleted after at most 30 days, like every YouTube answer.
    const [p] = await ownerQuery<{ days: number }>(`select ceil(extract(epoch from delete_after - fetched_at) / 86400)::int days from platform.raw_payloads where canonical_url = '${URL_}' order by fetched_at desc limit 1`);
    expect(p?.days).toBeLessThanOrEqual(30);
  });

  it("RF-02 a failed fetch moves nothing: the channel stays due and the failure is reported", async () => {
    await storedChannel(25);
    const { pipeline } = setup(new FixtureScraper({ youtube: new ProviderError(true, "provider", "quota exceeded") }));
    const errors: string[] = [];
    const r = await refreshDueYoutube({ db, refresh: pipeline.refreshKnown, onError: (_e, url) => errors.push(url) });
    expect(r).toMatchObject({ due: 1, refreshed: 0, failed: 1 });
    expect(errors).toEqual([URL_]);
    expect(await lastFetch()).toBe(25);
    // Due again the next day.
    expect((await refreshDueYoutube({ db, refresh: pipeline.refreshKnown })).due).toBe(1);
  });

  it("RF-03 only channels between 20 and 30 days are due; nearer the limit they are counted for the staff alert", async () => {
    await storedChannel(10);
    const { pipeline } = setup();
    expect((await refreshDueYoutube({ db, refresh: pipeline.refreshKnown })).due).toBe(0);
    await ownerQuery(`update gcp.creator_profiles set last_scraped_at = now() - interval '31 days' where canonical_url = '${URL_}'`);
    expect((await refreshDueYoutube({ db, refresh: pipeline.refreshKnown })).due).toBe(0); // past the limit: retention clears it
    await ownerQuery(`update gcp.creator_profiles set last_scraped_at = now() - interval '28 days' where canonical_url = '${URL_}'`);
    const failing = setup(new FixtureScraper({ youtube: new ProviderError(true, "provider", "down") })).pipeline;
    expect(await refreshDueYoutube({ db, refresh: failing.refreshKnown })).toMatchObject({ due: 1, failed: 1, nearDeadline: 1 });
  });

  it("RF-04 eligibility does not matter: a locked (foreign) channel is refreshed on the same schedule", async () => {
    const id = await storedChannel(22);
    await ownerQuery(`update gcp.creator_profiles set country = 'AE', country_source = 'creator_stated', country_status = 'foreign', country_confidence = 'high', country_checked_at = now() where creator_id = '${id}'`);
    const { pipeline } = setup();
    expect(await refreshDueYoutube({ db, refresh: pipeline.refreshKnown })).toMatchObject({ due: 1, refreshed: 1 });
  });
});
