import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDbProviderRunStore, createDbReservationLedger } from "./provider-runs";
import { createTestDatabase, ownerQuery, resetTables } from "./testing";

/** Audit SRCH-04/05: provider budget reservations and paid-run records in PostgreSQL. */
const db = createTestDatabase();
const second = createTestDatabase(); // a second worker process: its own connection pool
beforeEach(resetTables);
afterAll(async () => {
  await db.close();
  await second.close();
});

const since = new Date(Date.UTC(2000, 0, 1));
const apify = (amount: number, limit: number) => ({ provider: "apify" as const, amount, limit, measure: "cost_usd" as const, since, leaseMs: 30 * 60_000 });

describe("shared provider budget (audit SRCH-05)", () => {
  it("two worker processes racing near the cap cannot pass it together", async () => {
    const a = createDbReservationLedger(db);
    const b = createDbReservationLedger(second);
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).reserve(apify(0.05, 1))));
    expect(results.filter((r) => "release" in r)).toHaveLength(20);
    expect(results.filter((r) => "refused" in r)).toHaveLength(10);
  });

  it("counts recorded spend, frees capacity on release, and ignores expired leases", async () => {
    await ownerQuery(`insert into platform.provider_calls (provider, operation, cost_usd, latency_ms, status) values ('apify', 'scrape', 0.9, 1, 'ok')`);
    const ledger = createDbReservationLedger(db);
    const first = await ledger.reserve(apify(0.05, 1));
    const secondRes = await ledger.reserve(apify(0.05, 1));
    expect("release" in first && "release" in secondRes).toBe(true);
    expect(await ledger.reserve(apify(0.05, 1))).toMatchObject({ refused: { used: 0.9, open: 0.1 } });
    if ("release" in first) await first.release();
    expect("release" in (await ledger.reserve(apify(0.05, 1)))).toBe(true);
    // A crashed process's reservation lapses with its lease.
    await ownerQuery(`update platform.provider_reservations set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where released_at is null`);
    expect("release" in (await ledger.reserve(apify(0.05, 1)))).toBe(true);
  });

  it("caps Serper by number of searches", async () => {
    const ledger = createDbReservationLedger(db);
    const serper = { provider: "serper" as const, amount: 1, limit: 2, measure: "calls" as const, since, leaseMs: 60_000 };
    await ownerQuery(`insert into platform.provider_calls (provider, operation, cost_usd, latency_ms, status) values ('serper', 'search', 0, 1, 'ok')`);
    expect("release" in (await ledger.reserve(serper))).toBe(true);
    expect(await ledger.reserve(serper)).toMatchObject({ refused: { used: 1, open: 1 } });
  });
});

describe("paid provider runs (audit SRCH-04)", () => {
  it("claims a run once, resumes it, and settles it once", async () => {
    const store = createDbProviderRunStore(db);
    const second = createDbProviderRunStore(db);
    const key = "apify:job-1:actor:abcdef";
    const c1 = await store.claim({ runKey: key, actor: "apify/instagram-profile-scraper", jobId: null, workspaceId: null });
    const c2 = await second.claim({ runKey: key, actor: "apify/instagram-profile-scraper", jobId: null, workspaceId: null });
    expect([c1.created, c2.created]).toEqual([true, false]);
    await store.attach(key, "run-42");
    expect((await second.claim({ runKey: key, actor: "x", jobId: null, workspaceId: null })).run).toEqual({ runKey: key, externalRunId: "run-42", status: "running", costRecorded: false });
    expect(await store.open(new Date(Date.now() + 60_000))).toHaveLength(1);
    await store.finish(key, "succeeded", 0.0213);
    await store.finish(key, "failed", 9); // a late second settlement changes nothing
    const [row] = await ownerQuery<{ status: string; cost_usd: string; cost_recorded: boolean }>(`select status, cost_usd, cost_recorded from platform.provider_runs`);
    expect(row).toEqual({ status: "succeeded", cost_usd: "0.021300", cost_recorded: true });
    expect(await store.open(new Date(Date.now() + 60_000))).toEqual([]);
  });
});
