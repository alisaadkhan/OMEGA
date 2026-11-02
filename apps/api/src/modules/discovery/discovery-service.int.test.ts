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
const addByUrl = (url: string, confirmedCost = 50) => ({ kind: "add_by_url" as const, url, confirmedCost });

describe("starting jobs", () => {
  it("reserves the price, queues the job and announces it", async () => {
    const c = await customer();
    const out = await discovery.start(c, addByUrl("https://www.instagram.com/Coke_Studio/?hl=en"));
    expect(out.httpStatus).toBe(202);
    if (out.body.status !== "started") throw new Error("expected started");
    expect(out.body.job).toMatchObject({ kind: "add_by_url", status: "queued", platform: "instagram", handle: "coke_studio", creatorId: null });
    expect(await balance(c)).toMatchObject({ available: 150, reserved: 50 });
    const ev = await ownerQuery<{ event_type: string; payload: { jobId: string } }>(`select event_type, payload from platform.outbox where event_type like 'discovery.%'`);
    expect(ev).toEqual([{ event_type: "discovery.requested", payload: { jobId: out.body.job.id } }]);
  });

  it("charges TikTok the same refresh price as other platforms and refuses a stale price", async () => {
    const c = await customer();
    await expect(discovery.start(c, addByUrl("https://tiktok.com/@cokestudiopakistan", 30))).rejects.toMatchObject({ code: "CONFLICT", details: { confirmedCost: 30, currentCost: 50 } });
    const ok = await discovery.start(c, addByUrl("https://tiktok.com/@cokestudiopakistan", 50));
    expect(ok.httpStatus).toBe(202);
    expect(await balance(c)).toMatchObject({ available: 150, reserved: 50 });
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
    expect(await balance(c)).toMatchObject({ available: 150, reserved: 50 });
  });

  it("refreshes a known creator, answers 'up to date' for fresh data, and refuses hidden creators", async () => {
    const c = await customer();
    const id = await addCreator(db, { profiles: [{ platform: "tiktok", handle: "fresh_one" }], primaryPlatform: "tiktok" });
    expect(await discovery.start(c, { kind: "refresh", creatorId: id, confirmedCost: 50 })).toMatchObject({ httpStatus: 200, body: { status: "up_to_date", creatorId: id } });
    await ownerQuery(`update gcp.creator_profiles set last_scraped_at = now() - interval '2 days' where creator_id = '${id}'`);
    const out = await discovery.start(c, { kind: "refresh", creatorId: id, confirmedCost: 50 });
    expect(out.body).toMatchObject({ status: "started", job: { kind: "refresh", creatorId: id, platform: "tiktok", handle: "fresh_one" } });
    const ev = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'refresh.requested'`);
    expect(ev[0]?.n).toBe(1);
    await ownerQuery(`update gcp.creators set status = 'erased' where id = '${id}'`);
    await expect(discovery.start(await customer(), { kind: "refresh", creatorId: id, confirmedCost: 50 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("treats creators customers cannot see (possible minors, removal requested) as not found on both paths", async () => {
    const c = await customer();
    const minor = await addCreator(db, { isMinor: true, profiles: [{ platform: "instagram", handle: "hidden_minor" }] });
    await ownerQuery(`update gcp.creator_profiles set last_scraped_at = now() - interval '2 days' where creator_id = '${minor}'`);
    await expect(discovery.start(c, addByUrl("instagram.com/hidden_minor"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(discovery.start(c, { kind: "refresh", creatorId: minor, confirmedCost: 50 })).rejects.toMatchObject({ code: "NOT_FOUND" });
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

describe("Pakistan-only lock on direct actions (BUG-32)", () => {
  it("a creator locked by the country rule cannot be refreshed or added by link by a workspace that does not hold it; nothing is charged", async () => {
    const id = await addCreator(db, { confirmedCountry: null, country: null, profiles: [{ platform: "instagram", handle: "abroad_one", bio: "Based in Dubai, UAE", updatedAt: new Date(Date.now() - 40 * 86_400_000) }] });
    const c = await customer();
    const before = await balance(c);
    await expect(discovery.start(c, { kind: "refresh", creatorId: id, confirmedCost: 50 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(discovery.start(c, addByUrl("https://www.instagram.com/abroad_one/"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await balance(c)).toEqual(before);
    // A workspace that saved the creator before the lock may still refresh it (its saved work keeps working).
    const holder = await customer();
    const listId = randomUUID();
    await ownerQuery(`insert into wp.lists (id, workspace_id, name, created_by) values ('${listId}', '${holder.workspaceId}', 'Saved', '${holder.userId}');
      insert into wp.list_members (list_id, workspace_id, creator_id, added_by) values ('${listId}', '${holder.workspaceId}', '${id}', '${holder.userId}');`);
    expect((await discovery.start(holder, { kind: "refresh", creatorId: id, confirmedCost: 50 })).body).toMatchObject({ status: "started" });
  });
});
