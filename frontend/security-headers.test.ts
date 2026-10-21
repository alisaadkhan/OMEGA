import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, headersFile, securityHeaders } from "./security-headers";

describe("static host headers (audit SEC-14)", () => {
  const csp = contentSecurityPolicy("https://abcd.supabase.co/");

  it("allows scripts only from the app itself and never evaluates code", () => {
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|script-src[^;]*https:/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it("talks only to itself (API under /api) and Supabase Auth", () => {
    expect(csp).toContain("connect-src 'self' https://abcd.supabase.co;");
  });

  it("cannot be framed (clickjacking of the staff console)", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(securityHeaders("https://abcd.supabase.co")["X-Frame-Options"]).toBe("DENY");
  });

  it("sets nosniff, HSTS and a referrer policy, caches hashed assets and never the page", () => {
    const file = headersFile("https://abcd.supabase.co");
    expect(file).toMatch(/^\/\*\n {2}Content-Security-Policy: /);
    expect(file).toContain("  X-Content-Type-Options: nosniff");
    expect(file).toContain("  Strict-Transport-Security: max-age=31536000; includeSubDomains");
    expect(file).toContain("  Referrer-Policy: strict-origin-when-cross-origin");
    expect(file).toContain("/assets/*\n  Cache-Control: public, max-age=31536000, immutable");
    expect(file).toContain("/index.html\n  Cache-Control: no-cache");
  });
});

// vercel.json repeats these headers (Vercel ignores dist/_headers); they must not drift apart.
describe("Vercel headers (vercel.json)", () => {
  it("send exactly the app's security headers, Supabase allowed by its project domain", async () => {
    const { readFileSync } = await import("node:fs");
    const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
    const page = vercel.headers.find((h) => h.source === "/((?!api/).*)");
    const sent = Object.fromEntries((page?.headers ?? []).map((h) => [h.key, h.value]));
    const expected = securityHeaders("https://x.supabase.co");
    expected["Content-Security-Policy"] = (expected["Content-Security-Policy"] ?? "").replace("https://x.supabase.co", "https://*.supabase.co");
    expect(sent).toEqual(expected);
  });
});
