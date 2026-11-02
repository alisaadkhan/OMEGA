import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { createSupportService } from "./index";

const db = createTestDatabase();
const support = createSupportService({ db });
beforeEach(resetTables);
afterAll(() => db.close());

const customer = async (): Promise<TenantContext> => ({ ...(await createTestWorkspace()), requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" });
const ticket = (n: number) => ({ subject: `Question ${n}`, category: "other" as const, body: "Please help" });

describe("customer support requests", () => {
  // Regression (2026-10-21): the open-request limit was counted without a lock, so simultaneous requests could pass it.
  it("never lets simultaneous requests go past 20 open requests per workspace", async () => {
    const c = await customer();
    const results = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => support.create(c, ticket(i))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(20);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason?.code === "CONFLICT")).toBe(true);
    const [n] = await ownerQuery<{ n: number }>(`select count(*)::int n from wp.support_tickets where workspace_id = '${c.workspaceId}' and status in ('open', 'waiting_on_customer')`);
    expect(n?.n).toBe(20);
  });

  it("refuses a reply on a closed request until it is reopened", async () => {
    const c = await customer();
    const t = await support.create(c, ticket(1));
    await support.setStatus(c, t.id, "closed");
    await expect(support.reply(c, t.id, "One more thing")).rejects.toMatchObject({ code: "CONFLICT" });
    await support.setStatus(c, t.id, "open");
    expect((await support.reply(c, t.id, "One more thing")).thread).toHaveLength(2);
  });

  it("keeps each workspace's requests to itself", async () => {
    const a = await customer();
    const b = await customer();
    const t = await support.create(a, ticket(1));
    await expect(support.detail(b, t.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await support.list(b)).tickets).toEqual([]);
  });
});

// Ticket lifecycle (0064): In progress, first response, resolution and reopening are recorded whatever writes them.
describe("ticket lifecycle and staff performance (0064)", () => {
  const staffMember = async (name: string) =>
    (await ownerQuery<{ id: string }>(`insert into staff.staff_users (email, name, password_hash, totp_secret_encrypted, role) values ('${randomUUID().slice(0, 8)}@staff.test', '${name}', 'x', 'x', 'support') returning id`))[0]?.id as string;
  const staffUpdate = (id: string, staffId: string, body: string | null, status: string | null) =>
    ownerQuery(`select platform.staff_ticket_update('${id}', '${staffId}', ${body === null ? "null" : `'${body}'`}, ${status === null ? "null" : `'${status}'`})`);
  const row = async (id: string) =>
    (await ownerQuery<{ status: string; first: boolean; resolved: boolean; reopened_count: number }>(`select status, first_response_at is not null first, resolved_at is not null resolved, reopened_count from wp.support_tickets where id = '${id}'`))[0];
  const events = async (id: string) => (await ownerQuery<{ kind: string; to_status: string | null }>(`select kind, to_status from wp.support_ticket_events where ticket_id = '${id}' order by id`)).map((e) => `${e.kind}:${e.to_status ?? ""}`);

  it("TKT-01 an internal note is not a response; the first staff reply is, once", async () => {
    const c = await customer();
    const t = await support.create(c, ticket(1));
    const s = await staffMember("Ayesha");
    await ownerQuery(`select platform.staff_ticket_note('${t.id}', '${s}', 'checking billing')`);
    expect(await row(t.id)).toMatchObject({ first: false });
    await staffUpdate(t.id, s, "Looking into it", "in_progress");
    await staffUpdate(t.id, s, "Still on it", null);
    expect(await row(t.id)).toMatchObject({ status: "in_progress", first: true });
    expect(await events(t.id)).toEqual(["created:open", "first_response:", "status:in_progress"]);
  });

  it("TKT-02 a customer reply keeps an in-progress request in progress and reopens a resolved one, counting the reopen", async () => {
    const c = await customer();
    const t = await support.create(c, ticket(1));
    const s = await staffMember("Bilal");
    await staffUpdate(t.id, s, null, "in_progress");
    await support.reply(c, t.id, "More detail");
    expect(await row(t.id)).toMatchObject({ status: "in_progress" });
    await staffUpdate(t.id, s, "Fixed", "resolved");
    expect(await row(t.id)).toMatchObject({ status: "resolved", resolved: true, reopened_count: 0 });
    await support.reply(c, t.id, "It happened again");
    expect(await row(t.id)).toMatchObject({ status: "open", resolved: false, reopened_count: 1 });
    expect((await events(t.id)).filter((e) => e.startsWith("reopened"))).toEqual(["reopened:open"]);
  });

  it("TKT-03 in-progress requests count toward the 20 open requests per workspace", async () => {
    const c = await customer();
    const s = await staffMember("Sana");
    for (let i = 0; i < 20; i++) {
      const t = await support.create(c, ticket(i));
      await staffUpdate(t.id, s, null, "in_progress");
    }
    await expect(support.create(c, ticket(99))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("TKT-04 staff performance: workload, resolved, median first response and resolution, reopened and backlog", async () => {
    const c = await customer();
    const s = await staffMember("Hina");
    const [a, b] = [await support.create(c, ticket(1)), await support.create(c, ticket(2))];
    await ownerQuery(`update wp.support_tickets set assigned_staff_id = '${s}' where id in ('${a.id}', '${b.id}')`);
    await staffUpdate(a.id, s, "On it", "in_progress");
    await staffUpdate(a.id, s, null, "resolved");
    await support.setStatus(c, a.id, "open");
    const [p] = await ownerQuery<{ v: { backlog: number; people: { name: string; workload: number; resolved: number; reopened: number; pending: number; firstResponseMinutes: number | null }[] } }>(`select platform.staff_support_performance(30) v`);
    const hina = p?.v.people.find((x) => x.name === "Hina");
    expect(p?.v.backlog).toBe(2);
    expect(hina).toMatchObject({ workload: 2, resolved: 1, reopened: 1, pending: 1 });
    expect(hina?.firstResponseMinutes).toBeGreaterThanOrEqual(0);
    expect(p?.v.people.find((x) => x.name === "Unassigned")).toMatchObject({ workload: 0 });
  });
});
