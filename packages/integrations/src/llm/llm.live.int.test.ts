import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLogger, loadWorkerConfig } from "@mushin/core";
import { MemoryProviderCallSink } from "../memory-sink";
import { createLlm } from "./index";

describe.skipIf(process.env["LIVE_LLM_TESTS"] !== "1")("live LLM (LIVE_LLM_TESTS=1)", () => {
  it("gets valid JSON from the configured provider and records its cost", async () => {
    const sink = new MemoryProviderCallSink();
    const llm = createLlm(loadWorkerConfig(process.env).llm, { sink, logger: createLogger({ level: "silent" }), budget: null });
    const out = await llm.complete({ feature: "search_interpret", system: 'Reply with JSON only: {"ok": true}', input: "ping", schema: z.object({ ok: z.boolean() }) });
    expect(out.value.ok).toBe(true);
    expect(sink.calls.some((c) => c.status === "ok" && (c.tokensIn ?? 0) > 0)).toBe(true);
  });
});
