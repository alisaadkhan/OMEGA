import { sql, type SQL } from "drizzle-orm";
import type { AnalyticsSummary } from "@mushin/contracts";
import type { TenantContext } from "@mushin/core";
import type { Db } from "@mushin/db";

const VISIBLE = sql`c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null)`;
const n = (v: unknown) => Number(v ?? 0);

/** Workspace analytics (canonical spec page 12): read-only aggregates of persisted rows, under the tenant's RLS context. */
export function createAnalyticsService(deps: { db: Db }) {
  async function summary(ctx: TenantContext, q: { from: string; to: string }): Promise<AnalyticsSummary> {
    const ws = ctx.workspaceId;
    // The period covers whole days in Pakistan time (UTC+5, no daylight saving).
    const from = sql`(${q.from}::date)::timestamp at time zone 'Asia/Karachi'`;
    const to = sql`(${q.to}::date + 1)::timestamp at time zone 'Asia/Karachi'`;
    return deps.db.withTenant({ userId: ctx.userId, workspaceId: ws }, async (tx) => {
      const one = async (query: SQL) => (await tx.execute<Record<string, unknown>>(query))[0] ?? {};
      const k = await one(sql`select count(*) total,
          count(*) filter (where status = 'draft') draft, count(*) filter (where status = 'active') active,
          count(*) filter (where status = 'paused') paused, count(*) filter (where status = 'completed') completed,
          coalesce(sum(budget_minor), 0) budget
        from wp.campaigns where workspace_id = ${ws}`);
      const p = await one(sql`select
          count(*) filter (where m.outcome = 'open' and m.stage = 'identified') identified,
          count(*) filter (where m.outcome = 'open' and m.stage = 'contacted') contacted,
          count(*) filter (where m.outcome = 'open' and m.stage = 'negotiating') negotiating,
          count(*) filter (where m.outcome = 'open' and m.stage = 'confirmed') confirmed,
          count(*) filter (where m.outcome = 'declined') declined,
          count(*) filter (where m.content_status = 'none') c_none, count(*) filter (where m.content_status = 'content_pending') c_pending,
          count(*) filter (where m.content_status = 'posted') c_posted, count(*) filter (where m.content_status = 'completed') c_completed,
          coalesce(sum(m.fee_minor) filter (where m.outcome = 'open' and m.fee_kind = 'agreed'), 0) agreed
        from wp.campaign_creators m join gcp.creators c on c.id = m.creator_id where m.workspace_id = ${ws} and ${VISIBLE}`);
      const o = await one(sql`select count(*) total,
          count(*) filter (where outcome = 'attempted') attempted, count(*) filter (where outcome = 'replied') replied,
          count(*) filter (where outcome = 'no_response') no_response, count(*) filter (where outcome = 'declined') declined,
          count(*) filter (where outcome = 'agreed') agreed, count(distinct creator_id) creators
        from wp.outreach_events where workspace_id = ${ws} and occurred_at >= ${from} and occurred_at < ${to}`);
      const channels = await tx.execute<{ channel: string; n: string }>(sql`select channel, count(*) n from wp.outreach_events
        where workspace_id = ${ws} and occurred_at >= ${from} and occurred_at < ${to} group by channel`);
      const l = await one(sql`select (select count(*) from wp.lists where workspace_id = ${ws}) total,
          (select count(distinct m.creator_id) from wp.list_members m join gcp.creators c on c.id = m.creator_id where m.workspace_id = ${ws} and ${VISIBLE}) saved`);
      const d = await one(sql`select count(*) runs, coalesce(sum(found_count), 0) found, coalesce(sum(new_count), 0) fresh
        from wp.discovery_jobs where workspace_id = ${ws} and kind = 'live' and status = 'completed' and finished_at >= ${from} and finished_at < ${to}`);
      const cr = await one(sql`select coalesce(-sum(amount) filter (where kind = 'spend'), 0) spent, coalesce(sum(amount) filter (where kind = 'refund'), 0) refunded
        from wp.credit_ledger where workspace_id = ${ws} and created_at >= ${from} and created_at < ${to}`);
      return {
        period: { from: q.from, to: q.to },
        campaigns: { total: n(k["total"]), byStatus: { draft: n(k["draft"]), active: n(k["active"]), paused: n(k["paused"]), completed: n(k["completed"]) } },
        pipeline: {
          byStage: { identified: n(p["identified"]), contacted: n(p["contacted"]), negotiating: n(p["negotiating"]), confirmed: n(p["confirmed"]) },
          declined: n(p["declined"]),
          byContent: { none: n(p["c_none"]), content_pending: n(p["c_pending"]), posted: n(p["c_posted"]), completed: n(p["c_completed"]) },
          agreedFeesMinor: n(p["agreed"]),
          budgetMinor: n(k["budget"]),
          currency: "PKR",
        },
        outreach: {
          total: n(o["total"]),
          byOutcome: { attempted: n(o["attempted"]), replied: n(o["replied"]), no_response: n(o["no_response"]), declined: n(o["declined"]), agreed: n(o["agreed"]) },
          byChannel: Object.fromEntries(channels.map((r) => [r.channel, n(r.n)])),
          creatorsContacted: n(o["creators"]),
        },
        lists: { total: n(l["total"]), savedCreators: n(l["saved"]) },
        discovery: { liveRuns: n(d["runs"]), creatorsDelivered: n(d["found"]), newCreators: n(d["fresh"]) },
        credits: { spent: n(cr["spent"]), refunded: n(cr["refunded"]) },
      };
    });
  }
  return { summary };
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
