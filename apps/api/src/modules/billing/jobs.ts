import { randomUUID } from "node:crypto";
import type { BillingInterval, PlanId } from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { recordAlertEvent, type SystemTx, type TenantTx } from "@mushin/db";
import { isMockPayments, type PriceRef, type SubscriptionRef } from "@mushin/integrations";
import type { createCreditEngine } from "./engine";
import * as repo from "./repository";
import { addMonths } from "./rules";
import { COMP_REF_PREFIX, downgradeDue, isComp, isPaying, minDate } from "./subscription-status";
import type { BillingDeps } from "./service";

/**
 * The scheduled billing jobs (renewals, monthly grants, credit expiry, trial notices and ends, scheduled plan changes,
 * complimentary periods, reconciliation) and complimentary plan grants, split from service.ts (500-line rule). Each job
 * acts only on what is due, under the workspace's credit lock, so running it twice changes nothing.
 */
export function createBillingJobs(x: {
  deps: BillingDeps;
  engine: ReturnType<typeof createCreditEngine>;
  now: () => Date;
  notify: (tx: TenantTx, workspaceId: string, type: string, payload: Record<string, unknown>) => Promise<void>;
  subscriptionRef: (sub: repo.SubscriptionRow, plan: repo.PlanRow) => SubscriptionRef;
  priceForPlan: (plan: repo.PlanRow, interval: BillingInterval) => PriceRef;
}) {
  const { deps, engine, now, notify, subscriptionRef, priceForPlan } = x;
  const DAY = 86_400_000;
  const later = (ms: number) => new Date(now().getTime() + ms);

  async function runJobFor(job: repo.BillingJob, workspaceId: string): Promise<void> {
    const t = now();
    switch (job) {
      case "release_abandoned":
        await deps.db.withWorkspace(workspaceId, async (tx) => {
          await engine.releaseAbandoned(tx, workspaceId);
          await repo.setNextDue(tx, workspaceId, job, await repo.earliestHeldExpiry(tx, workspaceId));
        });
        return;
      case "expire_lots":
        await deps.db.withWorkspace(workspaceId, async (tx) => {
          await engine.expireLots(tx, workspaceId);
          const next = await repo.earliestLotExpiry(tx, workspaceId);
          // A lot still past its expiry was skipped because a hold exists: look again in five minutes.
          await repo.setNextDue(tx, workspaceId, job, next && next.getTime() <= t.getTime() ? later(5 * 60_000) : next);
        });
        return;
      case "reconcile":
        await deps.db.withWorkspace(workspaceId, async (tx) => {
          const mismatches = await engine.reconcile(tx, workspaceId);
          if (mismatches.length > 0) {
            deps.logger.error({ workspaceId, mismatches }, "credit lots do not match the ledger");
            // Audit OPS-03: operators are told; the workspace id stays in the log. withWorkspace runs as the worker role.
            await recordAlertEvent(tx as unknown as SystemTx, { key: "credit_mismatch", severity: "critical", message: `Credit lots do not match the ledger in a workspace (${mismatches.length} difference(s)). See the log entry "credit lots do not match the ledger".` });
          }
          await repo.setNextDue(tx, workspaceId, job, later(DAY));
        });
        return;
      case "end_trials":
        await deps.db.withWorkspace(workspaceId, async (tx) => {
          const sub = await repo.getSubscription(tx, workspaceId, { forUpdate: true });
          if (sub?.status !== "trialing" || !sub.trialEndsAt) return repo.setNextDue(tx, workspaceId, job, null);
          if (sub.trialEndsAt.getTime() > t.getTime()) return repo.setNextDue(tx, workspaceId, job, sub.trialEndsAt);
          await repo.updateSubscription(tx, workspaceId, { status: "expired" });
          await engine.expireLots(tx, workspaceId);
          await notify(tx, workspaceId, "trial_expired", {});
          await repo.setNextDue(tx, workspaceId, job, null);
        });
        await deps.cache.invalidate(workspaceId);
        return;
      case "trial_notices":
        await deps.db.withWorkspace(workspaceId, async (tx) => {
          const sub = await repo.getSubscription(tx, workspaceId, { forUpdate: true });
          if (sub?.status !== "trialing" || sub.trialEndingNotifiedAt || !sub.trialEndsAt) return repo.setNextDue(tx, workspaceId, job, null);
          const settings = await repo.getSettings(tx);
          const noticeAt = new Date(sub.trialEndsAt.getTime() - settings.trialEndingNoticeDays * DAY);
          if (noticeAt.getTime() > t.getTime()) return repo.setNextDue(tx, workspaceId, job, noticeAt);
          await repo.updateSubscription(tx, workspaceId, { trialEndingNotifiedAt: t });
          await notify(tx, workspaceId, "trial_ending", { trialEndsAt: sub.trialEndsAt.toISOString() });
          await repo.setNextDue(tx, workspaceId, job, null);
        });
        return;
      case "monthly_grants":
        await deps.db.withWorkspace(workspaceId, async (tx) => {
          const sub = await repo.getSubscription(tx, workspaceId, { forUpdate: true });
          const start = sub?.nextCreditGrantAt ?? null;
          if (!sub || !isPaying(sub) || !start || !sub.planId || !sub.currentPeriodEnd || !sub.paddleSubscriptionId) {
            return repo.setNextDue(tx, workspaceId, job, null);
          }
          if (start.getTime() > t.getTime()) return repo.setNextDue(tx, workspaceId, job, start);
          const plan = await repo.getPlan(tx, sub.planId);
          if (!plan) return repo.setNextDue(tx, workspaceId, job, null);
          const end = minDate(addMonths(start, 1), sub.currentPeriodEnd);
          await engine.endLots(tx, workspaceId, "monthly");
          await engine.grant(tx, workspaceId, {
            source: "monthly",
            amount: plan.monthlyCredits,
            expiresAt: end,
            sourceRef: `monthly:${sub.paddleSubscriptionId}:${start.toISOString()}:${plan.id}:year`,
            note: `${plan.name} monthly credits`,
          });
          const next = end.getTime() < sub.currentPeriodEnd.getTime() ? end : null;
          await repo.updateSubscription(tx, workspaceId, { nextCreditGrantAt: next });
          await repo.setNextDue(tx, workspaceId, job, next);
        });
        return;
      case "scheduled_changes": {
        const work = await deps.db.withWorkspace(workspaceId, async (tx) => {
          const sub = await repo.getSubscription(tx, workspaceId);
          if (
            !sub ||
            !isPaying(sub) ||
            sub.cancelAtPeriodEnd ||
            !sub.planId ||
            !sub.scheduledPlanId ||
            !sub.scheduledInterval ||
            !sub.currentPeriodEnd
          ) {
            await repo.setNextDue(tx, workspaceId, job, null);
            return null;
          }
          const due = downgradeDue(sub.currentPeriodEnd);
          if (due.getTime() > t.getTime()) {
            await repo.setNextDue(tx, workspaceId, job, due);
            return null;
          }
          const current = await repo.getPlan(tx, sub.planId);
          const target = await repo.getPlan(tx, sub.scheduledPlanId);
          if (!current || !target) return null;
          // Looked at again in an hour until the provider's webhook confirms the change and clears it.
          await repo.setNextDue(tx, workspaceId, job, later(3_600_000));
          return { ref: subscriptionRef(sub, current), target: priceForPlan(target, sub.scheduledInterval) };
        });
        if (work) await deps.payments.changePlan({ subscription: work.ref, target: work.target, when: "next_period" });
        return;
      }
      case "testing_allowance":
        // Monthly testing credits (0061): granted once per Karachi month (unique ledger reference), retried safely.
        await deps.db.withWorkspace(workspaceId, (tx) => engine.grantTesting(tx, workspaceId));
        await deps.cache.invalidate(workspaceId);
        return;
      case "comp_period_end":
        await deps.db.withWorkspace(workspaceId, async (tx) => {
          const sub = await repo.getSubscription(tx, workspaceId, { forUpdate: true });
          if (!sub || !isComp(sub) || !isPaying(sub) || !sub.currentPeriodEnd) return repo.setNextDue(tx, workspaceId, job, null);
          if (sub.currentPeriodEnd.getTime() > t.getTime()) return repo.setNextDue(tx, workspaceId, job, sub.currentPeriodEnd);
          // The comp period is over: the plan ends as a provider cancellation would end it; its monthly credits end too.
          await engine.endLots(tx, workspaceId, "monthly");
          await repo.updateSubscription(tx, workspaceId, { status: "canceled", nextCreditGrantAt: null });
          await repo.setNextDue(tx, workspaceId, job, null);
        });
        await deps.cache.invalidate(workspaceId);
        return;
      case "mock_renewals": {
        if (!isMockPayments(deps.payments)) return;
        const work = await deps.db.withWorkspace(workspaceId, async (tx) => {
          const sub = await repo.getSubscription(tx, workspaceId);
          if (!sub || !isPaying(sub) || !sub.planId || !sub.currentPeriodEnd) {
            await repo.setNextDue(tx, workspaceId, job, null);
            return null;
          }
          if (sub.currentPeriodEnd.getTime() > t.getTime()) {
            await repo.setNextDue(tx, workspaceId, job, sub.currentPeriodEnd);
            return null;
          }
          await repo.setNextDue(tx, workspaceId, job, later(DAY));
          const plan = await repo.getPlan(tx, sub.planId);
          return plan ? { ref: subscriptionRef(sub, plan), cancel: sub.cancelAtPeriodEnd } : null;
        });
        if (work) await deps.payments.renew(work.ref, work.cancel);
        return;
      }
    }
  }

  /**
   * Complimentary plan (owner instruction 2026-10-21; out-of-band only: scripts/grant-comp-plan.ts, audited there). The
   * workspace gets the plan for `months` with no payment: an ordinary subscription row with a `comp:` reference,
   * already set to end at its period end, so plan changes and cancellation are refused before anything reaches the
   * payment provider. The first month's credits are granted now and the existing monthly_grants job grants the rest; the
   * comp_period_end job ends the plan. A workspace that already pays through the provider is refused.
   */
  async function grantComplimentaryPlan(input: { workspaceId: string; planId: PlanId; months: number }): Promise<{ ref: string; planId: string; periodStart: Date; periodEnd: Date; monthlyCredits: number }> {
    if (!Number.isInteger(input.months) || input.months < 1 || input.months > 24) throw new AppError("VALIDATION_FAILED", "months must be a whole number from 1 to 24");
    const t = now();
    const result = await deps.db.withWorkspace(input.workspaceId, async (tx) => {
      const plan = await repo.getPlan(tx, input.planId);
      if (!plan || !plan.active) throw new AppError("NOT_FOUND", "That plan is not available");
      const sub = await repo.getSubscription(tx, input.workspaceId, { forUpdate: true });
      if (sub && isPaying(sub) && !isComp(sub)) throw new AppError("CONFLICT", "This team already pays for a plan through the payment provider; a complimentary plan would double it.");
      const ref = `${COMP_REF_PREFIX}${randomUUID()}`;
      const periodEnd = addMonths(t, input.months);
      const creditEnd = minDate(addMonths(t, 1), periodEnd);
      await engine.endLots(tx, input.workspaceId, "monthly");
      await repo.upsertSubscription(tx, input.workspaceId, {
        planId: plan.id,
        billingInterval: "year",
        status: "active",
        currentPeriodStart: t,
        currentPeriodEnd: periodEnd,
        trialEndsAt: null,
        nextCreditGrantAt: creditEnd.getTime() < periodEnd.getTime() ? creditEnd : null,
        paddleSubscriptionId: ref,
        paddleCustomerId: null,
        cancelAtPeriodEnd: true,
        scheduledPlanId: null,
        scheduledInterval: null,
      });
      await engine.grant(tx, input.workspaceId, {
        source: "monthly",
        amount: plan.monthlyCredits,
        expiresAt: creditEnd,
        sourceRef: `monthly:${ref}:${t.toISOString()}:${plan.id}:year`,
        note: `${plan.name} monthly credits (complimentary)`,
      });
      if (creditEnd.getTime() < periodEnd.getTime()) await repo.scheduleJob(tx, input.workspaceId, "monthly_grants", creditEnd);
      await repo.scheduleJob(tx, input.workspaceId, "comp_period_end", periodEnd);
      return { ref, planId: plan.id, periodStart: t, periodEnd, monthlyCredits: plan.monthlyCredits };
    });
    await deps.cache.invalidate(input.workspaceId);
    return result;
  }

  async function runJob(job: repo.BillingJob): Promise<{ processed: number }> {
    if (job === "mock_renewals" && (!isMockPayments(deps.payments) || deps.paymentsOpen === false)) return { processed: 0 };
    const workspaceIds = await deps.db.withSystem((tx) => repo.dueWorkspaces(tx, job, now()));
    let failed = 0;
    for (const workspaceId of workspaceIds) {
      try {
        await runJobFor(job, workspaceId);
      } catch (err) {
        failed += 1;
        deps.logger.error({ err, job, workspaceId }, "billing job failed for a workspace");
      }
    }
    if (failed > 0) throw new Error(`billing job ${job} failed for ${failed} of ${workspaceIds.length} workspaces`);
    return { processed: workspaceIds.length };
  }

  return { runJob, grantComplimentaryPlan };
}
