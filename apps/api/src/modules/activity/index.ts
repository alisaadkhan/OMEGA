import { sql } from "drizzle-orm";
import { activityFeedSchema, activityQuerySchema, type ActivityEvent } from "@mushin/contracts";
import type { TenantContext } from "@mushin/core";
import type { Db } from "@mushin/db";
import { tenantOf } from "../../auth/customer-guard";
import type { AppModule } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";

const OUTCOME = { attempted: "reached out to", replied: "logged a reply from", no_response: "logged no response from", declined: "logged that %s declined", agreed: "logged that %s agreed" } as const;

/** Read-only activity feed from existing workspace records, newest first; RLS keeps it to the current workspace. */
export function createActivityService(deps: { db: Db }) {
  async function feed(ctx: TenantContext, q: { limit: number; before?: string }): Promise<{ events: ActivityEvent[] }> {
    const ws = ctx.workspaceId;
    // Keyset paging on (time in microseconds, id): a page boundary inside a group of events with one time skips none.
    const cursor = q.before?.match(/^(\d+)~(.+)$/);
    const after = cursor
      ? sql`(e.at_us < ${cursor[1]}::bigint or (e.at_us = ${cursor[1]}::bigint and e.id > ${cursor[2]}))`
      : q.before
        ? sql`e.at < ${q.before}::timestamptz`
        : sql`true`;
    const rows = await deps.db.withTenant({ userId: ctx.userId, workspaceId: ws }, (tx) =>
      tx.execute<{ id: string; kind: ActivityEvent["kind"]; at: string | Date; at_us: string; actor: string | null; a: string | null; b: string | null; c: string | null; target_type: string | null; target_id: string | null }>(sql`
        select e.* from (select *, (extract(epoch from at) * 1000000)::bigint as at_us from (
          select 'l:' || l.id id, 'list_created' kind, l.created_at at, l.created_by actor, l.name a, null b, null c, 'list' target_type, l.id target_id
            from wp.lists l where l.workspace_id = ${ws}
          union all
          select 'm:' || m.list_id || ':' || m.creator_id, 'creator_saved', m.added_at, m.added_by, cr.display_name, l.name, null, 'list', l.id
            from wp.list_members m join wp.lists l on l.id = m.list_id join gcp.creators cr on cr.id = m.creator_id where m.workspace_id = ${ws}
          union all
          select 'k:' || k.id, 'campaign_created', k.created_at, k.created_by, k.name, null, null, 'campaign', k.id
            from wp.campaigns k where k.workspace_id = ${ws}
          union all
          select 'kc:' || m.campaign_id || ':' || m.creator_id, 'creator_added_to_campaign', m.added_at, m.added_by, cr.display_name, k.name, null, 'campaign', k.id
            from wp.campaign_creators m join wp.campaigns k on k.id = m.campaign_id join gcp.creators cr on cr.id = m.creator_id where m.workspace_id = ${ws}
          union all
          select 'o:' || e.id, 'outreach_logged', e.occurred_at, e.logged_by, cr.display_name, k.name, e.outcome, 'campaign', k.id
            from wp.outreach_events e join wp.campaigns k on k.id = e.campaign_id join gcp.creators cr on cr.id = e.creator_id where e.workspace_id = ${ws}
          union all
          select 'j:' || j.id, 'live_run_finished', j.finished_at, j.requested_by, j.search->>'text', j.found_count::text, j.new_count::text, 'discovery_job', j.id
            from wp.discovery_jobs j where j.workspace_id = ${ws} and j.kind = 'live' and j.finished_at is not null
          union all
          select 'r:' || r.creator_id, 'contact_revealed', r.created_at, r.revealed_by, cr.display_name, null, null, 'creator', cr.id
            from wp.contact_reveals r join gcp.creators cr on cr.id = r.creator_id where r.workspace_id = ${ws}
        ) raw) e
        where ${after}
        order by e.at_us desc, e.id
        limit ${q.limit}`),
    );
    const people = new Map(
      (await deps.db.withTenant({ userId: ctx.userId, workspaceId: ws }, (tx) => tx.execute<{ id: string; display_name: string }>(sql`select id, display_name from platform.workspace_people()`))).map((p) => [p.id, p.display_name]),
    );
    const text = (r: (typeof rows)[number]): string => {
      switch (r.kind) {
        case "list_created": return `created the list ${r.a}`;
        case "creator_saved": return `saved ${r.a} to ${r.b}`;
        case "campaign_created": return `created the campaign ${r.a}`;
        case "creator_added_to_campaign": return `added ${r.a} to ${r.b}`;
        case "outreach_logged": {
          const phrase = OUTCOME[(r.c ?? "attempted") as keyof typeof OUTCOME];
          return `${phrase.includes("%s") ? phrase.replace("%s", r.a ?? "") : `${phrase} ${r.a}`} (${r.b})`;
        }
        case "live_run_finished": return `finished a Find New Creators run for "${r.a ?? ""}": ${r.b} found, ${r.c} new`;
        case "contact_revealed": return `revealed contact details for ${r.a}`;
      }
    };
    return {
      events: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        at: new Date(r.at).toISOString(),
        actor: r.actor ? { id: r.actor, name: people.get(r.actor) ?? "Former member" } : null,
        text: text(r),
        target: r.target_type && r.target_id ? { type: r.target_type as "list", id: r.target_id } : null,
        cursor: `${r.at_us}~${r.id}`,
      })),
    };
  }
  return { feed };
}

export type ActivityService = ReturnType<typeof createActivityService>;

export function createActivityModule(o: { service: ActivityService }): AppModule {
  return {
    name: "activity",
    register: (app, guards) => {
      app.get("/v1/activity", { preHandler: guards.customer }, async (req, reply) =>
        sendOk(reply, activityFeedSchema, await o.service.feed(tenantOf(req), parseInput(activityQuerySchema, req.query))),
      );
    },
  };
}
