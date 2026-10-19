/**
 * Points every Supabase setting in the repo-root `.env` at the one project named by SUPABASE_URL (audit ARCH-07,
 * ENV-01). Prints variable names and project refs only, never values.
 *
 *   node --import tsx scripts/supabase/align-env.ts                       dry run: what would change
 *   node --import tsx scripts/supabase/align-env.ts --pooler-host aws-1-<region>.pooler.supabase.com --write
 *
 * Changes made:
 *   - VITE_SUPABASE_URL, JWT_ISSUER, JWKS_URI → the SUPABASE_URL project (Auth issuer and its signing-key endpoint);
 *   - VITE_SUPABASE_PUBLISHABLE_KEY → SUPABASE_ANON_KEY, when the target project refuses the current public key;
 *   - with --pooler-host, a direct `db.<ref>.supabase.co` DATABASE_URL (IPv6 only, unreachable from IPv4 networks)
 *     becomes the transaction pooler (6543) and DIRECT_URL the session pooler (5432), as the README describes.
 * `--write` first copies `.env` to `.env.bak-<time>` (git-ignored).
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export type Change = { name: string; from: string; to: string };

const projectRef = (url: string | undefined): string | null => {
  try {
    return /^([a-z0-9]{20})\.supabase\.(co|in)$/.exec(new URL(url ?? "").hostname)?.[1] ?? null;
  } catch {
    return null;
  }
};

/** Where a value points, safe to print: a project ref, a pooler port, or a coarse class. */
export function describe(value: string | undefined): string {
  if (!value) return "(unset)";
  if (/^postgres(ql)?:\/\//.test(value)) {
    try {
      const u = new URL(value);
      const ref = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(u.username))?.[1] ?? /^db\.([a-z0-9]{20})\./.exec(u.hostname)?.[1];
      const kind = u.hostname.endsWith(".pooler.supabase.com") ? `pooler:${u.port}` : u.hostname.startsWith("db.") ? "direct" : u.hostname;
      return `${kind}${ref ? ` ${ref}` : ""}`;
    } catch {
      return "(unparsable url)";
    }
  }
  if (/^https?:\/\//.test(value)) return projectRef(value) ?? "(not a Supabase project url)";
  return "(key)";
}

export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m?.[1]) out.set(m[1], (m[2] ?? "").replace(/^(["'])(.*)\1$/, "$2"));
  }
  return out;
}

export function alignEnv(text: string, opts: { poolerHost?: string; publishableFromAnon?: boolean }): { text: string; changes: Change[] } {
  const env = parseEnv(text);
  const base = env.get("SUPABASE_URL");
  const ref = projectRef(base);
  if (!base || !ref) throw new Error("SUPABASE_URL must be https://<ref>.supabase.co");
  const origin = new URL(base).origin;
  const want = new Map<string, string>([
    ["VITE_SUPABASE_URL", origin],
    ["JWT_ISSUER", `${origin}/auth/v1`],
    ["JWKS_URI", `${origin}/auth/v1/.well-known/jwks.json`],
  ]);
  const anon = env.get("SUPABASE_ANON_KEY");
  if (opts.publishableFromAnon && anon) want.set("VITE_SUPABASE_PUBLISHABLE_KEY", anon);
  const db = env.get("DATABASE_URL");
  if (opts.poolerHost && db) {
    if (!/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(opts.poolerHost)) throw new Error("--pooler-host must be aws-<n>-<region>.pooler.supabase.com");
    const u = new URL(db);
    if (u.hostname === `db.${ref}.supabase.co`) {
      const pooled = (port: number) => {
        const p = new URL(db);
        p.username = `postgres.${ref}`;
        p.hostname = opts.poolerHost ?? "";
        p.port = String(port);
        return p.toString();
      };
      want.set("DATABASE_URL", pooled(6543));
      want.set("DIRECT_URL", pooled(5432));
    }
  }
  const changes: Change[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/).map((line) => {
    const m = /^(\s*)([A-Z0-9_]+)(\s*=\s*)(.*?)\s*$/.exec(line);
    const name = m?.[2];
    if (!m || !name || !want.has(name)) return line;
    seen.add(name);
    const to = want.get(name) ?? "";
    const from = env.get(name) ?? "";
    if (from === to) return line;
    changes.push({ name, from: describe(from), to: describe(to) });
    return `${m[1]}${name}${m[3]}${to}`;
  });
  for (const [name, to] of want) {
    if (seen.has(name)) continue;
    changes.push({ name, from: "(unset)", to: describe(to) });
    lines.push(`${name}=${to}`);
  }
  return { text: lines.join(text.includes("\r\n") ? "\r\n" : "\n"), changes };
}

/** Does the project accept this public key? (GET /auth/v1/settings answers 401 for a key from another project.) */
async function keyAccepted(origin: string, key: string | undefined): Promise<boolean> {
  if (!key) return false;
  const res = await fetch(`${origin}/auth/v1/settings`, { headers: { apikey: key }, signal: AbortSignal.timeout(10_000) });
  return res.ok;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { "pooler-host": { type: "string" }, write: { type: "boolean", default: false } } });
  const file = join(resolve(fileURLToPath(new URL("../..", import.meta.url))), ".env");
  const text = readFileSync(file, "utf8");
  const env = parseEnv(text);
  const origin = new URL(env.get("SUPABASE_URL") ?? "https://invalid").origin;
  const publishableFromAnon = !(await keyAccepted(origin, env.get("VITE_SUPABASE_PUBLISHABLE_KEY"))) && (await keyAccepted(origin, env.get("SUPABASE_ANON_KEY")));
  const result = alignEnv(text, { poolerHost: values["pooler-host"], publishableFromAnon });
  console.log(`target project: ${describe(env.get("SUPABASE_URL"))}`);
  for (const c of result.changes) console.log(`  ${c.name}: ${c.from} → ${c.to}`);
  if (result.changes.length === 0) console.log("  nothing to change");
  else if (values.write) {
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(file, backup);
    writeFileSync(file, result.text);
    console.log(`written; previous file kept as ${backup.split(/[\\/]/).pop()}`);
  } else console.log("dry run: add --write to apply");
}
