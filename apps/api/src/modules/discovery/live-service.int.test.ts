import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { searchFiltersSchema, type LiveSearch } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { addCreator } from "../creators/test-fixtures";
import * as repo from "./repository";
import { createDiscoveryService } from "./service";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
const discovery = createDiscoveryService({ db, billing });
beforeEach(resetTables);
afterAll(() => db.close());

async function customer(): Promise<TenantContext> {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" };
}
const balance = async (c: TenantContext) => (await billing.summary(c)).balance;
const search = (filters: Record<string, unknown> = {}, text = "bridal makeup"): LiveSearch => ({ text, filters: searchFiltersSchema.parse(filters) });
const live = (s: LiveSearch, maxNew: 5 | 10 | 20, confirmedCost: number) => ({ kind: "live" as const, search: s, maxNew, confirmedCost });

async function started(c: TenantContext, s = search({ platform: "instagram" }), maxNew: 5 | 10 | 20 = 10, cost = 112): Promise<string> {
  const out = await discovery.start(c, live(s, maxNew, cost));
  if (out.body.status !== "started") throw new Error("expected started");
  return out.body.job.id;
}

describe("starting live runs", () => {
  it("reserves 12 + size × the platform's price and announces the run", async () => {
    const c = await customer();
    const out = await discovery.start(c, live(search({ platform: "instagram", niches: ["Bridal"] }), 10, 112));
    expect(out.httpStatus).toBe(202);
    if (out.body.status !== "started") throw new Error("expected started");
    expect(out.body.job).toMatchObject({ kind: "live", status: "queued", platform: null, handle: null, live: { maxNew: 10, maxCost: 112, found: 0, creditsCharged: 0 } });
    expect(await balance(c)).toMatchObject({ available: 88, reserved: 112 });
    const ev = await ownerQuery<{ event_type: string }>(`select event_type from platform.outbox where event_type like 'discovery.%'`);
    expect(ev.map((e) => e.event_type)).toEqual(["discovery.live_requested"]);
  });

  it("prices every new creator at TikTok's price when TikTok is in scope, and refuses a stale price", async () => {
    const c = await customer();
    await expect(discovery.start(c, live(search(), 5, 62))).rejects.toMatchObject({ code: "CONFLICT", details: { confirmedCost: 62, currentCost: 162 } });
    await started(c, search(), 5, 162);
    expect(await balance(c)).toMatchObject({ available: 38, reserved: 162 });
    await expect(discovery.start(await customer(), live(search(), 20, 612))).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
  });

  it("the same search while it runs returns the same run and charges once, even for simultaneous clicks", async () => {
    const c = await customer();
    const outs = await Promise.all(Array.from({ length: 4 }, () => discovery.start(c, live(search({ platform: "instagram" }), 10, 112))));
    expect(new Set(outs.map((o) => (o.body.status === "started" ? o.body.job.id : "")))).toHaveProperty("size", 1);
    expect(await balance(c)).toMatchObject({ available: 88, reserved: 112 });
    const other = await discovery.start(c, live(search({ platform: "instagram" }), 5, 62));
    expect(other.httpStatus).toBe(202);
  });
});

describe("reading results", () => {
  it("returns cards after the cursor, leaves hidden creators out, and keeps runs private", async () => {
    const a = await customer();
    const b = await customer();
    const jobId = await started(a);
    const known = await addCreator(db, { displayName: "Known One" });
    const fresh = await addCreator(db, { displayName: "New One" });
    const minor = await addCreator(db, { isMinor: true });
    await db.withWorkspace(a.workspaceId, async (tx) => {
      expect(await repo.insertResult(tx, a.workspaceId, jobId, { creatorId: known, isNew: false, credits: 0, reason: null })).toBe(true);
      expect(await repo.insertResult(tx, a.workspaceId, jobId, { creatorId: fresh, isNew: true, credits: 10, reason: "Bridal makeup in Lahore" })).toBe(true);
      expect(await repo.insertResult(tx, a.workspaceId, jobId, { creatorId: minor, isNew: true, credits: 0, reason: null })).toBe(true);
      expect(await repo.insertResult(tx, a.workspaceId, jobId, { creatorId: fresh, isNew: true, credits: 10, reason: null })).toBe(false);
    });
    const all = await discovery.results(a, jobId, 0);
    expect(all.results.map((r) => [r.displayName, r.isNew, r.seq])).toEqual([["Known One", false, 1], ["New One", true, 2]]);
    expect(all.done).toBe(false);
    expect((await discovery.results(a, jobId, 1)).results.map((r) => r.displayName)).toEqual(["New One"]);
    expect(await discovery.get(a, jobId)).toMatchObject({ live: { found: 3, new: 2, known: 1 } });
    await expect(discovery.results(b, jobId, 0)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
