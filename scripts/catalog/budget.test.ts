import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { assertDisposableTestDatabaseUrl } from "@mushin/db/testing";
import { BudgetExhausted, createBudgetGate, type BudgetGate } from "./budget";

// Runs against the local disposable test database (the ledger lives in its own catalog_build schema).
const url = process.env["TEST_DATABASE_URL"];
const db = url ? postgres(assertDisposableTestDatabaseUrl(url), { max: 6, onnotice: () => {} }) : null;
afterAll(() => db?.end());
const record = async (usd: number, at: Date) => {
  if (db) await db`insert into platform.provider_calls (provider, operation, cost_usd, latency_ms, status, created_at) values ('serper', 'budget-test', ${usd}, 1, 'ok', ${at.toISOString()}::timestamptz)`;
};
const cleanup = async () => {
  if (db) await db`delete from platform.provider_calls where operation = 'budget-test'`;
};

describe.skipIf(!db)("catalogue build combined budget gate", () => {
  it("refuses a request that would exceed the combined cap, without calling the provider", async () => {
    if (!db) return;
    await cleanup();
    const since = new Date(Date.now() - 1000);
    const gate = await createBudgetGate(db, { capUsd: 1, since });
    await record(0.95, new Date());
    let called = 0;
    // A paid call records its cost, as the provider adapters do: 0.95 + 0.04 = 0.99 spent.
    await gate.guard(0.04, async () => {
      called++;
      await record(0.04, new Date());
    });
    const refused = await gate.guard(0.02, async () => void called++).catch((e: unknown) => e);
    expect(called).toBe(1);
    expect(refused).toBeInstanceOf(BudgetExhausted);
    // Free calls (estimate 0, e.g. YouTube within quota) are never blocked.
    await gate.guard(0, async () => void called++);
    expect(called).toBe(2);
    await cleanup();
  });

  it("is combined across concurrent workers: 20 racing requests never go past the cap", async () => {
    if (!db) return;
    await cleanup();
    const since = new Date(Date.now() - 1000);
    const gates: BudgetGate[] = await Promise.all([1, 2, 3, 4].map(() => createBudgetGate(db, { capUsd: 0.5, since })));
    let inFlight = 0;
    let maxInFlight = 0;
    let called = 0;
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        (gates[i % 4] as BudgetGate).guard(0.1, async () => {
          called++;
          inFlight += 0.1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 30));
          await record(0.1, new Date());
          inFlight -= 0.1;
        }),
      ),
    );
    expect(called).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeLessThanOrEqual(0.5 + 1e-9);
    const rejected = outcomes.filter((x): x is PromiseRejectedResult => x.status === "rejected");
    expect(rejected.length).toBe(20 - called);
    expect(rejected.every((x) => x.reason instanceof BudgetExhausted)).toBe(true);
    const status = await (gates[0] as BudgetGate).status();
    expect(status.spent).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(status.open).toBe(0);
    await cleanup();
  });
});
