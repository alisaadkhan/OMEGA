import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Logger } from "@mushin/core";
import { withLlmBudget } from "./budget";
import { MockLlm } from "./mock";

const logs: { level: string; msg: string }[] = [];
const logger = {
  warn: (_o: unknown, msg: string) => logs.push({ level: "warn", msg }),
  error: (_o: unknown, msg: string) => logs.push({ level: "error", msg }),
} as unknown as Logger;
const req = { feature: "search_interpret" as const, system: "s", input: "i", schema: z.object({ ok: z.boolean() }) };

describe("monthly LLM budget", () => {
  it("lets calls through under the budget and refuses them at the budget without calling the provider", async () => {
    let spent = 4.9;
    const inner = new MockLlm(() => ({ ok: true }));
    const llm = withLlmBudget(inner, { budgetUsd: 5, spentSince: async () => spent, logger, perCallUsd: 0.05 });
    await expect(llm.complete(req)).resolves.toMatchObject({ value: { ok: true } });
    spent = 4.97;
    await expect(llm.complete(req)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", details: { reason: "llm_budget" } });
    expect(inner.calls).toHaveLength(1);
  });

  it("counts calls in flight, so simultaneous calls cannot jointly overshoot", async () => {
    let release: () => void = () => {};
    const slow = new MockLlm(() => new Promise((r) => (release = () => r({ ok: true }))));
    const llm = withLlmBudget(slow, { budgetUsd: 1, spentSince: async () => 0.9, logger, perCallUsd: 0.06 });
    const first = llm.complete(req); // 0.9 + 1 × 0.06 fits
    await new Promise((r) => setTimeout(r, 0));
    await expect(llm.complete(req)).rejects.toMatchObject({ details: { reason: "llm_budget" } }); // 0.9 + 2 × 0.06 does not
    release();
    await expect(first).resolves.toBeDefined();
  });

  it("warns once a month after the warning share and again in a new month", async () => {
    logs.length = 0;
    let now = new Date("2026-10-20T00:00:00Z");
    const llm = withLlmBudget(new MockLlm(() => ({ ok: true })), { budgetUsd: 10, spentSince: async () => 8.5, logger, now: () => now });
    await llm.complete(req);
    await llm.complete(req);
    now = new Date("2026-11-02T00:00:00Z");
    await llm.complete(req);
    expect(logs.filter((l) => l.level === "warn")).toHaveLength(2);
  });
});

describe("monthly LLM budget at zero", () => {
  it("refuses every call: a zero cap never means unlimited", async () => {
    const inner = new MockLlm(() => ({ ok: true }));
    const llm = withLlmBudget(inner, { budgetUsd: 0, spentSince: async () => 0, logger });
    await expect(llm.complete(req)).rejects.toMatchObject({ details: { reason: "llm_budget" } });
    expect(inner.calls).toHaveLength(0);
  });
});
