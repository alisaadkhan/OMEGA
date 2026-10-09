import { describe, expect, it } from "vitest";
import { createBudgetGuard } from "./guard";

describe("Apify budget guard", () => {
  it("counts this calendar month's spend (UTC) and refuses at the budget", async () => {
    const seen: Date[] = [];
    const guard = (spent: number) =>
      createBudgetGuard({ budgetUsd: 5, now: () => new Date("2026-10-09T12:00:00Z"), spentSince: async (since) => (seen.push(since), spent) });
    await expect(guard(4.99).assertWithinBudget()).resolves.toBeUndefined();
    expect(seen[0]?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    await expect(guard(5).assertWithinBudget()).rejects.toMatchObject({ reason: "spend_cap", retryable: false });
    await expect(createBudgetGuard({ budgetUsd: 0, spentSince: async () => 0 }).assertWithinBudget()).rejects.toMatchObject({ reason: "spend_cap" });
  });
});
