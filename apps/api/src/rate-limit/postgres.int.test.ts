import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, dbError, ownerQuery, resetTables } from "@mushin/db/testing";
import { PostgresRateLimiter } from "./postgres";
import { bucketsFromConfig, limitPaidStart } from "./types";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

const buckets = { ...bucketsFromConfig({ windowMs: 60_000, maxRequests: 3 }), jobs: { limit: 2, windowSeconds: 3600 } };

describe("PostgreSQL rate limiter (platform.rate_limit_hit)", () => {
  it("allows up to the limit, then refuses with a retry delay, per bucket and key", async () => {
    const limiter = new PostgresRateLimiter(db, buckets);
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await limiter.limit("ip", "203.0.113.7"));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(results[3]?.retryAfterSeconds).toBeLessThanOrEqual(60);
    // Another key and another bucket are counted separately.
    expect((await limiter.limit("ip", "203.0.113.8")).allowed).toBe(true);
    expect((await limiter.limit("user", "203.0.113.7")).allowed).toBe(true);
  });

  it("counts concurrent hits atomically (no lost updates)", async () => {
    const limiter = new PostgresRateLimiter(db, { ...buckets, ip: { limit: 10, windowSeconds: 60 } });
    const results = await Promise.all(Array.from({ length: 25 }, () => limiter.limit("ip", "198.51.100.1")));
    // A window boundary during the burst can only lower the count, never raise it above the limit.
    expect(results.filter((r) => r.allowed).length).toBeLessThanOrEqual(10);
    // Only admitted requests are counted (0069): refused hits are taken back.
    const [row] = await ownerQuery<{ total: number }>("select coalesce(sum(hits), 0)::int as total from platform.rate_limit_counters where bucket = 'ip'");
    expect(row?.total).toBe(results.filter((r) => r.allowed).length);
  });

  // Security hardening 2026-11-03 (0069): retrying while refused must not push the count up and extend the lockout.
  it("does not count refused requests, so a retry storm cannot lock a client out for longer", async () => {
    const limiter = new PostgresRateLimiter(db, { ...buckets, jobs: { limit: 3, windowSeconds: 3600 } });
    const results = [];
    for (let i = 0; i < 20; i += 1) results.push(await limiter.limit("jobs", "user-7"));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    const [row] = await ownerQuery<{ hits: number }>("select sum(hits)::int as hits from platform.rate_limit_counters where bucket = 'jobs'");
    expect(row?.hits).toBe(3);
  });

  it("shares one limit across API instances (two processes with their own connection pools)", async () => {
    const second = createTestDatabase();
    try {
      const a = new PostgresRateLimiter(db, { ...buckets, user: { limit: 6, windowSeconds: 60 } });
      const b = new PostgresRateLimiter(second, { ...buckets, user: { limit: 6, windowSeconds: 60 } });
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).limit("user", "user-42")));
      expect(results.filter((r) => r.allowed).length).toBeLessThanOrEqual(6);
      expect(results.filter((r) => !r.allowed).length).toBeGreaterThanOrEqual(4);
    } finally {
      await second.close();
    }
  });

  it("stores only hashed keys, never the raw IP or id", async () => {
    await new PostgresRateLimiter(db, buckets).limit("ip", "192.0.2.44");
    const rows = await ownerQuery<{ key_hash: string }>("select key_hash from platform.rate_limit_counters");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.key_hash).not.toContain("192.0.2.44");
  });

  it("weights the previous window (sliding estimate), so a burst at a window edge is not doubled", async () => {
    const window = 3600;
    const start = Math.floor(Date.now() / 1000 / window) * window;
    const key = "a".repeat(64);
    // Ten hits in the previous window; early in the current one most of them still count.
    await ownerQuery(`insert into platform.rate_limit_counters values ('jobs', '${key}', to_timestamp(${start - window}), 10)`);
    const [r] = await ownerQuery<{ retry: number }>(`select platform.rate_limit_hit('jobs', '${key}', 10, ${window}) as retry`);
    const elapsed = Date.now() / 1000 - start;
    // Allowed only if the previous window's weighted share has fallen to 9 or less.
    if (10 * (1 - elapsed / window) + 1 > 10) expect(Number(r?.retry)).toBeGreaterThan(0);
    else expect(Number(r?.retry)).toBe(0);
  });

  it("enforces paid-start limits per user (fails closed in the database)", async () => {
    const limiter = new PostgresRateLimiter(db, buckets);
    const ctx = { userId: "user-1", workspaceId: "ws-1" };
    await limitPaidStart(limiter, ctx);
    await limitPaidStart(limiter, ctx);
    await expect(limitPaidStart(limiter, ctx)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("refuses invalid limits and is not callable by the customer role", async () => {
    await expect(ownerQuery(`select platform.rate_limit_hit('ip', '${"b".repeat(64)}', 0, 60)`)).rejects.toSatisfy(dbError(/must be positive/));
    await expect(ownerQuery(`set role mushin_app; select platform.rate_limit_hit('ip', '${"b".repeat(64)}', 5, 60)`)).rejects.toSatisfy(dbError(/permission denied/));
  });

  it("purges windows older than a day", async () => {
    const key = "c".repeat(64);
    await ownerQuery(`insert into platform.rate_limit_counters values ('ip', '${key}', now() - interval '2 days', 3), ('ip', '${key}', now(), 1)`);
    const [r] = await ownerQuery<{ n: number }>("select platform.rate_limit_purge() as n");
    expect(r?.n).toBe(1);
  });
});
