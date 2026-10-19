import { describe as group, expect, it } from "vitest";
import { alignEnv, describe, parseEnv } from "./align-env";

const A = "aaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbb";
const sample = [
  "# comment kept",
  `SUPABASE_URL=https://${A}.supabase.co`,
  "SUPABASE_ANON_KEY=anon-of-a",
  `VITE_SUPABASE_URL=https://${B}.supabase.co`,
  "VITE_SUPABASE_PUBLISHABLE_KEY=publishable-of-b",
  `JWT_ISSUER=https://${B}.supabase.co/auth/v1`,
  `JWKS_URI=https://${B}.supabase.co/auth/v1/.well-known/jwks.json`,
  `DATABASE_URL=postgresql://postgres:p%40ss@db.${A}.supabase.co:5432/postgres`,
  "OTHER=unchanged",
].join("\n");

group("align-env (ARCH-07 / ENV-01)", () => {
  it("points the frontend URL, issuer and JWKS at the SUPABASE_URL project and keeps everything else", () => {
    const { text, changes } = alignEnv(sample, {});
    const env = parseEnv(text);
    expect(env.get("VITE_SUPABASE_URL")).toBe(`https://${A}.supabase.co`);
    expect(env.get("JWT_ISSUER")).toBe(`https://${A}.supabase.co/auth/v1`);
    expect(env.get("JWKS_URI")).toBe(`https://${A}.supabase.co/auth/v1/.well-known/jwks.json`);
    expect(env.get("VITE_SUPABASE_PUBLISHABLE_KEY")).toBe("publishable-of-b");
    expect(env.get("OTHER")).toBe("unchanged");
    expect(text.startsWith("# comment kept\n")).toBe(true);
    expect(changes.map((c) => c.name)).toEqual(["VITE_SUPABASE_URL", "JWT_ISSUER", "JWKS_URI"]);
    expect(alignEnv(text, {}).changes).toEqual([]);
  });

  it("uses the anon key as the public key only when asked (the target project refused the current one)", () => {
    expect(parseEnv(alignEnv(sample, { publishableFromAnon: true }).text).get("VITE_SUPABASE_PUBLISHABLE_KEY")).toBe("anon-of-a");
  });

  it("moves a direct IPv6-only database URL to the poolers, keeping the password", () => {
    const { text } = alignEnv(sample, { poolerHost: "aws-1-ap-northeast-2.pooler.supabase.com" });
    const env = parseEnv(text);
    const db = new URL(env.get("DATABASE_URL") ?? "");
    const direct = new URL(env.get("DIRECT_URL") ?? "");
    expect([db.username, db.hostname, db.port, db.password]).toEqual([`postgres.${A}`, "aws-1-ap-northeast-2.pooler.supabase.com", "6543", "p%40ss"]);
    expect([direct.username, direct.port]).toEqual([`postgres.${A}`, "5432"]);
    expect(() => alignEnv(sample, { poolerHost: "evil.example.com" })).toThrow();
  });

  it("never describes a value by its secret parts", () => {
    const shown = [describe(`postgresql://postgres.${A}:secret@aws-1-x.pooler.supabase.com:6543/postgres`), describe("sb_secret_abc"), describe(`https://${A}.supabase.co`)];
    expect(shown).toEqual([`pooler:6543 ${A}`, "(key)", A]);
    expect(shown.join(" ")).not.toContain("secret");
  });
});
