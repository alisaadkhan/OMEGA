import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, resetTables } from "@mushin/db/testing";
import { createCampaignsService } from "../campaigns/index";
import { addIndexedCreator as addCreator } from "../creators/test-fixtures";
import { createListsService } from "../lists/index";
import { createActivityService } from "../activity/index";
import { createAnalyticsService } from "./index";

const db = createTestDatabase();
const analytics = createAnalyticsService({ db });
const activity = createActivityService({ db });
const campaigns = createCampaignsService({ db, planLimits: async () => ({ entitlements: { campaignLimit: null } }) });
const lists = createListsService({ db });
beforeEach(resetTables);
afterAll(() => db.close());

const customer = async (): Promise<TenantContext> => ({ ...(await createTestWorkspace()), requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" });
const base = { status: "active", platform: null, client: "", objective: "", notes: "", budgetMinor: 10_000_000, startDate: null, endDate: null } as const;

describe("activity feed", () => {
  it("lists what the team actually did, newest first, pages with `before`, and stays in the workspace", async () => {
    const c = await customer();
    const a = await addCreator(db, { displayName: "Sana Bridal" });
    const l = await lists.create(c, { name: "Bridal", description: "" });
    await lists.addMembers(c, l.id, [a]);
    const k = await campaigns.create(c, { ...base, name: "Eid" });
    await campaigns.addCreators(c, k.id, [a]);
    await campaigns.logOutreach(c, k.id, a, { channel: "email", outcome: "agreed", note: "" });
    const feed = (await activity.feed(c, { limit: 10 })).events;
    expect(feed.map((e) => e.kind).sort()).toEqual(["campaign_created", "creator_added_to_campaign", "creator_saved", "list_created", "outreach_logged"]);
    expect(feed.find((e) => e.kind === "outreach_logged")?.text).toBe("logged that Sana Bridal agreed (Eid)");
    expect(feed.find((e) => e.kind === "creator_saved")).toMatchObject({ text: "saved Sana Bridal to Bridal", actor: { id: c.userId }, target: { type: "list", id: l.id } });
    expect(feed.map((e) => e.at)).toEqual([...feed.map((e) => e.at)].sort().reverse());
    const older = await activity.feed(c, { limit: 10, before: feed[1]?.at ?? "" });
    expect(older.events.every((e) => e.at < (feed[1]?.at ?? ""))).toBe(true);
    expect((await activity.feed(await customer(), { limit: 10 })).events).toEqual([]);
  });

  // Regression (2026-10-21): one request that saves many creators stamps them all with the same time, and paging by
  // that time alone skipped every event tied at a page boundary.
  it("pages through events that share one timestamp without skipping any", async () => {
    const c = await customer();
    const ids = [];
    for (let i = 0; i < 25; i++) ids.push(await addCreator(db, { displayName: `Creator ${i}` }));
    const l = await lists.create(c, { name: "Bulk", description: "" });
    await lists.addMembers(c, l.id, ids);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const events = (await activity.feed(c, { limit: 10, ...(cursor ? { before: cursor } : {}) })).events;
      if (events.length === 0) break;
      seen.push(...events.map((e) => e.id));
      cursor = events.at(-1)?.cursor;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.filter((id) => id.startsWith("m:")).length).toBe(25);
    expect(seen.length).toBe(26);
  });
});

describe("analytics summary", () => {
  it("aggregates only persisted rows of the workspace, with outreach limited to the period", async () => {
    const c = await customer();
    const [a, b, x] = [await addCreator(db), await addCreator(db), await addCreator(db)];
    const k = await campaigns.create(c, { ...base, name: "One" });
    await campaigns.create(c, { ...base, name: "Two", status: "draft", budgetMinor: null });
    await campaigns.addCreators(c, k.id, [a, b, x]);
    const version = async (id: string) => (await campaigns.detail(c, k.id)).creators.find((m) => m.creator.id === id)?.version ?? 0;
    await campaigns.updateCreator(c, k.id, a, { expectedVersion: await version(a), stage: "confirmed", feeMinor: 3_000_000, contentStatus: "posted" });
    await campaigns.updateCreator(c, k.id, b, { expectedVersion: await version(b), outcome: "declined" });
    await campaigns.logOutreach(c, k.id, a, { channel: "email", outcome: "attempted", note: "", occurredAt: "2026-10-05T09:00:00.000Z" });
    await campaigns.logOutreach(c, k.id, a, { channel: "whatsapp", outcome: "agreed", note: "", occurredAt: "2026-10-06T09:00:00.000Z" });
    await campaigns.logOutreach(c, k.id, b, { channel: "email", outcome: "declined", note: "", occurredAt: "2026-09-01T09:00:00.000Z" }); // outside the period
    const l = await lists.create(c, { name: "Saved", description: "" });
    await lists.addMembers(c, l.id, [a, b]);

    const s = await analytics.summary(c, { from: "2026-10-01", to: "2026-10-31" });
    expect(s.campaigns).toEqual({ total: 2, byStatus: { draft: 1, active: 1, paused: 0, completed: 0 } });
    expect(s.pipeline).toMatchObject({ byStage: { identified: 1, contacted: 0, negotiating: 0, confirmed: 1 }, declined: 1, agreedFeesMinor: 3_000_000, budgetMinor: 10_000_000 });
    expect(s.pipeline.byContent).toMatchObject({ posted: 1, none: 2 });
    expect(s.outreach).toEqual({ total: 2, byOutcome: { attempted: 1, replied: 0, no_response: 0, declined: 0, agreed: 1 }, byChannel: { email: 1, whatsapp: 1 }, creatorsContacted: 1 });
    expect(s.lists).toEqual({ total: 1, savedCreators: 2 });
    expect(s.discovery).toEqual({ liveRuns: 0, creatorsDelivered: 0, newCreators: 0 });

    // Another workspace sees none of it.
    const other = await analytics.summary(await customer(), { from: "2026-10-01", to: "2026-10-31" });
    expect(other).toMatchObject({ campaigns: { total: 0 }, outreach: { total: 0 }, lists: { total: 0, savedCreators: 0 }, pipeline: { agreedFeesMinor: 0 } });
  });
});
