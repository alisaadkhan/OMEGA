import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { searchRequestSchema } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockLlm, MockPayments, UnavailableSearchIndex } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createPostgresCatalogSearch } from "./postgres-search";
import { isIndexable, toDocument } from "./projection";
import * as repo from "./repository";
import { SEARCH_CHARGE_WINDOW_MS } from "./search-charge";
import { createCreatorsService } from "./service";
import { addCreator, TEST_KEY } from "./test-fixtures";

// Owner pricing 2026-10-14: a standalone catalogue search costs 50 credits once per logical search.
const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
let clock = Date.now();
const now = () => new Date(clock);
const deps = { db, index: new UnavailableSearchIndex(), llm: new MockLlm(() => ({})), billing, encryptionKey: TEST_KEY, logger, now };
const creators = createCreatorsService({ ...deps, nativeSearch: createPostgresCatalogSearch(db) });

afterAll(() => db.close());
beforeEach(async () => {
  await resetTables();
  clock = Date.now();
  const id = await addCreator(db, { displayName: "Sana Bridal", niches: ["Bridal"] });
  const docs = (await db.withSystem((tx) => repo.indexRows(tx, [id]))).filter(isIndexable).map(toDocument);
  await db.withSystem((tx) => repo.upsertPostgresSearchDocuments(tx, docs));
});

async function customer(credits: "trial" | "none" = "trial"): Promise<TenantContext> {
  const ws = await createTestWorkspace();
  if (credits === "trial") await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: "req-search-charge", role: "owner" };
}
const req = (text: string, filters: Record<string, unknown> = {}, cursor?: string | null, confirmedCost = 50) => searchRequestSchema.parse({ text, filters, confirmedCost, ...(cursor ? { cursor } : {}) });
const available = async (c: TenantContext) => (await billing.summary(c)).balance.available;
const searchSpends = async (c: TenantContext) =>
  (await ownerQuery<{ n: number }>(`select count(*)::int n from wp.credit_ledger where workspace_id = '${c.workspaceId}' and action = 'search_existing' and kind = 'spend'`))[0]?.n ?? 0;

describe("catalogue search price", () => {
  it("charges the server price once per logical search; pages, repeats and spacing/case variants are free", async () => {
    const c = await customer();
    const first = await creators.search(c, req("Sana"));
    expect(first).toMatchObject({ charged: true, creditsCharged: 50 });
    expect(first.results.map((r) => r.displayName)).toEqual(["Sana Bridal"]);
    expect(await available(c)).toBe(150);
    for (const repeat of [req("Sana"), req("  sana "), req("SANA")]) {
      expect(await creators.search(c, repeat)).toMatchObject({ charged: false, creditsCharged: 0 });
    }
    expect(await available(c)).toBe(150);
    expect(await searchSpends(c)).toBe(1);
  });

  // Regression (search audit 2026-10-22): paging through real cursors, forwards and back, refreshing, clicking rapidly,
  // fetching pages simultaneously and retrying after a failure stay one logical search with one ledger spend.
  it("charges a multi-page search once across every page, back navigation, refresh, rapid and simultaneous requests and retries", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await addCreator(db, { displayName: `Sana Studio ${i}`, niches: ["Bridal"] }));
    const docs = (await db.withSystem((tx) => repo.indexRows(tx, ids))).filter(isIndexable).map(toDocument);
    await db.withSystem((tx) => repo.upsertPostgresSearchDocuments(tx, docs));
    await ownerQuery(`update platform.search_settings set page_size = 2`);
    try {
      const creators = createCreatorsService({ ...deps, nativeSearch: createPostgresCatalogSearch(db) }); // settings are cached per instance
      const c = await customer();
      const first = await creators.search(c, req("Sana"));
      expect(first).toMatchObject({ charged: true, creditsCharged: 50, page: 1, total: 7 });
      expect(first.platformCounts).toEqual({ instagram: 7, tiktok: 0, youtube: 0 }); // the whole result set, not the page
      const pages = [first];
      while (pages.at(-1)?.nextCursor) pages.push(await creators.search(c, req("Sana", {}, pages.at(-1)?.nextCursor)));
      expect(pages.map((p) => p.page)).toEqual([1, 2, 3, 4]);
      expect(new Set(pages.flatMap((p) => p.results.map((r) => r.id))).size).toBe(7); // every creator once, no repeats
      let back = pages[3];
      while (back?.prevCursor) back = await creators.search(c, req("Sana", {}, back.prevCursor));
      expect(back?.page).toBe(1);
      const cursor2 = pages[0]?.nextCursor;
      await creators.search(c, req("Sana", {}, cursor2)); // refresh of page 2
      await Promise.all(Array.from({ length: 6 }, () => creators.search(c, req("Sana", {}, cursor2)))); // rapid clicks
      await Promise.all(pages.map((p, i) => creators.search(c, req("Sana", {}, i === 0 ? null : pages[i - 1]?.nextCursor)))); // all pages at once
      const broken = createCreatorsService(deps);
      await expect(broken.search(c, req("Sana", {}, cursor2))).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
      expect(await creators.search(c, req("Sana", {}, cursor2))).toMatchObject({ charged: false, page: 2 }); // retry
      expect(await searchSpends(c)).toBe(1);
      expect(await available(c)).toBe(150);
      expect((await ownerQuery<{ n: number }>(`select count(*)::int n from wp.catalog_search_charges where workspace_id = '${c.workspaceId}'`))[0]?.n).toBe(1);
    } finally {
      await ownerQuery(`update platform.search_settings set page_size = 24`);
    }
  });

  it("charges again for different filters, for another user and after the 30-minute window", async () => {
    const c = await customer();
    await creators.search(c, req("Sana"));
    expect(await creators.search(c, req("Sana", { platform: "instagram" }))).toMatchObject({ charged: true });
    const teammate = randomUUID();
    await ownerQuery(`insert into wp.users (id, email) values ('${teammate}', '${teammate}@test.mushin.pk');
      insert into wp.workspace_members (workspace_id, user_id, role) values ('${c.workspaceId}', '${teammate}', 'member');`);
    expect(await creators.search({ ...c, userId: teammate, role: "member" }, req("Sana"))).toMatchObject({ charged: true });
    clock += SEARCH_CHARGE_WINDOW_MS + 1000;
    expect(await creators.search(c, req("Sana"))).toMatchObject({ charged: true });
    expect(await searchSpends(c)).toBe(4);
    expect(await available(c)).toBe(0);
  });

  it("refuses a stale confirmed price, an empty balance or a workspace without a plan, without charging", async () => {
    const c = await customer();
    await expect(creators.search(c, req("Sana", {}, null, 10))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await available(c)).toBe(200);
    expect((await ownerQuery<{ n: number }>(`select count(*)::int n from wp.catalog_search_charges`))[0]?.n).toBe(0);
    for (const text of ["a1", "a2", "a3", "a4"]) await creators.search(c, req(text)); // 4 × 50 spends the 200-credit trial
    await expect(creators.search(c, req("a5"))).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
    expect(await searchSpends(c)).toBe(4);
    expect(await available(c)).toBe(0);
    await expect(creators.search(await customer("none"), req("Sana"))).rejects.toMatchObject({ code: "ENTITLEMENT_REQUIRED" });
  });

  it("charges simultaneous identical searches once", async () => {
    const c = await customer();
    const outs = await Promise.all(Array.from({ length: 5 }, () => creators.search(c, req("Sana"))));
    expect(outs.filter((o) => o.charged)).toHaveLength(1);
    expect(await available(c)).toBe(150);
  });

  it("charges nothing when the search itself fails", async () => {
    const c = await customer();
    const broken = createCreatorsService(deps); // Meilisearch unavailable and no PostgreSQL fallback
    await expect(broken.search(c, req("Sana"))).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(await available(c)).toBe(200);
  });

  it("is never charged by Live Discovery's internal catalogue lookups", () => {
    // The only caller of the standalone charge is the customer search endpoint's service method.
    const dir = new URL("../discovery/", import.meta.url);
    const sources = readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => readFileSync(new URL(f.replaceAll("\\", "/"), dir), "utf8"));
    expect(sources.length).toBeGreaterThan(5);
    for (const s of sources) expect(s).not.toMatch(/chargeCatalogSearch|search-charge|creators\.search\(/);
  });
});
