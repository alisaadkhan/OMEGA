import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  providerUsageQuerySchema,
  providerUsageSchema,
  staffAuditListSchema,
  staffJobDetailSchema,
  staffJobListSchema,
  staffJobQuerySchema,
  staffOverviewSchema,
  staffTicketDetailSchema,
  staffTicketListSchema,
  staffTicketUpdateSchema,
  staffWorkspaceListSchema,
  staffWorkspaceQuerySchema,
  ticketStatusSchema,
} from "@mushin/contracts";
import { AppError } from "@mushin/core";
import type { Db, SystemTx } from "@mushin/db";
import type { AppModule, PreHandler } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import { recordStaffAudit, type StaffAction, type StaffPrincipal } from "../staff/index";

const idParams = z.object({ id: z.uuid() });

/** `a***@domain.pk`: support staff identify a workspace without seeing the full address. */
export const maskEmail = (email: string) => {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}***@${domain}`;
};

/**
 * Staff operations (canonical spec pages 20–23). Reads go through the platform.staff_* security-definer functions,
 * which return redacted projections across workspaces; views of one workspace's data and every write are audited.
 */
export function createOpsModule(o: { db: Db; requireStaff: (action: StaffAction) => PreHandler; now?: () => Date }): AppModule {
  const now = o.now ?? (() => new Date());
  // The functions return JSON; it is validated against the response contract before it leaves the API.
  const json = async (fn: (tx: SystemTx) => Promise<{ v: unknown }[]>): Promise<unknown> => (await o.db.withSystem(fn))[0]?.v ?? null;
  const staffOf = (req: FastifyRequest): StaffPrincipal => {
    if (!req.staff) throw new AppError("UNAUTHENTICATED", "Admin authentication required");
    return req.staff;
  };
  const audit = (req: FastifyRequest, action: string, metadata: Record<string, unknown>) =>
    o.db.withSystem((tx) => recordStaffAudit(tx, { staffId: staffOf(req).staffId, action, metadata, ip: req.ip, requestId: req.id }));

  function register(app: FastifyInstance) {
    app.get("/admin/v1/ops/overview", { preHandler: o.requireStaff("ops.overview.read") }, async (_req, reply) =>
      sendOk(reply, staffOverviewSchema, staffOverviewSchema.parse(await json((tx) => tx.execute(sql`select platform.staff_overview() v`)))),
    );

    app.get("/admin/v1/ops/jobs", { preHandler: o.requireStaff("ops.jobs.read") }, async (req, reply) => {
      const q = parseInput(staffJobQuerySchema, req.query);
      const jobs = await json((tx) => tx.execute(sql`select platform.staff_jobs(${q.status ?? null}, ${q.limit}) v`));
      return sendOk(reply, staffJobListSchema, staffJobListSchema.parse({ jobs }));
    });

    app.get("/admin/v1/ops/jobs/:id", { preHandler: o.requireStaff("ops.jobs.read") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      const detail = await json((tx) => tx.execute(sql`select platform.staff_job(${id}) v`));
      if (!detail) throw new AppError("NOT_FOUND", "Job not found");
      await audit(req, "ops.job.viewed", { jobId: id });
      return sendOk(reply, staffJobDetailSchema, staffJobDetailSchema.parse(detail));
    });

    app.get("/admin/v1/ops/providers", { preHandler: o.requireStaff("ops.providers.read") }, async (req, reply) => {
      const { hours } = parseInput(providerUsageQuerySchema, req.query);
      const since = new Date(now().getTime() - hours * 3_600_000);
      const rows = await o.db.withSystem((tx) =>
        tx.execute<{ provider: string; calls: string; errors: string; cost: string; p95: number | null; last_at: string | null; last_error: string | null }>(sql`
          select provider, count(*) calls, count(*) filter (where status = 'error') errors, coalesce(sum(cost_usd), 0) cost,
            percentile_cont(0.95) within group (order by latency_ms) p95, max(created_at) last_at,
            (select c2.error_code from platform.provider_calls c2 where c2.provider = c.provider and c2.status = 'error' and c2.created_at >= ${since.toISOString()}::timestamptz order by c2.created_at desc limit 1) last_error
          from platform.provider_calls c where created_at >= ${since.toISOString()}::timestamptz group by provider order by provider`),
      );
      const status = await o.db.withSystem((tx) =>
        tx.execute<{ provider: string; configured: boolean; detail: Record<string, string | number | boolean>; quota_used: string | null; quota_limit: string | null; quota_unit: "usd" | "searches" | null; quota_source: string | null; check_error: string | null; checked_at: string }>(
          sql`select provider, configured, detail, quota_used, quota_limit, quota_unit, quota_source, check_error, checked_at from platform.provider_status order by provider`,
        ),
      );
      return sendOk(reply, providerUsageSchema, {
        since: since.toISOString(),
        status: status.map((r) => ({
          provider: r.provider,
          configured: r.configured,
          detail: r.detail,
          quota: r.quota_used !== null && r.quota_limit !== null && r.quota_unit ? { used: Number(r.quota_used), limit: Number(r.quota_limit), unit: r.quota_unit, source: r.quota_source ?? "" } : null,
          checkError: r.check_error,
          checkedAt: new Date(r.checked_at).toISOString(),
        })),
        providers: rows.map((r) => ({
          provider: r.provider,
          calls: Number(r.calls),
          errors: Number(r.errors),
          costUsd: Number(r.cost),
          p95LatencyMs: r.p95 === null ? null : Math.round(Number(r.p95)),
          lastCallAt: r.last_at ? new Date(r.last_at).toISOString() : null,
          lastErrorCode: r.last_error,
        })),
      });
    });

    app.get("/admin/v1/ops/workspaces", { preHandler: o.requireStaff("ops.workspaces.read") }, async (req, reply) => {
      const { q } = parseInput(staffWorkspaceQuerySchema, req.query);
      const list = staffWorkspaceListSchema.parse({ workspaces: await json((tx) => tx.execute(sql`select platform.staff_workspaces(${q}) v`)) }).workspaces;
      if (q) await audit(req, "ops.workspaces.searched", { query: q, results: list.length });
      // The function already masks the owner email for every staff role.
      return sendOk(reply, staffWorkspaceListSchema, { workspaces: list });
    });

    app.get("/admin/v1/support/tickets", { preHandler: o.requireStaff("support.tickets.read") }, async (req, reply) => {
      const { status } = parseInput(z.object({ status: ticketStatusSchema.optional() }), req.query);
      const tickets = await json((tx) => tx.execute(sql`select platform.staff_tickets(${status ?? null}) v`));
      return sendOk(reply, staffTicketListSchema, staffTicketListSchema.parse({ tickets }));
    });

    app.get("/admin/v1/support/tickets/:id", { preHandler: o.requireStaff("support.tickets.read") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      const ticket = await json((tx) => tx.execute(sql`select platform.staff_ticket(${id}) v`));
      if (!ticket) throw new AppError("NOT_FOUND", "Ticket not found");
      await audit(req, "support.ticket.viewed", { ticketId: id });
      return sendOk(reply, staffTicketDetailSchema, staffTicketDetailSchema.parse(ticket));
    });

    app.patch("/admin/v1/support/tickets/:id", { preHandler: o.requireStaff("support.tickets.reply") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      const body = parseInput(staffTicketUpdateSchema, req.body);
      const staff = staffOf(req);
      const done = await o.db.withSystem(async (tx) => {
        const [r] = await tx.execute<{ ok: boolean }>(sql`select platform.staff_ticket_update(${id}, ${staff.staffId}, ${body.body ?? null}, ${body.status ?? null}) ok`);
        if (r?.ok) await recordStaffAudit(tx, { staffId: staff.staffId, action: "support.ticket.updated", metadata: { ticketId: id, replied: Boolean(body.body), status: body.status ?? null }, ip: req.ip, requestId: req.id });
        return r?.ok === true;
      });
      if (!done) throw new AppError("NOT_FOUND", "Ticket not found");
      return sendOk(reply, staffTicketDetailSchema, staffTicketDetailSchema.parse(await json((tx) => tx.execute(sql`select platform.staff_ticket(${id}) v`))));
    });

    app.get("/admin/v1/audit", { preHandler: o.requireStaff("staff.audit.read") }, async (req, reply) => {
      const { limit } = parseInput(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
      return sendOk(reply, staffAuditListSchema, staffAuditListSchema.parse({ events: await json((tx) => tx.execute(sql`select platform.staff_audit(${limit}) v`)) }));
    });
  }

  return { name: "ops", register };
}
