/**
 * Safe source packaging (audit SEC-01, H §3 step 7). The only supported way to hand the code to someone: archives the
 * committed tree at HEAD (`git archive`), so ignored files (.env, eval-data, supabase/.temp, node_modules) can never
 * be included, and refuses to write anything if a committed file looks like a secret. Findings name the file and the
 * kind of match, never the value.
 *
 *   node --import tsx scripts/package-source.ts [out.zip]          (default ../MUSHIN-source-<sha>.zip)
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privilegedJwts, SECRET_FORMATS, SERVER_SETTING_NAMES, type Finding } from "./check-bundle-secrets";

/** Paths that must never be in a source archive, whatever their content. */
const FORBIDDEN_PATH = /(^|\/)(\.env(\.(?!example$)[^/]+)?|docker\.env|id_(rsa|ed25519)|[^/]+\.(pem|p12|pfx|key))$|(^|\/)supabase\/\.temp\/|(^|\/)eval-data\//;
/** A server setting given a real-looking value (placeholders and empty values are fine). */
const PLACEHOLDER = /^(|["']?(?:x+|replace[-_ ]?me|change[-_ ]?me|your[-_].*|<.*>|\.\.\.|ci-.*|test-.*|e2e-.*|placeholder.*|dummy.*)["']?)$/i;

/** Test fixtures that contain fake secrets on purpose, by file and kind (each one reviewed). */
export const ALLOWED: Record<string, string[]> = {
  "scripts/check-bundle-secrets.test.ts": ["apify_token", "groq_key", "private_key", "resend_key", "paddle_key", "stripe_like_secret", "supabase_secret_key"],
};

export function scanSourceFile(path: string, text: string): Finding[] {
  const allowed = ALLOWED[path] ?? [];
  return rawFindings(path, text).filter((f) => !allowed.includes(f.kind));
}

function rawFindings(path: string, text: string): Finding[] {
  const findings: Finding[] = [];
  if (FORBIDDEN_PATH.test(path)) findings.push({ file: path, kind: "forbidden_path" });
  for (const [kind, re] of SECRET_FORMATS) if (re.test(text)) findings.push({ file: path, kind });
  for (const kind of privilegedJwts(text)) findings.push({ file: path, kind });
  for (const name of SERVER_SETTING_NAMES) {
    for (const m of text.matchAll(new RegExp(String.raw`(?:^|[\s"'])${name}\s*[=:]\s*([^\s#"'\n]+|"[^"\n]*"|'[^'\n]*')`, "gm"))) {
      if (looksLikeRealSecret(name, (m[1] ?? "").trim().replace(/^["']|["']$/g, ""))) findings.push({ file: path, kind: `assigned_value:${name}` });
    }
  }
  return findings;
}

/**
 * A value a person would not write as an example: a database URL with a password for a non-local host, or a long,
 * high-entropy token without template words. Placeholders, local URLs and variable references pass.
 */
export function looksLikeRealSecret(name: string, value: string): boolean {
  if (PLACEHOLDER.test(value) || /\$\{|process\.env|env\(|secrets\.|\$[A-Z_]/.test(value)) return false;
  // Code, not a value: schema calls, expressions, template literals.
  if (/[(),`<>]|\.\.\./.test(value)) return false;
  if (/_URL$/.test(name)) {
    const u = /^[a-z]+:\/\/([^:@/\s]+):([^@/\s]+)@([^/:\s]+)/i.exec(value);
    return !!u && !/^(localhost|127\.0\.0\.1|db|postgres|host|example\.com|.*\.example\.com)$/i.test(u[3] ?? "") && !/^(password|pass|postgres|secret|x+|<.*>)$/i.test(u[2] ?? "");
  }
  if (value.length < 20 || /\s/.test(value) || /example|placeholder|replace|change|your|local|dummy|sample|fake|test|ci-only|not-a-secret/i.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/].filter((re) => re.test(value)).length;
  return classes >= 2 && new Set(value).size >= 12;
}

/** Every committed file at HEAD with its content, read in one `git cat-file --batch` pass. */
export function committedFiles(repo: string): { path: string; text: string }[] {
  const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
  const out = execFileSync("git", ["cat-file", "--batch"], { cwd: repo, input: paths.map((p) => `HEAD:${p}`).join("\n") + "\n", maxBuffer: 1024 * 1024 * 1024 });
  const files: { path: string; text: string }[] = [];
  let at = 0;
  for (const path of paths) {
    const nl = out.indexOf(10, at);
    const header = out.subarray(at, nl).toString("utf8").split(" ");
    const size = Number(header[2] ?? 0);
    files.push({ path, text: out.subarray(nl + 1, nl + 1 + size).toString("utf8") });
    at = nl + 1 + size + 1;
  }
  return files;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const target = resolve(process.argv[2] ?? resolve(repo, "..", `MUSHIN-source-${sha}.zip`));
  const files = committedFiles(repo);
  const findings = files.flatMap((f) => scanSourceFile(f.path, f.text));
  if (findings.length) {
    console.error(`Refusing to package: ${findings.length} finding(s) in committed files:\n${findings.map((f) => `  ${f.kind} in ${f.file}`).join("\n")}`);
    process.exit(1);
  }
  execFileSync("git", ["archive", "--format=zip", "--prefix=MUSHIN/", "-o", target, "HEAD"], { cwd: repo });
  console.log(`Packaged ${files.length} committed files at ${sha} into ${target}; secret scan passed (no ignored files can be included).`);
}
