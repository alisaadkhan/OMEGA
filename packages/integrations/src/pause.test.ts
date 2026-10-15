import { describe, expect, it } from "vitest";
import { pausableGuard, pausableLlm } from "./pause";

describe("operations pause", () => {
  it("refuses new provider work while paused, fails closed when the flag cannot be read, and passes through otherwise", async () => {
    let paused = false;
    let begun = 0;
    const guard = pausableGuard({ begin: async () => { begun++; return () => {}; } }, async () => paused, "Apify");
    await guard.begin();
    paused = true;
    await expect(guard.begin()).rejects.toMatchObject({ reason: "spend_cap", message: expect.stringMatching(/paused/) });
    const broken = pausableGuard({ begin: async () => () => {} }, async () => { throw new Error("db down"); }, "Apify");
    await expect(broken.begin()).rejects.toThrow(/db down/);
    expect(begun).toBe(1);
  });

  it("pauses AI calls as AI unavailable", async () => {
    let calls = 0;
    const llm = pausableLlm({ complete: async () => { calls++; return { value: 1 } as never; } }, async () => true);
    await expect(llm.complete({} as never)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", details: { reason: "provider_paused" } });
    expect(calls).toBe(0);
  });
});
