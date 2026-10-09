import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { providerSpendSince } from "./provider-calls";
import { createTestDatabase, createTestWorkspace, dbError, ownerQuery, resetTables } from "./testing";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

async function creatorWithProfile(): Promise<{ creatorId: string; profileId: string }> {
  const creatorId = randomUUID();
  const profileId = randomUUID();
  await ownerQuery(`
    insert into gcp.creators (id, display_name, primary_handle, primary_platform) values ('${creatorId}', 'C', 'c_${creatorId.slice(0, 6)}', 'instagram');
    insert into gcp.creator_profiles (id, creator_id, platform, handle, canonical_url) values ('${profileId}', '${creatorId}', 'instagram', 'c', 'https://instagram.com/c_${creatorId.slice(0, 6)}');`);
  return { creatorId, profileId };
}

const insertJob = (ws: { userId: string; workspaceId: string }, url: string) =>
  db.withTenant(ws, (tx) =>
    tx.execute(sql`insert into wp.discovery_jobs (workspace_id, kind, requested_by, input_url, platform, handle, canonical_url, cost)
      values (${ws.workspaceId}, 'add_by_url', ${ws.userId}, ${url}, 'instagram', 'c', ${url}, 10) returning id`),
  );

describe("creator pipeline tables", () => {
  it("prices TikTok refreshes at 30 credits and accepts the action in reservations and the ledger", async () => {
    const rows = await ownerQuery<{ credits: number }>(`select credits from platform.credit_action_costs where action = 'refresh_tiktok'`);
    expect(rows).toEqual([{ credits: 30 }]);
    const ws = await createTestWorkspace();
    await expect(
      ownerQuery(`insert into wp.credit_reservations (workspace_id, amount, action, confirmed_cost, status, ref_type, ref_id, expires_at, spend_scope)
        values ('${ws.workspaceId}', 30, 'refresh_tiktok', 30, 'held', 'discovery_job', 'x', now() + interval '15 minutes', 'all')`),
    ).resolves.toBeDefined();
  });

  it("keeps jobs private to their workspace and allows one open job per profile", async () => {
    const a = await createTestWorkspace();
    const b = await createTestWorkspace();
    await insertJob(a, "https://instagram.com/c");
    await expect(insertJob(a, "https://instagram.com/c")).rejects.toSatisfy(dbError(/discovery_jobs_one_open/));
    await expect(insertJob(b, "https://instagram.com/c")).resolves.toBeDefined();
    const seenByB = await db.withTenant(b, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int n from wp.discovery_jobs`));
    expect(seenByB[0]?.n).toBe(1);
    await ownerQuery(`update wp.discovery_jobs set status = 'completed' where workspace_id = '${a.workspaceId}'`);
    await expect(insertJob(a, "https://instagram.com/c")).resolves.toBeDefined();
  });

  it("lets only the worker find stuck jobs across workspaces", async () => {
    const a = await createTestWorkspace();
    await insertJob(a, "https://instagram.com/stuck");
    await ownerQuery(`update wp.discovery_jobs set created_at = now() - interval '2 hours'`);
    const found = await db.withSystem((tx) => tx.execute<{ workspace_id: string }>(sql`select * from platform.stuck_discovery_jobs(30)`));
    expect(found.map((r) => r.workspace_id)).toEqual([a.workspaceId]);
    await expect(db.withTenant(a, (tx) => tx.execute(sql`select * from platform.stuck_discovery_jobs(30)`))).rejects.toSatisfy(dbError(/permission denied/));
  });

  it("keeps metric snapshots append-only and readable by the API role only through creators", async () => {
    const { profileId } = await creatorWithProfile();
    await db.withSystem((tx) => tx.execute(sql`insert into gcp.profile_metric_snapshots (profile_id, followers) values (${profileId}, 100)`));
    await expect(db.withSystem((tx) => tx.execute(sql`update gcp.profile_metric_snapshots set followers = 1`))).rejects.toSatisfy(dbError(/permission denied/));
    await expect(db.withSystem((tx) => tx.execute(sql`delete from gcp.profile_metric_snapshots`))).rejects.toSatisfy(dbError(/permission denied/));
  });

  it("stores linked accounts and raw payload index rows, and seeds the enrichment settings", async () => {
    const { creatorId } = await creatorWithProfile();
    await db.withSystem(async (tx) => {
      await tx.execute(sql`insert into gcp.creator_links (creator_id, platform, url, source) values (${creatorId}, 'website', 'https://example.com', 'profile_link')`);
      await tx.execute(sql`insert into platform.raw_payloads (provider, platform, canonical_url, storage_key, bytes, sha256, delete_after)
        values ('apify', 'instagram', 'https://instagram.com/c', 'instagram/2026/10/x.json', 10, 'abc', now() + interval '365 days')`);
    });
    const a = await createTestWorkspace();
    const links = await db.withTenant(a, (tx) => tx.execute<{ url: string }>(sql`select url from gcp.creator_links`));
    expect(links.map((l) => l.url)).toEqual(["https://example.com"]);
    await expect(db.withTenant(a, (tx) => tx.execute(sql`select * from platform.raw_payloads`))).rejects.toSatisfy(dbError(/permission denied/));
    const s = await ownerQuery<{ raw_retention_days: number; tiktok_recent_videos: number; score_band: number }>(
      `select raw_retention_days, tiktok_recent_videos, score_band from platform.enrichment_settings`,
    );
    expect(s).toEqual([{ raw_retention_days: 365, tiktok_recent_videos: 6, score_band: 5 }]);
  });

  it("sums a provider's recorded spend for the spend cap", async () => {
    await ownerQuery(`insert into platform.provider_calls (provider, operation, cost_usd, latency_ms, status, created_at) values
      ('apify', 'scrape_instagram', 0.0026, 10, 'ok', now()),
      ('apify', 'scrape_tiktok', 0.018, 10, 'ok', now()),
      ('apify', 'scrape_tiktok', 1, 10, 'ok', now() - interval '40 days'),
      ('youtube', 'scrape_youtube', 0, 10, 'ok', now())`);
    const monthStart = new Date(Date.now() - 30 * 86_400_000);
    expect(await providerSpendSince(db, "apify", monthStart)).toBeCloseTo(0.0206, 4);
  });
});
