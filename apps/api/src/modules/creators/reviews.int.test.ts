import { randomUUID } from "node:crypto";
import { creatorReviewRequestSchema } from "@mushin/contracts";
import type { TenantContext } from "@mushin/core";
import { createTestDatabase, ownerQuery, resetTables } from "@mushin/db/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCreatorFlags } from "../staffops/creator-flags";
import { submitCreatorReview } from "./reviews";
import { addCreator } from "./test-fixtures";

// Owner directive 2026-11-15 ("authentication flows" §3, 0090): customers confirm or flag creators; staff work the flags.
const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

async function customer(): Promise<TenantContext> {
  const [u] = await ownerQuery<{ id: string }>(`insert into wp.users (id, email, display_name) values (gen_random_uuid(), 'c${randomUUID().slice(0, 6)}@brand.pk', 'C') returning id`);
  const [w] = await ownerQuery<{ id: string }>(`insert into wp.workspaces (name, owner_user_id) values ('Brand', '${u?.id}') returning id`);
  await ownerQuery(`insert into wp.workspace_members (workspace_id, user_id, role) values ('${w?.id}', '${u?.id}', 'owner')`);
  return { userId: u?.id as string, workspaceId: w?.id as string, requestId: "r", role: "owner" };
}
const staffMember = async (role = "admin") =>
  (await ownerQuery<{ id: string }>(`insert into staff.staff_users (email, name, password_hash, totp_secret_encrypted, role) values ('${randomUUID().slice(0, 8)}@staff.test', 'S', 'x', 'x', '${role}') returning id`))[0]?.id as string;
const meta = { ip: null, requestId: "req" };
const reviews = () => ownerQuery<{ verdict: string; reason: string | null; status: string; source_mode: string; platform: string | null }>(`select verdict, reason, status, source_mode, platform from wp.creator_profile_reviews order by created_at`);

describe("creator profile reviews", () => {
  it("stores confirmations (already resolved) and flags (open) from database search and Live Discovery", async () => {
    const ctx = await customer();
    const creator = await addCreator(db);
    expect(await submitCreatorReview(db, ctx, creator, { verdict: "valid", sourceMode: "db_search", platform: "instagram" })).toMatchObject({ status: "resolved" });
    expect(await submitCreatorReview(db, ctx, creator, { verdict: "invalid", reason: "wrong_location", note: "Lives in Dubai", sourceMode: "live_discovery" })).toMatchObject({ status: "pending" });
    expect(await reviews()).toEqual([
      { verdict: "valid", reason: null, status: "resolved", source_mode: "db_search", platform: "instagram" },
      { verdict: "invalid", reason: "wrong_location", status: "pending", source_mode: "live_discovery", platform: null },
    ]);
    // A second flag from the same person on the same creator updates the open one.
    const again = await submitCreatorReview(db, ctx, creator, { verdict: "invalid", reason: "not_individual_creator", sourceMode: "db_search" });
    expect((await reviews()).filter((r) => r.status === "pending")).toEqual([{ verdict: "invalid", reason: "not_individual_creator", status: "pending", source_mode: "db_search", platform: null }]);
    expect(again.status).toBe("pending");
  });

  it("refuses creators customers cannot see, and keeps each workspace's reviews to itself", async () => {
    const a = await customer();
    const b = await customer();
    const hidden = await addCreator(db);
    await ownerQuery(`update gcp.creators set is_minor = true where id = '${hidden}'`);
    await expect(submitCreatorReview(db, a, hidden, { verdict: "valid", sourceMode: "db_search" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(submitCreatorReview(db, a, randomUUID(), { verdict: "valid", sourceMode: "db_search" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const creator = await addCreator(db);
    await submitCreatorReview(db, a, creator, { verdict: "invalid", reason: "other", sourceMode: "db_search" });
    const seenByB = await db.withTenant(b, (tx) => tx.execute(`select id from wp.creator_profile_reviews` as never));
    expect(seenByB).toHaveLength(0);
  });

  it("validates the request: a flag needs a reason, a confirmation has none", () => {
    expect(creatorReviewRequestSchema.safeParse({ verdict: "invalid", sourceMode: "db_search" }).success).toBe(false);
    expect(creatorReviewRequestSchema.safeParse({ verdict: "valid", reason: "other", sourceMode: "db_search" }).success).toBe(false);
    expect(creatorReviewRequestSchema.safeParse({ verdict: "invalid", reason: "wrong_niche", sourceMode: "live_discovery", note: "x".repeat(501) }).success).toBe(false);
  });
});

describe("staff review queue", () => {
  it("lists open flags with their creator, then resolves, dismisses or excludes in one step, audited", async () => {
    const flags = createCreatorFlags({ db });
    const staff = await staffMember();
    const ctx = await customer();
    const other = await customer();
    const brand = await addCreator(db, { displayName: "Lahore Shoes Official" });
    const fine = await addCreator(db, { displayName: "Sana Cooks" });
    await submitCreatorReview(db, ctx, brand, { verdict: "invalid", reason: "not_individual_creator", note: "This is a shoe shop", sourceMode: "live_discovery" });
    await submitCreatorReview(db, other, brand, { verdict: "valid", sourceMode: "db_search" });
    await submitCreatorReview(db, ctx, fine, { verdict: "invalid", reason: "wrong_niche", sourceMode: "db_search" });

    const open = await flags.list({ status: "pending", offset: 0 });
    expect(open.counts).toEqual({ pending: 2, resolved: 0, dismissed: 0 });
    const shop = open.items.find((i) => i.creatorId === brand);
    expect(shop).toMatchObject({ displayName: "Lahore Shoes Official", reason: "not_individual_creator", note: "This is a shoe shop", sourceMode: "live_discovery", openFlags: 1, confirmations: 1 });
    expect(Object.keys(shop ?? {})).not.toContain("submittedBy"); // no submitter identity reaches staff

    const events = async () => (await ownerQuery(`select 1 from platform.outbox where event_type = 'creator.changed' and aggregate_id = '${brand}'`)).length;
    const before = await events();
    await flags.decide({ staffId: staff, role: "admin" } as never, shop?.id as string, { action: "exclude", excludeAs: "BUSINESS_STORE", note: "Storefront, not a person" }, meta);
    const [excluded] = await ownerQuery<{ account_type: string; account_type_source: string; account_type_confidence: string }>(`select account_type, account_type_source, account_type_confidence from gcp.creators where id = '${brand}'`);
    expect(excluded).toEqual({ account_type: "BUSINESS_STORE", account_type_source: "staff", account_type_confidence: "high" });
    expect((await events()) - before).toBe(1); // search re-indexes the creator, which leaves the results

    const niche = (await flags.list({ status: "pending", offset: 0 })).items[0];
    await flags.decide({ staffId: staff, role: "admin" } as never, niche?.id as string, { action: "dismiss", note: "Niche is right" }, meta);
    await expect(flags.decide({ staffId: staff, role: "admin" } as never, niche?.id as string, { action: "resolve", note: "again" }, meta)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await flags.list({ status: "dismissed", offset: 0 })).counts).toEqual({ pending: 0, resolved: 1, dismissed: 1 });
    const audit = await ownerQuery<{ action: string }>(`select action from staff.audit_log where action like 'catalogue.flag_%' order by created_at`);
    expect(audit.map((a) => a.action)).toEqual(["catalogue.flag_exclude", "catalogue.flag_dismiss"]);
  });

  it("erasing a workspace removes its reviews", async () => {
    const ctx = await customer();
    await submitCreatorReview(db, ctx, await addCreator(db), { verdict: "invalid", reason: "broken_profile", sourceMode: "db_search" });
    await ownerQuery(`select platform.erase_workspace('${ctx.workspaceId}')`);
    expect(await ownerQuery(`select 1 from wp.creator_profile_reviews`)).toHaveLength(0);
  });
});

describe("reported profiles auto-hide (owner, 25 Nov, 0106)", () => {
  const status = async (id: string) => (await ownerQuery<{ status: string; hidden_reason: string | null }>(`select status, hidden_reason from gcp.creators where id = '${id}'`))[0];
  const flag = (ctx: TenantContext, id: string) => submitCreatorReview(db, ctx, id, { verdict: "invalid", reason: "not_individual_creator", sourceMode: "db_search" });
  const subscribed = async () => {
    const ctx = await customer();
    await ownerQuery(`insert into wp.subscriptions (workspace_id, status) values ('${ctx.workspaceId}', 'active')`);
    return ctx;
  };

  it("hides a creator once 3 different accounts report it; one account alone never can", async () => {
    const creator = await addCreator(db);
    const a = await subscribed();
    for (let i = 0; i < 3; i++) await flag(await customer(), creator); // free accounts never hide a creator
    expect((await status(creator))?.status).toBe("active");
    await flag(a, creator);
    await flag(a, creator); // the same account again only updates its open report
    expect((await status(creator))?.status).toBe("active");
    await flag(await subscribed(), creator);
    expect((await status(creator))?.status).toBe("active");
    await flag(await subscribed(), creator);
    expect(await status(creator)).toEqual({ status: "hidden", hidden_reason: "Hidden automatically: reports from 3 accounts; waiting for staff review" });
  });

  it("dismissing every report brings it back, and those old reports never hide it again", async () => {
    const flags = createCreatorFlags({ db });
    const staff = { staffId: await staffMember(), role: "admin" } as never;
    const creator = await addCreator(db);
    for (let i = 0; i < 3; i++) await flag(await subscribed(), creator);
    expect((await status(creator))?.status).toBe("hidden");
    const open = (await flags.list({ status: "pending", offset: 0 })).items.filter((i) => i.creatorId === creator);
    await flags.decide(staff, open[0]?.id as string, { action: "dismiss", note: "Checked: real creator" }, meta);
    expect((await status(creator))?.status).toBe("hidden"); // two reports still open
    for (const f of open.slice(1)) await flags.decide(staff, f.id, { action: "dismiss", note: "Checked: real creator" }, meta);
    expect(await status(creator)).toEqual({ status: "active", hidden_reason: null });
    // Two new reports after the review are not enough; the dismissed ones no longer count.
    await flag(await subscribed(), creator);
    await flag(await subscribed(), creator);
    expect((await status(creator))?.status).toBe("active");
  });
});
