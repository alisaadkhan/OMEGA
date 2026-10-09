import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./memory";
import { SupabaseStorage } from "./supabase";

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function fake(respond: (c: Call) => Response) {
  const calls: Call[] = [];
  const fetchFake = async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init?.body === "string" ? init.body : init?.body ? new TextDecoder().decode(init.body as Uint8Array) : "";
    const call = { url: String(input), method: init?.method ?? "GET", headers, body };
    calls.push(call);
    return respond(call);
  };
  return { storage: new SupabaseStorage({ url: "https://ref.supabase.co", serviceKey: "k", fetch: fetchFake as typeof fetch }), calls };
}

describe("SupabaseStorage", () => {
  it("creates a bucket once and treats 'already exists' as done", async () => {
    let n = 0;
    const { storage, calls } = fake(() => (++n === 1 ? Response.json({ name: "raw-payloads" }) : Response.json({ statusCode: "409", error: "Duplicate", message: "The resource already exists" }, { status: 400 })));
    await storage.ensureBucket("raw-payloads", { public: false });
    await storage.ensureBucket("raw-payloads", { public: false });
    expect(calls[0]).toMatchObject({ url: "https://ref.supabase.co/storage/v1/bucket", method: "POST" });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ id: "raw-payloads", name: "raw-payloads", public: false });
    expect(calls[0]?.headers["authorization"]).toBe("Bearer k");
  });

  it("uploads with upsert, downloads, removes and builds public URLs", async () => {
    const { storage, calls } = fake((c) => {
      if (c.method === "GET" && c.url.endsWith("/missing.json")) return Response.json({ statusCode: "404", error: "not_found" }, { status: 400 });
      if (c.method === "GET") return new Response("{\"a\":1}");
      return Response.json({});
    });
    await storage.put("raw-payloads", "instagram/2026/10/x.json", "{\"a\":1}", "application/json");
    expect(calls[0]).toMatchObject({ url: "https://ref.supabase.co/storage/v1/object/raw-payloads/instagram/2026/10/x.json", method: "POST" });
    expect(calls[0]?.headers["x-upsert"]).toBe("true");
    expect(new TextDecoder().decode((await storage.get("raw-payloads", "instagram/2026/10/x.json")) ?? new Uint8Array())).toBe("{\"a\":1}");
    expect(await storage.get("raw-payloads", "missing.json")).toBeNull();
    await storage.remove("raw-payloads", ["a.json", "b.json"]);
    expect(calls.at(-1)).toMatchObject({ url: "https://ref.supabase.co/storage/v1/object/raw-payloads", method: "DELETE" });
    expect(JSON.parse(calls.at(-1)?.body ?? "{}")).toEqual({ prefixes: ["a.json", "b.json"] });
    expect(storage.publicUrl("creator-avatars", "instagram/abc.jpg")).toBe("https://ref.supabase.co/storage/v1/object/public/creator-avatars/instagram/abc.jpg");
  });

  it("reports an unreachable or failing storage as PROVIDER_UNAVAILABLE", async () => {
    const { storage } = fake(() => new Response("boom", { status: 503 }));
    await expect(storage.put("raw-payloads", "x.json", "{}", "application/json")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});

describe("MemoryStorage", () => {
  it("round-trips objects and removes them", async () => {
    const s = new MemoryStorage();
    await s.put("b", "k.json", "hi", "application/json");
    expect(new TextDecoder().decode((await s.get("b", "k.json")) ?? new Uint8Array())).toBe("hi");
    await s.remove("b", ["k.json"]);
    expect(await s.get("b", "k.json")).toBeNull();
    expect(s.publicUrl("b", "k.json")).toBe("memory://b/k.json");
  });
});
