import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLogger, type LlmProviderConfig } from "@mushin/core";
import { MemoryProviderCallSink } from "../memory-sink";
import { MockLlm } from "./mock";
import { OpenAiCompatibleLlm } from "./openai-compatible";

const groq: LlmProviderConfig = { name: "groq", baseUrl: "https://groq.test/v1", apiKey: "g", model: "openai/gpt-oss-20b", priceInPerMTok: 0.1, priceOutPerMTok: 0.4 };
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
    const { client, sink, bodies } = llm([groq], () => reply('{"ok":true}'));
    const out = await client.complete({ feature: "search_interpret", system: "s", input: "i", schema, ctx: { workspaceId: "w" } });
    expect(out).toEqual({ value: { ok: true }, model: "groq:openai/gpt-oss-20b" });
    expect(bodies[0]).toMatchObject({ url: "https://groq.test/v1/chat/completions", body: { model: "openai/gpt-oss-20b", response_format: { type: "json_object" }, max_tokens: 1024 } });
    expect(sink.calls).toEqual([expect.objectContaining({ provider: "groq", operation: "search_interpret", tokensIn: 1000, tokensOut: 500, costUsd: 0.0003, status: "ok", workspaceId: "w" })]);
  });

  it("corrects one invalid reply, then gives up with PROVIDER_UNAVAILABLE", async () => {
    let n = 0;
    const fixed = llm([groq], () => reply(++n === 1 ? "not json" : '{"ok":true}'));
    expect((await fixed.client.complete({ feature: "creator_summary", system: "s", input: "i", schema })).value).toEqual({ ok: true });
    expect(fixed.bodies[1]?.body["messages"]).toHaveLength(4);
    const broken = llm([groq, ollama], () => reply('{"ok":"yes"}'));
    await expect(broken.client.complete({ feature: "creator_summary", system: "s", input: "i", schema })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(broken.bodies.every((b) => b.url.startsWith("https://groq.test"))).toBe(true);
  });

  it("falls back to Ollama Cloud when Groq fails, and fails cleanly when both do", async () => {
    const { client, sink } = llm([groq, ollama], (url) => (url.startsWith("https://groq.test") ? reply("", 503) : reply('{"ok":false}')));
    expect(await client.complete({ feature: "search_interpret", system: "s", input: "i", schema })).toEqual({ value: { ok: false }, model: "ollama:gpt-oss:20b" });
    expect(sink.calls.map((c) => [c.provider, c.status])).toEqual([
      ["groq", "error"],
      ["groq", "error"],
      ["ollama", "ok"],
    ]);
    const down = llm([groq, ollama], () => reply("", 503));
    await expect(down.client.complete({ feature: "search_interpret", system: "s", input: "i", schema })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("does not retry a request Groq rejects as invalid (4xx), and fails when nothing is configured", async () => {
    const { client, bodies } = llm([groq], () => reply("", 400));
    await expect(client.complete({ feature: "search_interpret", system: "s", input: "i", schema })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(bodies).toHaveLength(1);
    const none = llm([], () => reply('{"ok":true}'));
    await expect(none.client.complete({ feature: "search_interpret", system: "s", input: "i", schema })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
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
