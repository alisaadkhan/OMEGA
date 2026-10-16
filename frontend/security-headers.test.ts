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
