import { TIKTOK_LIVE_MINIMUM_CREDITS } from "@mushin/contracts";
import type { BillingInterval, BillingPlans, BillingSummary, Capabilities, CheckoutRequest, CreditAction, Entitlements, InvoicesResponse, LedgerPage, PlanChangeRequest, PlanChangeResponse } from "@mushin/contracts";
import { AppError, type Logger, type TenantContext } from "@mushin/core";
import { writeOutbox, type Db, type TenantTx } from "@mushin/db";
import { isMockPayments, type Payments, type PriceRef, type SubscriptionRef } from "@mushin/integrations";
import type { Access, AccessCache } from "./access-cache";
import { createCreditEngine, type SpendRequest } from "./engine";
import { createBillingJobs } from "./jobs";
import { createBillingWebhooks } from "./webhooks";
import { COMP_REF_PREFIX, downgradeDue, isComp, isPaying } from "./subscription-status";
import * as repo from "./repository";
import { classifyChange, daysLeft, decodeCursor, effectiveStatus, encodeCursor, karachiMonth, lostAccessFor, spendScope, TESTING_ACTIONS } from "./rules";

/** `capabilities`: the server-wide switches (see capabilitiesSchema); omitted means everything gated stays off. */
/** `paymentsOpen` false (public deployment without a real provider): nothing renews or is sold through the mock. */
export type BillingDeps = { db: Db; payments: Payments; cache: AccessCache; logger: Logger; now?: () => Date; capabilities?: Capabilities; paymentsOpen?: boolean };
const CAPABILITIES_OFF: Capabilities = { audienceDetails: false, outreachEmail: "off", export: false };
export type Customer = TenantContext & { email: string };

export { COMP_REF_PREFIX };

const BILLING_ROLES = new Set<TenantContext["role"]>(["owner", "admin"]);
const NO_ENTITLEMENTS: Entitlements = { audienceViewsPerMonth: 0, outreachEmailsPerMonth: 0, campaignLimit: 0, export: false };

function refuseUnapprovedAnnual(settings: repo.SettingsRow, interval: BillingInterval) {
  if (interval === "year" && !settings.annualBillingEnabled) {
    throw new AppError("VALIDATION_FAILED", "Annual billing is not available yet. Choose monthly billing.", { reason: "annual_billing_unavailable", field: "interval" });
  }
}

function requireBillingRole(ctx: TenantContext) {
  if (!BILLING_ROLES.has(ctx.role)) throw new AppError("FORBIDDEN", "Only the team owner or an admin can manage billing");
}



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
      const enrolled = (await repo.testingAllowanceOf(tx, ctx.workspaceId)).since !== null;
      return {
        plan: plan ? { id: plan.id, name: plan.name, monthlyCredits: plan.monthlyCredits } : null,
        // A complimentary plan is not billed: no interval is shown, so it never reads as a yearly purchase.
        interval: plan && !isComp(sub) ? (sub?.billingInterval ?? null) : null,
        status: b.status ?? "expired",
        currentPeriodEnd: plan ? (sub?.currentPeriodEnd?.toISOString() ?? null) : null,
        trialStartedAt: sub?.trialEndsAt ? sub.createdAt.toISOString() : null,
        trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
        trialDaysLeft: b.status === "trialing" && sub ? daysLeft(sub.trialEndsAt, now()) : null,
        awaitingTrial: sub === null,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        complimentary: plan !== null && isComp(sub),
        scheduledChange: sub?.scheduledPlanId && sub.scheduledInterval ? { planId: sub.scheduledPlanId, interval: sub.scheduledInterval } : null,
        balance: { available: b.available, reserved: b.reserved, base: b.base, meter: b.meter },
        canPurchase: BILLING_ROLES.has(ctx.role),
        // Testing credits still pay for catalogue search and contact reveal (0061), so those are not lost.
        lostAccess: lostAccessFor(b.status, b.topupRemaining).filter((k) => !(enrolled && (TESTING_ACTIONS as readonly string[]).includes(k))),
        testingAllowance: enrolled
          ? { monthlyCredits: (await repo.getSettings(tx)).testingMonthlyCredits, remaining: b.testingRemaining, renewsAt: karachiMonth(now()).end.toISOString(), actions: [...TESTING_ACTIONS] }
          : null,
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

  const { recordWebhook, processStoredWebhook, applyEvent } = createBillingWebhooks({ deps, engine, now, notify });

  // ── jobs ─────────────────────────────────────────────────────────────────
  // Each job reads the due-work index (platform) to find workspaces, then works inside one workspace at a time
  // and records that workspace's next due time (SRS §2.5).

  const { runJob, grantComplimentaryPlan } = createBillingJobs({ deps, engine, now, notify, subscriptionRef, priceForPlan });

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
    /** Provisioning hook: the new account's first workspace receives this month's testing credits (0061). */
    startTestingAllowance: engine.grantTesting,
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
