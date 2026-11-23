import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, dbError, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockEmailProvider } from "@mushin/integrations";
import { createSupportService } from "../support/index";
import { createNotificationMailer } from "./index";

const db = createTestDatabase();
const support = createSupportService({ db });
beforeEach(resetTables);
afterAll(() => db.close());

const logger = createLogger({ level: "silent", name: "t" });
const customer = async (): Promise<TenantContext> => ({ ...(await createTestWorkspace()), requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" });
const staffMember = async () =>
  (await ownerQuery<{ id: string }>(`insert into staff.staff_users (email, name, password_hash, totp_secret_encrypted, role) values ('${randomUUID().slice(0, 8)}@staff.test', 'Sara', 'x', 'x', 'support') returning id`))[0]?.id as string;
const staffUpdate = (id: string, staffId: string, body: string | null, status: string | null) =>
  ownerQuery(`select platform.staff_ticket_update('${id}', '${staffId}', ${body === null ? "null" : `'${body}'`}, ${status === null ? "null" : `'${status}'`})`);
// What the bell shows: the person's own notifications in their own workspace (RLS).
const bell = (c: TenantContext) =>
  db.withTenant({ userId: c.userId, workspaceId: c.workspaceId }, (tx) => tx.execute<{ kind: string; title: string; link: string | null; read_at: string | null }>(sql`select kind, title, link, read_at from wp.notifications order by created_at`));

describe("customer notifications (owner, 23 Nov; 0100)", () => {
  it("a staff reply and a resolution notify the person who asked; internal notes and their own closing do not", async () => {
    const c = await customer();
    const staff = await staffMember();
    const t = await support.create(c, { subject: "Search shows old counts", category: "other", body: "Please check" });
    await ownerQuery(`select platform.staff_ticket_note('${t.id}', '${staff}', 'Looking into it')`).catch(() => undefined);
    await staffUpdate(t.id, staff, "We refreshed the counts.", "waiting_on_customer");
    await staffUpdate(t.id, staff, null, "resolved");
    expect((await bell(c)).map((n) => [n.kind, n.title, n.link])).toEqual([
      ["ticket_reply", "Support replied: Search shows old counts", "#/dashboard/support"],
      ["ticket_resolved", "Your support request was resolved: Search shows old counts", "#/dashboard/support"],
    ]);
    // The customer reopening and then ending their own request makes nothing new.
    await support.setStatus(c, t.id, "open");
    await support.setStatus(c, t.id, "closed");
    expect(await bell(c)).toHaveLength(2);
    // Another account never sees them.
    expect(await bell(await customer())).toEqual([]);
  });

  it("turns billing and live-search events into notifications for the account's owners and admins", async () => {
    const c = await customer();
    await ownerQuery(`insert into platform.outbox (event_type, aggregate_type, aggregate_id, workspace_id, payload) values
      ('notify.credits_low', 'workspace', '${c.workspaceId}', '${c.workspaceId}', '{"available": 120}'),
      ('notify.discovery_job_finished', 'workspace', '${c.workspaceId}', '${c.workspaceId}', '{"status": "failed"}'),
      ('workspace.something_else', 'workspace', '${c.workspaceId}', '${c.workspaceId}', '{}')`);
    const n = (await bell(c)).sort((a, b) => a.kind.localeCompare(b.kind));
    expect(n.map((x) => [x.kind, x.title, x.link])).toEqual([
      ["credits_low", "Your credits are running low", "#/dashboard/billing"],
      ["live_search_failed", "Your live search could not finish", "#/dashboard/search"],
    ]);
  });

  it("emails each waiting notification once, and none to a person who turned account emails off", async () => {
    const c = await customer();
    const off = await customer();
    await ownerQuery(`update wp.users set preferences = preferences || '{"emailNotifications": false}' where id = '${off.userId}'`);
    for (const w of [c, off]) await ownerQuery(`insert into platform.outbox (event_type, aggregate_type, aggregate_id, workspace_id, payload) values ('notify.trial_expired', 'workspace', '${w.workspaceId}', '${w.workspaceId}', '{}')`);
    const provider = new MockEmailProvider();
    const mailer = createNotificationMailer({ db, provider, from: "MUSHIN <n@x.test>", appUrl: "https://app.test", logger });
    expect(await mailer.drain()).toEqual({ sent: 1, failed: 0 });
    expect(await mailer.drain()).toEqual({ sent: 0, failed: 0 });
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]).toMatchObject({ to: `${c.userId}@test.mushin.pk`, subject: "Your free trial has ended" });
    expect(provider.sent[0]?.text).toContain("https://app.test/#/dashboard/billing");
    const status = await ownerQuery<{ email_status: string }>(`select email_status from wp.notifications order by email_status`);
    expect(status.map((s) => s.email_status)).toEqual(["sent", "skipped"]);
  });

  it("lets a person mark their notifications read, and nothing else", async () => {
    const c = await customer();
    await ownerQuery(`insert into platform.outbox (event_type, aggregate_type, aggregate_id, workspace_id, payload) values ('notify.payment_failed', 'workspace', '${c.workspaceId}', '${c.workspaceId}', '{}')`);
    await db.withTenant({ userId: c.userId, workspaceId: c.workspaceId }, (tx) => tx.execute(sql`update wp.notifications set read_at = now()`));
    expect((await bell(c))[0]?.read_at).not.toBeNull();
    await expect(db.withTenant({ userId: c.userId, workspaceId: c.workspaceId }, (tx) => tx.execute(sql`update wp.notifications set title = 'x'`))).rejects.toSatisfy(dbError(/permission denied/));
  });
});
