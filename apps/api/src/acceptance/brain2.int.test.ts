/**
 * Acceptance: Brain 2 Live Discovery (B2-*), delivery-to-database persistence (P-*) and live query variations (VAR-L*).
 * Providers are deterministic FIXTURES (web search, Instagram/TikTok scraper, LLM): nothing here is real-provider
 * evidence. Every delivered creator is checked against authoritative rows read through the database owner's own
 * connection, never through the application's objects.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetTables } from "@mushin/db/testing";
import { FixtureScraper, FixtureWebSearch, ProviderError, scraperFixture, type ScrapeRequest, type WebQuery } from "@mushin/integrations";
import { buildApi, db, evidence, externalAttempts, igProfile, ledgerMismatches, owner, scraperFor, synthetic, webFor } from "./harness";

beforeEach(resetTables);
afterAll(() => expect(externalAttempts).toEqual([]));

const LAHORE = (n: number, prefix = "lhr_food") => Array.from({ length: n }, (_, i) => `${prefix}_${i + 1}`);
const brief = { text: "food vlogger", filters: { platform: "instagram", creatorCity: "Lahore" } };
type Api = Awaited<ReturnType<typeof buildApi>>;

async function topUp(api: Api, workspaceId: string, amount = 5_000) {
  await db.withWorkspace(workspaceId, (tx) => api.billing.engine.grant(tx, workspaceId, { source: "adjustment", amount, expiresAt: new Date(Date.now() + 30 * 86_400_000), sourceRef: `acc-${workspaceId}-${amount}-${Math.random()}`, note: "Acceptance campaign credits" }));
}
async function customer(api: Api, credits = 5_000) {
  const p = await api.person();
  if (credits > 0) await topUp(api, p.workspaceId, credits);
  return p;
}
const committed = (handles: string[]) =>
  owner<{ handle: string; canonical_url: string; followers: number; creator_id: string; created_at: string }>(
    `select p.handle, p.canonical_url, p.followers, p.creator_id, c.created_at::text from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id where p.handle in (${handles.map((h) => `'${h}'`).join(",") || "''"})`,
  );
/** A creator MUSHIN already knows, saved through the real pipeline (so it has an archived sample, as in production). */
async function knownThroughPipeline(api: Api, workspaceId: string, handle: string, bio: string, followers: number): Promise<string> {
  const job = { jobId: randomUUID(), workspaceId, platform: "instagram" as const, handle, canonicalUrl: `https://instagram.com/${handle}`, requestId: null };
  const raw = igProfile(handle, bio, followers);
  const payloadId = await api.pipeline.archive(job, "apify", raw);
  let id = "";
  await api.pipeline.processProfile(job, payloadId, raw, { onSaved: async (_tx, saved) => void (id = saved.creatorId) });
  return id;
}
async function runToEnd(api: Api, ctx: Awaited<ReturnType<typeof customer>>["ctx"], jobId: string) {
  await api.live.run(jobId, ctx.workspaceId);
  const job = await api.discovery.get(ctx, jobId);
  const results = (await api.discovery.results(ctx, jobId, 0)).results;
  return { job, results };
}

describe("Brain 2 pipeline (B2)", () => {
  it("B2-01 a brief without a topic and a place is refused before any credits are held", async () => {
    const api = await buildApi();
    const c = await customer(api);
    const before = await api.balance(c.ctx);
    const err = await api.startLive(c.ctx, "creators", {}).catch((e: unknown) => e);
    const after = await api.balance(c.ctx);
    evidence("B2-01", { error: (err as { code?: string }).code, before, after });
    expect((err as { code?: string }).code).toMatch(/QUERY_TOO_BROAD|VALIDATION_FAILED/);
    expect(after).toEqual(before);
  });

  it("B2-02 the quote is 50 + 10 per creator from the price table; TikTok in scope adds the 100-credit minimum", async () => {
    const api = await buildApi();
    const c = await customer(api);
    const ig = await api.discovery.createEstimate(c.ctx, { search: { text: "food vlogger", filters: { niches: [], verifiedOnly: false, hasContact: false, freshOnly: false, platform: "instagram", creatorCity: "Lahore" } }, maxNew: 10 });
    const tt = await api.discovery.createEstimate(c.ctx, { search: { text: "food vlogger", filters: { niches: [], verifiedOnly: false, hasContact: false, freshOnly: false, platform: "tiktok", creatorCity: "Lahore" } }, maxNew: 5 });
    evidence("B2-02", { instagram10: ig, tiktok5: tt });
    expect(ig).toMatchObject({ maxCredits: 150 });
    expect(tt).toMatchObject({ maxCredits: 100, minimumCredits: 100 });
  });

  it("B2-03 confirming reserves exactly the quote and creates the job and its outbox event together", async () => {
    const api = await buildApi();
    const c = await customer(api);
    const { estimate, jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const res = await owner<{ amount: number; status: string }>(`select amount, status from wp.credit_reservations where ref_id = '${jobId}'`);
    const ev = await owner<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'discovery.live_requested' and aggregate_id = '${jobId}'`);
    evidence("B2-03", { quote: estimate.maxCredits, reservation: res, outboxEvents: ev[0]?.n });
    expect(res).toEqual([{ amount: estimate.maxCredits, status: "held" }]);
    expect(ev[0]?.n).toBe(1);
  });

  it("B2-04 an estimate cannot be used by another person, twice, or after it expires", async () => {
    const api = await buildApi();
    const c = await customer(api);
    const other = await customer(api);
    const e1 = await api.discovery.createEstimate(c.ctx, { search: { text: "food vlogger", filters: { niches: [], verifiedOnly: false, hasContact: false, freshOnly: false, platform: "instagram", creatorCity: "Lahore" } }, maxNew: 5 });
    const foreign = await api.discovery.start(other.ctx, { kind: "live", estimateId: e1.estimateId }).catch((e: { code: string }) => e.code);
    const first = await api.discovery.start(c.ctx, { kind: "live", estimateId: e1.estimateId });
    const again = await api.discovery.start(c.ctx, { kind: "live", estimateId: e1.estimateId });
    const e2 = await api.discovery.createEstimate(c.ctx, { search: { text: "food blogger", filters: { niches: [], verifiedOnly: false, hasContact: false, freshOnly: false, platform: "instagram", creatorCity: "Karachi" } }, maxNew: 5 });
    await owner(`update wp.discovery_estimates set expires_at = now() - interval '1 minute' where id = '${e2.estimateId}'`);
    const expired = await api.discovery.start(c.ctx, { kind: "live", estimateId: e2.estimateId }).catch((e: { code: string }) => e.code);
    const holds = await owner<{ n: number }>(`select count(*)::int n from wp.credit_reservations where workspace_id = '${c.workspaceId}' and status = 'held'`);
    evidence("B2-04", { foreign, firstJob: first.body.status === "started" ? first.body.job.id : null, againJob: again.body.status === "started" ? again.body.job.id : null, expired, heldReservations: holds[0]?.n });
    expect(foreign).toBe("NOT_FOUND");
    expect(again.body).toEqual(first.body);
    expect(expired).toBe("CONFLICT");
    expect(holds[0]?.n).toBe(1);
  });

  it("B2-05 an insufficient balance is refused: no job, no hold, no ledger entry", async () => {
    const api = await buildApi();
    const c = await customer(api, 0);
    await owner(`update wp.credit_lots set remaining = 40 where workspace_id = '${c.workspaceId}'`);
    const err = await api.startLive(c.ctx, brief.text, brief.filters).catch((e: { code: string }) => e.code);
    const jobs = await owner<{ n: number }>(`select count(*)::int n from wp.discovery_jobs where workspace_id = '${c.workspaceId}'`);
    evidence("B2-05", { error: err, jobs: jobs[0]?.n });
    expect(err).toBe("INSUFFICIENT_CREDITS");
    expect(jobs[0]?.n).toBe(0);
  });

  it("B2-06 a provider that is not configured fails the run honestly and returns every credit", async () => {
    const web = new FixtureWebSearch(new ProviderError(false, "not_configured", "SERPER_API_KEY is not set"));
    const api = await buildApi({ fixtures: { web } });
    const c = await customer(api);
    const before = await api.balance(c.ctx);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    await api.live.run(jobId, c.ctx.workspaceId).catch(() => undefined);
    const job = await api.discovery.get(c.ctx, jobId);
    const after = await api.balance(c.ctx);
    evidence("B2-06", { status: job.status, outcome: job.outcome, message: job.error?.message, before, after, charged: job.live?.creditsCharged });
    expect(job.status).toBe("failed");
    expect(job.error?.message).toMatch(/credits were returned/i);
    expect(after.available).toBe(before.available);
    expect(after.reserved).toBe(0);
  });

  it("B2-07 a transient provider failure is retried; the run then completes and is charged once", async () => {
    let calls = 0;
    const web = new FixtureWebSearch((q: WebQuery) => {
      calls++;
      if (calls === 1) throw new ProviderError(true, "provider", "HTTP 503 from search provider");
      return LAHORE(8).map((h) => ({ title: h, link: `https://www.instagram.com/${h}/`, snippet: `Food vlogger ${q.query}` }));
    });
    const api = await buildApi({ fixtures: { web, scraper: scraperFor(() => "Food vlogger based in Lahore, Pakistan") } });
    const c = await customer(api);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters, 5);
    const first = await api.live.run(jobId, c.ctx.workspaceId).then(() => "completed", (e: Error) => `threw: ${e.message.slice(0, 60)}`);
    const mid = await api.discovery.get(c.ctx, jobId);
    if (mid.status !== "completed") await api.live.run(jobId, c.ctx.workspaceId);
    const job = await api.discovery.get(c.ctx, jobId);
    const ledger = await owner<{ n: number }>(`select count(*)::int n from wp.credit_ledger where workspace_id = '${c.workspaceId}' and kind = 'spend'`);
    evidence("B2-07", { firstAttempt: first, statusAfterFirst: mid.status, final: { status: job.status, outcome: job.outcome, charged: job.live?.creditsCharged }, chargeEntries: ledger[0]?.n });
    expect(job.status).toBe("completed");
    expect(job.live?.creditsCharged).toBe(100);
    expect(await ledgerMismatches(api.billing, c.workspaceId)).toEqual([]);
  });

  it("B2-08 too few candidates (under the 8-candidate pool) ends as insufficient: nothing fetched, nothing charged", async () => {
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(3)) } });
    const c = await customer(api);
    const before = await api.balance(c.ctx);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const { job } = await runToEnd(api, c.ctx, jobId);
    evidence("B2-08", { outcome: job.outcome, charged: job.live?.creditsCharged, scrapes: (api.scraper as FixtureScraper).batchCalls.length });
    expect(job.outcome).toBe("insufficient");
    expect(job.live?.creditsCharged).toBe(0);
    expect((api.scraper as FixtureScraper).batchCalls).toHaveLength(0);
    expect(await api.balance(c.ctx)).toEqual(before);
  });

  it("B2-18 Pakistan-only (elig-2): a profile based abroad, with no stated country or with conflicting evidence is saved but never delivered or charged", async () => {
    const bios: Record<string, string> = {
      lhr_food_1: "Food vlogger based in Dubai, UAE",
      lhr_food_2: "Food vlogger in Lahore",
      lhr_food_3: "Based in Pakistan, also based in the UK",
    };
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(8)), scraper: scraperFor((h) => bios[h] ?? "Food vlogger based in Lahore, Pakistan") } });
    const c = await customer(api);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const { job, results } = await runToEnd(api, c.ctx, jobId);
    const handles = results.map((r) => r.handle).sort();
    evidence("B2-18", { delivered: handles, charged: job.live?.creditsCharged });
    for (const excluded of Object.keys(bios)) expect(handles).not.toContain(excluded);
    expect(handles.length).toBeGreaterThan(0);
    // Not delivered is not deleted: the excluded profiles were saved with their country decision.
    const saved = await owner<{ handle: string; country_status: string }>(`select handle, country_status from gcp.creator_profiles where handle in ('lhr_food_1', 'lhr_food_2', 'lhr_food_3') order by handle`);
    expect(saved).toEqual([{ handle: "lhr_food_1", country_status: "foreign" }, { handle: "lhr_food_2", country_status: "unknown" }, { handle: "lhr_food_3", country_status: "conflicting" }]);
  });

  it("B2-09 when every candidate is off-topic, nothing is delivered and the run costs nothing", async () => {
    const web = new FixtureWebSearch(() => LAHORE(10, "lhr_cars").map((h) => ({ title: `${h} | Car repairs`, link: `https://www.instagram.com/${h}/`, snippet: "Car mechanic, engine repair, Lahore" })));
    const api = await buildApi({ fixtures: { web, scraper: scraperFor(() => "Car mechanic and engine repair videos") } });
    const c = await customer(api);
    const before = await api.balance(c.ctx);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const { job, results } = await runToEnd(api, c.ctx, jobId);
    const reasons = await owner<{ reason: string | null; n: number }>(`select reason, count(*)::int n from wp.discovery_candidates where job_id = '${jobId}' group by 1`);
    evidence("B2-09", { outcome: job.outcome, delivered: results.length, charged: job.live?.creditsCharged, reasons });
    expect(results).toEqual([]);
    expect(job.live?.creditsCharged).toBe(0);
    expect(job.outcome).not.toBe("succeeded");
    expect(await api.balance(c.ctx)).toEqual(before);
  });

  it("B2-10/11/12 private, possible-minor and under-10k profiles are never delivered or charged; adults over 10k are", async () => {
    const bios: Record<string, string | null> = { lhr_food_1: null, lhr_food_2: "16 years old Pakistani food blogger from Lahore", lhr_food_3: "Food vlogger based in Lahore, Pakistan" };
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(8)), scraper: scraperFor((h) => (h in bios ? (bios[h] as string | null) : "Food vlogger based in Lahore, Pakistan"), (h) => (h === "lhr_food_3" ? 5_000 : 50_000)) } });
    const c = await customer(api);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const { job, results } = await runToEnd(api, c.ctx, jobId);
    const trail = await owner<{ candidate_key: string; decision: string; reason: string | null }>(`select candidate_key, decision, reason from wp.discovery_candidates where job_id = '${jobId}' order by 1`);
    const delivered = results.map((r) => r.handle);
    evidence("B2-10", { delivered, trail, charged: job.live?.creditsCharged });
    evidence("B2-11", { minorDelivered: delivered.includes("lhr_food_2"), minorRow: await committed(["lhr_food_2"]) });
    evidence("B2-12", { smallDelivered: delivered.includes("lhr_food_3"), smallRow: await committed(["lhr_food_3"]) });
    expect(delivered).not.toContain("lhr_food_1");
    expect(delivered).not.toContain("lhr_food_2");
    expect(delivered).not.toContain("lhr_food_3");
    expect(delivered.sort()).toEqual(["lhr_food_4", "lhr_food_5", "lhr_food_6", "lhr_food_7", "lhr_food_8"]);
    expect(job.live?.creditsCharged).toBe(50 + 5 * 10);
    expect(trail.find((t) => t.candidate_key.endsWith("lhr_food_1"))).toMatchObject({ decision: "rejected" });
  });

  it("B2-13 a partial result (fewer deliverable creators than the size) is charged the base fee plus delivered creators only", async () => {
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(8)), scraper: scraperFor((h) => (["lhr_food_1", "lhr_food_2", "lhr_food_3"].includes(h) ? "Food vlogger based in Lahore, Pakistan" : null)) } });
    const c = await customer(api);
    const before = await api.balance(c.ctx);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters, 10);
    const { job, results } = await runToEnd(api, c.ctx, jobId);
    const after = await api.balance(c.ctx);
    evidence("B2-13", { delivered: results.length, charged: job.live?.creditsCharged, before, after });
    expect(results).toHaveLength(3);
    expect(job.live?.creditsCharged).toBe(80);
    expect(before.available - after.available).toBe(80);
    expect(after.reserved).toBe(0);
  });

  it("B2-14 a run cancelled before it starts calls no provider and costs nothing", async () => {
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(10)) } });
    const c = await customer(api);
    const before = await api.balance(c.ctx);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    await api.discovery.cancel(c.ctx, jobId);
    await api.live.run(jobId, c.ctx.workspaceId);
    const job = await api.discovery.get(c.ctx, jobId);
    evidence("B2-14", { status: job.status, outcome: job.outcome, webCalls: api.web.calls.length, charged: job.live?.creditsCharged });
    expect(job.outcome).toBe("canceled");
    expect(api.web.calls).toHaveLength(0);
    expect(await api.balance(c.ctx)).toEqual(before);
  });

  it("B2-15 a stop requested during extraction keeps and charges only creators already delivered", async () => {
    // The scraper's first fetch asks to stop the run it belongs to (filled in once the run exists).
    const running: { api?: Api; ctx?: Awaited<ReturnType<typeof customer>>["ctx"]; jobId?: string; fetched: number } = { fetched: 0 };
    const scraper = new FixtureScraper({
      instagram: async (req: ScrapeRequest) => {
        running.fetched++;
        if (running.fetched === 1 && running.api && running.ctx && running.jobId) await running.api.discovery.cancel(running.ctx, running.jobId);
        return { provider: "apify", raw: igProfile(req.handle, "Food vlogger based in Lahore, Pakistan"), costUsd: 0.0026 };
      },
    });
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(8)), scraper } });
    const c = await customer(api);
    const jobId = (await api.startLive(c.ctx, brief.text, brief.filters)).jobId;
    Object.assign(running, { api, ctx: c.ctx, jobId });
    const { job, results } = await runToEnd(api, c.ctx, jobId);
    evidence("B2-15", { outcome: job.outcome, delivered: results.length, charged: job.live?.creditsCharged });
    expect(job.outcome).toBe("canceled");
    expect(job.live?.creditsCharged).toBe(results.length > 0 ? 50 + results.filter((r) => r.isNew).length * 10 : 0);
    expect((await api.balance(c.ctx)).reserved).toBe(0);
  });

  it("B2-16 TikTok profiles extracted from the recorded provider shape but not deliverable: nothing delivered, everything returned", async () => {
    const handles = Array.from({ length: 8 }, (_, i) => `tt_food_${i + 1}`);
    const web = new FixtureWebSearch(() => handles.map((h) => ({ title: `${h} | TikTok`, link: `https://www.tiktok.com/@${h}`, snippet: "Food, Karachi" })));
    const raw = scraperFixture("tiktok-novideos.json");
    const scraper = new FixtureScraper({ tiktok: () => ({ provider: "apify", raw, costUsd: 0.01 }) });
    const api = await buildApi({ fixtures: { web, scraper } });
    const c = await customer(api);
    const before = await api.balance(c.ctx);
    const { jobId } = await api.startLive(c.ctx, "food vlogger", { platform: "tiktok", creatorCity: "Karachi" }, 5);
    const { job, results } = await runToEnd(api, c.ctx, jobId);
    const trail = await owner<{ stage: string; decision: string; reason: string | null }>(`select stage, decision, reason from wp.discovery_candidates where job_id = '${jobId}'`);
    evidence("B2-16", { outcome: job.outcome, delivered: results.length, charged: job.live?.creditsCharged, trail, before, after: await api.balance(c.ctx) });
    expect(results).toEqual([]);
    expect(job.live?.creditsCharged).toBe(0);
    expect(job.outcome).not.toBe("succeeded");
    expect(trail.filter((t) => t.decision === "pending")).toEqual([]);
    expect(await api.balance(c.ctx)).toEqual(before);
  });

  it("B2-17 contacts are never invented: only an address present in the source bio is stored, with its source", async () => {
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(8)), scraper: scraperFor((h) => (h === "lhr_food_1" ? "Food vlogger based in Lahore, Pakistan. Collab: lhrfood1@lhrfoodmail.pk" : "Food vlogger based in Lahore, Pakistan")) } });
    const c = await customer(api);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const { results } = await runToEnd(api, c.ctx, jobId);
    const contacts = await owner<{ handle: string; kind: string; source: string }>(`select p.handle, k.kind, k.source from gcp.creator_contacts k join gcp.creator_profiles p on p.creator_id = k.creator_id`);
    evidence("B2-17", { delivered: results.map((r) => ({ handle: r.handle, contact: r.contactAvailability ?? r.hasContact })), contacts });
    expect(contacts.map((x) => x.handle)).toEqual(["lhr_food_1"]);
    expect(contacts[0]?.source).toMatch(/bio/);
    expect(JSON.stringify(results)).not.toContain("lhrfood1@lhrfoodmail.pk");
  });

  it("B2-18 every delivered creator is traceable to an archived provider payload and a candidate source URL", async () => {
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(8)) } });
    const c = await customer(api);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const { results } = await runToEnd(api, c.ctx, jobId);
    const trace = await owner<{ creator_id: string; payloads: number; url: string }>(`select d.creator_id, (select count(*)::int from platform.raw_payloads r where r.job_id = d.job_id and r.canonical_url = d.candidate_key) payloads, d.candidate_key url from wp.discovery_candidates d where d.job_id = '${jobId}' and d.decision = 'delivered'`);
    evidence("B2-18", { delivered: results.length, trace });
    expect(trace).toHaveLength(results.length);
    expect(trace.every((t) => t.payloads >= 1 && t.url.startsWith("https://instagram.com/"))).toBe(true);
  });
});

describe("delivery persistence (P)", () => {
  it("P-01 every delivered creator has a committed row matching the delivered result (independent connection)", async () => {
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(8)), scraper: scraperFor(() => "Food vlogger based in Lahore, Pakistan", (h) => 40_000 + Number(h.split("_").at(-1)) * 1_000) } });
    const c = await customer(api);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const { results } = await runToEnd(api, c.ctx, jobId);
    const rows = await committed(results.map((r) => r.handle));
    const byHandle = new Map(rows.map((r) => [r.handle, r]));
    const mismatches = results.filter((r) => {
      const row = byHandle.get(r.handle);
      return !row || row.creator_id !== r.id || row.canonical_url !== `https://instagram.com/${r.handle}` || row.followers !== r.followers;
    });
    const resultRows = await owner<{ n: number }>(`select count(*)::int n from wp.discovery_results where job_id = '${jobId}'`);
    evidence("P-01", { delivered: results.length, committedRows: rows.length, resultRows: resultRows[0]?.n, mismatches: mismatches.map((m) => m.handle) });
    expect(results.length).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
    expect(resultRows[0]?.n).toBe(results.length);
  });

  it("P-02 a failure while saving one creator rolls back that creator and its delivery together; others stay committed", async () => {
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(8)) } });
    const original = api.pipeline.processProfile.bind(api.pipeline);
    (api.pipeline as { processProfile: typeof original }).processProfile = async (job, payloadId, raw, hooks) =>
      original(job, payloadId, raw, {
        ...hooks,
        onSaved: async (tx, saved) => {
          await hooks.onSaved(tx, saved);
          if (job.handle === "lhr_food_4") throw new Error("injected database failure after the delivery insert");
        },
      });
    const c = await customer(api);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const outcome = await api.live.run(jobId, c.ctx.workspaceId).then(() => "returned", (e: Error) => `threw: ${e.message}`);
    const job = await api.discovery.get(c.ctx, jobId);
    const failedRow = await committed(["lhr_food_4"]);
    const failedResult = await owner<{ n: number }>(`select count(*)::int n from wp.discovery_results r join gcp.creator_profiles p on p.creator_id = r.creator_id where r.job_id = '${jobId}' and p.handle = 'lhr_food_4'`);
    const results = (await api.discovery.results(c.ctx, jobId, 0)).results;
    const rows = await committed(results.map((r) => r.handle));
    evidence("P-02", { run: outcome, status: job.status, outcome: job.outcome, charged: job.live?.creditsCharged, failedCreatorRows: failedRow.length, failedResultRows: failedResult[0]?.n, delivered: results.map((r) => r.handle), committedForDelivered: rows.length });
    expect(failedRow).toEqual([]);
    expect(failedResult[0]?.n).toBe(0);
    expect(rows.length).toBe(results.length);
    expect(await ledgerMismatches(api.billing, c.workspaceId)).toEqual([]);
  });

  it("P-03 a creator MUSHIN already knows is reused (same id, no new row) and delivered free", async () => {
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(8)) } });
    const c = await customer(api);
    const knownId = await knownThroughPipeline(api, c.workspaceId, "lhr_food_1", "Food vlogger based in Lahore, Pakistan", 50_000);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const { job, results } = await runToEnd(api, c.ctx, jobId);
    const rows = await committed(["lhr_food_1"]);
    const known = results.find((r) => r.handle === "lhr_food_1");
    evidence("P-03", { knownId, deliveredAs: known && { id: known.id, isNew: known.isNew }, rows: rows.length, charged: job.live?.creditsCharged, newCount: results.filter((r) => r.isNew).length });
    expect(rows).toHaveLength(1);
    expect(known).toMatchObject({ id: knownId, isNew: false });
    expect(job.live?.creditsCharged).toBe(50 + results.filter((r) => r.isNew).length * 10);
  });

  it("P-04 duplicate provider candidates (URL forms, case, tracking parameters) become one candidate and one creator", async () => {
    const forms = ["https://www.instagram.com/lhr_food_1/", "https://instagram.com/LHR_FOOD_1", "https://m.instagram.com/lhr_food_1/?igsh=abc", "instagram.com/lhr_food_1"];
    const web = new FixtureWebSearch(() => [...forms.map((link) => ({ title: "dup", link, snippet: "Food vlogger Lahore" })), ...LAHORE(9).slice(1).map((h) => ({ title: h, link: `https://www.instagram.com/${h}/`, snippet: "Food vlogger Lahore" }))]);
    const api = await buildApi({ fixtures: { web } });
    const c = await customer(api);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const { results } = await runToEnd(api, c.ctx, jobId);
    const cand = await owner<{ n: number }>(`select count(*)::int n from wp.discovery_candidates where job_id = '${jobId}' and candidate_key = 'https://instagram.com/lhr_food_1'`);
    const rows = await committed(["lhr_food_1"]);
    evidence("P-04", { candidateRows: cand[0]?.n, creatorRows: rows.length, deliveredTimes: results.filter((r) => r.handle === "lhr_food_1").length });
    expect(cand[0]?.n).toBe(1);
    expect(rows).toHaveLength(1);
    expect(results.filter((r) => r.handle === "lhr_food_1").length).toBeLessThanOrEqual(1);
  });

  it("P-05 two different people with the same display name stay two creators", async () => {
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(8)), scraper: scraperFor(() => "Food vlogger based in Lahore, Pakistan") } });
    const c = await customer(api);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    await runToEnd(api, c.ctx, jobId);
    const names = await owner<{ display_name: string; n: number }>(`select c.display_name, count(*)::int n from gcp.creators c group by 1 order by 2 desc limit 1`);
    const ids = await owner<{ n: number }>(`select count(distinct creator_id)::int n from gcp.creator_profiles where handle like 'lhr_food_%'`);
    evidence("P-05", { mostCommonName: names[0], distinctCreators: ids[0]?.n });
    // The fixture gives every profile the same display name; identity is the platform URL, so each stays separate.
    expect(names[0]?.n).toBeGreaterThan(1);
    expect(ids[0]?.n).toBe(names[0]?.n);
  });

  it("P-06 the same handle on Instagram and TikTok is two creators (no cross-platform merge is claimed)", async () => {
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(8)) } });
    const ttId = await synthetic({ name: "TT twin", platform: "tiktok", handle: "lhr_food_2", niches: ["Food"], bio: "Food TikTok" });
    const c = await customer(api);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const { results } = await runToEnd(api, c.ctx, jobId);
    const rows = await owner<{ platform: string; creator_id: string }>(`select platform, creator_id from gcp.creator_profiles where handle = 'lhr_food_2' order by platform`);
    evidence("P-06", { rows, igDelivered: results.find((r) => r.handle === "lhr_food_2")?.id, ttId });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.creator_id)).size).toBe(2);
  });

  it("P-07 rediscovering a known creator keeps better-known data (contacts, niches, city) and does not overwrite it with the new fetch", async () => {
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(8)), scraper: scraperFor(() => "Food vlogger based in Lahore, Pakistan", (h) => (h === "lhr_food_1" ? 77_000 : 50_000)) } });
    const c = await customer(api);
    const id = await knownThroughPipeline(api, c.workspaceId, "lhr_food_1", "Food vlogger in Lahore. Collab: rich@lhrfoodmail.pk", 60_000);
    // Better-known fields set later (as an assessment or staff edit would), which a live run must not erase.
    await owner(`update gcp.creators set city = 'Lahore', niches = array['Food'] where id = '${id}'`);
    const before = await owner<Record<string, unknown>>(`select c.city, c.niches, (select count(*)::int from gcp.creator_contacts k where k.creator_id = c.id) contacts, p.followers from gcp.creators c join gcp.creator_profiles p on p.creator_id = c.id where c.id = '${id}'`);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const { results } = await runToEnd(api, c.ctx, jobId);
    const [row] = await owner<{ city: string | null; niches: string[]; contacts: number; followers: number }>(`select c.city, c.niches, (select count(*)::int from gcp.creator_contacts k where k.creator_id = c.id) contacts, p.followers from gcp.creators c join gcp.creator_profiles p on p.creator_id = c.id where c.id = '${id}'`);
    const fetchedAgain = (api.scraper as FixtureScraper).batchCalls.some((b) => b.handles.includes("lhr_food_1"));
    evidence("P-07", { before: before[0], after: row, deliveredAs: results.find((r) => r.id === id)?.isNew, refetched: fetchedAgain });
    expect(row).toMatchObject({ city: "Lahore", niches: ["Food"], contacts: 1 });
    // Live runs reuse a known creator's retained sample instead of fetching it again (refresh is a separate paid action).
    expect(fetchedAgain).toBe(false);
    expect(row?.followers).toBe(60_000);
  });

  it("P-08 a run retried after a crash mid-delivery creates no duplicate creators or results and charges once", async () => {
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(8)) } });
    const original = api.pipeline.processProfile.bind(api.pipeline);
    let crashed = false;
    (api.pipeline as { processProfile: typeof original }).processProfile = async (job, payloadId, raw, hooks) => {
      const out = await original(job, payloadId, raw, hooks);
      if (!crashed && job.handle === "lhr_food_5") {
        crashed = true;
        throw new Error("worker terminated after a committed delivery");
      }
      return out;
    };
    const c = await customer(api);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const first = await api.live.run(jobId, c.ctx.workspaceId).then(() => "returned", (e: Error) => `threw: ${e.message}`);
    const mid = await api.discovery.get(c.ctx, jobId);
    if (mid.status !== "completed" && mid.status !== "failed") await api.live.run(jobId, c.ctx.workspaceId);
    const job = await api.discovery.get(c.ctx, jobId);
    const results = (await api.discovery.results(c.ctx, jobId, 0)).results;
    const dupCreators = await owner<{ n: number }>(`select count(*)::int n from (select handle from gcp.creator_profiles group by platform, handle having count(*) > 1) x`);
    const dupResults = await owner<{ n: number }>(`select count(*)::int n from (select creator_id from wp.discovery_results where job_id = '${jobId}' group by 1 having count(*) > 1) x`);
    const charges = await owner<{ n: number }>(`select count(*)::int n from wp.credit_ledger where workspace_id = '${c.workspaceId}' and kind = 'spend'`);
    evidence("P-08", { firstAttempt: first, statusAfterFirst: mid.status, final: { status: job.status, outcome: job.outcome, charged: job.live?.creditsCharged }, delivered: results.length, duplicateCreators: dupCreators[0]?.n, duplicateResults: dupResults[0]?.n, chargeLedgerRows: charges[0]?.n });
    expect(dupCreators[0]?.n).toBe(0);
    expect(dupResults[0]?.n).toBe(0);
    expect(job.status).toMatch(/completed|failed/);
    expect(await ledgerMismatches(api.billing, c.workspaceId)).toEqual([]);
    expect((await api.balance(c.ctx)).reserved).toBe(0);
  });

  it("P-09 delivered creators reach Brain 1 only after the outbox event is processed; timings recorded", async () => {
    const api = await buildApi({ fixtures: { web: webFor(() => LAHORE(8)) } });
    const c = await customer(api);
    const { jobId } = await api.startLive(c.ctx, brief.text, brief.filters);
    const { results } = await runToEnd(api, c.ctx, jobId);
    const committedAt = Date.now();
    const before = (await api.search(c.headers, "food lahore", {})).json() as { results: { id: string }[] };
    const pending = await owner<{ id: string; aggregate_id: string }>(`select id, aggregate_id from platform.outbox where event_type = 'creator.changed' and published_at is null`);
    const { indexer } = await import("./harness");
    await indexer.sync([...new Set(pending.map((p) => p.aggregate_id))]);
    const indexedAt = Date.now();
    const after = (await api.search(c.headers, "food lahore", {})).json() as { results: { id: string }[] };
    const searchableAt = Date.now();
    const deliveredIds = results.map((r) => r.id);
    evidence("P-09", { delivered: deliveredIds.length, outboxEvents: pending.length, foundBeforeIndexing: before.results.filter((r) => deliveredIds.includes(r.id)).length, foundAfterIndexing: after.results.filter((r) => deliveredIds.includes(r.id)).length, msCommitToIndexed: indexedAt - committedAt, msCommitToSearchable: searchableAt - committedAt });
    expect(before.results.filter((r) => deliveredIds.includes(r.id))).toEqual([]);
    expect(pending.length).toBeGreaterThanOrEqual(deliveredIds.length);
    expect(after.results.map((r) => r.id).sort()).toEqual(expect.arrayContaining(deliveredIds));
  });
});

describe("live query variations (VAR-L)", () => {
  /** Any Lahore food wording reaches the same eight profiles; Karachi wording reaches different ones. */
  const web = () => webFor((q) => (/karachi|کراچی/i.test(q.query) ? LAHORE(8, "khi_food") : LAHORE(8)));

  it("VAR-L01/L02/L04 equivalent briefs (English, blogger, exact repeat) deliver the same creators without duplicate rows", async () => {
    const api = await buildApi({ fixtures: { web: web() } });
    const c = await customer(api, 20_000);
    const briefs = [
      { id: "VAR-L01", text: "food vlogger", filters: { platform: "instagram", creatorCity: "Lahore" } },
      { id: "VAR-L02", text: "food blogger", filters: { platform: "instagram", creatorCity: "Lahore" } },
      { id: "VAR-L04", text: "food vlogger", filters: { platform: "instagram", creatorCity: "Lahore" } },
    ];
    const seen = new Map<string, string>();
    for (const b of briefs) {
      const webCallsBefore = api.web.calls.length;
      const balBefore = await api.balance(c.ctx);
      const { jobId, estimate } = await api.startLive(c.ctx, b.text, b.filters, 10);
      const { job, results } = await runToEnd(api, c.ctx, jobId);
      const balAfter = await api.balance(c.ctx);
      const rows = await committed(results.map((r) => r.handle));
      for (const r of results) {
        const prev = seen.get(r.handle);
        expect(prev === undefined || prev === r.id).toBe(true);
        seen.set(r.handle, r.id);
      }
      evidence(b.id, { brief: b, quote: estimate.maxCredits, outcome: job.outcome, delivered: results.map((r) => ({ handle: r.handle, isNew: r.isNew })), newCreators: results.filter((r) => r.isNew).length, reused: results.filter((r) => !r.isNew).length, committedRows: rows.length, providerWebCalls: api.web.calls.length - webCallsBefore, charged: job.live?.creditsCharged, balanceDelta: balBefore.available - balAfter.available });
      expect(results.length).toBeGreaterThan(0);
      expect(rows.length).toBe(results.length);
      expect(job.live?.creditsCharged).toBe(balBefore.available - balAfter.available);
    }
    const dup = await owner<{ n: number }>(`select count(*)::int n from (select platform, canonical_url from gcp.creator_profiles group by 1,2 having count(*) > 1) x`);
    expect(dup[0]?.n).toBe(0);
    expect(new Set(seen.values()).size).toBe(seen.size);
  });

  // KNOWN DEFECT (reported FAIL): Brain 1 reads the Roman Urdu "khana" as food, but the Live Discovery fit check does
  // not, so the same food creators (English bios, food posts) are not delivered for a "khana" brief. Not fixed: Live
  // Discovery selection and Campaign Fit are frozen with Search. `it.fails` keeps the suite runnable.
  it.fails("VAR-L03 KNOWN DEFECT a Roman Urdu brief (khana, Lahore) delivers the food creators an English brief delivers", async () => {
    const api = await buildApi({ fixtures: { web: web() } });
    const c = await customer(api, 20_000);
    const en = await api.startLive(c.ctx, "food vlogger", { platform: "instagram", creatorCity: "Lahore" }, 10);
    const ren = await runToEnd(api, c.ctx, en.jobId);
    const ru = await api.startLive(c.ctx, "khana", { platform: "instagram", creatorCity: "Lahore" }, 10);
    const rru = await runToEnd(api, c.ctx, ru.jobId);
    const reasons = await owner<{ stage: string; decision: string; reason: string | null; n: number }>(`select stage, decision, reason, count(*)::int n from wp.discovery_candidates where job_id = '${ru.jobId}' group by 1,2,3 order by 4 desc`);
    evidence("VAR-L03", { english: { outcome: ren.job.outcome, delivered: ren.results.length }, romanUrdu: { outcome: rru.job.outcome, delivered: rru.results.length, charged: rru.job.live?.creditsCharged }, romanUrduReasons: reasons });
    expect(rru.results.length).toBeGreaterThan(0);
  });

  it("VAR-L05a changed city is a different brief: different provider queries and different creators, no reuse of the Lahore results", async () => {
    const api = await buildApi({ fixtures: { web: web() } });
    const c = await customer(api, 20_000);
    const a = await api.startLive(c.ctx, "food vlogger", { platform: "instagram", creatorCity: "Lahore" }, 5);
    const ra = await runToEnd(api, c.ctx, a.jobId);
    const b = await api.startLive(c.ctx, "food vlogger", { platform: "instagram", creatorCity: "Karachi" }, 5);
    const rb = await runToEnd(api, c.ctx, b.jobId);
    evidence("VAR-L05", { lahore: ra.results.map((r) => r.handle), karachi: rb.results.map((r) => r.handle), queries: api.web.calls.map((q) => q.query) });
    expect(rb.results.every((r) => r.handle.startsWith("khi_food"))).toBe(true);
    expect(ra.results.every((r) => r.handle.startsWith("lhr_food"))).toBe(true);
  });

  it("VAR-L06 an exact repeat within the cache window reuses cached provider searches (no new web calls) but is a new run", async () => {
    const api = await buildApi({ fixtures: { web: web() } });
    const c = await customer(api, 20_000);
    const a = await api.startLive(c.ctx, "food vlogger", { platform: "instagram", creatorCity: "Lahore" }, 5);
    await runToEnd(api, c.ctx, a.jobId);
    const calls = api.web.calls.length;
    const b = await api.startLive(c.ctx, "food vlogger", { platform: "instagram", creatorCity: "Lahore" }, 5);
    const rb = await runToEnd(api, c.ctx, b.jobId);
    evidence("VAR-L06", { firstRunWebCalls: calls, secondRunWebCalls: api.web.calls.length - calls, secondJobDistinct: a.jobId !== b.jobId, secondCharged: rb.job.live?.creditsCharged });
    expect(api.web.calls.length).toBe(calls);
    expect(b.jobId).not.toBe(a.jobId);
  });

  it("VAR-L07 a changed size (5 vs 10) is a different estimate and job, never the cached open job", async () => {
    const api = await buildApi({ fixtures: { web: web() } });
    const c = await customer(api, 20_000);
    const e5 = await api.discovery.createEstimate(c.ctx, { search: { text: "food vlogger", filters: { niches: [], verifiedOnly: false, hasContact: false, freshOnly: false, platform: "instagram", creatorCity: "Lahore" } }, maxNew: 5 });
    const e10 = await api.discovery.createEstimate(c.ctx, { search: { text: "food vlogger", filters: { niches: [], verifiedOnly: false, hasContact: false, freshOnly: false, platform: "instagram", creatorCity: "Lahore" } }, maxNew: 10 });
    evidence("VAR-L07", { five: e5.maxCredits, ten: e10.maxCredits, distinct: e5.estimateId !== e10.estimateId });
    expect(e5.maxCredits).toBe(100);
    expect(e10.maxCredits).toBe(150);
    expect(e5.estimateId).not.toBe(e10.estimateId);
  });
});
