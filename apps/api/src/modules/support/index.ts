import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createTicketSchema,
  ticketCustomerStatusSchema,
  ticketDetailSchema,
  ticketListSchema,
  ticketReplySchema,
  ticketSummarySchema,
  type CreateTicket,
  type TicketDetail,
  type TicketSummary,
} from "@mushin/contracts";
import { AppError, type TenantContext } from "@mushin/core";
import { supportMessages, supportTickets, type Db, type TenantTx } from "@mushin/db";
import { tenantOf } from "../../auth/customer-guard";
import type { AppModule, Guards } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";

const MAX_OPEN_TICKETS = 20;

/** Customer support requests (canonical spec page 15). Workspace members see their workspace's tickets. */
export function createSupportService(deps: { db: Db }) {
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });

  async function summaries(tx: TenantTx, ws: string, id?: string): Promise<TicketSummary[]> {
    const rows = await tx.execute<Record<string, unknown>>(sql`
      select k.id, k.subject, k.category, k.status, k.created_at, k.last_message_at,
        (select count(*) from wp.support_messages m where m.ticket_id = k.id) messages,
        (select m.author_kind from wp.support_messages m where m.ticket_id = k.id order by m.created_at desc limit 1) last_author
      from wp.support_tickets k where k.workspace_id = ${ws} ${id ? sql`and k.id = ${id}` : sql``}
      order by k.last_message_at desc limit 200`);
    return rows.map((r) => ({
      id: r["id"] as string,
      subject: r["subject"] as string,
      category: r["category"] as TicketSummary["category"],
      status: r["status"] as TicketSummary["status"],
      createdAt: new Date(r["created_at"] as string).toISOString(),
      lastMessageAt: new Date(r["last_message_at"] as string).toISOString(),
      messages: Number(r["messages"]),
      lastAuthor: (r["last_author"] as TicketSummary["lastAuthor"]) ?? null,
    }));
  }

  async function detailIn(tx: TenantTx, ctx: TenantContext, id: string): Promise<TicketDetail> {
    const [summary] = await summaries(tx, ctx.workspaceId, id);
    if (!summary) throw new AppError("NOT_FOUND", "Support request not found");
    const thread = await tx.execute<Record<string, unknown>>(sql`
      select m.id, m.author_kind, m.body, m.created_at,
        case when m.author_kind = 'staff' then 'MUSHIN support'
             else coalesce((select p.display_name from platform.workspace_people() p where p.id = m.author_user_id), 'Former member') end author_name
      from wp.support_messages m where m.workspace_id = ${ctx.workspaceId} and m.ticket_id = ${id} order by m.created_at`);
    return {
      ...summary,
      thread: thread.map((m) => ({ id: m["id"] as string, authorKind: m["author_kind"] as "customer" | "staff", authorName: m["author_name"] as string, body: m["body"] as string, createdAt: new Date(m["created_at"] as string).toISOString() })),
    };
  }

  return {
    async list(ctx: TenantContext) {
      return { tickets: await deps.db.withTenant(tenant(ctx), (tx) => summaries(tx, ctx.workspaceId)) };
    },
    async detail(ctx: TenantContext, id: string) {
      return deps.db.withTenant(tenant(ctx), (tx) => detailIn(tx, ctx, id));
    },
    async create(ctx: TenantContext, body: CreateTicket): Promise<TicketDetail> {
      return deps.db.withTenant(tenant(ctx), async (tx) => {
        // One creation at a time per workspace, so simultaneous requests cannot all pass the limit (released at commit).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`support-tickets:${ctx.workspaceId}`}, 0))`);
        const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(supportTickets).where(and(eq(supportTickets.workspaceId, ctx.workspaceId), sql`${supportTickets.status} in ('open', 'waiting_on_customer')`));
        if ((open?.n ?? 0) >= MAX_OPEN_TICKETS) throw new AppError("CONFLICT", `Your workspace has ${MAX_OPEN_TICKETS} open requests. Close one, or reply on an existing request.`);
        const [t] = await tx.insert(supportTickets).values({ workspaceId: ctx.workspaceId, createdBy: ctx.userId, subject: body.subject, category: body.category }).returning({ id: supportTickets.id });
        if (!t) throw new Error("ticket insert returned no row");
        await tx.insert(supportMessages).values({ ticketId: t.id, workspaceId: ctx.workspaceId, authorKind: "customer", authorUserId: ctx.userId, body: body.body });
        return detailIn(tx, ctx, t.id);
      });
    },
    /** A customer reply reopens a ticket that was waiting on them or resolved. Closed tickets need reopening first. */
    async reply(ctx: TenantContext, id: string, text: string): Promise<TicketDetail> {
      return deps.db.withTenant(tenant(ctx), async (tx) => {
        const [t] = await tx.select({ status: supportTickets.status }).from(supportTickets).where(and(eq(supportTickets.workspaceId, ctx.workspaceId), eq(supportTickets.id, id))).for("update");
        if (!t) throw new AppError("NOT_FOUND", "Support request not found");
        if (t.status === "closed") throw new AppError("CONFLICT", "This request is closed. Reopen it to reply.");
        await tx.insert(supportMessages).values({ ticketId: id, workspaceId: ctx.workspaceId, authorKind: "customer", authorUserId: ctx.userId, body: text });
        await tx.update(supportTickets).set({ status: "open", lastMessageAt: sql`now()` }).where(and(eq(supportTickets.workspaceId, ctx.workspaceId), eq(supportTickets.id, id)));
        return detailIn(tx, ctx, id);
      });
    },
    async setStatus(ctx: TenantContext, id: string, status: "open" | "closed"): Promise<TicketSummary> {
      return deps.db.withTenant(tenant(ctx), async (tx) => {
        const rows = await tx.update(supportTickets).set({ status }).where(and(eq(supportTickets.workspaceId, ctx.workspaceId), eq(supportTickets.id, id))).returning({ id: supportTickets.id });
        if (rows.length === 0) throw new AppError("NOT_FOUND", "Support request not found");
        const [s] = await summaries(tx, ctx.workspaceId, id);
        if (!s) throw new AppError("NOT_FOUND", "Support request not found");
        return s;
      });
    },
  };
}

export type SupportService = ReturnType<typeof createSupportService>;
const idParams = z.object({ id: z.uuid() });

function registerSupportRoutes(app: FastifyInstance, guards: Guards, service: SupportService) {
  const auth = { preHandler: guards.customer };
  app.get("/v1/support/tickets", auth, async (req, reply) => sendOk(reply, ticketListSchema, await service.list(tenantOf(req))));
  app.post("/v1/support/tickets", auth, async (req, reply) => sendOk(reply, ticketDetailSchema, await service.create(tenantOf(req), parseInput(createTicketSchema, req.body)), 201));
  app.get("/v1/support/tickets/:id", auth, async (req, reply) => sendOk(reply, ticketDetailSchema, await service.detail(tenantOf(req), parseInput(idParams, req.params).id)));
  app.post("/v1/support/tickets/:id/messages", auth, async (req, reply) =>
    sendOk(reply, ticketDetailSchema, await service.reply(tenantOf(req), parseInput(idParams, req.params).id, parseInput(ticketReplySchema, req.body).body), 201),
  );
  app.patch("/v1/support/tickets/:id", auth, async (req, reply) =>
    sendOk(reply, ticketSummarySchema, await service.setStatus(tenantOf(req), parseInput(idParams, req.params).id, parseInput(ticketCustomerStatusSchema, req.body).status)),
  );
}

export function createSupportModule(o: { service: SupportService }): AppModule {
  return { name: "support", register: (app, guards) => registerSupportRoutes(app, guards, o.service) };
}
