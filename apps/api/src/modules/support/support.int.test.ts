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
