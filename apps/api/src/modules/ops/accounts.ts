import { and, desc, eq, gte, notInArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { staffAccountSchema, staffPlanGrantResultSchema, staffPlanGrantSchema, staffSubscriptionsSchema, staffSuspendResultSchema, staffSuspendSchema } from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { creditLedger, plans, subscriptions, workspaces, type Db } from "@mushin/db";
import type { PreHandler } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import type { BillingService } from "../billing/index";
import { COMP_REF_PREFIX } from "../billing/service";
import { recordStaffAudit, type StaffAction } from "../staff/index";

const idParams = z.object({ id: z.uuid() });
const DAY = 86_400_000;

/**
 * Staff Users page (owner, 22 Nov): one customer account's plan, credits, credit history and members, a complimentary
 * plan (Super Admin, hardware key, audited) and the subscription totals. Credits are added through the two-person
 * approval (credits.grant), not here. Reading an account is audited like reading its activity.
 */
export function registerAccountRoutes(
  app: FastifyInstance,
  o: { db: Db; requireStaff: (action: StaffAction) => PreHandler; billing: Pick<BillingService, "engine" | "grantComplimentaryPlan">; now: () => Date },
) {
  const staffId = (req: FastifyRequest) => {
    if (!req.staff) throw new AppError("UNAUTHENTICATED", "Admin authentication required");
    return req.staff.staffId;
  };
  const audit = (req: FastifyRequest, action: string, metadata: Record<string, unknown>) =>
    o.db.withSystem((tx) => recordStaffAudit(tx, { staffId: staffId(req), action, metadata, ip: req.ip, requestId: req.id }));

  app.get("/admin/v1/ops/workspaces/:id/account", { preHandler: o.requireStaff("ops.account.read") }, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    // The history is read through the staff function: customer rows are not open to the API's database role.
    const [h] = await o.db.withSystem((tx) => tx.execute<{ v: unknown }>(sql`select platform.staff_workspace_history(${id}) v`));
    const history = staffAccountSchema.shape.history.parse(h?.v);
    const since = new Date(o.now().getTime() - 30 * DAY);
    const account = await o.db.withWorkspace(id, async (tx) => {
      const [w] = await tx.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.id, id), eq(workspaces.status, "active")));
      if (!w) return null;
      const [sub] = await tx
        .select({ planId: subscriptions.planId, status: subscriptions.status, ref: subscriptions.paddleSubscriptionId, periodEnd: subscriptions.currentPeriodEnd, trialEndsAt: subscriptions.trialEndsAt, planName: plans.name, monthlyCredits: plans.monthlyCredits })
        .from(subscriptions)
        .leftJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.workspaceId, id))
        .limit(1);
      const balance = await o.billing.engine.balance(tx, id);
      const [sums] = await tx
        .select({
          spent: sql<number>`coalesce(sum(-${creditLedger.amount}) filter (where ${creditLedger.kind} = 'spend'), 0)::int`,
          granted: sql<number>`coalesce(sum(${creditLedger.amount}) filter (where ${creditLedger.kind} in ('grant', 'adjust') and ${creditLedger.amount} > 0), 0)::int`,
        })
        .from(creditLedger)
        .where(and(eq(creditLedger.workspaceId, id), gte(creditLedger.createdAt, since)));
      const ledger = await tx
        .select({ id: creditLedger.id, kind: creditLedger.kind, action: creditLedger.action, amount: creditLedger.amount, note: creditLedger.note, staff: creditLedger.actorStaffId, createdAt: creditLedger.createdAt })
        .from(creditLedger)
        .where(and(eq(creditLedger.workspaceId, id), notInArray(creditLedger.kind, ["reserve", "release"])))
        .orderBy(desc(creditLedger.createdAt))
        .limit(25);
      return {
        workspaceId: id,
        plan: sub
          ? { id: sub.planId, name: sub.planName, status: sub.status, complimentary: Boolean(sub.ref?.startsWith(COMP_REF_PREFIX)), periodEnd: sub.periodEnd?.toISOString() ?? null, trialEndsAt: sub.trialEndsAt?.toISOString() ?? null, monthlyCredits: sub.monthlyCredits }
          : null,
        credits: { available: balance.available, reserved: balance.reserved, spent30d: Math.max(0, Number(sums?.spent ?? 0)), granted30d: Math.max(0, Number(sums?.granted ?? 0)) },
        ledger: ledger.map((l) => ({ id: l.id, kind: l.kind, action: l.action, amount: l.amount, note: l.note, byStaff: l.staff !== null, createdAt: l.createdAt.toISOString() })),
        members: [] as { name: string | null; email: string; role: string; joinedAt: string }[],
        history,
      };
    });
    if (!account) throw new AppError("NOT_FOUND", "Account not found");
    const [m] = await o.db.withSystem((tx) => tx.execute<{ v: unknown }>(sql`select platform.staff_workspace_members(${id}) v`));
    account.members = staffAccountSchema.shape.members.parse(m?.v ?? []);
    await audit(req, "ops.account.viewed", { workspaceId: id });
    return sendOk(reply, staffAccountSchema, account);
  });

  for (const [path, suspended] of [["suspend", true], ["restore", false]] as const) {
    app.post(`/admin/v1/ops/workspaces/:id/${path}`, { preHandler: o.requireStaff("ops.account.suspend") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      const { reason } = parseInput(staffSuspendSchema, req.body);
      const [r] = await o.db.withSystem((tx) => tx.execute<{ n: number }>(sql`select platform.staff_set_account_suspended(${id}, ${suspended}) n`));
      await audit(req, suspended ? "ops.account.suspended" : "ops.account.restored", { workspaceId: id, people: r?.n ?? 0, reason });
      return sendOk(reply, staffSuspendResultSchema, { suspended, people: r?.n ?? 0 });
    });
  }

  app.post("/admin/v1/ops/workspaces/:id/plan", { preHandler: o.requireStaff("billing.plan.grant") }, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    const body = parseInput(staffPlanGrantSchema, req.body);
    const r = await o.billing.grantComplimentaryPlan({ workspaceId: id, planId: body.planId, months: body.months });
    await audit(req, "billing.plan.granted", { workspaceId: id, planId: r.planId, months: body.months, periodEnd: r.periodEnd.toISOString(), reason: body.reason });
    return sendOk(reply, staffPlanGrantResultSchema, { planId: body.planId, periodEnd: r.periodEnd.toISOString(), monthlyCredits: r.monthlyCredits });
  });

  app.get("/admin/v1/ops/subscriptions", { preHandler: o.requireStaff("ops.subscriptions.read") }, async (_req, reply) => {
    const [row] = await o.db.withSystem((tx) => tx.execute<{ v: unknown }>(sql`select platform.staff_subscription_totals() v`));
    return sendOk(reply, staffSubscriptionsSchema, staffSubscriptionsSchema.parse(row?.v));
  });
}
