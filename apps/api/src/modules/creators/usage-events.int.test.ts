import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { searchRequestSchema } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockLlm, MockPayments, UnavailableSearchIndex } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createCreatorIndexer } from "./indexer";
import { createPostgresCatalogSearch } from "./postgres-search";
import { createCreatorsService } from "./service";
import { addCreator, TEST_KEY } from "./test-fixtures";

// Usage events (0065): searches and creator-profile views, as staff analytics read them.
const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
const indexer = createCreatorIndexer({ db, index: null, logger });
const creators = createCreatorsService({ db, index: new UnavailableSearchIndex(), llm: new MockLlm(() => ({})), billing, encryptionKey: TEST_KEY, logger, nativeSearch: createPostgresCatalogSearch(db) });
afterAll(() => db.close());
beforeEach(resetTables);

async function customer(): Promise<TenantContext> {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: "req-usage", role: "owner" };
}
const req = (text: string, cursor?: string | null) => searchRequestSchema.parse({ text, filters: {}, confirmedCost: 50, ...(cursor ? { cursor } : {}) });
const searchEvents = () => ownerQuery<{ results: number; charged: boolean; backend: string; has_text: boolean }>(`select results, charged, backend, has_text from wp.search_events order by id`);
const stats = async (fn: string) => (await ownerQuery<{ v: Record<string, unknown> }>(`select platform.${fn} v`))[0]?.v;

describe("usage events", () => {
  it("EV-01 a search is recorded once (its first page), with the result count, charge and backend; no query text is stored", async () => {
    for (let i = 0; i < 25; i++) await addCreator(db, { displayName: `Lahore Food ${i}`, niches: ["Food"] });
    await indexer.sync((await ownerQuery<{ id: string }>(`select id from gcp.creators`)).map((r) => r.id));
    const c = await customer();
    const first = await creators.search(c, req("Lahore Food"));
    expect(first.nextCursor).not.toBeNull();
    await creators.search(c, req("Lahore Food", first.nextCursor));
    await creators.search(c, req("zzq nothing matches"));
    expect(await searchEvents()).toEqual([
      { results: 25, charged: true, backend: "postgres", has_text: true },
      { results: 0, charged: false, backend: "postgres", has_text: true },
    ]);
    const cols = (await ownerQuery<{ c: string }>(`select column_name c from information_schema.columns where table_schema = 'wp' and table_name = 'search_events'`)).map((r) => r.c);
    expect(cols.some((c2) => /text|query/.test(c2) && c2 !== "has_text")).toBe(false);
    expect(await stats("staff_search_stats(30)")).toMatchObject({ searches: 2, zeroResult: 1, zeroResultRate: 0.5, charged: 1, byBackend: { postgres: 2 } });
  });

  it("EV-02 opening a profile records one view per person per 30 minutes; locked creators record nothing; stats rank most and least viewed", async () => {
    const [a, b] = [await addCreator(db, { displayName: "Alpha Food", niches: ["Food"] }), await addCreator(db, { displayName: "Beta Food", niches: ["Food"] })];
    const abroad = await addCreator(db, { displayName: "Gamma Abroad", niches: ["Food"], confirmedCountry: null, country: null, profiles: [{ bio: "Food vlogger based in Dubai, UAE" }] });
    await indexer.sync([a, b, abroad]);
    const [c1, c2] = [await customer(), await customer()];
    await creators.profile(c1, a);
    await creators.profile(c1, a);
    await creators.profile(c2, a);
    await expect(creators.profile(c1, abroad)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from wp.creator_profile_views where creator_id = '${a}'`))[0]?.n).toBe(2);
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from wp.creator_profile_views where creator_id = '${abroad}'`))[0]?.n).toBe(0);
    const v = (await stats("staff_creator_view_stats(30, 10)")) as { byPlatform: unknown[]; mostViewed: { displayName: string; views: number; uniqueViewers: number }[]; leastViewed: { displayName: string; views: number }[] };
    expect(v.mostViewed[0]).toMatchObject({ displayName: "Alpha Food", views: 2, uniqueViewers: 2 });
    // Least viewed: eligible creators only, never-viewed included; the locked creator is not listed.
    expect(v.leastViewed.map((x) => `${x.displayName}:${x.views}`)).toEqual(["Beta Food:0", "Alpha Food:2"]);
    expect(JSON.stringify(v)).not.toMatch(/userId|workspaceId|email/);
  });
});
