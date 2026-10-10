import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { searchFiltersSchema } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { FixtureScraper, FixtureWebSearch, MemoryStorage, MockLlm, MockPayments, ProviderError, scraperFixture, type ScrapeRequest, type WebResult } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createEnrichmentPipeline, suppress, type EnrichmentPipeline } from "../creators/index";
import { addCreator, TEST_KEY } from "../creators/test-fixtures";
import { createCachedSearch } from "./live/cache";
import { createLiveRunner } from "./live-runner";
import { createDiscoveryService } from "./service";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
const discovery = createDiscoveryService({ db, billing });
beforeEach(resetTables);
afterAll(() => db.close());

const profile = (username: string, bio = "Bridal makeup artist in Lahore") => {
  const one = structuredClone((scraperFixture("instagram-profile.json") as Record<string, unknown>[])[0] ?? {});
  return [{ ...one, username, biography: bio }];
};

/** Instagram replies per handle: a private account for "private_c", a 16-year-old's bio for "minor_m", a normal profile otherwise. */
function igScraper() {
  return new FixtureScraper({
    instagram: (req: ScrapeRequest) =>
      req.handle === "private_c"
        ? { provider: "apify", raw: scraperFixture("instagram-private.json"), costUsd: 0.0026 }
        : { provider: "apify", raw: profile(req.handle, req.handle === "minor_m" ? "16 years old, makeup lover" : undefined), costUsd: 0.0026 },
  });
}

const links = (...handles: string[]): WebResult[] => handles.map((h) => ({ title: `${h} | Bridal MUA`, link: `https://www.instagram.com/${h}/`, snippet: "Bridal makeup, Lahore" }));

/** The relevance filter keeps everything in order; assessments are valid for whatever range was measured. */
const llm = () =>
  new MockLlm((req) => {
    if (req.feature === "discovery_relevance") {
      const n = (req.input.match(/^\d+\. /gm) ?? []).length;
      return { keep: Array.from({ length: n }, (_, i) => ({ i, reason: "Bridal makeup in Lahore" })) };
    }
    const m = /Range: (\d+)–(\d+)/.exec(req.input);
    const score = m ? Math.round((Number(m[1]) + Number(m[2])) / 2) : null;
    const signal = /^(\w+) \(/m.exec(req.input.split("<signals>")[1] ?? "")?.[1] ?? "engagement_vs_tier";
    return {
      verdict: score === null ? null : score >= 80 ? "genuine" : score >= 60 ? "mostly genuine" : score >= 40 ? "mixed signals" : "likely inflated",
      score,
      evidence: score === null ? [] : [{ signal, detail: "Measured from recent posts." }],
      watchOuts: [],
      audience: { age: [], gender: null, cities: [], countries: [] },
      niches: [],
      creatorCity: null,
      creatorCountry: null,
      minorSigns: { likely: false, reason: "" },
    };
  });

function setup(o: { web?: FixtureWebSearch; scraper?: FixtureScraper; wrap?: (p: EnrichmentPipeline) => EnrichmentPipeline } = {}) {
  const web = o.web ?? new FixtureWebSearch(links("new_a", "new_b"));
  const scraper = o.scraper ?? igScraper();
  const model = llm();
  const base = createEnrichmentPipeline({ db, scraper, storage: new MemoryStorage(), llm: model, encryptionKey: TEST_KEY, logger, fetchImage: async () => new Response("", { status: 404 }) });
  const pipeline = o.wrap ? o.wrap(base) : base;
  const runner = createLiveRunner({ db, billing, pipeline, scraper, search: createCachedSearch({ db, web }), llm: model, logger });
  return { runner, web, scraper };
}

async function customer(): Promise<TenantContext> {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" };
}
const balance = async (c: TenantContext) => (await billing.summary(c)).balance;

async function startRun(c: TenantContext, maxNew: 5 | 10 = 10): Promise<string> {
  const out = await discovery.start(c, { kind: "live", search: { text: "bridal makeup", filters: searchFiltersSchema.parse({ platform: "instagram", creatorCity: "Lahore" }) }, maxNew, confirmedCost: 12 + maxNew * 10 });
  if (out.body.status !== "started") throw new Error("expected started");
  return out.body.job.id;
}

describe("live runner", () => {
  it("merges a known creator for free, adds new ones in one Apify run, skips a private one and charges only for what was added", async () => {
    const known = await addCreator(db, { displayName: "Known One", profiles: [{ platform: "instagram", handle: "known_one" }] });
    const { runner, web, scraper } = setup({ web: new FixtureWebSearch(links("known_one", "new_a", "new_b", "private_c")) });
    const c = await customer();
    const id = await startRun(c);
    await runner.run(id, c.workspaceId);
    const job = await discovery.get(c, id);
    expect(job).toMatchObject({ status: "completed", live: { found: 3, new: 2, known: 1, creditsCharged: 32 } });
    expect(await balance(c)).toMatchObject({ available: 168, reserved: 0 });
    const res = await discovery.results(c, id, 0);
    expect(res.done).toBe(true);
    expect(res.results.find((r) => r.id === known)).toMatchObject({ isNew: false });
    expect(res.results.filter((r) => r.isNew)).toHaveLength(2);
    expect(scraper.batchCalls).toHaveLength(1);
    expect(scraper.batchCalls[0]?.handles.sort()).toEqual(["new_a", "new_b", "private_c"]);
    expect(web.calls).toHaveLength(2); // "bridal makeup lahore" and "bridal makeup content creator lahore"
    const payloads = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.raw_payloads where job_id = '${id}'`);
    expect(payloads[0]?.n).toBe(3);
    const ev = await ownerQuery<{ n: number }>(`select count(*)::int n from platform.outbox where event_type = 'notify.discovery_job_finished'`);
    expect(ev[0]?.n).toBe(1);
  });

  it("a run that finds nothing is free", async () => {
    const { runner } = setup({ web: new FixtureWebSearch([]) });
    const c = await customer();
    const id = await startRun(c);
    await runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", live: { found: 0, creditsCharged: 0 } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });
  });

  it("stops at the chosen number of new creators", async () => {
    const { runner, scraper } = setup({ web: new FixtureWebSearch(links("n1", "n2", "n3", "n4", "n5", "n6", "n7")) });
    const c = await customer();
    const id = await startRun(c, 5);
    await runner.run(id, c.workspaceId);
    expect(scraper.batchCalls[0]?.handles).toHaveLength(5);
    expect(await discovery.get(c, id)).toMatchObject({ live: { new: 5, creditsCharged: 62 } });
  });

  it("a new creator flagged as a possible minor is saved but costs nothing (Review Focus 1)", async () => {
    const { runner } = setup({ web: new FixtureWebSearch(links("new_a", "minor_m")) });
    const c = await customer();
    const id = await startRun(c);
    await runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ live: { new: 2, creditsCharged: 22 } });
    expect((await discovery.results(c, id, 0)).results.map((r) => r.handle)).toEqual(["new_a"]);
  });

  it("candidates on the do-not-re-add list are dropped (Review Focus 5)", async () => {
    await db.withSystem((tx) => suppress(tx, [{ canonicalUrl: "https://instagram.com/new_b", platform: "instagram" }], null));
    const { runner, scraper } = setup();
    const c = await customer();
    await runner.run(await startRun(c), c.workspaceId);
    expect(scraper.batchCalls[0]?.handles).toEqual(["new_a"]);
  });

  it("a retry reuses cached searches and archived profiles and charges once (Review Focus 2, 3)", async () => {
    let crash = true;
    const { runner, web, scraper } = setup({
      wrap: (p) => ({
        ...p,
        processProfile: async (job, payloadId, raw, hooks) => {
          if (crash && job.handle === "new_b") {
            crash = false;
            throw new Error("worker crashed");
          }
          return p.processProfile(job, payloadId, raw, hooks);
        },
      }),
    });
    const c = await customer();
    const id = await startRun(c);
    await expect(runner.run(id, c.workspaceId)).rejects.toThrow(/crashed/);
    await runner.run(id, c.workspaceId);
    expect(web.calls).toHaveLength(2); // the retry reads both searches from the cache
    expect(scraper.batchCalls).toHaveLength(1);
    expect(await discovery.get(c, id)).toMatchObject({ status: "completed", live: { new: 2, creditsCharged: 32 } });
    expect(await balance(c)).toMatchObject({ available: 168, reserved: 0 });
  });

  it("the Serper limit or a provider outage fails the run and returns everything", async () => {
    const capped = setup({ web: new FixtureWebSearch(new ProviderError(false, "spend_cap", "Monthly Serper limit reached")) });
    const c = await customer();
    const id = await startRun(c);
    await capped.runner.run(id, c.workspaceId);
    expect(await discovery.get(c, id)).toMatchObject({ status: "failed", error: { code: "PROVIDER_UNAVAILABLE", message: expect.stringMatching(/paused/i) } });
    expect(await balance(c)).toMatchObject({ available: 200, reserved: 0 });

    const down = setup({ scraper: new FixtureScraper({ instagram: new ProviderError(true, "provider", "Apify answered HTTP 502") }) });
    const c2 = await customer();
    const id2 = await startRun(c2);
    await expect(down.runner.run(id2, c2.workspaceId)).rejects.toThrow(/502/);
    await expect(down.runner.run(id2, c2.workspaceId)).rejects.toThrow(/502/);
    await down.runner.run(id2, c2.workspaceId);
    expect(await discovery.get(c2, id2)).toMatchObject({ status: "failed", error: { code: "PROVIDER_UNAVAILABLE" } });
    expect(await balance(c2)).toMatchObject({ available: 200, reserved: 0 });
  });
});
