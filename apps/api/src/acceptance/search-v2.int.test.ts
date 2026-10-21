/**
 * SEARCH_PROFILE=v2 acceptance (search-v2 branch): the catalogue variation matrix on the same SYNTHETIC catalogue as the
 * v1 suite (brain1.int.test.ts), and the live Roman Urdu brief, with expectations fixed before running. v1 stays the
 * default and is covered unchanged by the v1 suites and the freeze check.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTables } from "@mushin/db/testing";
import { buildApi, db, evidence, externalAttempts, owner, scraperFor, synthetic, webFor } from "./harness";
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
  it("VAR2-L01 a known creator without a stored sample is fetched again and delivered as known and free (v1 skips it)", async () => {
    const handles = Array.from({ length: 8 }, (_, i) => `v2_known_${i + 1}`);
    const results: Record<string, { delivered: string[]; knownFree: boolean; charged: number | undefined }> = {};
    for (const profile of ["v1", "v2"] as const) {
      await resetTables();
      await synthetic({ name: "Known without sample", handle: "v2_known_1", niches: ["Food"], bio: "Food vlogger in Lahore" });
      const live = await buildApi({ searchProfile: profile, fixtures: { web: webFor(() => handles) } });
      const p = await live.person();
      await db.withWorkspace(p.workspaceId, (tx) => live.billing.engine.grant(tx, p.workspaceId, { source: "adjustment", amount: 5_000, expiresAt: new Date(Date.now() + 86_400_000), sourceRef: `v2k-${randomUUID()}`, note: "acceptance" }));
      const { jobId } = await live.startLive(p.ctx, "food vlogger", { platform: "instagram", creatorCity: "Lahore" }, 10);
      await live.live.run(jobId, p.workspaceId);
      const job = await live.discovery.get(p.ctx, jobId);
      const res = (await live.discovery.results(p.ctx, jobId, 0)).results;
      const known = res.find((r) => r.handle === "v2_known_1");
      results[profile] = { delivered: res.map((r) => r.handle), knownFree: known ? known.isNew === false : false, charged: job.live?.creditsCharged };
    }
    evidence("VAR2-L01", results);
    expect(results["v1"]?.delivered).not.toContain("v2_known_1");
    expect(results["v2"]?.delivered).toContain("v2_known_1");
    expect(results["v2"]?.knownFree).toBe(true);
    expect(results["v2"]?.charged).toBe(50 + 7 * 10);
    const rows = await owner<{ n: number }>(`select count(*)::int n from gcp.creator_profiles where handle = 'v2_known_1'`);
    expect(rows[0]?.n).toBe(1);
  });

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
  it("VAR2-L04 stores city and country only from the creator's own words, and keeps provenance", async () => {
    const bios: Record<string, string> = {
      v2_ev_1: "Food vlogger in Lahore",
      v2_ev_2: "Food reviews | Lahore | Karachi",
      v2_ev_3: "Daily vlogs and challenges",
      // The pool needs 8 candidates before extraction starts.
      ...Object.fromEntries([4, 5, 6, 7, 8].map((n) => [`v2_ev_${n}`, "Food vlogger in Lahore"])),
    };
    // Its own query, so cached web results from the earlier tests are not reused.
    const live = await buildApi({ searchProfile: "v2", fixtures: { web: webFor(() => Object.keys(bios)), scraper: scraperFor((h) => bios[h] ?? null) } });
    const p = await live.person();
    await db.withWorkspace(p.workspaceId, (tx) => live.billing.engine.grant(tx, p.workspaceId, { source: "adjustment", amount: 5_000, expiresAt: new Date(Date.now() + 86_400_000), sourceRef: `v2e-${randomUUID()}`, note: "acceptance" }));
    const { jobId } = await live.startLive(p.ctx, "street food", { platform: "instagram", creatorCity: "Lahore" }, 10);
    await live.live.run(jobId, p.workspaceId);
    const stored = await owner<{ handle: string; id: string; city: string | null; country: string | null }>(
      `select pr.handle, c.id, c.city, c.country from gcp.creator_profiles pr join gcp.creators c on c.id = pr.creator_id where pr.handle like 'v2_ev_%' order by 1`,
    );
    const rows = await owner<{ handle: string; attribute: string; value: string; source: string; status: string }>(
      `select pr.handle, e.attribute, e.value, e.source, e.status from gcp.creator_attribute_evidence e join gcp.creator_profiles pr on pr.creator_id = e.creator_id where pr.handle like 'v2_ev_%' order by 1, 2, 3`,
    );
    const reasons = await owner<{ decision: string; reason: string | null; n: number }>(`select decision, reason, count(*)::int n from wp.discovery_candidates where job_id = '${jobId}' group by 1,2`);
    evidence("VAR2-L04", { outcome: (await live.discovery.get(p.ctx, jobId)).outcome, reasons, stored, rows });
    const by = Object.fromEntries(stored.map((r) => [r.handle, r]));
    expect(by["v2_ev_1"]).toMatchObject({ city: "Lahore", country: "PK" });
    // The fixture's display name is "Coke Studio Pakistan": own words support Pakistan, but two cities support none.
    expect(by["v2_ev_2"]).toMatchObject({ city: null, country: "PK" });
    expect(by["v2_ev_3"]?.city).toBeNull();
    expect(rows).toContainEqual({ handle: "v2_ev_1", attribute: "city", value: "Lahore", source: "profile_text", status: "supported" });
    expect(rows.filter((r) => r.handle === "v2_ev_2" && r.attribute === "city").every((r) => r.status === "conflicting")).toBe(true);
    // The profile explains where the city came from, with the quote (FRONTEND_REQUIREMENTS CR-01).
    const id1 = by["v2_ev_1"]?.id ?? "";
    const shown = (await live.creators.profile(p.ctx, id1)).attributeEvidence;
    expect(shown).toContainEqual(expect.objectContaining({ attribute: "city", value: "Lahore", source: "profile_text", status: "supported", quote: expect.stringContaining("Lahore") }));
    // Under minor protection the quotes are withheld, like linked accounts.
    await owner(`update gcp.creators set is_minor = true, minor_reason = 'test' where id = '${id1}'`);
    expect((await live.creators.profile(p.ctx, id1)).attributeEvidence).toEqual([]);
  });
});
