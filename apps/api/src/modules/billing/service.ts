import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { TIKTOK_LIVE_MINIMUM_CREDITS } from "@mushin/contracts";
import type {
  BillingInterval,
  BillingPlans,
  BillingSummary,
  Capabilities,
  CheckoutRequest,
  CreditAction,
  Entitlements,
  InvoicesResponse,
  LedgerPage,
  PlanChangeRequest,
  PlanChangeResponse,
  PlanId,
} from "@mushin/contracts";
import { AppError, type Logger, type TenantContext } from "@mushin/core";
import { recordAlertEvent, writeOutbox, type Db, type SystemTx, type TenantTx } from "@mushin/db";
import { isMockPayments, parsePaddleEvent, type PaymentEvent, type Payments, type PriceRef, type SubscriptionRef } from "@mushin/integrations";
import type { Access, AccessCache } from "./access-cache";
import { createCreditEngine, type SpendRequest } from "./engine";
import * as repo from "./repository";
import { addMonths, classifyChange, daysLeft, decodeCursor, effectiveStatus, encodeCursor, lostAccessFor, spendScope } from "./rules";

/** `capabilities`: the server-wide switches (see capabilitiesSchema); omitted means everything gated stays off. */
export type BillingDeps = { db: Db; payments: Payments; cache: AccessCache; logger: Logger; now?: () => Date; capabilities?: Capabilities };
const CAPABILITIES_OFF: Capabilities = { audienceDetails: false, outreachEmail: "off", export: false };
export type Customer = TenantContext & { email: string };

const BILLING_ROLES = new Set<TenantContext["role"]>(["owner", "admin"]);
const NO_ENTITLEMENTS: Entitlements = { audienceViewsPerMonth: 0, outreachEmailsPerMonth: 0, campaignLimit: 0, export: false };

function refuseUnapprovedAnnual(settings: repo.SettingsRow, interval: BillingInterval) {
  if (interval === "year" && !settings.annualBillingEnabled) {
    throw new AppError("VALIDATION_FAILED", "Annual billing is not available yet. Choose monthly billing.", { reason: "annual_billing_unavailable", field: "interval" });
  }
}

function requireBillingRole(ctx: TenantContext) {
  if (!BILLING_ROLES.has(ctx.role)) throw new AppError("FORBIDDEN", "Only the workspace owner or an admin can manage billing");
}

const minDate = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);
/**
 * A downgrade is sent to the provider this long before the period ends, billed from the next period: the provider
 * renews at the period end, so a change sent after it would charge the old plan for another period. The
 * scheduled_changes job runs hourly, so this leaves one retry before the boundary.
 */
const DOWNGRADE_LEAD_MS = 2 * 3_600_000;
const downgradeDue = (periodEnd: Date) => new Date(periodEnd.getTime() - DOWNGRADE_LEAD_MS);
const isPaying = (s: repo.SubscriptionRow | null) => s?.status === "active" || s?.status === "past_due";
/** A complimentary plan's subscription reference (never a payment provider's). */
export const COMP_REF_PREFIX = "comp:";
const isComp = (s: repo.SubscriptionRow | null) => Boolean(s?.paddleSubscriptionId?.startsWith(COMP_REF_PREFIX));

export function createBillingService(deps: BillingDeps) {
  const now = deps.now ?? (() => new Date());
  const engine = createCreditEngine({ now });
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });
  const actorOf = (ctx: TenantContext) => ({ userId: ctx.userId, requestId: ctx.requestId });

  function priceForPlan(plan: repo.PlanRow, interval: BillingInterval): PriceRef {
    return {
      priceId: plan.paddlePriceIds[interval],
      interval,
      amountMinor: interval === "month" ? plan.chargeMonthlyMinor : plan.chargeYearlyMinor,
      currency: plan.chargeCurrency,
    };
  }

  function subscriptionRef(sub: repo.SubscriptionRow, plan: repo.PlanRow): SubscriptionRef {
    if (!sub.paddleSubscriptionId || !sub.billingInterval || !sub.currentPeriodStart || !sub.currentPeriodEnd) {
      throw new AppError("CONFLICT", "There is no active subscription to change. Choose a plan instead.");
    }
    return {
      subscriptionId: sub.paddleSubscriptionId,
      customerId: sub.paddleCustomerId,
      workspaceId: sub.workspaceId,
      price: priceForPlan(plan, sub.billingInterval),
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
    };
  }

  async function notify(tx: TenantTx, workspaceId: string, type: string, payload: Record<string, unknown>) {
    await writeOutbox(tx, { eventType: `notify.${type}`, aggregateType: "workspace", aggregateId: workspaceId, workspaceId, payload, requestId: null });
  }

  // ── reads ────────────────────────────────────────────────────────────────
  async function summary(ctx: TenantContext): Promise<BillingSummary> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const sub = await repo.getSubscription(tx, ctx.workspaceId);
      const b = await engine.balance(tx, ctx.workspaceId);
      const plan = isPaying(sub) && sub?.planId ? await repo.getPlan(tx, sub.planId) : null;
      return {
        plan: plan ? { id: plan.id, name: plan.name, monthlyCredits: plan.monthlyCredits } : null,
        interval: plan ? (sub?.billingInterval ?? null) : null,
        status: b.status ?? "expired",
        currentPeriodEnd: plan ? (sub?.currentPeriodEnd?.toISOString() ?? null) : null,
        trialStartedAt: sub?.trialEndsAt ? sub.createdAt.toISOString() : null,
        trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
        trialDaysLeft: b.status === "trialing" && sub ? daysLeft(sub.trialEndsAt, now()) : null,
        awaitingTrial: sub === null,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        scheduledChange: sub?.scheduledPlanId && sub.scheduledInterval ? { planId: sub.scheduledPlanId, interval: sub.scheduledInterval } : null,
        balance: { available: b.available, reserved: b.reserved, base: b.base, meter: b.meter },
        canPurchase: BILLING_ROLES.has(ctx.role),
        lostAccess: lostAccessFor(b.status, b.topupRemaining),
      };
    });
  }

  /** The current credit price of an action, for screens that show it before the user confirms (SRS §3.1). */
  async function actionCost(ctx: TenantContext, action: CreditAction): Promise<number> {
    return deps.db.withTenant(tenant(ctx), (tx) => repo.getActionCost(tx, action));
  }

  /** The plan catalogue (platform.plans is the only source of plans, prices and entitlements). */
  async function catalogue(tx: repo.AnyTx): Promise<BillingPlans> {
    const planRows = await repo.listPlans(tx);
    const packRows = await repo.listPacks(tx);
    const costs = new Map((await repo.listActionCosts(tx)).map((c) => [c.action, c.credits]));
    const cost = (a: CreditAction) => {
      const value = costs.get(a);
      if (value === undefined) throw new Error(`no credit cost configured for ${a}`);
      return value;
    };
    return {
      plans: planRows.map((p) => ({
        id: p.id,
        name: p.name,
        monthlyCredits: p.monthlyCredits,
        display: {
          monthly: { amountMinor: p.displayMonthlyMinor, currency: p.displayCurrency },
          yearlyPerMonth: { amountMinor: p.displayYearlyMonthlyMinor, currency: p.displayCurrency },
        },
        charge: {
          monthly: { amountMinor: p.chargeMonthlyMinor, currency: p.chargeCurrency },
          yearly: { amountMinor: p.chargeYearlyMinor, currency: p.chargeCurrency },
        },
        entitlements: p.entitlements,
      })),
      topupPacks: packRows.map((k) => ({
        id: k.id,
        credits: k.credits,
        display: { amountMinor: k.displayPriceMinor, currency: k.displayCurrency },
        charge: { amountMinor: k.chargePriceMinor, currency: k.chargeCurrency },
        validityMonths: null,
      })),
      actionCosts: {
        search_existing: cost("search_existing"),
        find_new: cost("find_new"),
        live_creator: cost("live_creator"),
        reveal_contact: cost("reveal_contact"),
        refresh_data: cost("refresh_data"),
        refresh_tiktok: cost("refresh_tiktok"),
        audience_estimate: cost("audience_estimate"),
      },
      annualBilling: (await repo.getSettings(tx)).annualBillingEnabled,
      liveTiktokMinimum: TIKTOK_LIVE_MINIMUM_CREDITS,
      availability: deps.capabilities ?? CAPABILITIES_OFF,
    };
  }

  const plans = (ctx: TenantContext): Promise<BillingPlans> => deps.db.withTenant(tenant(ctx), catalogue);
  /** The same catalogue for signed-out visitors (pricing page): plan and price data only, nothing per workspace. */
  const publicPlans = (): Promise<BillingPlans> => deps.db.withSystem(catalogue);

  async function ledger(ctx: TenantContext, q: { cursor?: string | undefined; limit: number }): Promise<LedgerPage> {
    requireBillingRole(ctx);
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    if (q.cursor && !cursor) throw new AppError("VALIDATION_FAILED", "Invalid cursor");
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const rows = await repo.ledgerPage(tx, ctx.workspaceId, cursor, q.limit);
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        entries: page.map((r) => ({
          id: r.id,
          kind: r.kind,
          amount: r.amount,
          action: r.action,
          lotSource: r.lotSource,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
        })),
        nextCursor: rows.length > q.limit && last ? encodeCursor({ at: last.cursorAt, id: last.id }) : null,
      };
    });
  }

  async function invoices(ctx: TenantContext): Promise<InvoicesResponse> {
    requireBillingRole(ctx);
    return deps.db.withTenant(tenant(ctx), async (tx) => ({
      invoices: (await repo.listPayments(tx, ctx.workspaceId)).map((p) => ({
        id: p.id,
        kind: p.kind,
        amount: { amountMinor: p.amountMinor, currency: p.currency },
        status: p.status,
        invoiceUrl: p.invoiceUrl,
        createdAt: p.createdAt.toISOString(),
      })),
    }));
  }

  async function getAccess(ctx: TenantContext): Promise<Access> {
    const cached = await deps.cache.get(ctx.workspaceId);
    if (cached) return cached;
    const access = await deps.db.withTenant(tenant(ctx), async (tx): Promise<Access> => {
      const sub = await repo.getSubscription(tx, ctx.workspaceId);
      const settings = await repo.getSettings(tx);
      const status = effectiveStatus(sub?.status ?? null, sub?.trialEndsAt ?? null, now());
      const planId = status === "trialing" ? settings.trialPlanId : isPaying(sub) ? (sub?.planId ?? null) : null;
      const plan = planId ? await repo.getPlan(tx, planId) : null;
      return {
        status,
        planId: status === "trialing" ? null : (plan?.id ?? null),
        entitlements: plan?.entitlements ?? NO_ENTITLEMENTS,
        spend: spendScope(status),
      };
    });
    await deps.cache.set(ctx.workspaceId, access);
    return access;
  }

  async function useEntitlement(ctx: TenantContext, key: "audience_views" | "outreach_emails"): Promise<void> {
    const access = await getAccess(ctx);
    const limit = key === "audience_views" ? access.entitlements.audienceViewsPerMonth : access.entitlements.outreachEmailsPerMonth;
    const ok = await deps.db.withTenant(tenant(ctx), (tx) => engine.useEntitlement(tx, ctx.workspaceId, key, limit));
    if (!ok) throw new AppError("ENTITLEMENT_REQUIRED", "Your plan's monthly limit for this feature is used up.", { reason: "plan_limit", key });
  }

  // ── purchases ────────────────────────────────────────────────────────────
  async function startCheckout(c: Customer, req: CheckoutRequest): Promise<{ checkoutId: string; url: string }> {
    requireBillingRole(c);
    const created = await deps.db.withTenant(tenant(c), async (tx) => {
      const sub = await repo.getSubscription(tx, c.workspaceId);
      if (req.kind === "topup") {
        if (sub?.status === "trialing") {
          throw new AppError("ENTITLEMENT_REQUIRED", "Credit top-ups are available once you choose a plan.", { reason: "trial_topup_blocked" });
        }
        const pack = await repo.getPack(tx, req.packId);
        if (!pack) throw new AppError("NOT_FOUND", "That credit pack is not available");
        const price: PriceRef = { priceId: pack.paddlePriceId, interval: null, amountMinor: pack.chargePriceMinor, currency: pack.chargeCurrency };
        const checkout = await repo.insertCheckout(tx, {
          workspaceId: c.workspaceId,
          kind: "topup",
          topupPackId: pack.id,
          priceId: price.priceId,
          amountMinor: price.amountMinor,
          currency: price.currency,
          requestedBy: c.userId,
        });
        return { checkout, price };
      }
      if (isPaying(sub)) throw new AppError("CONFLICT", "You already have a subscription. Change your plan instead.");
      refuseUnapprovedAnnual(await repo.getSettings(tx), req.interval);
      const plan = await repo.getPlan(tx, req.planId);
      if (!plan || !plan.active) throw new AppError("NOT_FOUND", "That plan is not available");
      const price = priceForPlan(plan, req.interval);
      const checkout = await repo.insertCheckout(tx, {
        workspaceId: c.workspaceId,
        kind: "subscription",
        planId: plan.id,
        billingInterval: req.interval,
        priceId: price.priceId,
        amountMinor: price.amountMinor,
        currency: price.currency,
        requestedBy: c.userId,
      });
      return { checkout, price };
    });

    let hosted: { providerCheckoutId: string; url: string };
    try {
      hosted = await deps.payments.createCheckout({ checkoutId: created.checkout.id, workspaceId: c.workspaceId, customerEmail: c.email, price: created.price });
    } catch (err) {
      await deps.db.withTenant(tenant(c), (tx) => repo.setCheckoutStatus(tx, c.workspaceId, created.checkout.id, "failed"));
      throw err instanceof AppError
        ? err
        : new AppError("PROVIDER_UNAVAILABLE", "The payment provider is unavailable right now. Please try again shortly.", undefined, { cause: err });
    }
    await deps.db.withTenant(tenant(c), (tx) => repo.setCheckoutProvider(tx, c.workspaceId, created.checkout.id, hosted.providerCheckoutId, hosted.url));
    return { checkoutId: created.checkout.id, url: hosted.url };
  }

  async function requestPlanChange(c: TenantContext, req: PlanChangeRequest): Promise<PlanChangeResponse> {
    requireBillingRole(c);
    const decision = await deps.db.withTenant(tenant(c), async (tx) => {
      const sub = await repo.getSubscription(tx, c.workspaceId, { forUpdate: true });
      if (!sub || !isPaying(sub) || !sub.planId || !sub.billingInterval) {
        throw new AppError("CONFLICT", "There is no active subscription to change. Choose a plan instead.");
      }
      if (sub.cancelAtPeriodEnd) throw new AppError("CONFLICT", "Your subscription is set to end at the end of this period.");
      if (sub.billingInterval !== "year") refuseUnapprovedAnnual(await repo.getSettings(tx), req.interval);
      const current = await repo.getPlan(tx, sub.planId);
      const target = await repo.getPlan(tx, req.planId);
      if (!current || !target || !target.active) throw new AppError("NOT_FOUND", "That plan is not available");
      const change = classifyChange(
        { planId: current.id, interval: sub.billingInterval, monthlyCredits: current.monthlyCredits },
        { planId: target.id, interval: req.interval, monthlyCredits: target.monthlyCredits },
      );
      if (change === "same") throw new AppError("CONFLICT", "You are already on this plan");
      if (change === "downgrade") {
        await repo.updateSubscription(tx, c.workspaceId, { scheduledPlanId: target.id, scheduledInterval: req.interval });
        if (sub.currentPeriodEnd) await repo.scheduleJob(tx, c.workspaceId, "scheduled_changes", downgradeDue(sub.currentPeriodEnd));
        return { change, ref: null, target };
      }
      await repo.updateSubscription(tx, c.workspaceId, { scheduledPlanId: null, scheduledInterval: null });
      return { change, ref: subscriptionRef(sub, current), target };
    });
    if (decision.ref) await deps.payments.changePlan({ subscription: decision.ref, target: priceForPlan(decision.target, req.interval), when: "now" });
    await deps.cache.invalidate(c.workspaceId);
    return decision.change === "upgrade" ? { change: "upgrade", effective: "now" } : { change: "downgrade", effective: "period_end" };
  }

  async function requestCancel(c: TenantContext): Promise<PlanChangeResponse> {
    requireBillingRole(c);
    const ref = await deps.db.withTenant(tenant(c), async (tx) => {
      const sub = await repo.getSubscription(tx, c.workspaceId);
      if (!sub || !isPaying(sub) || !sub.planId) throw new AppError("CONFLICT", "There is no active subscription to cancel.");
      if (sub.cancelAtPeriodEnd) throw new AppError("CONFLICT", "Your subscription is already set to end.");
      const plan = await repo.getPlan(tx, sub.planId);
      if (!plan) throw new AppError("NOT_FOUND", "That plan is not available");
      return subscriptionRef(sub, plan);
    });
    await deps.payments.cancelAtPeriodEnd({ subscription: ref });
    // Ending the subscription supersedes a scheduled downgrade, which would otherwise be sent at the period end.
    await deps.db.withTenant(tenant(c), (tx) => repo.updateSubscription(tx, c.workspaceId, { scheduledPlanId: null, scheduledInterval: null }));
    await deps.cache.invalidate(c.workspaceId);
    return { change: "cancel", effective: "period_end" };
  }

  // ── webhooks ─────────────────────────────────────────────────────────────
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

  // ── jobs ─────────────────────────────────────────────────────────────────
  // Each job reads the due-work index (platform) to find workspaces, then works inside one workspace at a time
  // and records that workspace's next due time (SRS §2.5).
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
      if (sub && isPaying(sub) && !isComp(sub)) throw new AppError("CONFLICT", "This workspace already pays for a plan through the payment provider; a complimentary plan would double it.");
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
    if (job === "mock_renewals" && !isMockPayments(deps.payments)) return { processed: 0 };
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

  // ── mock checkout pages ─────────────────────────────────────────────────
  async function mockCheckout(workspaceId: string, checkoutId: string): Promise<repo.CheckoutRow | null> {
    if (!isMockPayments(deps.payments)) return null;
    return deps.db.withWorkspace(workspaceId, (tx) => repo.getCheckout(tx, workspaceId, checkoutId));
  }

  async function completeMockCheckout(workspaceId: string, checkoutId: string, outcome: "paid" | "failed"): Promise<void> {
    if (!isMockPayments(deps.payments)) throw new AppError("NOT_FOUND", "Route not found");
    const checkout = await deps.db.withWorkspace(workspaceId, (tx) => repo.getCheckout(tx, workspaceId, checkoutId));
    if (!checkout) throw new AppError("NOT_FOUND", "Checkout not found");
    if (checkout.status !== "open") throw new AppError("CONFLICT", "This checkout is already finished");
    // The API role writes checkout rows, so the price is re-derived from config rather than trusted.
    const price = await deps.db.withWorkspace(workspaceId, async (tx): Promise<PriceRef> => {
      if (checkout.kind === "topup") {
        const pack = checkout.topupPackId ? await repo.getPack(tx, checkout.topupPackId) : null;
        if (!pack) throw new AppError("NOT_FOUND", "That credit pack is not available");
        return { priceId: pack.paddlePriceId, interval: null, amountMinor: pack.chargePriceMinor, currency: pack.chargeCurrency };
      }
      const plan = checkout.planId ? await repo.getPlan(tx, checkout.planId) : null;
      if (!plan || !checkout.billingInterval) throw new AppError("NOT_FOUND", "That plan is not available");
      return priceForPlan(plan, checkout.billingInterval);
    });
    await deps.payments.completeCheckout({ checkoutId: checkout.id, workspaceId: checkout.workspaceId, kind: checkout.kind, price }, outcome);
  }

  return {
    engine,
    startTrial: engine.startTrial,
    summary,
    plans,
    publicPlans,
    actionCost,
    ledger,
    invoices,
    getAccess,
    useEntitlement,
    startCheckout,
    requestPlanChange,
    requestCancel,
    recordWebhook,
    processStoredWebhook,
    applyEvent,
    runJob,
    grantComplimentaryPlan,
    mockCheckout,
    completeMockCheckout,
    reserve: (ctx: TenantContext, req: SpendRequest) => deps.db.withTenant(tenant(ctx), (tx) => engine.reserve(tx, ctx.workspaceId, req, actorOf(ctx))),
    commit: (ctx: TenantContext, reservationId: string) =>
      deps.db.withTenant(tenant(ctx), (tx) => engine.commit(tx, ctx.workspaceId, reservationId, actorOf(ctx))),
    release: (ctx: TenantContext, reservationId: string, reason: string) =>
      deps.db.withTenant(tenant(ctx), (tx) => engine.release(tx, ctx.workspaceId, reservationId, reason, actorOf(ctx))),
    extend: (ctx: TenantContext, reservationId: string) => deps.db.withTenant(tenant(ctx), (tx) => engine.extend(tx, ctx.workspaceId, reservationId)),
    spendInstant: (ctx: TenantContext, req: SpendRequest) =>
      deps.db.withTenant(tenant(ctx), (tx) => engine.spendInstant(tx, ctx.workspaceId, req, actorOf(ctx))),
  };
}

export type BillingService = ReturnType<typeof createBillingService>;
