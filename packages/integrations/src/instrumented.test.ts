import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { errorCodeOf, instrumented } from "./instrumented";
import { MemoryProviderCallSink } from "./memory-sink";

const logger = createLogger({ level: "silent" });
const noSleep = async () => {};

describe("instrumented", () => {
  it("records a successful call with usage and context", async () => {
    const sink = new MemoryProviderCallSink();
    const result = await instrumented(
      {
        provider: "groq",
        operation: "chat",
        timeoutMs: 1000,
        retries: 0,
        sink,
        logger,
        ctx: { workspaceId: "w1", requestId: "r1" },
        usage: () => ({ model: "llama", tokensIn: 10, tokensOut: 5, costUsd: 0.0001 }),
      },
      async () => "hi",
    );
    expect(result).toBe("hi");
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]).toMatchObject({
      provider: "groq",
      operation: "chat",
      model: "llama",
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.0001,
      status: "ok",
      errorCode: null,
      workspaceId: "w1",
      requestId: "r1",
      jobId: null,
    });
  });

  it("retries retryable failures, records every attempt, then succeeds", async () => {
    const sink = new MemoryProviderCallSink();
    let attempts = 0;
    const result = await instrumented(
      { provider: "serper", operation: "search", timeoutMs: 1000, retries: 2, sink, logger, sleep: noSleep },
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("503");
        return 42;
      },
    );
    expect(result).toBe(42);
    expect(sink.calls.map((c) => c.status)).toEqual(["error", "error", "ok"]);
  });

  it("times out, stops after the retry budget and throws PROVIDER_UNAVAILABLE", async () => {
    const sink = new MemoryProviderCallSink();
    const run = instrumented(
      { provider: "apify", operation: "run", timeoutMs: 20, retries: 1, sink, logger, sleep: noSleep },
      (signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    );
    await expect(run).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(sink.calls).toHaveLength(2);
    expect(sink.calls.every((c) => c.status === "error" && c.errorCode === "timeout")).toBe(true);
  });

  it("does not retry non-retryable errors", async () => {
    const sink = new MemoryProviderCallSink();
    await expect(
      instrumented(
        { provider: "x", operation: "y", timeoutMs: 1000, retries: 3, sink, logger, sleep: noSleep, isRetryable: () => false },
        async () => {
          throw new Error("400 bad request");
        },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(sink.calls).toHaveLength(1);
  });

  it("enforces the timeout even when the call ignores the abort signal", async () => {
    const sink = new MemoryProviderCallSink();
    const run = instrumented(
      { provider: "sdk", operation: "slow", timeoutMs: 20, retries: 0, sink, logger, sleep: noSleep },
      () => new Promise(() => {}),
    );
    await expect(run).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(sink.calls[0]).toMatchObject({ status: "error", errorCode: "timeout" });
  });

  it("does not repeat a successful (paid) call when usage extraction throws", async () => {
    const sink = new MemoryProviderCallSink();
    let calls = 0;
    const result = await instrumented(
      {
        provider: "groq",
        operation: "chat",
        timeoutMs: 1000,
        retries: 2,
        sink,
        logger,
        sleep: noSleep,
        usage: () => {
          throw new Error("unexpected response shape");
        },
      },
      async () => {
        calls += 1;
        return "answer";
      },
    );
    expect(result).toBe("answer");
    expect(calls).toBe(1);
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]).toMatchObject({ status: "ok", costUsd: 0 });
  });

  it("never fails the call because the sink failed", async () => {
    const broken = { record: async () => Promise.reject(new Error("db down")) };
    await expect(
      instrumented({ provider: "x", operation: "y", timeoutMs: 1000, retries: 0, sink: broken, logger }, async () => "ok"),
    ).resolves.toBe("ok");
  });
});

describe("provider failure codes", () => {
  it("records the HTTP status or adapter reason, never the message", () => {
    expect(errorCodeOf(Object.assign(new Error("LLM provider answered 429 (rate_limit_exceeded)"), { status: 429 }))).toBe("http_429");
    expect(errorCodeOf(Object.assign(new Error("Serper refused the key"), { reason: "not_configured" }))).toBe("not_configured");
    expect(errorCodeOf(Object.assign(new Error("secret prompt text"), { reason: "Some Prompt Text" }))).toBe("error");
    expect(errorCodeOf(new Error("boom"))).toBe("error");
    expect(errorCodeOf("boom")).toBe("error");
  });
});
