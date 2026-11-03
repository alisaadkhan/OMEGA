import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  alertTestResultSchema,
  approvalDecisionSchema,
  approvalListSchema,
  approvalRequestSchema,
  approvalSchema,
  jobActionResultSchema,
  jobActionSchema,
  pausableProviderSchema,
  providerControlListSchema,
  providerControlUpdateSchema,
  staffAlertsSchema,
  staffAuditListSchema,
  staffAuditQuerySchema,
  staffCreatedSchema,
  staffCreateSchema,
  staffDirectorySchema,
  staffTicketAssignSchema,
  staffTicketDetailSchema,
  staffTicketNoteSchema,
  supportAccessCreateSchema,
  supportAccessGrantSchema,
  supportAccessListSchema,
  supportAccessSchema,
  supportAccessViewSchema,
} from "@mushin/contracts";
import { AppError } from "@mushin/core";
import type { Db } from "@mushin/db";
import { tenantOf } from "../../auth/customer-guard";
import type { AppModule, PreHandler } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import type { BillingService } from "../billing/index";
import { can, recordStaffAudit, type StaffAction, type StaffPrincipal } from "../staff/index";
import { createSupportAccess } from "./access";
import { createStaffActions } from "./actions";
import type { AlertNotifier } from "./alert-notifier";
import { createApprovals } from "./approvals";
import { clearMinorSchema, clearOrganisationSchema, createCatalogueReview, reviewListSchema, reviewQuerySchema, setCountrySchema } from "./catalogue-review";

const idParams = z.object({ id: z.uuid() });
const meta = (req: FastifyRequest) => ({ ip: req.ip ?? null, requestId: req.id });

/**
 * Internal operations beyond the read-only views (staff spec §4): approvals, provider and job controls, ticket
 * assignment and internal notes, the staff directory, audit search, alerts and consented support access. Every route
 * passes the staff authorization chain (requireStaff) and every change is audited by the service doing it.
 */
export function createStaffOpsModule(o: {
  db: Db;
  billing: Pick<BillingService, "engine">;
  requireStaff: (action: StaffAction) => PreHandler;
  createStaffAccount: (input: { email: string; name: string; role: "support" }) => Promise<{ id: string; password: string; totpSecret: string; totpUri: string }>;
  /** Alert delivery (audit OPS-03); its channel is "webhook" when ALERT_WEBHOOK_URL is set, otherwise the log. */
  alerts?: { notifier: Pick<AlertNotifier, "sendTest">; channel: "webhook" | "log" };
  now?: () => Date;
}): AppModule {
  const deps = { db: o.db, ...(o.now ? { now: o.now } : {}) };
  const approvals = createApprovals({ ...deps, billing: o.billing });
  const review = createCatalogueReview({ db: o.db });
  const actions = createStaffActions(deps);
  const access = createSupportAccess(deps);
  const staffOf = (req: FastifyRequest): StaffPrincipal => {
    if (!req.staff) throw new AppError("UNAUTHENTICATED", "Admin authentication required");
    return req.staff;
  };

  function register(app: FastifyInstance, guards: { customer: PreHandler }) {
    const r = o.requireStaff;
    // ── Alerts, providers, jobs ──
    app.get("/admin/v1/ops/alerts", { preHandler: r("ops.alerts.read") }, async (_req, reply) => sendOk(reply, staffAlertsSchema, await actions.alerts()));
    // Proves the alert channel works: a fixed test message, no alert state, audited (audit OPS-03).
    app.post("/admin/v1/ops/alerts/test", { preHandler: r("ops.alerts.test") }, async (req, reply) => {
      if (!o.alerts) throw new AppError("NOT_FOUND", "Alert delivery is not configured");
      try {
        await o.alerts.notifier.sendTest();
      } catch {
        throw new AppError("PROVIDER_UNAVAILABLE", "The alert channel did not accept the test message. Check ALERT_WEBHOOK_URL.");
      }
      await o.db.withSystem((tx) => recordStaffAudit(tx, { staffId: staffOf(req).staffId, action: "ops.alerts.test_sent", metadata: { channel: o.alerts?.channel ?? "log" }, ...meta(req) }));
      return sendOk(reply, alertTestResultSchema, { sent: true, channel: o.alerts.channel });
    });
    app.get("/admin/v1/ops/provider-controls", { preHandler: r("ops.providers.read") }, async (_req, reply) => sendOk(reply, providerControlListSchema, { providers: await actions.providers() }));
    app.put("/admin/v1/ops/provider-controls/:provider", { preHandler: r("ops.providers.control") }, async (req, reply) => {
      const { provider } = parseInput(z.object({ provider: pausableProviderSchema }), req.params);
      const body = parseInput(providerControlUpdateSchema, req.body);
      await actions.setProvider(staffOf(req), provider, body.paused, body.reason, meta(req));
      return sendOk(reply, providerControlListSchema, { providers: await actions.providers() });
    });
    app.post("/admin/v1/ops/jobs/:id/cancel", { preHandler: r("ops.jobs.cancel") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      return sendOk(reply, jobActionResultSchema, await actions.cancelJob(staffOf(req), id, parseInput(jobActionSchema, req.body).reason, meta(req)));
    });
    app.post("/admin/v1/ops/jobs/:id/retry", { preHandler: r("ops.jobs.retry") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      return sendOk(reply, jobActionResultSchema, await actions.retryJob(staffOf(req), id, parseInput(jobActionSchema, req.body).reason, meta(req)));
    });

    // ── Tickets ──
    const ticket = async (id: string) => staffTicketDetailSchema.parse((await o.db.withSystem((tx) => tx.execute<{ v: unknown }>(sql`select platform.staff_ticket(${id}) v`)))[0]?.v);
    app.post("/admin/v1/support/tickets/:id/notes", { preHandler: r("support.tickets.note") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      await actions.noteTicket(staffOf(req), id, parseInput(staffTicketNoteSchema, req.body).body, meta(req));
      return sendOk(reply, staffTicketDetailSchema, await ticket(id), 201);
    });
    app.put("/admin/v1/support/tickets/:id/assignee", { preHandler: r("support.tickets.assign_self") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      const { assigneeId } = parseInput(staffTicketAssignSchema, req.body);
      const p = staffOf(req);
      // Assigning to someone else is the Admin capability, with its hardware-key step-up.
      const others = can(p.role, "support.tickets.assign") && p.factors.includes("hwk");
      await actions.assignTicket(p, id, assigneeId, others, meta(req));
      return sendOk(reply, staffTicketDetailSchema, await ticket(id));
    });
    app.get("/admin/v1/staff/assignable", { preHandler: r("support.tickets.read") }, async (_req, reply) =>
      sendOk(reply, z.object({ staff: z.array(z.object({ id: z.uuid(), name: z.string() })) }), { staff: await actions.assignable() }),
    );

    // ── Audit search, staff directory ──
    app.get("/admin/v1/audit/search", { preHandler: r("staff.audit.read") }, async (req, reply) =>
      sendOk(reply, staffAuditListSchema, staffAuditListSchema.parse({ events: await actions.auditSearch(parseInput(staffAuditQuerySchema, req.query)) })),
    );
    app.get("/admin/v1/staff", { preHandler: r("staff.list") }, async (_req, reply) => sendOk(reply, staffDirectorySchema, { staff: await actions.directory() }));
    app.post("/admin/v1/staff", { preHandler: r("staff.manage") }, async (req, reply) => {
      const body = parseInput(staffCreateSchema, req.body);
      const p = staffOf(req);
      let acct;
      try {
        acct = await o.createStaffAccount({ email: body.email, name: body.name, role: "support" });
      } catch (err) {
        if (err instanceof Error && /staff_users_email_key|unique/i.test(`${err.message} ${String((err as { cause?: unknown }).cause ?? "")}`)) throw new AppError("CONFLICT", "A staff member with this email already exists.");
        throw err;
      }
      await o.db.withSystem((tx) => recordStaffAudit(tx, { staffId: p.staffId, action: "staff.created", targetType: "staff", targetId: acct.id, metadata: { role: "support", reason: body.reason }, ...meta(req) }));
      // The temporary password and TOTP secret are shown once, to the Super Admin, for an out-of-band hand-over.
      return sendOk(reply, staffCreatedSchema, { id: acct.id, temporaryPassword: acct.password, totpSecret: acct.totpSecret, totpUri: acct.totpUri }, 201);
    });

    // ── Approvals ──
    // Catalogue review (owner directive 2026-11-03): unknown or conflicting countries, possible minors, pending assessments.
    app.get("/admin/v1/catalogue/review", { preHandler: r("catalogue.review.read") }, async (req, reply) =>
      sendOk(reply, reviewListSchema, await review.list(parseInput(reviewQuerySchema, req.query))),
    );
    app.post("/admin/v1/catalogue/creators/:id/country", { preHandler: r("catalogue.review.decide") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      const out = await review.setCountry(staffOf(req), id, parseInput(setCountrySchema, req.body), meta(req));
      return sendOk(reply, z.object({ changed: z.array(z.object({ platform: z.string(), from: z.string(), to: z.string() })) }), out);
    });
    app.post("/admin/v1/catalogue/creators/:id/organisation-override", { preHandler: r("catalogue.review.decide") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      return sendOk(reply, z.object({ cleared: z.literal(true) }), await review.clearOrganisation(staffOf(req), id, parseInput(clearOrganisationSchema, req.body), meta(req)));
    });
    app.post("/admin/v1/catalogue/creators/:id/minor-override", { preHandler: r("catalogue.review.decide") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      return sendOk(reply, z.object({ cleared: z.literal(true) }), await review.clearMinor(staffOf(req), id, parseInput(clearMinorSchema, req.body), meta(req)));
    });

    app.get("/admin/v1/approvals", { preHandler: r("approvals.read") }, async (req, reply) => {
      const { status } = parseInput(z.object({ status: approvalSchema.shape.status.optional() }), req.query);
      return sendOk(reply, approvalListSchema, { approvals: await approvals.list(status ?? null) });
    });
    app.post("/admin/v1/approvals", { preHandler: r("approvals.request") }, async (req, reply) =>
      sendOk(reply, approvalSchema, await approvals.request(staffOf(req), parseInput(approvalRequestSchema, req.body), meta(req)), 201),
    );
    app.post("/admin/v1/approvals/:id/decision", { preHandler: r("approvals.decide") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      const body = parseInput(approvalDecisionSchema, req.body);
      return sendOk(reply, approvalSchema, await approvals.decide(staffOf(req), id, body.decision, body.note, meta(req)));
    });

    // ── Consented support access: staff side ──
    app.get("/admin/v1/access-requests", { preHandler: r("support.access.request") }, async (req, reply) => sendOk(reply, supportAccessListSchema, { requests: await access.mine(staffOf(req)) }));
    app.post("/admin/v1/access-requests", { preHandler: r("support.access.request") }, async (req, reply) => {
      const body = parseInput(supportAccessCreateSchema, req.body);
      return sendOk(reply, supportAccessSchema, await access.request(staffOf(req), body.workspaceId, body.purpose, meta(req)), 201);
    });
    app.post("/admin/v1/access-requests/:id/end", { preHandler: r("support.access.request") }, async (req, reply) =>
      sendOk(reply, supportAccessSchema, await access.staffEnd(staffOf(req), parseInput(idParams, req.params).id, meta(req))),
    );
    app.get("/admin/v1/access-requests/:id/view", { preHandler: r("support.access.view") }, async (req, reply) =>
      sendOk(reply, supportAccessViewSchema, await access.view(staffOf(req), parseInput(idParams, req.params).id, meta(req))),
    );

    // ── Consented support access: customer side (owner or admin of the workspace) ──
    app.get("/v1/support/access-requests", { preHandler: guards.customer }, async (req, reply) => sendOk(reply, supportAccessListSchema, { requests: await access.list(tenantOf(req)) }));
    app.post("/v1/support/access-requests/:id/grant", { preHandler: guards.customer }, async (req, reply) => {
      const { minutes } = parseInput(supportAccessGrantSchema, req.body ?? {});
      return sendOk(reply, supportAccessSchema, await access.decide(tenantOf(req), parseInput(idParams, req.params).id, "grant", minutes));
    });
    app.post("/v1/support/access-requests/:id/decline", { preHandler: guards.customer }, async (req, reply) =>
      sendOk(reply, supportAccessSchema, await access.decide(tenantOf(req), parseInput(idParams, req.params).id, "decline")),
    );
    app.post("/v1/support/access-requests/:id/end", { preHandler: guards.customer }, async (req, reply) =>
      sendOk(reply, supportAccessSchema, await access.decide(tenantOf(req), parseInput(idParams, req.params).id, "end")),
    );
  }

  return { name: "staffops", register };
}

export { createStaffActions } from "./actions";
export { createAlertNotifier, createLogSender, createWebhookSender, type AlertNotifier } from "./alert-notifier";
