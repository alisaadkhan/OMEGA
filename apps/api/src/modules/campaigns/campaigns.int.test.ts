import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, dbError, ownerQuery, resetTables } from "@mushin/db/testing";
import { addCreator } from "../creators/test-fixtures";
import { createCampaignsService } from "./index";

const db = createTestDatabase();
const campaigns = createCampaignsService({ db });
beforeEach(resetTables);
afterAll(() => db.close());

async function customer(): Promise<TenantContext> {
  return { ...(await createTestWorkspace()), requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" };
}
const base = { status: "draft", platform: null, client: "", objective: "", notes: "", budgetMinor: null, startDate: null, endDate: null } as const;

describe("campaigns", () => {
  it("creates and edits a campaign; dates must be in order", async () => {
    const c = await customer();
    const made = await campaigns.create(c, { ...base, name: "Eid Bridal", client: "Heritage", budgetMinor: 50_000_000, startDate: "2026-11-01", endDate: "2026-11-30" });
    expect(made).toMatchObject({ name: "Eid Bridal", status: "draft", currency: "PKR", budgetMinor: 50_000_000, creatorCount: 0, stageCounts: { identified: 0, confirmed: 0 } });
    await expect(campaigns.update(c, made.id, { endDate: "2026-10-01" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await campaigns.update(c, made.id, { status: "active", objective: "Bridal looks for Eid" })).toMatchObject({ status: "active", objective: "Bridal looks for Eid" });
    await campaigns.remove(c, made.id);
    expect((await campaigns.index(c)).campaigns).toEqual([]);
  });

  it("tracks creators through stages; fees follow the stage, declined is an outcome, and stale edits are refused", async () => {
    const c = await customer();
    const k = await campaigns.create(c, { ...base, name: "Food Karachi" });
    const a = await addCreator(db, { displayName: "Ali Eats" });
    const b = await addCreator(db, { displayName: "Bilal Bites" });
    expect(await campaigns.addCreators(c, k.id, [a, b, b])).toEqual({ added: 2, alreadyInCampaign: 0 });
    expect(await campaigns.addCreators(c, k.id, [a])).toEqual({ added: 0, alreadyInCampaign: 1 });

    let v = (await campaigns.detail(c, k.id)).creators.find((x) => x.creator.id === a)?.version ?? 0;
    v = (await campaigns.updateCreator(c, k.id, a, { expectedVersion: v, stage: "negotiating", feeMinor: 2_500_000 })).version;
    v = (await campaigns.updateCreator(c, k.id, a, { expectedVersion: v, stage: "confirmed", contentStatus: "content_pending" })).version;
    // A second tab still holding the old version cannot overwrite the newer change.
    await expect(campaigns.updateCreator(c, k.id, a, { expectedVersion: v - 1, stage: "identified" })).rejects.toMatchObject({ code: "CONFLICT" });
    const bv = (await campaigns.detail(c, k.id)).creators.find((x) => x.creator.id === b)?.version ?? 0;
    await campaigns.updateCreator(c, k.id, b, { expectedVersion: bv, outcome: "declined", feeMinor: 900_000, feeKind: "agreed" });

    const d = await campaigns.detail(c, k.id);
    expect(d.creators.find((x) => x.creator.id === a)).toMatchObject({ stage: "confirmed", feeKind: "agreed", feeMinor: 2_500_000, contentStatus: "content_pending", version: v });
    // Declined creators are counted apart and their fees are not counted as agreed spend.
    expect(d).toMatchObject({ creatorCount: 2, stageCounts: { identified: 0, contacted: 0, negotiating: 0, confirmed: 1 }, declinedCount: 1, agreedFeesMinor: 2_500_000 });
    expect(JSON.stringify(d)).not.toMatch(/"(email|phone)"/);
    expect((await campaigns.index(c, a)).campaigns[0]?.containsCreator).toBe(true);
    await campaigns.removeCreator(c, k.id, b);
    expect((await campaigns.detail(c, k.id)).creatorCount).toBe(1);
  });

  it("logs manual outreach (append-only), names who logged it and refuses future dates", async () => {
    const c = await customer();
    await ownerQuery(`update wp.users set display_name = 'Ayesha Ops' where id = '${c.userId}'`);
    const k = await campaigns.create(c, { ...base, name: "Outreach test" });
    const a = await addCreator(db);
    await campaigns.addCreators(c, k.id, [a]);
    await campaigns.logOutreach(c, k.id, a, { channel: "email", outcome: "attempted", note: "Sent brief", occurredAt: "2026-10-01T10:00:00.000Z" });
    const replied = await campaigns.logOutreach(c, k.id, a, { channel: "whatsapp", outcome: "replied", note: "Interested" });
    expect(replied).toMatchObject({ channel: "whatsapp", outcome: "replied", loggedBy: { id: c.userId, name: "Ayesha Ops" } });
    await expect(campaigns.logOutreach(c, k.id, a, { channel: "email", outcome: "attempted", note: "", occurredAt: new Date(Date.now() + 3_600_000).toISOString() })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await campaigns.outreach(c, k.id, a)).events.map((e) => e.outcome)).toEqual(["replied", "attempted"]);
    expect((await campaigns.detail(c, k.id)).creators[0]?.lastOutreach).toMatchObject({ outcome: "replied" });
    // The app role may not rewrite history.
    await expect(db.withTenant(c, (tx) => tx.execute(`update wp.outreach_events set outcome = 'agreed'`))).rejects.toSatisfy(dbError(/permission denied/));
    await expect(db.withTenant(c, (tx) => tx.execute(`delete from wp.outreach_events`))).rejects.toSatisfy(dbError(/permission denied/));
    // Logging needs the creator to be in the campaign.
    await expect(campaigns.logOutreach(c, k.id, await addCreator(db), { channel: "email", outcome: "attempted", note: "" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps campaigns private to the workspace (AUTH-001) and erasure removes the creator everywhere (PRIV-001)", async () => {
    const owner = await customer();
    const other = await customer();
    const a = await addCreator(db);
    const k = await campaigns.create(owner, { ...base, name: "Private" });
    await campaigns.addCreators(owner, k.id, [a]);
    await campaigns.logOutreach(owner, k.id, a, { channel: "phone", outcome: "no_response", note: "" });
    expect((await campaigns.index(other)).campaigns).toEqual([]);
    await expect(campaigns.detail(other, k.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(campaigns.update(other, k.id, { name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(campaigns.addCreators(other, k.id, [a])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(campaigns.outreach(other, k.id, a)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.withTenant(other, (tx) => tx.execute(`select * from wp.outreach_events`))).toHaveLength(0);
    // Hidden creators cannot be added and drop out of the pipeline view.
    await expect(campaigns.addCreators(owner, k.id, [await addCreator(db, { isMinor: true })])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await ownerQuery(`select platform.erase_creator_workspace_rows('${a}', array[]::text[])`);
    expect(await ownerQuery(`select 1 from wp.campaign_creators where creator_id = '${a}' union all select 1 from wp.outreach_events where creator_id = '${a}'`)).toHaveLength(0);
  });

  it("returns only the caller's own workspace members from workspace_people", async () => {
    const a = await customer();
    await customer();
    const people = await db.withTenant(a, (tx) => tx.execute<{ id: string; role: string }>(`select id, role from platform.workspace_people()`));
    expect(people).toEqual([{ id: a.userId, role: "owner" }]);
  });
});
