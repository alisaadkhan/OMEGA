/**
 * SEARCH_PROFILE=v2 acceptance (search-v2 branch): the catalogue variation matrix on the same SYNTHETIC catalogue as the
 * v1 suite (brain1.int.test.ts), and the live Roman Urdu brief, with expectations fixed before running. v1 stays the
 * default and is covered unchanged by the v1 suites and the freeze check.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTables } from "@mushin/db/testing";
import { buildApi, db, evidence, externalAttempts, owner, synthetic, webFor } from "./harness";
import { CATALOGUE, R } from "./catalogue";

type Api = Awaited<ReturnType<typeof buildApi>>;
let api: Api;
let headers: Record<string, string>;
const label = new Map<string, string>();
const sorted = (xs: string[]) => [...xs].sort();

beforeAll(async () => {
  await resetTables();
  api = await buildApi({ searchProfile: "v2" });
  for (const [k, c] of Object.entries(CATALOGUE)) label.set(await synthetic({ ...c, handle: `syn_${k.toLowerCase()}` }), k);
  const p = await api.person();
  headers = p.headers;
  await db.withWorkspace(p.workspaceId, (tx) => api.billing.engine.grant(tx, p.workspaceId, { source: "adjustment", amount: 50_000, expiresAt: new Date(Date.now() + 86_400_000), sourceRef: `v2-${randomUUID()}`, note: "acceptance" }));
});
afterAll(() => expect(externalAttempts).toEqual([]));

async function query(text: string, filters: Record<string, unknown> = {}) {
  const r = await api.search(headers, text, filters);
  const body = r.json() as { results?: { id: string }[]; understood?: unknown };
  return { status: r.statusCode, keys: (body.results ?? []).map((x) => label.get(x.id) ?? "?"), understood: body.understood };
}

describe("catalogue variation matrix under v2 (VAR2-C)", () => {
  const matrix: { id: string; text: string; filters?: Record<string, unknown>; expect: string[] }[] = [
    { id: "VAR2-C01", text: "food vloggers in Lahore", expect: R },
    { id: "VAR2-C02", text: "food bloggers in Lahore", expect: R },
    { id: "VAR2-C03", text: "food content creators based in Lahore", expect: R },
    { id: "VAR2-C04", text: "creators who review restaurants in Lahore", expect: R },
    { id: "VAR2-C05", text: "YouTubers covering food in Lahore", expect: ["F2", "F8"] },
    { id: "VAR2-C06", text: "food review influencers in Lahore", expect: R },
    { id: "VAR2-C07", text: "Lahore mein khana walay vloggers", expect: R },
    { id: "VAR2-C08", text: "لاہور کے کھانے والے", expect: R },
    { id: "VAR2-C09", text: "food vloggers in Lahore", expect: R },
    { id: "VAR2-C10", text: "food vloggers in Lahore on TikTok", expect: ["F3", "F15"] },
    { id: "VAR2-C11", text: "food vloggers in Karachi", expect: ["F5"] },
    { id: "VAR2-C12", text: "fashion vloggers in Lahore", expect: ["F6"] },
    { id: "VAR2-C13", text: "food vloggers in Lahore with over 100k followers", expect: ["F1", "F8"] },
    { id: "VAR2-C14", text: "food vloggers in Quetta", expect: [] },
    { id: "VAR2-C15", text: "LHR foodie", expect: R },
    { id: "VAR2-C16", text: "food vlogers in lahor", expect: R },
    { id: "VAR2-C17", text: "food vloggers in Lahore", filters: { platform: "youtube" }, expect: ["F2", "F8"] },
    // The mandate's natural-language examples (catalogue design fixed above).
    { id: "VAR2-C18", text: "Pakistani YouTubers reviewing restaurants in Lahore", expect: ["F2", "F8"] },
    { id: "VAR2-C19", text: "Food creators in Karachi who speak Urdu", expect: ["F5"] },
    { id: "VAR2-C20", text: "Lahore ke food vloggers", expect: R },
    { id: "VAR2-C21", text: "skin care", expect: ["F11"] },
  ];
  for (const v of matrix) {
    it(`${v.id} "${v.text}"`, async () => {
      const r = await query(v.text, v.filters ?? {});
      evidence(v.id, { input: v.text, filters: v.filters ?? {}, understood: r.understood, results: r.keys, expected: v.expect, recallAgainstR: r.keys.filter((k) => R.includes(k)).length / R.length });
      expect(r.status).toBe(200);
      expect(sorted(r.keys)).toEqual(sorted(v.expect));
    });
  }
});

describe("live discovery under v2 (VAR2-L)", () => {
  it("VAR2-L03 a Roman Urdu brief (khana, Lahore) delivers the food creators an English brief delivers (fixes D2)", async () => {
    const handles = Array.from({ length: 8 }, (_, i) => `v2_food_${i + 1}`);
    const live = await buildApi({ searchProfile: "v2", fixtures: { web: webFor(() => handles) } });
    const p = await live.person();
    await db.withWorkspace(p.workspaceId, (tx) => live.billing.engine.grant(tx, p.workspaceId, { source: "adjustment", amount: 5_000, expiresAt: new Date(Date.now() + 86_400_000), sourceRef: `v2l-${randomUUID()}`, note: "acceptance" }));
    const { jobId } = await live.startLive(p.ctx, "khana", { platform: "instagram", creatorCity: "Lahore" }, 10);
    await live.live.run(jobId, p.workspaceId);
    const job = await live.discovery.get(p.ctx, jobId);
    const results = (await live.discovery.results(p.ctx, jobId, 0)).results;
    const reasons = await owner<{ decision: string; reason: string | null; n: number }>(`select decision, reason, count(*)::int n from wp.discovery_candidates where job_id = '${jobId}' group by 1,2`);
    evidence("VAR2-L03", { outcome: job.outcome, delivered: results.length, charged: job.live?.creditsCharged, reasons });
    expect(results.length).toBe(8);
    expect(job.live?.creditsCharged).toBe(50 + 8 * 10);
  });
});
