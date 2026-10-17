import { describe, expect, it } from "vitest";
import { apiExposure } from "./exposure-check";

const respond = (exposed: string[], paths: string[] = []) =>
  (async (_url: string | URL | Request, init?: RequestInit) => {
    const profile = new Headers(init?.headers).get("accept-profile");
    if (profile) return new Response("{}", { status: exposed.includes(profile) ? 200 : 406 });
    return new Response(JSON.stringify({ paths: Object.fromEntries(["/", ...paths].map((p) => [p, {}])) }), { status: 200 });
  }) as typeof fetch;

describe("Supabase Data API exposure (audit SEC-11)", () => {
  it("passes when no MUSHIN schema is served and nothing is listed to the public key", async () => {
    expect((await apiExposure("http://supabase.test", "anon", respond([]))).problems).toEqual([]);
  });

  it("reports a served schema and any listed path", async () => {
    const out = await apiExposure("http://supabase.test/", "anon", respond(["wp"], ["/rpc/show_trgm"]));
    expect(out.problems).toEqual(["Data API serves schema wp to the public key (200)", "Data API lists 1 path(s) to the public key: /rpc/show_trgm"]);
  });
});
