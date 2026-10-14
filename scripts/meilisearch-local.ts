/**
 * Self-hosted Meilisearch for local development (no Meilisearch Cloud).
 *
 *   npm run meili:start   run Meilisearch on 127.0.0.1:7700 (foreground), data kept in MEILI_HOME/data
 *   npm run meili:env     write .env.meilisearch (git-ignored) with the host and keys the API, worker and tests need
 *   npm run meili:health  print the server health and the creator index sizes
 *
 * MEILI_HOME defaults to ~/meilisearch and holds the binary (meilisearch-windows-amd64.exe or meilisearch), the
 * master key (master.key, created on first start, never printed) and the data directory. PostgreSQL stays the
 * source of truth: an empty or lost index is rebuilt from it by the worker's reconcile (`npm run meili:reindex`).
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOST = "http://127.0.0.1:7700";
const home = process.env["MEILI_HOME"] ?? join(homedir(), "meilisearch");
const keyPath = join(home, "master.key");

function masterKey(create: boolean): string {
  if (!existsSync(keyPath)) {
    if (!create) throw new Error(`No master key at ${keyPath}. Run "npm run meili:start" first.`);
    mkdirSync(home, { recursive: true });
    writeFileSync(keyPath, randomBytes(32).toString("base64url"), { mode: 0o600 });
  }
  return readFileSync(keyPath, "utf8").trim();
}

function binary(): string {
  for (const name of ["meilisearch-windows-amd64.exe", "meilisearch.exe", "meilisearch"]) {
    const p = join(home, name);
    if (existsSync(p)) return p;
  }
  throw new Error(`No Meilisearch binary in ${home}. Download it from https://github.com/meilisearch/meilisearch/releases (see README).`);
}

async function get<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${HOST}${path}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`GET ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

async function start() {
  const key = masterKey(true);
  const child = spawn(
    binary(),
    ["--http-addr", "127.0.0.1:7700", "--env", "production", "--db-path", join(home, "data"), "--dump-dir", join(home, "dumps"), "--no-analytics"],
    // The key goes in through the environment, so it never appears in the process list or logs.
    { stdio: "inherit", env: { ...process.env, MEILI_MASTER_KEY: key } },
  );
  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => child.kill("SIGINT"));
}

async function env() {
  const master = masterKey(false);
  const { results } = await get<{ results: { name: string | null; key: string; actions: string[] }[] }>("/keys", master);
  const pick = (name: string) => results.find((k) => k.name === name)?.key;
  const admin = pick("Default Admin API Key");
  const search = pick("Default Search API Key");
  if (!admin || !search) throw new Error("The default admin/search keys were not found on this Meilisearch.");
  const lines = {
    CATALOG_SEARCH_BACKEND: "meilisearch",
    MEILISEARCH_HOST: HOST,
    MEILISEARCH_API_KEY: admin,
    MEILISEARCH_SEARCH_KEY: search,
    MEILISEARCH_INDEX_PREFIX: "dev_",
    // Integration tests create and drop uniquely named test_* indexes on the same local server.
    MEILISEARCH_TEST_HOST: HOST,
    MEILISEARCH_TEST_KEY: master,
  };
  writeFileSync(".env.meilisearch", `${Object.entries(lines).map(([k, v]) => `${k}="${v}"`).join("\n")}\n`, { mode: 0o600 });
  console.log(`Wrote .env.meilisearch (git-ignored): ${Object.keys(lines).join(", ")}. Values are not printed.`);
}

async function health() {
  const master = masterKey(false);
  const h = await get<{ status: string }>("/health", master);
  const stats = await get<{ indexes: Record<string, { numberOfDocuments: number }> }>("/stats", master);
  const creators = Object.entries(stats.indexes).filter(([uid]) => uid.endsWith("creators") && !uid.startsWith("test_"));
  console.log(`Meilisearch ${HOST}: ${h.status}`);
  for (const [uid, s] of creators) console.log(`  ${uid}: ${s.numberOfDocuments} documents`);
  if (creators.length === 0) console.log("  no creator index yet (the worker creates it on start)");
}

const commands: Record<string, () => Promise<void>> = { start, env, health };
const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error("usage: meilisearch-local.ts start | env | health");
  process.exit(2);
}
await command().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
