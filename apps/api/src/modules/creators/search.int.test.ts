import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { searchFiltersSchema, searchRequestSchema } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, pinActionCosts, resetTables } from "@mushin/db/testing";
import { MockLlm, MockPayments, testSearchIndex, UnavailableSearchIndex } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { isIndexable, toDocument } from "./projection";
import * as repo from "./repository";
import { createCreatorsService } from "./service";
import { createPostgresCatalogSearch } from "./postgres-search";
import { addCreator, TEST_KEY } from "./test-fixtures";
import { rankCards } from "./ranking";
import { suppress } from "./suppressions";

const db = createTestDatabase();
const index = testSearchIndex();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
let llmReply: unknown = {};
const llm = new MockLlm(() => llmReply);
const creators = createCreatorsService({ db, index, llm, billing, encryptionKey: TEST_KEY, logger });
const postgresCreators = createCreatorsService({ db, index, nativeSearch: createPostgresCatalogSearch(db), llm, billing, encryptionKey: TEST_KEY, logger });

// These tests check what search finds, not what it costs (search-charge.int.test.ts covers the price): searching is
// free for this file and the owner price is put back afterwards. The price is captured before anything else can fail, so a
// failed setup (e.g. Meilisearch down) can never "restore" a wrong price into the table every later run shares.
let restorePrices: (() => Promise<void>) | undefined;
beforeAll(async () => {
  restorePrices = await pinActionCosts({ search_existing: 0 });
  await index.ensureSettings();
});
afterAll(async () => {
  await restorePrices?.();
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
  const docs = rows.filter(isIndexable).map(toDocument);
  await index.upsert(docs);
  await db.withSystem((tx) => repo.upsertPostgresSearchDocuments(tx, docs));
}

async function customer(): Promise<TenantContext> {
  return { ...(await createTestWorkspace()), requestId: "req-search", role: "owner" };
}

const req = (text: string, filters: Record<string, unknown> = {}, cursor?: string | null) => searchRequestSchema.parse({ text, filters, confirmedCost: 0, ...(cursor ? { cursor } : {}) });

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
    const nativeOut = await postgresCreators.search(c, req("", { platform: "instagram", niches: ["Bridal"], followersMin: 10_000, followersMax: 100_000, engagementMin: 4, creatorCity: "Lahore", creatorCountry: "PK" }));
    expect(out.results.map((r) => r.id)).toEqual([best, ok]);
    expect(nativeOut.results.map((r) => r.id)).toEqual(out.results.map((r) => r.id));
    expect(out.results[0]?.fitScore).toBeGreaterThan(out.results[1]?.fitScore ?? 100);
    expect(out.results[0]).toMatchObject({ displayName: "Sana Bridal", followersFreshness: "current", authenticityScore: null, hasContact: false });
    expect(out.fewResults).toBe(true);
  });

  it("finds a creator by an alternative spelling of their name (SRS §6.2)", async () => {
    const id = await addCreator(db, { displayName: "Ayesha Khan", nameVariants: ["Aisha Khan", "Aysha Khan"] });
    await indexAll([id]);
    expect((await creators.search(await customer(), req("Aisha"))).results.map((r) => r.id)).toEqual([id]);
    expect((await creators.search(await customer(), req("Aysha Khan"))).results.map((r) => r.id)).toEqual([id]);
    expect((await postgresCreators.search(await customer(), req("Aisha"))).results.map((r) => r.id)).toEqual([id]);
    expect((await postgresCreators.search(await customer(), req("Aysha Khan"))).results.map((r) => r.id)).toEqual([id]);
  });

  it("refuses audience-country filtering until verified audience analytics are available", async () => {
    await expect(creators.search(await customer(), req("", { audienceCountry: "AE" }))).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      message: "Audience-country filtering is unavailable until a verified audience analytics source is connected.",
    });
  });

  it("answers from the PostgreSQL projection while Meilisearch is unavailable, and only then", async () => {
    const id = await addCreator(db, { displayName: "Sana Bridal", niches: ["Bridal"] });
    await indexAll([id]);
    const c = await customer();
    const down = createCreatorsService({ db, index: new UnavailableSearchIndex(), fallbackSearch: createPostgresCatalogSearch(db), llm, billing, encryptionKey: TEST_KEY, logger });
    expect((await down.search(c, req("Sana"))).results.map((r) => r.id)).toEqual([id]);
    expect((await down.lookup(c, "Sana")).matches.map((m) => m.id)).toEqual([id]);
    // Without a configured fallback the outage is reported, not hidden.
    const noFallback = createCreatorsService({ db, index: new UnavailableSearchIndex(), llm, billing, encryptionKey: TEST_KEY, logger });
    await expect(noFallback.search(c, req("Sana"))).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("drops creators the index still lists but Postgres hides (possible minors, erased)", async () => {
    const shown = await addCreator(db);
    const minor = await addCreator(db);
    const erased = await addCreator(db);
    await indexAll([shown, minor, erased]);
    await ownerQuery(`update gcp.creators set is_minor = true where id = '${minor}'; update gcp.creators set status = 'erased' where id = '${erased}';`);
    expect((await creators.search(await customer(), req(""))).results.map((r) => r.id)).toEqual([shown]);
  });

  it("scores the strongest creators when more match a filter-only search than the scoring pool holds (REQ-02.03)", async () => {
    // The pool's minimum is 10: ten weaker creators are stored first, the strongest last.
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await addCreator(db, { profiles: [{ followers: 20_000, engagementRate: 1 + i / 10 }] }));
    const strong = await addCreator(db, { profiles: [{ followers: 60_000, engagementRate: 9 }] });
    await indexAll([...ids, strong]);
    await ownerQuery(`update platform.search_settings set candidate_pool = 10`);
    try {
      const fresh = createCreatorsService({ db, index, llm, billing, encryptionKey: TEST_KEY, logger });
      const out = await fresh.search(await customer(), req(""));
      expect(out.results.map((r) => r.id)).toContain(strong);
      expect(out.total).toBe(11);
    } finally {
      await ownerQuery(`update platform.search_settings set candidate_pool = 200`);
    }
  });

  it("pages results by cursor (no duplicates, stale or foreign cursors refused) and says when there are few (CAT-004)", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 26; i++) ids.push(await addCreator(db, { profiles: [{ followers: 10_000 + i * 1000, engagementRate: 5 }] }));
    await indexAll(ids);
    const c = await customer();
    const page1 = await creators.search(c, req(""));
    const page2 = await creators.search(c, req("", {}, page1.nextCursor));
    const nativePage1 = await postgresCreators.search(c, req(""));
    const nativePage2 = await postgresCreators.search(c, req("", {}, nativePage1.nextCursor));
    expect([page1.results.length, page2.results.length, page1.total, page1.fewResults, page1.pageSize]).toEqual([24, 2, 26, false, 24]);
    expect([page1.page, page2.page, page1.prevCursor, page2.nextCursor]).toEqual([1, 2, null, null]);
    expect((await creators.search(c, req("", {}, page2.prevCursor))).results.map((r) => r.id)).toEqual(page1.results.map((r) => r.id));
    expect(new Set([...page1.results, ...page2.results].map((r) => r.id)).size).toBe(26);
    // A cursor only works for the search it came from, and a made-up one is refused.
    await expect(creators.search(c, req("bridal", {}, page1.nextCursor))).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "stale_cursor" } });
    await expect(creators.search(c, req("", { verifiedOnly: true }, page1.nextCursor))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(creators.search(c, req("", {}, "not-a-cursor"))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(nativePage1.results.map((r) => r.id)).toEqual(page1.results.map((r) => r.id));
    expect(nativePage2.results.map((r) => r.id)).toEqual(page2.results.map((r) => r.id));
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
          -- Valid profile URLs and counts at or above the 10,000 eligibility minimum (elig-1), so all 1,000 are searchable.
          select c.id, c.primary_platform, c.primary_handle,
            case c.primary_platform when 'instagram' then 'https://instagram.com/' else 'https://' || c.primary_platform || '.com/@' end || c.primary_handle,
            10000 + (random() * 900000)::int, round((random() * 10)::numeric, 2)::float8, now() - (random() * 40 || ' days')::interval
          from gcp.creators c;`);
      const ids = (await ownerQuery<{ id: string }>(`select id from gcp.creators`)).map((r) => r.id);
      await indexAll(ids);
      const c = await customer();
      await creators.search(c, req("")); // warm the settings cache and connections
      const nativeBrowse = await postgresCreators.search(c, req(""));
      expect(nativeBrowse.total).toBe(1000);
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
      const meiliTimes: number[] = [];
      const postgresTimes: number[] = [];
      for (let i = 0; i < 20; i++) {
        const query = queries[i % queries.length] ?? req("");
        let started = performance.now();
        await creators.search(c, query);
        meiliTimes.push(performance.now() - started);
        started = performance.now();
        await postgresCreators.search(c, query);
        postgresTimes.push(performance.now() - started);
      }
      meiliTimes.sort((a, b) => a - b);
      postgresTimes.sort((a, b) => a - b);
      const meiliP95 = meiliTimes[Math.ceil(meiliTimes.length * 0.95) - 1] ?? Infinity;
      const postgresP95 = postgresTimes[Math.ceil(postgresTimes.length * 0.95) - 1] ?? Infinity;
      expect(meiliP95).toBeLessThan(1000 + 6 * rtt);
      expect(postgresP95).toBeLessThan(1000 + 6 * rtt);
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
    expect((await creators.lookup(c, "https://www.tiktok.com/@new_person")).addable).toEqual({ platform: "tiktok", handle: "new_person", url: "https://tiktok.com/@new_person", cost: 50 });
    expect((await creators.lookup(c, "https://instagram.com/nobody_here")).addable).toMatchObject({ platform: "instagram", cost: 50 }); // add-by-link uses the refresh price, the same on every platform
    expect((await creators.lookup(c, "Bilal")).addable).toBeNull();
    // A creator hidden from customers is neither a match nor addable (the discovery service answers NOT_FOUND too).
    await addCreator(db, { isMinor: true, profiles: [{ platform: "instagram", handle: "hidden_minor" }] });
    expect(await creators.lookup(c, "instagram.com/hidden_minor")).toEqual({ matches: [], addable: null });
  });

  it("offers no 'add' for a link on the do-not-re-add list", async () => {
    const c = await customer();
    await db.withSystem((tx) => suppress(tx, [{ canonicalUrl: "https://instagram.com/gone_creator", platform: "instagram" }], null));
    expect((await creators.lookup(c, "instagram.com/gone_creator")).addable).toBeNull();
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

describe("ranking cards for live results", () => {
  it("ranks visible creators by fit for the run's filters and leaves hidden ones out", async () => {
    const strong = await addCreator(db, { profiles: [{ followers: 120_000, engagementRate: 6 }] });
    const weak = await addCreator(db, { profiles: [{ followers: 900, engagementRate: 0.2 }] });
    const minor = await addCreator(db, { isMinor: true });
    const cards = await db.withSystem((tx) => rankCards(tx, [weak, strong, minor], searchFiltersSchema.parse({ followersMin: 50_000, followersMax: 500_000 }), new Date()));
    expect(cards.map((c) => c.id)).toEqual([strong, weak]);
    expect(cards[0]?.fitScore).toBeGreaterThan(cards[1]?.fitScore ?? 100);
  });
});
