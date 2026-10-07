import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { claimUnpublished, markFailed, markPublished, writeOutbox } from "./outbox";
import { createDbProviderCallSink } from "./provider-calls";
import { createTestDatabase, ownerQuery, resetTables } from "./testing";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

const event = (workspaceId: string) => ({
  eventType: "system.ping",
  aggregateType: "workspace",
  aggregateId: workspaceId,
  workspaceId,
  payload: { hello: "world" },
  requestId: "req-1",
});

describe("outbox", () => {
  it("is written from a tenant transaction and claimed by the worker role", async () => {
    const ctx = { userId: randomUUID(), workspaceId: randomUUID() };
    const id = await db.withTenant(ctx, (tx) => writeOutbox(tx, event(ctx.workspaceId)));
    const claimed = await db.withSystem((tx) => claimUnpublished(tx, 10));
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id, eventType: "system.ping", payload: { hello: "world" }, attempts: 0 });
    await db.withSystem((tx) => markPublished(tx, id));
    expect(await db.withSystem((tx) => claimUnpublished(tx, 10))).toEqual([]);
  });

  it("counts failures and stops retrying after 10 attempts", async () => {
    const id = await db.withSystem((tx) => writeOutbox(tx, event(randomUUID())));
    for (let i = 0; i < 10; i++) await db.withSystem((tx) => markFailed(tx, id, "no route"));
    expect(await db.withSystem((tx) => claimUnpublished(tx, 10))).toEqual([]);
    const rows = await ownerQuery<{ attempts: number; last_error: string }>(`select attempts, last_error from platform.outbox`);
    expect(rows[0]).toEqual({ attempts: 10, last_error: "no route" });
  });
});

describe("provider call sink", () => {
  it("persists calls with cost", async () => {
    await createDbProviderCallSink(db).record({
      provider: "groq",
      operation: "chat",
      model: "llama",
      tokensIn: 12,
      tokensOut: 3,
      units: null,
      costUsd: 0.000123,
      latencyMs: 250,
      status: "ok",
      errorCode: null,
      workspaceId: null,
      jobId: null,
      requestId: "r",
    });
    const rows = await ownerQuery<{ cost_usd: string }>(`select cost_usd from platform.provider_calls`);
    expect(rows[0]?.cost_usd).toBe("0.000123");
  });
});
