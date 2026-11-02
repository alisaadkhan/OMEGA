/**
 * Exploratory pass (2026-10-28): paths around the monthly testing allowance that the planned cases did not cover, run
 * through the real services and database.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { searchRequestSchema } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockLlm, MockPayments, UnavailableSearchIndex } from "@mushin/integrations";
import { createCreatorIndexer, createCreatorsService, createPostgresCatalogSearch } from "../creators/index";
import { addCreator, TEST_KEY } from "../creators/test-fixtures";
import { createIdentityService } from "../identity/index";
import { MemoryAccessCache } from "./access-cache";
import { createBillingService } from "./service";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
let clock = new Date("2026-10-27T10:00:00Z");
const now = () => clock;
const payments = new MockPayments({ webhookSecret: "x".repeat(40), publicApiUrl: "http://api.test", now, deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger, now });
const identity = createIdentityService(db, null, billing.startTestingAllowance, async () => ({ email: "e@test.mushin.pk", confirmed: true }));
const creators = createCreatorsService({ db, index: new UnavailableSearchIndex(), nativeSearch: createPostgresCatalogSearch(db), llm: new MockLlm(() => ({})), billing, encryptionKey: TEST_KEY, logger, now });
const indexer = createCreatorIndexer({ db, index: null, logger });

beforeEach(async () => {
  await resetTables();
  clock = new Date("2026-10-27T10:00:00Z");
});
afterAll(() => db.close());

async function account(): Promise<TenantContext> {
  const t = await identity.resolveTenant({ userId: randomUUID(), email: `x-${randomUUID().slice(0, 6)}@test.mushin.pk`, fullName: "X" }, "req");
  return { ...t, requestId: "req", role: "owner" };
}
const req = (text: string, confirmedCost = 50) => searchRequestSchema.parse({ text, filters: {}, confirmedCost });
const cost = async (action: string) => (await ownerQuery<{ credits: number }>(`select credits from platform.credit_action_costs where action = '${action}'`))[0]?.credits as number;

describe("exploratory: testing credits in real user paths (EX)", () => {
  it("EX-01 a contact reveal through the creators service is paid from testing credits without a plan", async () => {
    const id = await addCreator(db, { displayName: "Reveal Me", niches: ["Food"], contacts: [{ kind: "email", value: "reveal.me@example.com", trust: "likely", source: "bio" }] });
    await indexer.sync([id]);
    const c = await account();
    const price = await cost("reveal_contact");
    const out = await creators.reveal(c, id, price);
    expect(JSON.stringify(out)).toContain("reveal.me@example.com");
    expect((await billing.summary(c)).balance.available).toBe(500 - price);
  });

  it("EX-02 a catalogue search with results is paid from testing credits; Find New Creators is still refused with a clear reason", async () => {
    const id = await addCreator(db, { displayName: "Search Me", niches: ["Food"] });
    await indexer.sync([id]);
    const c = await account();
    expect(await creators.search(c, req("Search Me"))).toMatchObject({ charged: true, creditsCharged: 50 });
    await expect(
      db.withTenant(c, (tx) => billing.engine.spendInstant(tx, c.workspaceId, { action: "find_new", confirmedCost: 50, refType: "t", refId: randomUUID() }, { userId: c.userId, requestId: "r" })),
    ).rejects.toMatchObject({ code: "ENTITLEMENT_REQUIRED", message: expect.stringContaining("Testing credits pay for searches and contact reveals only") });
  });

  it("EX-03 testing and purchased credits together: the testing credits (expiring first) are spent first, purchased ones stay", async () => {
    const c = await account();
    await db.withWorkspace(c.workspaceId, (tx) => billing.engine.grant(tx, c.workspaceId, { source: "topup", amount: 100, expiresAt: null, sourceRef: "ex-topup", note: "t" }));
    const id = await addCreator(db, { displayName: "Spend Order", niches: ["Food"] });
    await indexer.sync([id]);
    await creators.search(c, req("Spend Order"));
    const lots = await ownerQuery<{ source: string; remaining: number }>(`select source, remaining from wp.credit_lots where workspace_id = '${c.workspaceId}' order by source`);
    expect(lots).toEqual([{ source: "testing", remaining: 450 }, { source: "topup", remaining: 100 }]);
  });

  it("EX-04 a search answered just before 00:00 PKT is charged to the old month's lot; just after, the new lot pays", async () => {
    const id = await addCreator(db, { displayName: "Midnight", niches: ["Food"] });
    await indexer.sync([id]);
    const c = await account();
    clock = new Date("2026-10-31T18:59:30Z");
    await creators.search(c, req("Midnight"));
    clock = new Date("2026-10-31T19:00:30Z");
    await billing.runJob("expire_lots");
    await billing.runJob("testing_allowance");
    await creators.search(c, req("Midnight", 50));
    const lots = await ownerQuery<{ remaining: number; expires_at: string }>(`select remaining, to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') expires_at from wp.credit_lots where workspace_id = '${c.workspaceId}' order by expires_at`);
    // The repeat inside 30 minutes is free, so the new month's lot is untouched; the old lot lapsed with 450 unused.
    expect(lots).toEqual([{ remaining: 0, expires_at: "2026-10-31 19:00" }, { remaining: 500, expires_at: "2026-11-30 19:00" }]);
    const expired = await ownerQuery<{ amount: number }>(`select amount from wp.credit_ledger where workspace_id = '${c.workspaceId}' and kind = 'expire'`);
    expect(expired).toEqual([{ amount: -450 }]);
  });

  it("EX-05 a workspace locked out of an excluded creator cannot reveal its contacts either", async () => {
    const id = await addCreator(db, { displayName: "Abroad Contact", niches: ["Food"], confirmedCountry: null, country: null, profiles: [{ bio: "Food vlogger based in Dubai, UAE" }], contacts: [{ kind: "email", value: "abroad@example.com", trust: "likely", source: "bio" }] });
    await indexer.sync([id]);
    const c = await account();
    const outcome = await creators.reveal(c, id, await cost("reveal_contact")).then(
      (r) => ({ ok: true, body: JSON.stringify(r) }),
      (e: { code?: string }) => ({ ok: false, code: e.code }),
    );
    expect(outcome).toMatchObject({ ok: false });
    expect((await billing.summary(c)).balance.available).toBe(500);
  });
});
