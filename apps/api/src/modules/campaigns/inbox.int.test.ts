import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { buildTestApp, noGuards } from "../../test-support/app";
import { createActivityModule, createActivityService } from "../activity/index";
import { addIndexedCreator as addCreator } from "../creators/test-fixtures";
import { createCampaignsModule, createCampaignsService } from "./index";

const db = createTestDatabase();
const campaigns = createCampaignsService({ db, planLimits: async () => ({ entitlements: { campaignLimit: null } }) });
beforeEach(resetTables);
afterAll(() => db.close());

const base = { status: "active", platform: null, client: "", objective: "", notes: "", budgetMinor: null, startDate: null, endDate: null } as const;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });

async function appFor(c: TenantContext) {
  return buildTestApp({
    guards: { ...noGuards(), customer: async (req) => { req.tenant = c; } },
    modules: [createCampaignsModule({ db, service: campaigns }), createActivityModule({ service: createActivityService({ db }) })],
  });
}
async function customer(): Promise<TenantContext> {
  return { ...(await createTestWorkspace()), requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" };
}

describe("Inbox (owner, 17 Nov)", () => {
  it("lists one conversation per creator per campaign from the latest logged outreach, filters by status, and stays private", async () => {
    const c = await customer();
    const k = await campaigns.create(c, { ...base, name: "Eid drop" });
    const a = await addCreator(db, { displayName: "Ali Eats" });
    const b = await addCreator(db, { displayName: "Bilal Bites" });
    await campaigns.addCreators(c, k.id, [a, b]);
    await campaigns.logOutreach(c, k.id, a, { channel: "email", outcome: "attempted", note: "Sent brief", occurredAt: "2026-10-01T10:00:00.000Z" });
    await campaigns.logOutreach(c, k.id, a, { channel: "whatsapp", outcome: "replied", note: "Interested" });
    await campaigns.logOutreach(c, k.id, b, { channel: "instagram", outcome: "attempted", note: "" });
    const app = await appFor(c);

    const all = (await app.inject({ method: "GET", url: "/v1/outreach/inbox" })).json();
    expect(all.counts).toEqual({ all: 2, waiting: 1, replied: 1, agreed: 0, declined: 0 });
    const ali = all.threads.find((t: { creator: { id: string } }) => t.creator.id === a);
    expect(ali).toMatchObject({ campaign: { id: k.id, name: "Eid drop" }, events: 2, last: { outcome: "replied", channel: "whatsapp", note: "Interested" } });
    const waiting = (await app.inject({ method: "GET", url: "/v1/outreach/inbox?filter=waiting" })).json();
    expect(waiting.threads.map((t: { creator: { id: string } }) => t.creator.id)).toEqual([b]);
    expect((await app.inject({ method: "GET", url: "/v1/outreach/inbox?filter=bogus" })).statusCode).toBe(400);

    // Another account sees nothing of it; a hidden creator drops out.
    const other = await appFor(await customer());
    expect((await other.inject({ method: "GET", url: "/v1/outreach/inbox" })).json().threads).toEqual([]);
    await ownerQuery(`update gcp.creators set status = 'removal_requested' where id = '${b}'`);
    expect((await app.inject({ method: "GET", url: "/v1/outreach/inbox" })).json().counts.all).toBe(1);
  });
});

describe("post-day reminders (0091)", () => {
  it("appear in the activity feed only for campaigns that turned them on, until the content is marked posted", async () => {
    const c = await customer();
    const k = await campaigns.create(c, { ...base, name: "Summer" });
    const a = await addCreator(db, { displayName: "Ali Eats" });
    await campaigns.addCreators(c, k.id, [a]);
    const v = (await ownerQuery<{ version: number }>(`select version from wp.campaign_creators where creator_id = '${a}'`))[0]?.version ?? 0;
    await campaigns.updateCreator(c, k.id, a, { expectedVersion: v, dueDate: today() });
    const app = await appFor(c);
    const reminders = async () => (await app.inject({ method: "GET", url: "/v1/activity?kind=post_due&limit=20" })).json().events as { text: string }[];

    expect(await reminders()).toEqual([]);
    const on = await app.inject({ method: "PATCH", url: `/v1/campaigns/${k.id}`, payload: { notifyPostDue: true } });
    expect(on.json().notifyPostDue).toBe(true);
    expect((await reminders()).map((e) => e.text)).toEqual(["Ali Eats is due to post today (Summer)"]);

    const v2 = (await ownerQuery<{ version: number }>(`select version from wp.campaign_creators where creator_id = '${a}'`))[0]?.version ?? 0;
    await campaigns.updateCreator(c, k.id, a, { expectedVersion: v2, contentStatus: "posted" });
    expect(await reminders()).toEqual([]);
  });
});
