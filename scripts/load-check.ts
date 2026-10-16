/**
 * Bounded local load check of the customer API (no providers are called; catalogue search repeats are free inside the
 * 30-minute window, so only the first search spends trial credits). Measures p50/p95/p99 per endpoint at a fixed
 * concurrency and compares them with the proposed targets (search p95 ≤ 800 ms; CRM reads p95 ≤ 300 ms).
 *
 *   node --import tsx scripts/load-check.ts <api-base> <identities.json> [requests-per-endpoint=200] [concurrency=10]
 * Run against a disposable stack (the E2E harness database), never a shared or production API.
 */
import { readFileSync } from "node:fs";

const [base, idFile, perArg, concArg] = process.argv.slice(2);
if (!base || !idFile) {
  console.error("usage: load-check.ts <api-base> <identities.json> [requests] [concurrency]");
  process.exit(2);
}
const PER = Number(perArg ?? 200);
const CONC = Number(concArg ?? 10);
const token = (JSON.parse(readFileSync(idFile, "utf8")) as Record<string, { token: string }>)["owner"]?.token;
if (!token) throw new Error("no owner token in identities file");
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

async function call(method: string, path: string, body?: unknown): Promise<{ ms: number; status: number; json: unknown }> {
  const t = performance.now();
  const r = await fetch(`${base}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await r.json().catch(() => null);
  return { ms: performance.now() - t, status: r.status, json };
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;

async function measure(name: string, target: number, fn: () => Promise<{ ms: number; status: number }>) {
  const times: number[] = [];
  const statuses: Record<number, number> = {};
  let next = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (next < PER) {
      next++;
      const r = await fn();
      times.push(r.ms);
      statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    }
  }));
  const wall = (performance.now() - t0) / 1000;
  times.sort((a, b) => a - b);
  const row = { endpoint: name, requests: times.length, concurrency: CONC, rps: Math.round(times.length / wall), p50: Math.round(pct(times, 50)), p95: Math.round(pct(times, 95)), p99: Math.round(pct(times, 99)), targetP95: target, statuses };
  console.log(JSON.stringify({ ...row, meetsTarget: row.p95 <= target && Object.keys(statuses).every((s) => s.startsWith("2")) }));
  return row;
}

// Setup: the price the user was shown, one paid search (later identical searches are free repeats), a list and an id.
const price = ((await call("GET", "/v1/billing/plans")).json as { actionCosts?: { search_existing?: number } } | null)?.actionCosts?.search_existing;
const searchBody = { text: "food", filters: {}, confirmedCost: price ?? 50 };
const first = await call("POST", "/v1/search", searchBody);
if (first.status !== 200) throw new Error(`setup search failed: ${first.status} ${JSON.stringify(first.json)}`);
const creatorId = (first.json as { results: { id: string }[] }).results[0]?.id;
if (!creatorId) throw new Error("setup: the catalogue returned no creator for 'food'");

await measure("POST /v1/search (repeat, free)", 800, () => call("POST", "/v1/search", searchBody));
await measure("GET /v1/lists", 300, () => call("GET", "/v1/lists"));
await measure("GET /v1/campaigns", 300, () => call("GET", "/v1/campaigns"));
await measure(`GET /v1/creators/:id`, 300, () => call("GET", `/v1/creators/${creatorId}`));
await measure("GET /v1/billing/summary", 300, () => call("GET", "/v1/billing/summary"));
