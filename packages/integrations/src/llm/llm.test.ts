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
  it("skips a provider that answered 429 for a minute while another is available, then tries it again", async () => {
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
    expect(urls.filter((u) => u.startsWith("https://gemini.test"))).toHaveLength(2);
    clock = 30_000;
    expect((await ask()).model).toBe("ollama:gpt-oss:20b");
    expect(urls.filter((u) => u.startsWith("https://gemini.test"))).toHaveLength(2);
    clock = 61_000;
    await ask();
    expect(urls.filter((u) => u.startsWith("https://gemini.test"))).toHaveLength(4);
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
