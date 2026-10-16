import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { committedFiles, looksLikeRealSecret, scanSourceFile } from "./package-source";

/** Audit SEC-01: the packaging script refuses secrets and can only ever include committed files. */
const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
// Fake values assembled at runtime, so this file itself never looks like it holds a secret.
const token = ["k9Qm2", "Xr7Lp", "4Vw8T", "z1Bn6", "Hc3Jd"].join("");
const kinds = (path: string, text: string) => scanSourceFile(path, text).map((f) => f.kind);

describe("source packaging secret scan", () => {
  it("flags real-looking values, key formats and forbidden paths", () => {
    expect(kinds("docs/x.md", `STAFF_JWT_SECRET=${token}${token}`)).toContain("assigned_value:STAFF_JWT_SECRET");
    expect(kinds("docs/x.md", `DATABASE_URL=postgres://postgres:${token}@db.abcdefgh.supabase.co:5432/postgres`)).toContain("assigned_value:DATABASE_URL");
    expect(kinds("docs/x.md", `token: ${"apify_api_"}${token}`)).toContain("apify_token");
    expect(kinds("docs/x.md", `${"-----BEGIN "}PRIVATE KEY-----`)).toContain("private_key");
    for (const p of [".env", "apps/api/.env.local", "supabase/.temp/start-secrets/x/env/docker.env", "certs/server.pem", "eval-data/packets/a.csv"]) {
      expect(kinds(p, ""), p).toContain("forbidden_path");
    }
    expect(kinds(".env.example", "")).not.toContain("forbidden_path");
  });

  it("passes placeholders, local URLs, variable references and code", () => {
    for (const [name, value] of [
      ["STAFF_JWT_SECRET", "replace-me"],
      ["STAFF_JWT_SECRET", "ci-only-staff-secret-not-a-secret-value"],
      ["DATABASE_URL", "postgres://postgres@localhost:54330/mushin_test"],
      ["DATABASE_URL", "postgres://postgres:postgres@localhost:54322/postgres"],
      ["APIFY_TOKEN", "${{ secrets.APIFY_TOKEN }}"],
      ["APIFY_TOKEN", "z.string().min(1).optional(),"],
      ["DATA_ENCRYPTION_KEY", "<32 random bytes, base64>"],
    ] as const) {
      expect(looksLikeRealSecret(name, value), `${name}=${value}`).toBe(false);
    }
  });

  it("finds nothing in the committed tree at HEAD", () => {
    expect(committedFiles(repo).flatMap((f) => scanSourceFile(f.path, f.text))).toEqual([]);
  });

  it("archives only committed files: ignored ones such as .env can never be included", () => {
    const dir = mkdtempSync(join(tmpdir(), "mushin-pkg-"));
    try {
      const out = join(dir, "src.zip");
      execFileSync("git", ["archive", "--format=zip", "-o", out, "HEAD"], { cwd: repo });
      const listing = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: repo, encoding: "utf8" });
      expect(listing.split("\n").filter((p) => /(^|\/)\.env($|\.(?!example$))|supabase\/\.temp\/|eval-data\//.test(p))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
