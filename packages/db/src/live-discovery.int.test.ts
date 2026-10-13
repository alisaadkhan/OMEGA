import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, createTestWorkspace, dbError, ownerQuery, resetTables } from "./testing";
import { providerCallsSince } from "./provider-calls";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

async function creator(): Promise<string> {
  const [c] = await ownerQuery<{ id: string }>(`insert into gcp.creators (display_name, primary_handle, primary_platform) values ('C', 'c_${randomUUID().slice(0, 6)}', 'instagram') returning id`);
  return c?.id ?? "";
}

async function liveJob(workspaceId: string, userId: string, hash = "a".repeat(64)): Promise<string> {
  const [j] = await ownerQuery<{ id: string }>(`insert into wp.discovery_jobs (workspace_id, kind, requested_by, cost, search, max_new, search_hash, prices)
    values ('${workspaceId}', 'live', '${userId}', 112, '{"text":"","filters":{}}', 10, '${hash}', '{"search":12,"instagram":10,"tiktok":30,"youtube":10}') returning id`);
  return j?.id ?? "";
}

describe("migration 0012", () => {
  it("allows live jobs without a profile, but not profile jobs without one", async () => {
    const ws = await createTestWorkspace();
    expect(await liveJob(ws.workspaceId, ws.userId)).toMatch(/^[0-9a-f-]{36}$/);
    await expect(ownerQuery(`insert into wp.discovery_jobs (workspace_id, kind, requested_by, cost) values ('${ws.workspaceId}', 'add_by_url', '${ws.userId}', 10)`)).rejects.toSatisfy(dbError(/discovery_jobs_shape/));
    await expect(liveJob(ws.workspaceId, ws.userId)).rejects.toSatisfy(dbError(/discovery_jobs_one_open_live/));
  });

  it("keeps each workspace's results private (RLS) and lets only the worker write them", async () => {
    const a = await createTestWorkspace();
    const b = await createTestWorkspace();
    const job = await liveJob(a.workspaceId, a.userId);
    const c = await creator();
    await db.withWorkspace(a.workspaceId, (tx) => tx.execute(sql`insert into wp.discovery_results (workspace_id, job_id, creator_id, seq, is_new) values (${a.workspaceId}, ${job}, ${c}, 1, true)`));
    expect(await db.withTenant(a, (tx) => tx.execute(sql`select id from wp.discovery_results`))).toHaveLength(1);
    expect(await db.withTenant(b, (tx) => tx.execute(sql`select id from wp.discovery_results`))).toHaveLength(0);
    await expect(db.withTenant(a, (tx) => tx.execute(sql`insert into wp.discovery_results (workspace_id, job_id, creator_id, seq, is_new) values (${a.workspaceId}, ${job}, ${c}, 2, false)`))).rejects.toThrow();
  });

  it("stores only 64-character hashes on the do-not-re-add list", async () => {
    await expect(ownerQuery(`insert into gcp.creator_suppressions (url_hash, platform) values ('https://instagram.com/x', 'instagram')`)).rejects.toThrow();
    await ownerQuery(`insert into gcp.creator_suppressions (url_hash, platform) values ('${"a".repeat(64)}', 'instagram')`);
  });

  it("erases a creator's workspace rows in every workspace through the worker-only function", async () => {
    const a = await createTestWorkspace();
    const b = await createTestWorkspace();
    const c = await creator();
    for (const ws of [a, b]) {
      await ownerQuery(`insert into wp.audience_views (workspace_id, creator_id, month, viewed_by) values ('${ws.workspaceId}', '${c}', date_trunc('month', now())::date, '${ws.userId}')`);
    }
    // Earlier add-by-link and refresh jobs name the creator's profile in every workspace that ran them.
    await ownerQuery(`insert into wp.discovery_jobs (workspace_id, kind, requested_by, input_url, platform, handle, canonical_url, cost, status)
      values ('${a.workspaceId}', 'add_by_url', '${a.userId}', 'https://www.instagram.com/Erase.Me/?hl=en', 'instagram', 'erase.me', 'https://instagram.com/erase.me', 10, 'completed'),
             ('${b.workspaceId}', 'refresh', '${b.userId}', null, 'instagram', 'erase.me', 'https://instagram.com/erase.me', 10, 'failed')`);
    // Live runs' decision trails name the profile too (0021): by creator id, or by link before it was saved.
    const live = await liveJob(a.workspaceId, a.userId);
    await ownerQuery(`insert into wp.discovery_candidates (workspace_id, job_id, platform, candidate_key, source_url, canonical_url, stage, decision, creator_id)
      values ('${a.workspaceId}', '${live}', 'instagram', 'https://instagram.com/erase.me', 'https://www.instagram.com/erase.me/', 'https://instagram.com/erase.me', 'delivery', 'delivered', '${c}'),
             ('${a.workspaceId}', '${live}', 'instagram', 'https://instagram.com/erase.me.too', 'https://www.instagram.com/p/x/', 'https://instagram.com/erase.me', 'fit', 'rejected', null),
             ('${a.workspaceId}', '${live}', 'instagram', 'https://instagram.com/keep.me', 'https://www.instagram.com/keep.me/', 'https://instagram.com/keep.me', 'fit', 'rejected', null)`);
    const urls = sql`array[${sql.join(["https://instagram.com/erase.me"].map((u) => sql`${u}`), sql`, `)}]::text[]`;
    await db.withSystem((tx) => tx.execute(sql`select platform.erase_creator_workspace_rows(${c}, ${urls})`));
    expect(await ownerQuery(`select 1 from wp.audience_views where creator_id = '${c}'`)).toEqual([]);
    expect((await ownerQuery<{ candidate_key: string }>(`select candidate_key from wp.discovery_candidates`)).map((r) => r.candidate_key)).toEqual(["https://instagram.com/keep.me"]);
    const jobs = await ownerQuery<{ input_url: string | null; handle: string; canonical_url: string }>(`select input_url, handle, canonical_url from wp.discovery_jobs where kind <> 'live'`);
    expect(jobs).toHaveLength(2);
    for (const j of jobs) {
      expect(j.input_url).toBeNull();
      expect(j.handle).toBe("erased");
      expect(j.canonical_url).not.toContain("erase.me");
    }
    await expect(db.withTenant(a, (tx) => tx.execute(sql`select platform.erase_creator_workspace_rows(${c}, ${urls})`))).rejects.toSatisfy(dbError(/permission denied/));
  });

  it("keeps snapshots append-only and erases a creator's snapshots only through the worker-only function (0015)", async () => {
    const ws = await createTestWorkspace();
    const c = await creator();
    const [p] = await ownerQuery<{ id: string }>(`insert into gcp.creator_profiles (creator_id, platform, handle, canonical_url) values ('${c}', 'instagram', 'snap', 'https://instagram.com/snap') returning id`);
    await ownerQuery(`insert into gcp.profile_metric_snapshots (profile_id, followers) values ('${p?.id}', 100)`);
    await ownerQuery(`insert into gcp.enrichment_snapshots (creator_id, verdict, authenticity_score, evidence_breakdown, model_version)
      values ('${c}', 'genuine', 80, '[{"signal":"s","detail":"d","weight":1}]', 'm1')`);
    await expect(db.withSystem((tx) => tx.execute(sql`delete from gcp.enrichment_snapshots where creator_id = ${c}`))).rejects.toSatisfy(dbError(/permission denied/));
    await expect(db.withTenant(ws, (tx) => tx.execute(sql`select platform.erase_creator_snapshots(${c})`))).rejects.toSatisfy(dbError(/permission denied/));
    await db.withSystem((tx) => tx.execute(sql`select platform.erase_creator_snapshots(${c})`));
    expect(await ownerQuery(`select 1 from gcp.enrichment_snapshots where creator_id = '${c}'`)).toEqual([]);
    expect(await ownerQuery(`select 1 from gcp.profile_metric_snapshots where profile_id = '${p?.id}'`)).toEqual([]);
  });

  it("lets a workspace delete its own contact reveal", async () => {
    const ws = await createTestWorkspace();
    const c = await creator();
    await ownerQuery(`insert into wp.contact_reveals (workspace_id, creator_id, revealed_by) values ('${ws.workspaceId}', '${c}', '${ws.userId}')`);
    await db.withTenant(ws, (tx) => tx.execute(sql`delete from wp.contact_reveals where creator_id = ${c}`));
    expect(await ownerQuery(`select 1 from wp.contact_reveals`)).toEqual([]);
  });

  it("counts a provider's successful calls since a moment (the Serper monthly limit)", async () => {
    await ownerQuery(`insert into platform.provider_calls (provider, operation, cost_usd, latency_ms, status) values ('serper', 'web_search', 0.001, 5, 'ok'), ('serper', 'web_search', 0, 5, 'error'), ('apify', 'x', 1, 5, 'ok')`);
    expect(await providerCallsSince(db, "serper", new Date(Date.now() - 60_000))).toBe(1);
  });
});
