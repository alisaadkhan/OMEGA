import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { searchFiltersSchema, searchRequestSchema } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockLlm, MockPayments, testSearchIndex } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { isIndexable, toDocument } from "./projection";
import * as repo from "./repository";
import { createCreatorsService } from "./service";
import { addCreator, TEST_KEY } from "./test-fixtures";

const db = createTestDatabase();
const index = testSearchIndex();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
let llmReply: unknown = {};
const llm = new MockLlm(() => llmReply);
const creators = createCreatorsService({ db, index, llm, billing, encryptionKey: TEST_KEY, logger });

beforeAll(() => index.ensureSettings());
afterAll(async () => {
  await index.drop();
  await db.close();
});
beforeEach(async () => {
  await resetTables();
  await index.remove([...(await index.listIds()).keys()]);
  llm.calls.length = 0;
});

/** What the worker does for creator.changed events. */
async function indexAll(ids: string[]) {
  const rows = await db.withSystem((tx) => repo.indexRows(tx, ids));
  await index.upsert(rows.filter(isIndexable).map(toDocument));
}

async function customer(): Promise<TenantContext> {
  return { ...(await createTestWorkspace()), requestId: "req-search", role: "owner" };
}

const req = (text: string, filters: Record<string, unknown> = {}, page = 1) => searchRequestSchema.parse({ text, filters, page });

describe("search", () => {
  it("filters by every requested dimension and ranks by fit", async () => {
    const best = await addCreator(db, { displayName: "Sana Bridal", niches: ["Bridal"], profiles: [{ followers: 55_000, engagementRate: 9 }] });
    const ok = await addCreator(db, { displayName: "Hina Bridal", niches: ["Bridal"], profiles: [{ followers: 12_000, engagementRate: 4.1 }] });
    const wrongPlatform = await addCreator(db, { niches: ["Bridal"], primaryPlatform: "tiktok", profiles: [{ platform: "tiktok", followers: 50_000, engagementRate: 9 }] });
    const wrongNiche = await addCreator(db, { niches: ["Food"], profiles: [{ followers: 50_000, engagementRate: 9 }] });
    const tooBig = await addCreator(db, { niches: ["Bridal"], profiles: [{ followers: 2_000_000, engagementRate: 9 }] });
    await indexAll([best, ok, wrongPlatform, wrongNiche, tooBig]);
    const c = await customer();
    const out = await creators.search(c, req("", { platform: "instagram", niches: ["Bridal"], followersMin: 10_000, followersMax: 100_000, engagementMin: 4, creatorCity: "Lahore", creatorCountry: "PK" }));
    expect(out.results.map((r) => r.id)).toEqual([best, ok]);
    expect(out.results[0]?.fitScore).toBeGreaterThan(out.results[1]?.fitScore ?? 100);
    expect(out.results[0]).toMatchObject({ displayName: "Sana Bridal", followersFreshness: "current", authenticityScore: null, hasContact: false });
    expect(out.fewResults).toBe(true);
  });

  it("finds a creator by an alternative spelling of their name (SRS §6.2)", async () => {
    const id = await addCreator(db, { displayName: "Ayesha Khan", nameVariants: ["Aisha Khan", "Aysha Khan"] });
    await indexAll([id]);
    expect((await creators.search(await customer(), req("Aisha"))).results.map((r) => r.id)).toEqual([id]);
    expect((await creators.search(await customer(), req("Aysha Khan"))).results.map((r) => r.id)).toEqual([id]);
  });

  it("drops creators the index still lists but Postgres hides (possible minors, erased)", async () => {
    const shown = await addCreator(db);
    const minor = await addCreator(db);
    const erased = await addCreator(db);
    await indexAll([shown, minor, erased]);
    await ownerQuery(`update gcp.creators set is_minor = true where id = '${minor}'; update gcp.creators set status = 'erased' where id = '${erased}';`);
    expect((await creators.search(await customer(), req(""))).results.map((r) => r.id)).toEqual([shown]);
  });

  it("pages results and says when there are few", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 26; i++) ids.push(await addCreator(db, { profiles: [{ followers: 10_000 + i * 1000, engagementRate: 5 }] }));
    await indexAll(ids);
    const c = await customer();
    const page1 = await creators.search(c, req(""));
    const page2 = await creators.search(c, req("", {}, 2));
    expect([page1.results.length, page2.results.length, page1.total, page1.fewResults, page1.pageSize]).toEqual([24, 2, 26, false, 24]);
    expect(new Set([...page1.results, ...page2.results].map((r) => r.id)).size).toBe(26);
  });

  it(
    "answers under a second at p95 over 1,000 creators (NFR-P01)",
    async () => {
      await ownerQuery(`
        insert into gcp.creators (display_name, primary_handle, primary_platform, city, country, niches)
          select 'Perf Creator ' || g, 'perf_' || g, (array['instagram','tiktok','youtube'])[1 + g % 3],
            (array['Lahore','Karachi','Islamabad'])[1 + g % 3], 'PK', array[(array['Bridal','Food','Tech','Beauty'])[1 + g % 4]]
          from generate_series(1, 1000) g;
        insert into gcp.creator_profiles (creator_id, platform, handle, canonical_url, followers, engagement_rate, followers_updated_at)
          select c.id, c.primary_platform, c.primary_handle, 'https://perf.test/' || c.primary_handle,
            1000 + (random() * 900000)::int, round((random() * 10)::numeric, 2)::float8, now() - (random() * 40 || ' days')::interval
          from gcp.creators c;`);
      const ids = (await ownerQuery<{ id: string }>(`select id from gcp.creators`)).map((r) => r.id);
      await indexAll(ids);
      const c = await customer();
      await creators.search(c, req("")); // warm the settings cache and connections
      // A co-located production database adds no network round trips; the remote test database adds about 6 per search.
      const t = performance.now();
      await ownerQuery("select 1");
      const rtt = performance.now() - t;
      const queries = [
        req("perf"),
        req("", { platform: "tiktok" }),
        req("", { niches: ["Food"], followersMin: 10_000 }),
        req("Creator 42", { creatorCity: "Karachi" }),
        req("", { engagementMin: 5, freshOnly: true }),
      ];
      const times: number[] = [];
      for (let i = 0; i < 20; i++) {
        const s = performance.now();
        await creators.search(c, queries[i % queries.length] ?? req(""));
        times.push(performance.now() - s);
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.ceil(times.length * 0.95) - 1] ?? Infinity;
      expect(p95).toBeLessThan(1000 + 6 * rtt);
    },
    180_000,
  );
});

describe("interpretation", () => {
  it("turns plain English into cleaned chips and records the call against the workspace", async () => {
    llmReply = { platform: "instagram", creatorCity: "Lahore", niches: ["bridal", "Crypto"], followersMin: 50_000, keywords: ["wedding"] };
    const c = await customer();
    const out = await creators.interpret(c, "bridal creators in Lahore on insta with 50k+ followers, wedding content");
    expect(out).toEqual({
      chips: { platform: "instagram", creatorCity: "Lahore", niches: ["Bridal"], followersMin: 50_000, verifiedOnly: false, hasContact: false, freshOnly: false },
      keywords: ["wedding"],
    });
    expect(llm.calls[0]).toMatchObject({ feature: "search_interpret", ctx: { workspaceId: c.workspaceId, requestId: "req-search" } });
    expect(llm.calls[0]?.input).toContain("<query>");
  });

  it("fails cleanly when the AI reply is unusable", async () => {
    llmReply = { followersMin: "lots" };
    await expect(creators.interpret(await customer(), "anything")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});

describe("lookup", () => {
  it("finds creators by name, handle or profile URL", async () => {
    const id = await addCreator(db, { displayName: "Bilal Eats", profiles: [{ platform: "tiktok", handle: "bilal_eats", followers: 900_000, engagementRate: 6 }], primaryPlatform: "tiktok" });
    await indexAll([id]);
    const c = await customer();
    expect((await creators.lookup(c, "Bilal")).matches.map((m) => m.id)).toEqual([id]);
    expect((await creators.lookup(c, "https://www.tiktok.com/@Bilal_Eats?lang=en")).matches.map((m) => m.id)).toEqual([id]);
    expect((await creators.lookup(c, "https://instagram.com/nobody_here")).matches).toEqual([]);
  });
});

describe("saved searches", () => {
  it("saves, lists and deletes within the workspace only", async () => {
    const a = await customer();
    const b = await customer();
    const saved = await creators.createSaved(a, { name: "Lahore bridal", queryText: "bridal", filters: searchFiltersSchema.parse({ niches: ["Bridal"] }) });
    expect((await creators.listSaved(a)).searches).toEqual([expect.objectContaining({ id: saved.id, name: "Lahore bridal", filters: expect.objectContaining({ niches: ["Bridal"] }) })]);
    expect((await creators.listSaved(b)).searches).toEqual([]);
    await expect(creators.deleteSaved(b, saved.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await creators.deleteSaved(a, saved.id);
    expect((await creators.listSaved(a)).searches).toEqual([]);
  });
});
