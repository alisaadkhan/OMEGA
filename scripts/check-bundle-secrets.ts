/**
 * Frontend bundle secret scan (AUTH-002): fails if a built bundle contains anything that must stay on the server.
 *   node --import tsx scripts/check-bundle-secrets.ts [dist-dir]      (default frontend/dist)
 * Checks: names of server-only settings, known secret key formats, JWTs whose role is not anonymous (e.g.
 * service_role), private keys, and published source maps. Prints the finding kind and file, never the matched value.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Server-only settings (packages/core config); a VITE_ name is public by design and never listed here. */
export const SERVER_SETTING_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "DIRECT_URL", "STAFF_JWT_SECRET", "DATA_ENCRYPTION_KEY", "APIFY_TOKEN",
  "SERPER_API_KEY", "YOUTUBE_API_KEY", "GROQ_API_KEY", "OLLAMA_API_KEY", "PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET",
  "MOCK_PADDLE_WEBHOOK_SECRET", "UPSTASH_REDIS_REST_TOKEN", "MEILISEARCH_API_KEY", "MEILISEARCH_MASTER_KEY", "RESEND_API_KEY",
];

const SECRET_FORMATS: [kind: string, re: RegExp][] = [
  ["apify_token", /apify_api_[A-Za-z0-9]{20,}/],
  ["groq_key", /gsk_[A-Za-z0-9]{20,}/],
  ["resend_key", /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/],
  ["paddle_key", /\bpdl_(?:live|sdbx)_apikey_[A-Za-z0-9_]{10,}/],
  ["stripe_like_secret", /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/],
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["supabase_secret_key", /\bsb_secret_[A-Za-z0-9_-]{16,}/],
];

export type Finding = { file: string; kind: string };

/** JWT-shaped strings whose payload role is anything other than the public anonymous role. */
function privilegedJwts(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1] ?? "", "base64url").toString("utf8")) as { role?: unknown };
      if (payload.role !== undefined && payload.role !== "anon") out.push(`jwt_role_${String(payload.role)}`);
    } catch {
      // Not a JWT after all.
    }
  }
  return out;
}

export function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  for (const name of SERVER_SETTING_NAMES) if (text.includes(name)) findings.push({ file, kind: `server_setting_name:${name}` });
  for (const [kind, re] of SECRET_FORMATS) if (re.test(text)) findings.push({ file, kind });
  for (const kind of privilegedJwts(text)) findings.push({ file, kind });
  return findings;
}

export function scanDir(dir: string): Finding[] {
  const findings: Finding[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".map")) findings.push({ file: relative(dir, p), kind: "source_map_published" });
      else if (/\.(js|mjs|css|html|json|txt|svg)$/.test(name)) findings.push(...scanText(relative(dir, p), readFileSync(p, "utf8")));
    }
  };
  walk(dir);
  return findings;
}

if (process.argv[1] && /check-bundle-secrets\.ts$/.test(process.argv[1])) {
  const dir = process.argv[2] ?? "frontend/dist";
  const findings = scanDir(dir);
  if (findings.length) {
    console.error(`Bundle secret scan FAILED (${dir}):\n${findings.map((f) => `  ${f.kind} in ${f.file}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`Bundle secret scan passed: ${dir} holds no server setting names, secret key formats, privileged JWTs or source maps.`);
}
