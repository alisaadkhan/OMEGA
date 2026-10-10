import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockPayments } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { suppress } from "../creators/index";
import { addCreator } from "../creators/test-fixtures";
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
const addByUrl = (url: string, confirmedCost = 10) => ({ kind: "add_by_url" as const, url, confirmedCost });

describe("starting jobs", () => {
  it("reserves the price, queues the job and announces it", async () => {
    const c = await customer();
    const out = await discovery.start(c, addByUrl("https://www.instagram.com/Coke_Studio/?hl=en"));
    expect(out.httpStatus).toBe(202);
    if (out.body.status !== "started") throw new Error("expected started");
    expect(out.body.job).toMatchObject({ kind: "add_by_url", status: "queued", platform: "instagram", handle: "coke_studio", creatorId: null });
    expect(await balance(c)).toMatchObject({ available: 190, reserved: 10 });
    const ev = await ownerQuery<{ event_type: string; payload: { jobId: string } }>(`select event_type, payload from platform.outbox where event_type like 'discovery.%'`);
    expect(ev).toEqual([{ event_type: "discovery.requested", payload: { jobId: out.body.job.id } }]);
  });

  it("charges TikTok at its own price and refuses a stale price", async () => {
    const c = await customer();
    await expect(discovery.start(c, addByUrl("https://tiktok.com/@cokestudiopakistan", 10))).rejects.toMatchObject({ code: "CONFLICT", details: { confirmedCost: 10, currentCost: 30 } });
    const ok = await discovery.start(c, addByUrl("https://tiktok.com/@cokestudiopakistan", 30));
    expect(ok.httpStatus).toBe(202);
    expect(await balance(c)).toMatchObject({ available: 170, reserved: 30 });
  });

  it("opens a creator MUSHIN already has for free", async () => {
    const c = await customer();
    const id = await addCreator(db, { profiles: [{ platform: "instagram", handle: "known_one" }] });
    expect(await discovery.start(c, addByUrl("instagram.com/known_one"))).toEqual({ httpStatus: 200, body: { status: "known", creatorId: id } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });

  it("rejects links that are not a supported profile", async () => {
    const c = await customer();
    await expect(discovery.start(c, addByUrl("https://example.com/whatever"))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(discovery.start(c, addByUrl("https://instagram.com/p/Dd_0JNUslzh"))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("one open job per profile per workspace: repeats and simultaneous clicks charge once (Review Focus 2)", async () => {
    const c = await customer();
    const results = await Promise.all(Array.from({ length: 5 }, () => discovery.start(c, addByUrl("https://instagram.com/coke_studio"))));
    const ids = new Set(results.map((r) => (r.body.status === "started" ? r.body.job.id : "")));
    expect(ids.size).toBe(1);
    expect(await balance(c)).toMatchObject({ available: 190, reserved: 10 });
  });

  it("refreshes a known creator, answers 'up to date' for fresh data, and refuses hidden creators", async () => {
    const c = await customer();
    const id = await addCreator(db, { profiles: [{ platform: "tiktok", handle: "fresh_one" }], primaryPlatform: "tiktok" });
    expect(await discovery.start(c, { kind: "refresh", creatorId: id, confirmedCost: 30 })).toMatchObject({ httpStatus: 200, body: { status: "up_to_date", creatorId: id } });
    await ownerQuery(`update gcp.creator_profiles set last_scraped_at = now() - interval '2 days' where creator_id = '${id}'`);
    const out = await discovery.start(c, { kind: "refresh", creatorId: id, confirmedCost: 30 });
    expect(out.body).toMatchObject({ status: "started", job: { kind: "refresh", creatorId: id, platform: "tiktok", handle: "fresh_one" } });
    const ev = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'refresh.requested'`);
    expect(ev[0]?.n).toBe(1);
    await ownerQuery(`update gcp.creators set status = 'erased' where id = '${id}'`);
    await expect(discovery.start(await customer(), { kind: "refresh", creatorId: id, confirmedCost: 30 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("treats creators customers cannot see (possible minors, removal requested) as not found on both paths", async () => {
    const c = await customer();
    const minor = await addCreator(db, { isMinor: true, profiles: [{ platform: "instagram", handle: "hidden_minor" }] });
    await ownerQuery(`update gcp.creator_profiles set last_scraped_at = now() - interval '2 days' where creator_id = '${minor}'`);
    await expect(discovery.start(c, addByUrl("instagram.com/hidden_minor"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(discovery.start(c, { kind: "refresh", creatorId: minor, confirmedCost: 10 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const removing = await addCreator(db, { profiles: [{ platform: "instagram", handle: "asked_removal" }] });
    await ownerQuery(`update gcp.creators set status = 'removal_requested' where id = '${removing}'`);
    await expect(discovery.start(c, addByUrl("instagram.com/asked_removal"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });

  it("refuses workspaces without credits or a plan", async () => {
    const ws = await createTestWorkspace();
    const c: TenantContext = { ...ws, requestId: "r", role: "owner" };
    await expect(discovery.start(c, addByUrl("https://instagram.com/coke_studio"))).rejects.toSatisfy((e: unknown) =>
      ["ENTITLEMENT_REQUIRED", "INSUFFICIENT_CREDITS"].includes((e as { code?: string }).code ?? ""),
    );
  });
  it("refuses links on the do-not-re-add list without charging", async () => {
    const c = await customer();
    await db.withSystem((tx) => suppress(tx, [{ canonicalUrl: "https://instagram.com/erased_one", platform: "instagram" }], null));
    await expect(discovery.start(c, addByUrl("instagram.com/erased_one"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });

});

describe("reading jobs", () => {
  it("shows a workspace only its own jobs (RLS) and lists active ones", async () => {
    const a = await customer();
    const b = await customer();
    const started = await discovery.start(a, addByUrl("https://youtube.com/@cokestudio"));
    if (started.body.status !== "started") throw new Error("expected started");
    expect(await discovery.get(a, started.body.job.id)).toMatchObject({ id: started.body.job.id, platform: "youtube" });
    await expect(discovery.get(b, started.body.job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await discovery.listActive(a)).jobs.map((j) => j.id)).toEqual([started.body.job.id]);
    expect((await discovery.listActive(b)).jobs).toEqual([]);
  });
});
