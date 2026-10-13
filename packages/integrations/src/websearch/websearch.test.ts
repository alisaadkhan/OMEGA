import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";
import { MemoryProviderCallSink } from "../memory-sink";
import { createSearchLimitGuard } from "./guard";
import { createSerperSearch } from "./serper";
import { webSearchFixture } from "./testing";

const logger = createLogger({ level: "silent" });
const openLimit = { begin: async () => () => undefined };

function serper(reply: (body: unknown) => Response, apiKey: string | null = "k") {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const sink = new MemoryProviderCallSink();
  const s = createSerperSearch({
    apiKey,
    limit: openLimit,
    sink,
    logger,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body });
      return reply(body);
    }) as typeof fetch,
  });
  return { s, calls, sink };
}

describe("Serper web search", () => {
  it("sends the query with the country and size, and returns title, link and snippet", async () => {
    const { s, calls, sink } = serper(() => Response.json({ organic: webSearchFixture("serper-instagram.json") }));
    const out = await s.search({ query: "site:instagram.com bridal makeup Lahore", country: "pk", num: 20, hl: "ur", autocorrect: false });
    expect(calls[0]).toMatchObject({ url: "https://google.serper.dev/search", body: { q: "site:instagram.com bridal makeup Lahore", gl: "pk", hl: "ur", num: 20, autocorrect: false } });
    expect(calls[0]?.headers["x-api-key"]).toBe("k");
    expect(out.length).toBeGreaterThan(0);
    expect(Object.keys(out[0] ?? {}).sort()).toEqual(["link", "snippet", "title"]);
    expect(sink.calls).toEqual([expect.objectContaining({ provider: "serper", operation: "web_search", status: "ok", costUsd: 0.001 })]);
  });

  it("caps hostile text and ignores malformed rows", async () => {
    const { s } = serper(() => Response.json({ organic: [{ title: "t".repeat(900), link: "https://instagram.com/a", snippet: "s".repeat(900) }, { nonsense: true }, "x"] }));
    const out = await s.search({ query: "q", country: "pk", num: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]?.title.length).toBe(300);
    expect(out[0]?.snippet.length).toBe(500);
  });

  it("explains failures: no key, refused key, out of credits, provider down", async () => {
    await expect(serper(() => Response.json({}), null).s.search({ query: "q", country: "pk", num: 10 })).rejects.toMatchObject({ reason: "not_configured", retryable: false });
    await expect(serper(() => new Response("nope", { status: 403 })).s.search({ query: "q", country: "pk", num: 10 })).rejects.toMatchObject({ reason: "not_configured" });
    await expect(serper(() => new Response('{"message":"Not enough credits"}', { status: 400 })).s.search({ query: "q", country: "pk", num: 10 })).rejects.toMatchObject({ reason: "quota", retryable: false });
    await expect(serper(() => new Response("down", { status: 503 })).s.search({ query: "q", country: "pk", num: 10 })).rejects.toMatchObject({ reason: "provider", retryable: true });
  });

  it("stops at the monthly search limit, counting searches in progress", async () => {
    const guard = createSearchLimitGuard({ limit: 3, now: () => new Date("2026-10-09T12:00:00Z"), countSince: async (since) => (since.toISOString() === "2026-10-01T00:00:00.000Z" ? 2 : -1) });
    const first = await guard.begin();
    await expect(guard.begin()).rejects.toMatchObject({ reason: "spend_cap", retryable: false });
    first();
    await expect(guard.begin()).resolves.toBeTypeOf("function");
  });
});
