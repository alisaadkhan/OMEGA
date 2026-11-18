import { sql } from "drizzle-orm";
import { writeOutbox, type TenantTx } from "@mushin/db";
import { isMockPayments, parsePaddleEvent, type PaymentEvent } from "@mushin/integrations";
import type { createCreditEngine } from "./engine";
import { isPaying, minDate } from "./subscription-status";
import * as repo from "./repository";
import { addMonths } from "./rules";
import type { BillingDeps } from "./service";

/**
 * Payment provider webhooks (Paddle): stored first, then applied once each — transactions grant credits, failed
 * payments and subscription changes update the plan, refunds and chargebacks claw credits back. Split from service.ts
 * (500-line rule); behaviour unchanged.
 */
export function createBillingWebhooks(x: {
  deps: BillingDeps;
  engine: ReturnType<typeof createCreditEngine>;
  now: () => Date;
  notify: (tx: TenantTx, workspaceId: string, type: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  const { deps, engine, now, notify } = x;

  async function recordWebhook(event: PaymentEvent, rawBody: string, requestId: string): Promise<void> {
    const payload = JSON.parse(rawBody) as unknown;
    await deps.db.withSystem(async (tx) => {
      const id = await repo.insertWebhookEvent(tx, {
        provider: "paddle",
        providerEventId: event.eventId,
        eventType: event.kind === "ignored" ? event.eventType : event.kind,
        payload,
      });
      if (!id) return; // duplicate delivery
      await writeOutbox(tx, {
        eventType: "billing.webhook_received",
        aggregateType: "webhook_event",
        aggregateId: id,
        workspaceId: event.kind === "ignored" || event.kind === "adjustment.approved" ? null : event.workspaceId,
        payload: { webhookEventId: id },
        requestId,
      });
    });
  }

  async function processStoredWebhook(webhookEventId: string): Promise<void> {
    const row = await deps.db.withSystem((tx) => repo.getWebhookEvent(tx, webhookEventId));
    if (!row || row.processedAt) return;
    try {
      await applyEvent(parsePaddleEvent(row.payload));
      await deps.db.withSystem((tx) => repo.markWebhook(tx, webhookEventId, null));
    } catch (err) {
      await deps.db.withSystem((tx) => repo.markWebhook(tx, webhookEventId, err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  async function onTransaction(e: Extract<PaymentEvent, { kind: "transaction.completed" }>) {
    await deps.db.withWorkspace(e.workspaceId, async (tx) => {
      const kind = e.subscriptionId ? "subscription" : "topup";
      const paymentId = await repo.insertPayment(tx, {
        workspaceId: e.workspaceId,
        paddleTransactionId: e.transactionId,
        kind,
        amountMinor: e.amountMinor,
        currency: e.currency,
        status: "completed",
        invoiceUrl: e.invoiceUrl,
        checkoutId: e.checkoutId,
      });
      if (!paymentId) return; // already applied
      if (e.checkoutId) await repo.setCheckoutStatus(tx, e.workspaceId, e.checkoutId, "paid");
      if (kind === "topup") {
        const owner = await repo.findPriceOwner(tx, e.priceId);
        if (owner?.kind !== "topup") throw new Error(`unknown top-up price ${e.priceId}`);
        await engine.grant(tx, e.workspaceId, {
          source: "topup",
          amount: owner.pack.credits,
          expiresAt: null, // top-up credits never expire (owner decision 2026-10-14)
          sourceRef: `txn:${e.transactionId}`,
          paymentId,
          note: `${owner.pack.credits.toLocaleString("en-US")} credit top-up`,
        });
      }
    });
  }

  async function onPaymentFailed(e: Extract<PaymentEvent, { kind: "transaction.payment_failed" }>) {
    await deps.db.withWorkspace(e.workspaceId, async (tx) => {
      if (e.checkoutId) await repo.setCheckoutStatus(tx, e.workspaceId, e.checkoutId, "failed");
      await notify(tx, e.workspaceId, "payment_failed", { transactionId: e.transactionId });
    });
  }

  async function onSubscription(e: Extract<PaymentEvent, { subscription: unknown }>) {
    const s = e.subscription;
    await deps.db.withWorkspace(e.workspaceId, async (tx) => {
      const owner = await repo.findPriceOwner(tx, s.priceId);
      if (owner?.kind !== "plan") throw new Error(`unknown plan price ${s.priceId}`);
      const { plan, interval } = owner;
      const sub = await repo.getSubscription(tx, e.workspaceId, { forUpdate: true });
      if (sub?.providerEventAt && sub.providerEventAt.getTime() > e.occurredAt.getTime()) {
        deps.logger.info({ eventId: e.eventId, workspaceId: e.workspaceId }, "ignoring an older subscription event");
        return;
      }
      if (isPaying(sub) && sub?.paddleSubscriptionId && sub.paddleSubscriptionId !== s.subscriptionId) {
        // One workspace, one subscription: a second paid checkout must not add a second allowance.
        deps.logger.error(
          { eventId: e.eventId, workspaceId: e.workspaceId, existing: sub.paddleSubscriptionId, incoming: s.subscriptionId },
          "ignoring events for a second subscription; refund or cancel it in the payment provider",
        );
        return;
      }
      const status =
        e.kind === "subscription.canceled" || s.status === "canceled"
          ? "canceled"
          : e.kind === "subscription.past_due" || s.status === "past_due"
            ? "past_due"
            : "active";
      const patch: repo.SubscriptionPatch & { status: repo.SubscriptionRow["status"] } = {
        status,
        planId: plan.id,
        billingInterval: interval,
        currentPeriodStart: s.periodStart,
        currentPeriodEnd: s.periodEnd,
        paddleSubscriptionId: s.subscriptionId,
        paddleCustomerId: s.customerId,
        cancelAtPeriodEnd: status === "canceled" ? false : s.cancelScheduled,
        providerEventAt: e.occurredAt,
      };
      if (sub?.scheduledPlanId === plan.id && sub.scheduledInterval === interval) {
        patch.scheduledPlanId = null;
        patch.scheduledInterval = null;
      }
      if (status === "canceled") {
        await engine.endLots(tx, e.workspaceId, "monthly");
        Object.assign(patch, { nextCreditGrantAt: null, scheduledPlanId: null, scheduledInterval: null });
        await notify(tx, e.workspaceId, "subscription_canceled", { planId: plan.id });
      } else if (status === "active" && s.periodStart && s.periodEnd) {
        const creditEnd = interval === "year" ? minDate(addMonths(s.periodStart, 1), s.periodEnd) : s.periodEnd;
        const samePeriod = isPaying(sub) && sub?.currentPeriodStart?.getTime() === s.periodStart.getTime();
        const planChanged = sub?.planId !== plan.id || sub?.billingInterval !== interval;
        if (!samePeriod) {
          // A new billing period (first payment, renewal, or a change that restarts the period): full allowance.
          await engine.endLots(tx, e.workspaceId, "monthly");
          await engine.grant(tx, e.workspaceId, {
            source: "monthly",
            amount: plan.monthlyCredits,
            expiresAt: creditEnd,
            sourceRef: `monthly:${s.subscriptionId}:${s.periodStart.toISOString()}:${plan.id}:${interval}`,
            note: `${plan.name} monthly credits`,
          });
          patch.nextCreditGrantAt = creditEnd.getTime() < s.periodEnd.getTime() ? creditEnd : null;
        } else if (planChanged) {
          // Same period (a prorated mid-period change): keep the current allowance and add the difference, prorated
          // like the provider's charge by the share of the current credit month left, so an upgrade bought just before
          // the period ends cannot buy a month's worth of credits for a few cents (SRS §4.8 "impossible to game").
          // The extra lasts as long as the current credit month: for a yearly plan that ends at the next monthly grant.
          const previous = sub?.planId ? await repo.getPlan(tx, sub.planId) : null;
          const monthEnd = interval === "year" ? (sub?.nextCreditGrantAt ?? s.periodEnd) : s.periodEnd;
          const monthStart = interval === "year" ? addMonths(monthEnd, -1) : s.periodStart;
          const left = Math.min(1, Math.max(0, (monthEnd.getTime() - e.occurredAt.getTime()) / (monthEnd.getTime() - monthStart.getTime())));
          const extra = Math.floor((plan.monthlyCredits - (previous?.monthlyCredits ?? 0)) * left);
          if (extra > 0) {
            await engine.grant(tx, e.workspaceId, {
              source: "monthly",
              amount: extra,
              expiresAt: monthEnd,
              sourceRef: `upgrade:${s.subscriptionId}:${s.periodStart.toISOString()}:${plan.id}:${interval}`,
              note: `Upgrade to ${plan.name}: additional monthly credits`,
            });
          }
        }
      }
      await repo.upsertSubscription(tx, e.workspaceId, patch);
      if (patch.nextCreditGrantAt) await repo.scheduleJob(tx, e.workspaceId, "monthly_grants", patch.nextCreditGrantAt);
      if (status !== "canceled" && s.periodEnd && isMockPayments(deps.payments)) await repo.scheduleJob(tx, e.workspaceId, "mock_renewals", s.periodEnd);
    });
  }

  /**
   * An approved refund or chargeback (provisional policy until OD-009): mark the payment, remove the unspent credits it
   * granted (a top-up's own lot; for a subscription payment, the current period's monthly credits) in proportion to the
   * amount returned, and record what had already been spent as a shortfall. Applied once per provider adjustment.
   * Entitlements follow the subscription events the provider sends with it (a chargeback normally cancels).
   */
  async function onAdjustment(e: Extract<PaymentEvent, { kind: "adjustment.approved" }>): Promise<string | null> {
    const [owner] = await deps.db.withSystem((tx) => tx.execute<{ v: { paymentId: string; workspaceId: string } | null }>(sql`select platform.payment_owner(${e.transactionId}) v`));
    if (!owner?.v) {
      deps.logger.warn({ eventId: e.eventId, transactionId: e.transactionId }, "refund or chargeback for a transaction MUSHIN has not recorded; nothing changed");
      return null;
    }
    const { paymentId, workspaceId } = owner.v;
    await deps.db.withWorkspace(workspaceId, async (tx) => {
      await repo.lockCredits(tx, workspaceId);
      if (await repo.adjustmentApplied(tx, e.adjustmentId)) return;
      const payment = await repo.getPayment(tx, workspaceId, paymentId);
      if (!payment) return;
      const lots = payment.kind === "topup" ? await repo.lotsOfPayment(tx, workspaceId, paymentId) : await repo.currentMonthlyLots(tx, workspaceId, now());
      const granted = lots.reduce((n, l) => n + l.amount, 0);
      const share = e.full || payment.amountMinor === 0 ? 1 : Math.min(1, e.amountMinor / payment.amountMinor);
      const target = Math.floor(granted * share);
      const label = e.action === "chargeback" ? "Chargeback" : "Refund";
      const { removed, shortfall } = await engine.revoke(tx, workspaceId, lots, target, `${e.action}:${e.adjustmentId}`, `${label}: credits from the returned payment removed`);
      const refunded = Math.min(payment.amountMinor, payment.refundedMinor + e.amountMinor);
      const status = e.action === "chargeback" ? "charged_back" : refunded >= payment.amountMinor ? "refunded" : "partially_refunded";
      await repo.recordAdjustment(tx, { workspaceId, paymentId, providerAdjustmentId: e.adjustmentId, action: e.action, amountMinor: e.amountMinor, creditsRemoved: removed, creditsShortfall: shortfall }, refunded, status);
      await notify(tx, workspaceId, e.action === "chargeback" ? "payment_charged_back" : "payment_refunded", { paymentId, creditsRemoved: removed });
      if (shortfall > 0) deps.logger.warn({ workspaceId, paymentId, shortfall }, "refunded credits had already been spent; recorded as a shortfall");
    });
    return workspaceId;
  }

  async function applyEvent(e: PaymentEvent): Promise<void> {
    if (e.kind === "ignored") return;
    if (e.kind === "adjustment.approved") {
      const workspaceId = await onAdjustment(e);
      if (workspaceId) await deps.cache.invalidate(workspaceId);
      return;
    }
    if (e.kind === "transaction.completed") await onTransaction(e);
    else if (e.kind === "transaction.payment_failed") await onPaymentFailed(e);
    else await onSubscription(e);
    await deps.cache.invalidate(e.workspaceId);
  }

  return { recordWebhook, processStoredWebhook, applyEvent };
}
