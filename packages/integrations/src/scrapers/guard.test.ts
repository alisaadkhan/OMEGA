import { describe, expect, it } from "vitest";
import { createBudgetGuard } from "./guard";

describe("Apify budget guard", () => {
  it("counts this calendar month's spend (UTC) and refuses at the budget", async () => {
    const seen: Date[] = [];
    const guard = (spent: number) =>
      createBudgetGuard({ budgetUsd: 5, now: () => new Date("2026-10-09T12:00:00Z"), spentSince: async (since) => (seen.push(since), spent) });
    await expect(guard(4.9).begin()).resolves.toBeTypeOf("function");
    expect(seen[0]?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    await expect(guard(5).begin()).rejects.toMatchObject({ reason: "spend_cap", retryable: false });
    await expect(createBudgetGuard({ budgetUsd: 0, spentSince: async () => 0 }).begin()).rejects.toMatchObject({ reason: "spend_cap" });
  });

  it("counts runs still in progress, so simultaneous jobs cannot all pass just under the budget", async () => {
    // Spend is recorded only when a run ends: five jobs starting together all read the same $4.90.
    const guard = createBudgetGuard({ budgetUsd: 5, perRunUsd: 0.05, spentSince: async () => 4.9 });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => guard.begin()));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(3);
    // A finished run gives its share back (its real cost is in the recorded spend by then).
    const first = results[0];
    if (first?.status !== "fulfilled") throw new Error("expected the first run to start");
    first.value();
    first.value(); // releasing twice frees one share only
    await expect(guard.begin()).resolves.toBeTypeOf("function");
    await expect(guard.begin()).rejects.toMatchObject({ reason: "spend_cap" });
  });
});
