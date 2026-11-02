import { Writable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createLogger } from "@mushin/core";

/** Captures what the API logger writes for one injected request. */
async function logLinesFor(path: string): Promise<Record<string, unknown>[]> {
  const lines: string[] = [];
  const sink = new Writable({ write: (chunk: Buffer, _enc, done) => (lines.push(chunk.toString()), done()) });
  const app = Fastify({ loggerInstance: createLogger({ level: "info" }, sink) });
  app.get("/v1/ping", async () => ({ ok: true }));
  await app.inject({ method: "GET", url: path, remoteAddress: "203.0.113.57", headers: { authorization: "Bearer abc.def.ghi" } });
  await app.close();
  return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("request logs (personal data audit 2026-10-28)", () => {
  it("never write the full client IP, the remote port or the authorization header", async () => {
    const text = JSON.stringify(await logLinesFor("/v1/ping"));
    expect(text).not.toContain("203.0.113.57");
    expect(text).not.toContain("remotePort");
    expect(text).not.toContain("abc.def.ghi");
    expect(text).toContain("203.0.113.0");
  });
});
