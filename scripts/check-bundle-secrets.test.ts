import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanDir, scanText } from "./check-bundle-secrets";

const jwt = (payload: Record<string, unknown>) =>
  `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.c2lnbmF0dXJlLXZhbHVl`;

describe("frontend bundle secret scan (AUTH-002)", () => {
  it("passes public configuration: the anonymous key and VITE_ names", () => {
    expect(scanText("a.js", `const url = "https://abc.supabase.co"; const key = "${jwt({ role: "anon", iss: "supabase" })}"; VITE_SUPABASE_URL`)).toEqual([]);
  });

  it("flags a service-role JWT, server setting names and known secret formats, without echoing the value", () => {
    const kinds = scanText("a.js", `x="${jwt({ role: "service_role" })}"; process.env.STAFF_JWT_SECRET; "apify_api_ABCDEFGHIJKLMNOPQRSTUV"; "gsk_ABCDEFGHIJKLMNOPQRSTUVWX"`).map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(["jwt_role_service_role", "server_setting_name:STAFF_JWT_SECRET", "apify_token", "groq_key"]));
  });

  it("flags published source maps and private keys in a build directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "mushin-dist-"));
    writeFileSync(join(dir, "index.js.map"), "{}");
    writeFileSync(join(dir, "key.txt"), "-----BEGIN PRIVATE KEY-----\nabc");
    expect(scanDir(dir).map((f) => f.kind).sort()).toEqual(["private_key", "source_map_published"]);
  });
});
