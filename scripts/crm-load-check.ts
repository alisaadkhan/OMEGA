/**
 * Read-path timing for the workspace CRM endpoints at a busy-workspace size (test database only; it empties
 * application tables). Seeds one workspace with lists, campaigns and outreach, then times each service call warm.
 *
 *   TEST_DATABASE_URL=<local disposable db> node --import tsx scripts/crm-load-check.ts
 */
import { randomUUID } from "node:crypto";
import type { TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { createActivityService } from "../apps/api/src/modules/activity/index";
import { createAnalyticsService } from "../apps/api/src/modules/analytics/index";
import { createCampaignsService } from "../apps/api/src/modules/campaigns/index";
import { createListsService } from "../apps/api/src/modules/lists/index";

const db = createTestDatabase();
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)] ?? 0;

try {
  await resetTables();
  const ws = await createTestWorkspace();
  const ctx: TenantContext = { ...ws, requestId: "load", role: "owner" };
  // 20k creators; one workspace with 60 lists × 100 members, 30 campaigns × 100 creators, 15k outreach events.
  await ownerQuery(`
    insert into gcp.creators (display_name, primary_handle, primary_platform, city, country, niches)
      select 'Load Creator ' || g, 'load_' || g, 'instagram', 'Lahore', 'PK', array['Food'] from generate_series(1, 20000) g;
    insert into gcp.creator_profiles (creator_id, platform, handle, canonical_url, followers, engagement_rate)
      select id, 'instagram', primary_handle, 'https://load.test/' || primary_handle, 10000, 4 from gcp.creators;
    insert into wp.lists (workspace_id, name, created_by) select '${ws.workspaceId}', 'List ' || g, '${ws.userId}' from generate_series(1, 60) g;
    insert into wp.list_members (list_id, workspace_id, creator_id, added_by)
      select l.id, l.workspace_id, c.id, '${ws.userId}' from wp.lists l
      join lateral (select id from gcp.creators order by md5(l.id::text || id::text) limit 100) c on true;
    insert into wp.campaigns (workspace_id, name, status, budget_minor, created_by)
      select '${ws.workspaceId}', 'Campaign ' || g, 'active', 50000000, '${ws.userId}' from generate_series(1, 30) g;
    insert into wp.campaign_creators (campaign_id, workspace_id, creator_id, stage, fee_minor, fee_kind, added_by)
      select k.id, k.workspace_id, c.id, (array['identified','contacted','negotiating','confirmed'])[1 + abs(hashtext(c.id::text)) % 4], 2500000, 'agreed', '${ws.userId}'
      from wp.campaigns k join lateral (select id from gcp.creators order by md5(k.id::text || id::text) limit 100) c on true;
    insert into wp.outreach_events (workspace_id, campaign_id, creator_id, channel, outcome, occurred_at, logged_by)
      select m.workspace_id, m.campaign_id, m.creator_id, 'email', (array['attempted','replied','no_response','agreed'])[1 + g % 4], now() - (g || ' hours')::interval, '${ws.userId}'
      from wp.campaign_creators m cross join generate_series(1, 5) g;
    analyze;`);
  const lists = createListsService({ db });
  const campaigns = createCampaignsService({ db, planLimits: async () => ({ entitlements: { campaignLimit: null } }) });
  const analytics = createAnalyticsService({ db });
  const activity = createActivityService({ db });
  const firstList = (await lists.index(ctx)).lists[0]?.id ?? randomUUID();
  const firstCampaign = (await campaigns.index(ctx)).campaigns[0]?.id ?? randomUUID();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10);
  const calls: [string, () => Promise<unknown>][] = [
    ["GET /v1/lists (60 lists)", () => lists.index(ctx)],
    ["GET /v1/lists/:id (100 members)", () => lists.detail(ctx, firstList)],
    ["GET /v1/campaigns (30 campaigns)", () => campaigns.index(ctx)],
    ["GET /v1/campaigns/:id (100 creators)", () => campaigns.detail(ctx, firstCampaign)],
    ["GET /v1/analytics/summary (90 days)", () => analytics.summary(ctx, { from, to })],
    ["GET /v1/activity (30 newest)", () => activity.feed(ctx, { limit: 30 })],
  ];
  console.log("| Endpoint (service call, warm, 20 runs) | p50 | p95 |\n|---|---|---|");
  for (const [name, fn] of calls) {
    await fn();
    const t: number[] = [];
    for (let i = 0; i < 20; i++) {
      const s = performance.now();
      await fn();
      t.push(performance.now() - s);
    }
    console.log(`| ${name} | ${pct(t, 50).toFixed(0)} ms | ${pct(t, 95).toFixed(0)} ms |`);
  }
} finally {
  await db.close();
}
