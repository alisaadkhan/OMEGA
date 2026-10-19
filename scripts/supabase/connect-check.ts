/**
 * Staged, read-only proof that the repo-root `.env` reaches one hosted Supabase project (mandate Phase 1.4). Each stage
 * is reported on its own so a DNS failure is never confused with a credential or configuration failure. Prints
 * project refs, statuses and counts only, never secret values. Database sessions are READ ONLY transactions.
 *
 *   node --env-file=.env --import tsx scripts/supabase/connect-check.ts
 *   CHECK_ACCESS_TOKEN=<a token from a real sign-in> node --env-file=.env --import tsx scripts/supabase/connect-check.ts
 *
 * Stages: config validation (API and worker) → DNS → Auth HTTPS with the public key → JWKS → database through
 * DATABASE_URL and DIRECT_URL with TLS verification → migration ledger versus packages/db/migrations → token checks
 * against the live JWKS (tokens we sign ourselves, wrong issuer, expired: all refused; CHECK_ACCESS_TOKEN accepted).
 */
import { lookup } from "node:dns/promises";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPair, SignJWT } from "jose";
import postgres from "postgres";
import { ConfigError, loadApiConfig, loadWorkerConfig, readCaFile } from "@mushin/core";
import { tlsOptions } from "@mushin/db";
import { createCustomerTokenVerifier, remoteJwks } from "../../apps/api/src/auth/customer-token";

type Result = "PASS" | "FAIL" | "BLOCKED";
const results: { stage: string; result: Result; detail: string }[] = [];
const record = (stage: string, result: Result, detail: string) => {
  results.push({ stage, result, detail });
  console.log(`${result.padEnd(7)} ${stage}: ${detail}`);
};
const redact = (s: string) => s.replace(/[a-z0-9]{20}(?=\.supabase\.co|\b)/g, (m) => (m === ref ? "<ref>" : m)).replace(/postgres(ql)?:\/\/[^\s]+/g, "<url>");
const env = process.env as Record<string, string | undefined>;
const ref = /^([a-z0-9]{20})\.supabase\.co$/.exec(new URL(env.SUPABASE_URL ?? "https://x").hostname)?.[1] ?? "";
const origin = env.SUPABASE_URL ? new URL(env.SUPABASE_URL).origin : "";

console.log(`project: ${ref || "(SUPABASE_URL is not a hosted project url)"}`);

for (const [name, load] of [["API config", () => loadApiConfig(env)], ["worker config", () => loadWorkerConfig(env)]] as const) {
  try {
    load();
    record(name, "PASS", "valid");
  } catch (err) {
    record(name, "FAIL", err instanceof ConfigError ? err.message.split("\n").slice(0, 4).join("; ") : String(err));
  }
}

const hosts = new Set<string>();
for (const k of ["SUPABASE_URL", "JWKS_URI", "DATABASE_URL", "DIRECT_URL"]) if (env[k]) hosts.add(new URL(env[k] ?? "").hostname);
for (const h of hosts) {
  try {
    const a = await lookup(h, { all: true });
    record(`DNS ${h.replace(ref, "<ref>")}`, "PASS", a.map((x) => `IPv${x.family}`).join(","));
  } catch (err) {
    record(`DNS ${h.replace(ref, "<ref>")}`, "FAIL", (err as NodeJS.ErrnoException).code ?? "error");
  }
}

const publicKey = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY;
try {
  const res = await fetch(`${origin}/auth/v1/settings`, { headers: { apikey: publicKey ?? "" }, signal: AbortSignal.timeout(10_000) });
  record("Auth HTTPS (public key)", res.ok ? "PASS" : "FAIL", res.ok ? "settings 200: key belongs to this project" : `status ${res.status}`);
} catch (err) {
  record("Auth HTTPS (public key)", "FAIL", (err as { cause?: { code?: string } }).cause?.code ?? String(err));
}

try {
  const res = await fetch(env.JWKS_URI ?? "", { signal: AbortSignal.timeout(10_000) });
  const body = (await res.json()) as { keys?: { alg?: string }[] };
  const algs = [...new Set((body.keys ?? []).map((k) => k.alg))].join(",");
  record("JWKS", res.ok && (body.keys?.length ?? 0) > 0 ? "PASS" : "FAIL", `${res.status}, ${body.keys?.length ?? 0} key(s), ${algs || "no alg"}`);
} catch (err) {
  record("JWKS", "FAIL", String(err));
}

const files = readdirSync(join(resolve(fileURLToPath(new URL("../..", import.meta.url))), "packages", "db", "migrations")).filter((f) => f.endsWith(".sql"));
const caPem = readCaFile(env.DATABASE_SSL_CA_FILE);
for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
  const url = env[name];
  if (!url) {
    record(`database ${name}`, "FAIL", "unset");
    continue;
  }
  const sql = postgres(url, { max: 1, prepare: false, ssl: tlsOptions(caPem, url), connect_timeout: 15, onnotice: () => {} });
  try {
    const out = await sql.begin("read only", async (tx) => {
      const [s] = await tx<{ v: string; ro: string }[]>`select current_setting('server_version') v, current_setting('transaction_read_only') ro`;
      const [l] = await tx<{ ok: boolean }[]>`select to_regclass('platform.schema_migrations') is not null ok`;
      const applied = l?.ok ? (await tx<{ name: string }[]>`select name from platform.schema_migrations`).map((r) => r.name) : [];
      return { version: s?.v, ro: s?.ro, applied };
    });
    record(`database ${name}`, out.ro === "on" ? "PASS" : "FAIL", `PostgreSQL ${out.version}, TLS ${caPem ? "verified" : "NOT verified (no CA file)"}, read-only=${out.ro}`);
    if (name === "DATABASE_URL") {
      const missing = files.filter((f) => !out.applied.includes(f));
      const unknown = out.applied.filter((f) => !files.includes(f));
      record("migrations", missing.length === 0 && unknown.length === 0 ? "PASS" : "FAIL", `${out.applied.length} applied of ${files.length} in the repo${missing.length ? `; missing ${missing[0]} … ${missing.at(-1)}` : ""}${unknown.length ? `; not in repo: ${unknown.join(",")}` : ""}`);
    }
  } catch (err) {
    record(`database ${name}`, "FAIL", redact(String((err as Error).message ?? err)).slice(0, 160));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (env.JWKS_URI && env.JWT_ISSUER) {
  const audience = env.JWT_AUDIENCE ?? "authenticated";
  const verify = createCustomerTokenVerifier({ issuer: env.JWT_ISSUER, audience, keys: remoteJwks(env.JWKS_URI) });
  // A key of our own, presented under the project's real key id so the verifier must reject it on the signature.
  const { privateKey } = await generateKeyPair("ES256");
  const jwks = (await (await fetch(env.JWKS_URI, { signal: AbortSignal.timeout(10_000) })).json()) as { keys?: { kid?: string }[] };
  const kid = jwks.keys?.[0]?.kid;
  const forge = (o: { iss?: string; exp?: number }) =>
    new SignJWT({ email: "check@example.com" }).setProtectedHeader({ alg: "ES256", ...(kid ? { kid } : {}) }).setSubject("00000000-0000-4000-8000-000000000000")
      .setIssuer(o.iss ?? env.JWT_ISSUER ?? "").setAudience(audience).setIssuedAt().setExpirationTime(o.exp ?? "5m").sign(privateKey);
  const cases: [string, Promise<string>][] = [
    ["self-signed token with the right issuer", forge({})],
    ["wrong-project issuer", forge({ iss: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co/auth/v1" })],
    ["expired token", forge({ exp: Math.floor(Date.now() / 1000) - 60 })],
    ["malformed token", Promise.resolve("not.a.jwt")],
  ];
  for (const [label, token] of cases) {
    try {
      await verify(await token);
      record(`token refused: ${label}`, "FAIL", "was ACCEPTED");
    } catch {
      record(`token refused: ${label}`, "PASS", "refused");
    }
  }
  if (env.CHECK_ACCESS_TOKEN) {
    try {
      const who = await verify(env.CHECK_ACCESS_TOKEN);
      record("genuine token accepted", "PASS", `user ${who.userId.slice(0, 8)}…`);
    } catch {
      record("genuine token accepted", "FAIL", "a real Supabase token was refused");
    }
  } else record("genuine token accepted", "BLOCKED", "set CHECK_ACCESS_TOKEN to a token from a real sign-in on this project");
}

const failed = results.filter((r) => r.result === "FAIL").length;
console.log(`\n${results.length} stages: ${results.filter((r) => r.result === "PASS").length} PASS, ${failed} FAIL, ${results.filter((r) => r.result === "BLOCKED").length} BLOCKED`);
process.exitCode = failed ? 1 : 0;
