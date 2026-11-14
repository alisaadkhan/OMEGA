import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLogger, type LlmProviderConfig } from "@mushin/core";
import { MemoryProviderCallSink } from "../memory-sink";
import { MockLlm } from "./mock";
import { OpenAiCompatibleLlm } from "./openai-compatible";

const gemini: LlmProviderConfig = { name: "gemini", baseUrl: "https://gemini.test/v1beta/openai", apiKey: "secret-gemini-key", model: "gemini-test-model", priceInPerMTok: 0.1, priceOutPerMTok: 0.4 };
const ollama: LlmProviderConfig = { name: "ollama", baseUrl: "https://ollama.test/v1", apiKey: "o", model: "gpt-oss:20b", priceInPerMTok: 0, priceOutPerMTok: 0 };
const schema = z.object({ ok: z.boolean() });
const reply = (content: string, status = 200) =>
  status === 200 ? Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }) : new Response("boom", { status });

function llm(providers: LlmProviderConfig[], respond: (url: string, body: Record<string, unknown>) => Response) {
  const sink = new MemoryProviderCallSink();
  const bodies: { url: string; body: Record<string, unknown> }[] = [];
  const fetchFake = async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push({ url: String(input), body });
    return respond(String(input), body);
  };
  const client = new OpenAiCompatibleLlm({ providers, sink, logger: createLogger({ level: "silent" }), fetch: fetchFake as typeof fetch, sleep: async () => {} });
  return { client, sink, bodies };
}

describe("OpenAiCompatibleLlm", () => {
  it("asks for JSON with enough tokens for a reasoning model and records the cost", async () => {
    const { client, sink, bodies } = llm([gemini], () => reply('{"ok":true}'));
    const out = await client.complete({ feature: "search_interpret", system: "s", input: "i", schema, ctx: { workspaceId: "w" } });
    expect(out).toEqual({ value: { ok: true }, model: "gemini:gemini-test-model" });
    expect(bodies[0]).toMatchObject({ url: "https://gemini.test/v1beta/openai/chat/completions", body: { model: "gemini-test-model", response_format: { type: "json_object" }, max_tokens: 1024 } });
    expect(sink.calls).toEqual([expect.objectContaining({ provider: "gemini", operation: "search_interpret", tokensIn: 1000, tokensOut: 500, costUsd: 0.0003, status: "ok", workspaceId: "w" })]);
  });

  it("corrects one invalid reply, then gives up with PROVIDER_UNAVAILABLE", async () => {
    let n = 0;
    const fixed = llm([gemini], () => reply(++n === 1 ? "not json" : '{"ok":true}'));
    expect((await fixed.client.complete({ feature: "creator_summary", system: "s", input: "i", schema })).value).toEqual({ ok: true });
    expect(fixed.bodies[1]?.body["messages"]).toHaveLength(4);
    const broken = llm([gemini, ollama], () => reply('{"ok":"yes"}'));
    await expect(broken.client.complete({ feature: "creator_summary", system: "s", input: "i", schema })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(broken.bodies.every((b) => b.url.startsWith("https://gemini.test"))).toBe(true);
  });

  it("falls back to Ollama Cloud when Gemini fails, and fails cleanly when both do", async () => {
    const { client, sink } = llm([gemini, ollama], (url) => (url.startsWith("https://gemini.test") ? reply("", 503) : reply('{"ok":false}')));
    expect(await client.complete({ feature: "search_interpret", system: "s", input: "i", schema })).toEqual({ value: { ok: false }, model: "ollama:gpt-oss:20b" });
    expect(sink.calls.map((c) => [c.provider, c.status])).toEqual([
      ["gemini", "error"],
      ["gemini", "error"],
      ["ollama", "ok"],
    ]);
    const down = llm([gemini, ollama], () => reply("", 503));
    await expect(down.client.complete({ feature: "search_interpret", system: "s", input: "i", schema })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  // Measured 2026-10-13 on the earlier provider: every call answered 429 for hours, adding a retry before each fallback.
  it("on a 429 moves to the next model at once, pauses that model 15 s, then tries it again", async () => {
    let clock = 0;
    const sink = new MemoryProviderCallSink();
    const urls: string[] = [];
    const fetchFake = async (input: string | URL | Request) => {
      urls.push(String(input));
      return String(input).startsWith("https://gemini.test") ? reply("", 429) : reply('{"ok":true}');
    };
    const client = new OpenAiCompatibleLlm({ providers: [gemini, ollama], sink, logger: createLogger({ level: "silent" }), fetch: fetchFake as typeof fetch, sleep: async () => {}, now: () => clock });
    const ask = () => client.complete({ feature: "creator_assessment", system: "s", input: "i", schema });
    expect((await ask()).model).toBe("ollama:gpt-oss:20b");
    expect(urls.filter((u) => u.startsWith("https://gemini.test"))).toHaveLength(1); // no same-model retry when another model can answer
    clock = 10_000;
    expect((await ask()).model).toBe("ollama:gpt-oss:20b");
    expect(urls.filter((u) => u.startsWith("https://gemini.test"))).toHaveLength(1);
    clock = 16_000;
    await ask();
    expect(urls.filter((u) => u.startsWith("https://gemini.test"))).toHaveLength(2);
    // The only provider is never skipped.
    const solo = llm([gemini], () => reply("", 429));
    await expect(solo.client.complete({ feature: "search_interpret", system: "s", input: "i", schema })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await expect(solo.client.complete({ feature: "search_interpret", system: "s", input: "i", schema })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(solo.bodies).toHaveLength(4);
  });

  it("pauses a provider after 503 too, honours Retry-After, doubles the pause on repeats and resets it after a success", async () => {
    let clock = 0;
    let geminiDown = true;
    const urls: string[] = [];
    const fetchFake = async (input: string | URL | Request) => {
      urls.push(String(input));
      if (!String(input).startsWith("https://gemini.test")) return reply('{"ok":true}');
      return geminiDown ? new Response("busy", { status: 503, headers: { "retry-after": "300" } }) : reply('{"ok":true}');
    };
    const client = new OpenAiCompatibleLlm({ providers: [gemini, ollama], sink: new MemoryProviderCallSink(), logger: createLogger({ level: "silent" }), fetch: fetchFake as typeof fetch, sleep: async () => {}, now: () => clock });
    const ask = () => client.complete({ feature: "creator_assessment", system: "s", input: "i", schema });
    const geminiCalls = () => urls.filter((u) => u.startsWith("https://gemini.test")).length;
    await ask();
    expect(geminiCalls()).toBe(2);
    clock = 200_000; // within the 300 s the provider asked for
    await ask();
    expect(geminiCalls()).toBe(2);
    clock = 301_000;
    await ask(); // second strike: 2 min backoff, but Retry-After 300 s still wins
    expect(geminiCalls()).toBe(4);
    clock = 602_000;
    geminiDown = false;
    expect((await ask()).model).toBe("gemini:gemini-test-model");
    geminiDown = true;
    await ask(); // strikes were reset: one strike again, paused for the 300 s asked
    expect(geminiCalls()).toBe(7);
    clock = 860_000;
    await ask();
    expect(geminiCalls()).toBe(7);
    clock = 903_000;
    await ask();
    expect(geminiCalls()).toBe(9);
  });

  it("cools down per model: a 429 on Groq 120b moves to Groq 20b on the same key; Groq's reset header sets the pause; a removed model is skipped for good", async () => {
    let clock = 0;
    const g120: LlmProviderConfig = { name: "groq", baseUrl: "https://groq.test/v1", apiKey: "k", model: "openai/gpt-oss-120b", priceInPerMTok: 0, priceOutPerMTok: 0 };
    const g20 = { ...g120, model: "openai/gpt-oss-20b" };
    const llama = { ...g120, model: "llama-3.3-70b-versatile" };
    const models: string[] = [];
    let limited = true;
    const fetchFake = async (_input: string | URL | Request, init?: RequestInit) => {
      const model = String((JSON.parse(String(init?.body)) as { model: string }).model);
      models.push(model);
      if (model === "openai/gpt-oss-120b" && limited) return new Response('{"error":{"code":"rate_limit_exceeded"}}', { status: 429, headers: { "x-ratelimit-reset-tokens": "7.66s" } });
      if (model === "openai/gpt-oss-20b") return new Response('{"error":{"code":"model_decommissioned"}}', { status: 400 });
      return reply('{"ok":true}');
    };
    const client = new OpenAiCompatibleLlm({ providers: [g120, g20, llama], sink: new MemoryProviderCallSink(), logger: createLogger({ level: "silent" }), fetch: fetchFake as typeof fetch, sleep: async () => {}, now: () => clock });
    const ask = () => client.complete({ feature: "creator_assessment", system: "s", input: "i", schema });
    expect((await ask()).model).toBe("groq:llama-3.3-70b-versatile");
    expect(models).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"]);
    clock = 5_000; // inside the 7.66 s Groq asked for: 120b skipped; 20b is gone for good
    await ask();
    expect(models.slice(3)).toEqual(["llama-3.3-70b-versatile"]);
    clock = 9_000;
    limited = false;
    expect((await ask()).model).toBe("groq:openai/gpt-oss-120b");
    expect(models.filter((m) => m === "openai/gpt-oss-20b")).toHaveLength(1);
  });

  it("reads Groq's reset durations", async () => {
    const { resetSeconds } = await import("./openai-compatible");
    expect([resetSeconds("7.66s"), resetSeconds("2m59.56s"), resetSeconds("120ms"), resetSeconds("1h2m3s"), resetSeconds("soon")]).toEqual([7.66, 179.56, 0.12, 3723, null]);
  });

  it("keeps Gemini under its per-minute limit: over it, the next provider answers; alone, it waits for a free slot", async () => {
    let t = 1_000_000;
    const make = (providers: LlmProviderConfig[]) => {
      const urls: string[] = [];
      const slept: number[] = [];
      const fetchFake = async (input: string | URL | Request) => (urls.push(String(input)), reply('{"ok":true}'));
      const client = new OpenAiCompatibleLlm({ providers, sink: new MemoryProviderCallSink(), logger: createLogger({ level: "silent" }), fetch: fetchFake as typeof fetch, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
      return { client, urls, slept };
    };
    const limited = { ...gemini, requestsPerMinute: 2 };
    const ask = (c: OpenAiCompatibleLlm) => c.complete({ feature: "creator_assessment", system: "s", input: "i", schema });
    const both = make([limited, ollama]);
    for (let i = 0; i < 3; i++) await ask(both.client);
    expect(both.urls.map((u) => (u.includes("gemini") ? "gemini" : "ollama"))).toEqual(["gemini", "gemini", "ollama"]);
    t += 60_001; // a minute later Gemini has room again
    await ask(both.client);
    expect(both.urls.at(-1)).toContain("gemini");
    const solo = make([limited]);
    for (let i = 0; i < 3; i++) await ask(solo.client);
    expect(solo.urls).toHaveLength(3);
    expect(solo.slept).toHaveLength(1); // the third waited for a slot instead of sending a call that would be refused
  });

  it("retries a rate-limited 429 once and records both provider attempts", async () => {
    let attempts = 0;
    const { client, bodies, sink } = llm([gemini], () => (++attempts === 1 ? reply("", 429) : reply('{"ok":true}')));
    expect((await client.complete({ feature: "search_interpret", system: "s", input: "i", schema })).value).toEqual({ ok: true });
    expect(bodies).toHaveLength(2);
    expect(sink.calls.map((call) => call.status)).toEqual(["error", "ok"]);
  });
  it("does not retry a request Gemini rejects as invalid (4xx), and fails when nothing is configured", async () => {
    const { client, bodies } = llm([gemini], () => reply("", 400));
    await expect(client.complete({ feature: "search_interpret", system: "s", input: "i", schema })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(bodies).toHaveLength(1);
    const none = llm([], () => reply('{"ok":true}'));
    await expect(none.client.complete({ feature: "search_interpret", system: "s", input: "i", schema })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});

describe("OpenAiCompatibleLlm with Gemini as the main provider", () => {
  it("calls Gemini's OpenAI-compatible chat endpoint with the key as a bearer token", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchFake = async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
      return reply('{"ok":true}');
    };
    const client = new OpenAiCompatibleLlm({ providers: [gemini], sink: new MemoryProviderCallSink(), logger: createLogger({ level: "silent" }), fetch: fetchFake as typeof fetch, sleep: async () => {} });
    await client.complete({ feature: "creator_assessment", system: "s", input: "i", schema });
    expect(seen).toEqual([{ url: "https://gemini.test/v1beta/openai/chat/completions", auth: "Bearer secret-gemini-key" }]);
  });

  it("falls back to Ollama when Gemini times out", async () => {
    const sink = new MemoryProviderCallSink();
    const fetchFake = async (input: string | URL | Request) => {
      if (String(input).startsWith("https://gemini.test")) throw new DOMException("The operation timed out.", "TimeoutError");
      return reply('{"ok":true}');
    };
    const client = new OpenAiCompatibleLlm({ providers: [gemini, ollama], sink, logger: createLogger({ level: "silent" }), fetch: fetchFake as typeof fetch, sleep: async () => {} });
    expect((await client.complete({ feature: "creator_assessment", system: "s", input: "i", schema })).model).toBe("ollama:gpt-oss:20b");
    expect(sink.calls.at(-1)).toMatchObject({ provider: "ollama", status: "ok" });
    expect(sink.calls.filter((c) => c.provider === "gemini").every((c) => c.status === "error")).toBe(true);
  });

  it("never accepts syntactically valid JSON that breaks the schema, and keeps the key out of errors", async () => {
    const { client } = llm([gemini], () => reply('{"ok":"true"}'));
    const err = await client.complete({ feature: "creator_assessment", system: "s", input: "i", schema }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    const messages: string[] = [];
    for (let e: unknown = err; e instanceof Error; e = e.cause) messages.push(e.message);
    expect(messages.join(" | ")).not.toContain("secret-gemini-key");
  });
});

describe("OpenAiCompatibleLlm error details", () => {
  it("keeps the provider's error code but not its response body, which can echo the user's input", async () => {
    const body = JSON.stringify({ error: { message: "Failed to validate JSON", type: "invalid_request_error", code: "json_validate_failed", failed_generation: "bridal makeup Lahore for Ayesha 0300-1234567" } });
    const { client } = llm([gemini], () => new Response(body, { status: 400 }));
    const err = await client.complete({ feature: "search_interpret", system: "s", input: "i", schema }).catch((e: unknown) => e);
    const messages: string[] = [];
    for (let e: unknown = err; e instanceof Error; e = e.cause) messages.push(e.message);
    expect(messages.join(" | ")).toContain("json_validate_failed");
    expect(messages.join(" | ")).not.toContain("0300-1234567");
  });
});

describe("MockLlm", () => {
  it("records calls and validates replies like the real adapter", async () => {
    const mock = new MockLlm(() => ({ ok: true }));
    expect(await mock.complete({ feature: "search_interpret", system: "s", input: "i", schema })).toEqual({ value: { ok: true }, model: "mock" });
    expect(mock.calls).toHaveLength(1);
    await expect(new MockLlm(() => ({ ok: 1 })).complete({ feature: "search_interpret", system: "s", input: "i", schema })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});
