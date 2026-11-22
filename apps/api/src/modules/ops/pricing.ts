import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { staffActionCostSchema, staffPlanTermsSchema, staffPricingSchema } from "@mushin/contracts";
import { AppError } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { PreHandler } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import { recordStaffAudit, type StaffAction } from "../staff/index";

const iso = (d: unknown) => new Date(d as string).toISOString();

/**
 * Plans and credit costs from the console (owner, 22 Nov): anyone with Subscriptions access reads them; only a Super
 * Admin changes them, with a reason, audited before and after. The payment provider's charge is never changed here.
 */
export function registerPricingRoutes(app: FastifyInstance, o: { db: Db; requireStaff: (action: StaffAction) => PreHandler }) {
  const staffId = (req: FastifyRequest) => {
    if (!req.staff) throw new AppError("UNAUTHENTICATED", "Admin authentication required");
    return req.staff.staffId;
  };
  const read = async () => {
    const plans = await o.db.withSystem((tx) =>
      tx.execute<{ id: string; name: string; monthly_credits: number; display_currency: string; display_monthly_minor: string; charge_currency: string; charge_monthly_minor: string }>(sql`
        select id, name, monthly_credits, display_currency, display_monthly_minor, charge_currency, charge_monthly_minor from platform.plans where active order by sort_order`),
    );
    const actions = await o.db.withSystem((tx) => tx.execute<{ action: string; credits: number; updated_at: string }>(sql`select action, credits, updated_at from platform.credit_action_costs order by action`));
    return staffPricingSchema.parse({
      plans: plans.map((p) => ({ id: p.id, name: p.name, monthlyCredits: p.monthly_credits, displayCurrency: p.display_currency, displayMonthlyMinor: Number(p.display_monthly_minor), chargeCurrency: p.charge_currency, chargeMonthlyMinor: Number(p.charge_monthly_minor) })),
      actions: actions.map((a) => ({ action: a.action, credits: a.credits, updatedAt: iso(a.updated_at) })),
    });
  };

  app.get("/admin/v1/ops/pricing", { preHandler: o.requireStaff("ops.subscriptions.read") }, async (_req, reply) => sendOk(reply, staffPricingSchema, await read()));

  app.put("/admin/v1/ops/pricing/plans/:id", { preHandler: o.requireStaff("billing.pricing.manage") }, async (req, reply) => {
    const { id } = parseInput(z.object({ id: z.enum(["explorer", "growth", "scale"]) }), req.params);
    const body = parseInput(staffPlanTermsSchema, req.body);
    const before = (await read()).plans.find((p) => p.id === id);
    await o.db.withSystem(async (tx) => {
      await tx.execute(sql`select platform.staff_set_plan_terms(${id}, ${body.monthlyCredits}, ${body.displayMonthlyMinor})`);
      const metadata = { planId: id, before: before ? { monthlyCredits: before.monthlyCredits, displayMonthlyMinor: before.displayMonthlyMinor } : null, after: { monthlyCredits: body.monthlyCredits, displayMonthlyMinor: body.displayMonthlyMinor }, reason: body.reason };
      await recordStaffAudit(tx, { staffId: staffId(req), action: "billing.plan_terms.changed", metadata, ip: req.ip, requestId: req.id });
    });
    return sendOk(reply, staffPricingSchema, await read());
  });

  app.put("/admin/v1/ops/pricing/actions/:action", { preHandler: o.requireStaff("billing.pricing.manage") }, async (req, reply) => {
    const { action } = parseInput(z.object({ action: z.string().regex(/^[a-z_]{3,40}$/) }), req.params);
    const body = parseInput(staffActionCostSchema, req.body);
    const before = (await read()).actions.find((a) => a.action === action);
    if (!before) throw new AppError("NOT_FOUND", "No such action");
    await o.db.withSystem(async (tx) => {
      await tx.execute(sql`select platform.staff_set_action_cost(${action}, ${body.credits})`);
      await recordStaffAudit(tx, { staffId: staffId(req), action: "billing.action_cost.changed", metadata: { action, before: before.credits, after: body.credits, reason: body.reason }, ip: req.ip, requestId: req.id });
    });
    return sendOk(reply, staffPricingSchema, await read());
  });
}
