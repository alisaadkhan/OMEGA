/**
 * Acceptance: caching, PostgreSQL search projection, outbox delivery and recovery (IDX-*). Uses the worker's real outbox
 * relay and creator handlers, delivering events in-process (instead of pg-boss) so failures can be injected exactly.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetTables } from "@mushin/db/testing";
import { FixtureWebSearch } from "@mushin/integrations";
import { createOutboxRelay } from "../../../worker/src/relay";
import { creatorHandlers } from "../../../worker/src/creator-handlers";
import { createCachedSearch } from "../modules/discovery/index";
import { buildApi, db, evidence, externalAttempts, indexer, logger, owner, percentile, synthetic } from "./harness";

beforeEach(resetTables);
afterAll(() => expect(externalAttempts).toEqual([]));

const handlers = creatorHandlers({ indexer, summaries: { generate: async () => "skipped" } as never });
/** pg-boss stand-in: delivers creator events to the real worker handler; `fail` injects a broker outage. */
function relay(o: { fail?: () => boolean; delivered?: string[] } = {}) {
  return createOutboxRelay({
    db,
    logger,
    publish: async (_queue, data) => {
      if (o.fail?.()) throw new Error("broker unavailable (injected)");
      o.delivered?.push(data.eventType);
      const h = handlers[data.eventType];
      if (h) await h(data, { logger, jobId: randomUUID() });
    },
  });
}
const doc = (id: string) => owner<{ followers: number; eligible: boolean; eligibility_version: string; bio: string }>(`select followers, eligible, eligibility_version, bio from gcp.creator_search_documents where creator_id = '${id}'`);
const pendingFor = (id: string) => owner<{ id: string; attempts: number; published_at: string | null }>(`select id, attempts, published_at::text from platform.outbox where event_type = 'creator.changed' and aggregate_id = '${id}'`);

/** A creator saved the way production saves one (enrichment pipeline → creator + outbox row in one transaction). */
async function saveThroughPipeline(api: Awaited<ReturnType<typeof buildApi>>, workspaceId: string, handle: string, bio = "Food vlogger in Lahore") {
  const { igProfile } = await import("./harness");
  const job = { jobId: randomUUID(), workspaceId, platform: "instagram" as const, handle, canonicalUrl: `https://instagram.com/${handle}`, requestId: null };
  const raw = igProfile(handle, bio);
  const payloadId = await api.pipeline.archive(job, "apify", raw);
  let id = "";
  await api.pipeline.processProfile(job, payloadId, raw, { onSaved: async (_tx, s) => void (id = s.creatorId) });
  return id;
}

describe("outbox and search projection (IDX)", () => {
  it("IDX-01 saving a creator writes its creator.changed event in the same transaction (a rolled-back save leaves neither)", async () => {
    const api = await buildApi();
    const u = await api.person();
    const id = await saveThroughPipeline(api, u.workspaceId, "idx_one");
    const ok = await pendingFor(id);
    const job = { jobId: randomUUID(), workspaceId: u.workspaceId, platform: "instagram" as const, handle: "idx_rollback", canonicalUrl: "https://instagram.com/idx_rollback", requestId: null };
    const { igProfile } = await import("./harness");
    const raw = igProfile("idx_rollback", "Food vlogger in Lahore");
    const payloadId = await api.pipeline.archive(job, "apify", raw);
    await api.pipeline.processProfile(job, payloadId, raw, { onSaved: async () => { throw new Error("injected"); } }).catch(() => undefined);
    const rolled = await owner<{ n: number }>(`select count(*)::int n from gcp.creator_profiles where handle = 'idx_rollback'`);
    const orphanEvents = await owner<{ n: number }>(`select count(*)::int n from platform.outbox o where o.event_type = 'creator.changed' and not exists (select 1 from gcp.creators c where c.id::text = o.aggregate_id::text)`);
    evidence("IDX-01", { eventsForSaved: ok.length, rolledBackRows: rolled[0]?.n, orphanEvents: orphanEvents[0]?.n });
    expect(ok).toHaveLength(1);
    expect(rolled[0]?.n).toBe(0);
    expect(orphanEvents[0]?.n).toBe(0);
  });

  it("IDX-02 the relay publishes the event, marks it published, and the worker handler builds the search document", async () => {
    const api = await buildApi();
    const u = await api.person();
    const id = await saveThroughPipeline(api, u.workspaceId, "idx_two");
    const before = await doc(id);
    const delivered: string[] = [];
    const drained = await relay({ delivered }).drainOnce();
    const after = await doc(id);
    const ev = await pendingFor(id);
    evidence("IDX-02", { docBefore: before.length, drained, delivered, docAfter: after, event: ev });
    expect(before).toEqual([]);
    expect(after).toHaveLength(1);
    expect(ev[0]?.published_at).not.toBeNull();
  });

  it("IDX-03 delivering the same event twice (at-least-once broker) leaves one identical document", async () => {
    const api = await buildApi();
    const u = await api.person();
    const id = await saveThroughPipeline(api, u.workspaceId, "idx_three");
    await relay().drainOnce();
    const first = await doc(id);
    const h = handlers["creator.changed"];
    await h?.({ eventId: randomUUID(), eventType: "creator.changed", aggregateType: "creator", aggregateId: id, workspaceId: null, requestId: null, payload: { creatorId: id } }, { logger, jobId: "dup" });
    const second = await doc(id);
    const count = await owner<{ n: number }>(`select count(*)::int n from gcp.creator_search_documents where creator_id = '${id}'`);
    evidence("IDX-03", { first, second, rows: count[0]?.n });
    expect(count[0]?.n).toBe(1);
    expect(second).toEqual(first);
  });

  it("IDX-04 a broker outage marks the event failed and a later drain delivers it; the creator row is never lost", async () => {
    const api = await buildApi();
    const u = await api.person();
    const id = await saveThroughPipeline(api, u.workspaceId, "idx_four");
    await relay({ fail: () => true }).drainOnce();
    const failed = await pendingFor(id);
    const rowWhileDown = await owner<{ n: number }>(`select count(*)::int n from gcp.creators where id = '${id}'`);
    await relay().drainOnce();
    const after = await pendingFor(id);
    evidence("IDX-04", { afterOutage: failed, creatorRowWhileDown: rowWhileDown[0]?.n, afterRecovery: after, doc: await doc(id) });
    expect(failed[0]).toMatchObject({ attempts: 1, published_at: null });
    expect(rowWhileDown[0]?.n).toBe(1);
    expect(after[0]?.published_at).not.toBeNull();
    expect(await doc(id)).toHaveLength(1);
  });

  it("IDX-05 when the index handler itself fails, the database row is intact and reconciliation repairs the projection", async () => {
    const id = await synthetic({ name: "Unindexed", niches: ["Food"], bio: "food" }, { index: false });
    const missing = await doc(id);
    const repaired = await indexer.reconcile();
    evidence("IDX-05", { docBefore: missing.length, repaired, docAfter: (await doc(id)).length });
    expect(missing).toEqual([]);
    expect(repaired.upserted).toBeGreaterThanOrEqual(1);
    expect(await doc(id)).toHaveLength(1);
  });

  it("IDX-06 reconciliation removes a leftover document for a creator that is no longer visible", async () => {
    const id = await synthetic({ name: "To hide", niches: ["Food"], bio: "food" });
    await owner(`update gcp.creators set status = 'removal_requested' where id = '${id}'`);
    const stale = await doc(id);
    const r = await indexer.reconcile();
    evidence("IDX-06", { staleDocBefore: stale.length, reconcile: r, after: (await doc(id)).length });
    expect(stale).toHaveLength(1);
    expect(await doc(id)).toEqual([]);
  });

  it("IDX-07 reconciliation refreshes a document whose creator changed (without an event) after the last indexing", async () => {
    const id = await synthetic({ name: "Changed", niches: ["Food"], bio: "food", followers: 30_000 });
    await new Promise((r) => setTimeout(r, 1_100));
    await owner(`update gcp.creator_profiles set followers = 99000 where creator_id = '${id}'`);
    const stale = await doc(id);
    await indexer.reconcile();
    const fresh = await doc(id);
    evidence("IDX-07", { before: stale[0]?.followers, after: fresh[0]?.followers });
    expect(Number(stale[0]?.followers)).toBe(30_000);
    expect(Number(fresh[0]?.followers)).toBe(99_000);
  });

  // KNOWN DEFECT (reported FAIL, low severity): freshness is compared in whole seconds, so an event-less change made in
  // the same second as the last indexing is never repaired. Not fixed: updated_epoch is also a ranking tie-breaker and
  // Search is frozen. `it.fails` keeps the suite runnable while the defect stands; it will flag when fixed.
  it.fails("IDX-07b KNOWN DEFECT: an event-less change in the same second as the last indexing is repaired by reconciliation", async () => {
    const id = await synthetic({ name: "Same second", niches: ["Food"], bio: "food", followers: 30_000 });
    // Made deterministic (2026-10-21): the change is stamped exactly at the indexed second instead of hoping now() lands
    // in it, which made this expected failure pass on some runs. Triggers are off for this one owner statement only, so
    // set_updated_at does not overwrite the stamp; the connection ends with the call.
    await owner(`set session_replication_role = replica;
      update gcp.creator_profiles set followers = 99000,
        updated_at = to_timestamp((select updated_epoch from gcp.creator_search_documents where creator_id = '${id}'))
      where creator_id = '${id}'`);
    await indexer.reconcile();
    const fresh = await doc(id);
    evidence("IDX-07b", { afterReconcile: fresh[0]?.followers, expected: 99_000 });
    expect(Number(fresh[0]?.followers)).toBe(99_000);
  });

  it("IDX-08 a document built under an older eligibility version is rebuilt by reconciliation", async () => {
    const id = await synthetic({ name: "Old version", niches: ["Food"], bio: "food" });
    await owner(`update gcp.creator_search_documents set eligibility_version = 'elig-0' where creator_id = '${id}'`);
    await indexer.reconcile();
    const d = await doc(id);
    evidence("IDX-08", { versionAfter: d[0]?.eligibility_version });
    expect(d[0]?.eligibility_version).not.toBe("elig-0");
  });

  it("IDX-09 commit-to-searchable delay with the relay polling as in production (no documented target; measured)", async () => {
    const api = await buildApi();
    const u = await api.person();
    await db.withWorkspace(u.workspaceId, (tx) => api.billing.engine.grant(tx, u.workspaceId, { source: "adjustment", amount: 5_000, expiresAt: new Date(Date.now() + 86_400_000), sourceRef: `idx-${randomUUID()}`, note: "acceptance" }));
    const r = relay();
    await r.start();
    const delays: number[] = [];
    try {
      for (let i = 0; i < 10; i++) {
        const word = `zzidx${i}word`;
        const committedAt = Date.now();
        await saveThroughPipeline(api, u.workspaceId, `idx_delay_${i}`, `Food vlogger based in Lahore, Pakistan ${word}`);
        let found = false;
        while (!found && Date.now() - committedAt < 15_000) {
          const res = (await api.search(u.headers, word)).json() as { results?: unknown[] };
          found = (res.results?.length ?? 0) > 0;
          if (!found) await new Promise((x) => setTimeout(x, 50));
        }
        delays.push(found ? Date.now() - committedAt : Number.POSITIVE_INFINITY);
      }
    } finally {
      await r.stop();
    }
    const s = [...delays].sort((a, b) => a - b);
    evidence("IDX-09", { samples: delays.length, msP50: percentile(s, 50), msP95: percentile(s, 95), msMax: s.at(-1), target: "none documented (B4)" });
    expect(delays.every(Number.isFinite)).toBe(true);
  });
});

describe("live search cache (IDX)", () => {
  const q = (query: string, num = 10) => ({ query, country: "pk", hl: "en", num, round: 1, kind: "role" }) as never;

  it("IDX-10 the same planned query inside the 15-minute window is served from cache (no provider call)", async () => {
    const web = new FixtureWebSearch([{ title: "a", link: "https://www.instagram.com/a/", snippet: "s" }]);
    const cache = createCachedSearch({ db, web });
    await cache.search(q("food vlogger lahore"));
    await cache.search(q("food vlogger lahore"));
    evidence("IDX-10", { providerCalls: web.calls.length });
    expect(web.calls).toHaveLength(1);
  });

  it("IDX-11 after the window the query goes to the provider again", async () => {
    let clock = Date.now();
    const web = new FixtureWebSearch([{ title: "a", link: "https://www.instagram.com/a/", snippet: "s" }]);
    const cache = createCachedSearch({ db, web, now: () => new Date(clock) });
    await cache.search(q("food vlogger lahore"));
    clock += 16 * 60_000;
    await cache.search(q("food vlogger lahore"));
    evidence("IDX-11", { providerCalls: web.calls.length });
    expect(web.calls).toHaveLength(2);
  });

  it("IDX-12 the cache key covers every effective input: a different city, result count or language is a new provider call", async () => {
    const web = new FixtureWebSearch([]);
    const cache = createCachedSearch({ db, web });
    await cache.search(q("food vlogger lahore"));
    await cache.search(q("food vlogger karachi"));
    await cache.search(q("food vlogger lahore", 20));
    await cache.search({ ...(q("food vlogger lahore") as object), hl: "ur" } as never);
    evidence("IDX-12", { providerCalls: web.calls.length });
    expect(web.calls).toHaveLength(4);
  });

  it("IDX-13 the shared cache holds only public search results, with no workspace or person in it", async () => {
    const web = new FixtureWebSearch([{ title: "a", link: "https://www.instagram.com/a/", snippet: "s" }]);
    await createCachedSearch({ db, web }).search(q("food vlogger lahore"));
    const table = await owner<{ table_name: string }>(`select distinct c.table_name from information_schema.columns c where c.table_schema in ('platform','wp') and c.table_name ilike '%serper%' or c.table_name ilike '%search_cache%'`);
    const cols = table[0] ? await owner<{ column_name: string }>(`select column_name from information_schema.columns where table_name = '${table[0].table_name}'`) : [];
    evidence("IDX-13", { table: table.map((t) => t.table_name), columns: cols.map((c) => c.column_name) });
    expect(cols.length).toBeGreaterThan(0);
    expect(cols.map((c) => c.column_name)).not.toContain("workspace_id");
    expect(cols.map((c) => c.column_name)).not.toContain("user_id");
  });
});
