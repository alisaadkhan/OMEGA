import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { inboxQuerySchema, inboxSchema, type InboxFilter } from "@mushin/contracts";
import type { Db } from "@mushin/db";
import { tenantOf } from "../../auth/customer-guard";
import type { Guards } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import { CREATOR_VISIBLE } from "../creators/visibility";

/** Which latest outcomes each Inbox filter shows. "Waiting": you reached out and have not logged an answer yet. */
const FILTER_OUTCOMES: Record<Exclude<InboxFilter, "all">, string[]> = { waiting: ["attempted", "no_response"], replied: ["replied"], agreed: ["agreed"], declined: ["declined"] };
const THREAD_LIMIT = 300;

/**
 * GET /v1/outreach/inbox: the latest logged outreach per creator per campaign, newest first, with how many entries the
 * conversation has. RLS and the workspace filter keep it to the account; hidden creators are left out, as everywhere.
 */
export function registerInboxRoute(app: FastifyInstance, guards: Guards, db: Db): void {
  app.get("/v1/outreach/inbox", { preHandler: guards.customer }, async (req, reply) => {
    const ctx = tenantOf(req);
    const { filter } = parseInput(inboxQuerySchema, req.query);
    const ws = ctx.workspaceId;
    const rows = await db.withTenant({ userId: ctx.userId, workspaceId: ws }, (tx) =>
      tx.execute<Record<string, unknown>>(sql`
        with latest as (
          select distinct on (e.campaign_id, e.creator_id) e.*, count(*) over (partition by e.campaign_id, e.creator_id) as n
          from wp.outreach_events e where e.workspace_id = ${ws}
          order by e.campaign_id, e.creator_id, e.occurred_at desc, e.created_at desc
        )
        select l.id, l.channel, l.outcome, l.note, l.occurred_at, l.logged_by, l.n::int as n,
          coalesce((select p.display_name from platform.workspace_people() p where p.id = l.logged_by), 'Former member') as logged_by_name,
          k.id as campaign_id, k.name as campaign_name, c.id as creator_id, c.display_name, c.primary_handle, c.primary_platform, m.stage
        from latest l
        join wp.campaigns k on k.id = l.campaign_id
        join wp.campaign_creators m on m.campaign_id = l.campaign_id and m.creator_id = l.creator_id
        join gcp.creators c on c.id = l.creator_id
        where ${CREATOR_VISIBLE}
        order by l.occurred_at desc, l.id
        limit 2000`),
    );
    const counts = { all: rows.length, waiting: 0, replied: 0, agreed: 0, declined: 0 };
    for (const r of rows) for (const [f, outs] of Object.entries(FILTER_OUTCOMES)) if (outs.includes(r["outcome"] as string)) counts[f as keyof typeof counts] += 1;
    const shown = filter === "all" ? rows : rows.filter((r) => FILTER_OUTCOMES[filter].includes(r["outcome"] as string));
    return sendOk(reply, inboxSchema, {
      counts,
      threads: shown.slice(0, THREAD_LIMIT).map((r) => ({
        campaign: { id: r["campaign_id"] as string, name: r["campaign_name"] as string },
        creator: { id: r["creator_id"] as string, name: r["display_name"] as string, handle: r["primary_handle"] as string, platform: r["primary_platform"] as "instagram" },
        stage: r["stage"] as "identified",
        last: {
          id: r["id"] as string,
          channel: r["channel"] as "email",
          outcome: r["outcome"] as "attempted",
          note: r["note"] as string,
          occurredAt: new Date(r["occurred_at"] as string).toISOString(),
          loggedBy: { id: r["logged_by"] as string, name: r["logged_by_name"] as string },
        },
        events: Number(r["n"]),
      })),
    });
  });
}
