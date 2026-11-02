import type { CreditAction, MeterState, SubscriptionStatus } from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { writeOutbox, type TenantTx } from "@mushin/db";
import * as repo from "./repository";
import {
  allocateLots,
  effectiveStatus,
  InsufficientLotsError,
  lostAccessFor,
  meterAlert,
  meterState,
  allowancePeriodStart,
  karachiMonth,
  spendScope,
  TESTING_ACTIONS,
  testingGrantRef,
  type Allocation,
} from "./rules";

export type Actor = { userId: string | null; requestId: string | null };
export type SpendRequest = { action: CreditAction; confirmedCost: number; refType: string; refId: string };
/** A reservation for an amount the caller computed from `costs()` (live discovery: 12 + size × per-creator price). */
export type HoldRequest = { action: CreditAction; amount: number; confirmedCost: number; refType: string; refId: string };
export type GrantRequest = {
  source: repo.LotSource;
  amount: number;
  /** Null = never expires; only top-ups (owner decision 2026-10-14, enforced by the database). */
  expiresAt: Date | null;
  sourceRef: string;
  paymentId?: string | null;
  note?: string | null;
  /** Testing grants only: the Asia/Karachi month the lot belongs to (unique per workspace, 0062). */
  period?: string | null;
};
export type Balance = {
  status: SubscriptionStatus | null;
  available: number;
  reserved: number;
  base: number;
  meter: MeterState;
  topupRemaining: number;
  /** Unexpired monthly testing credits (0061), included in `available`. */
  testingRemaining: number;
};

const FALLBACK_BASE = 1000;

export function createCreditEngine(o: { now?: () => Date } = {}) {
  const now = o.now ?? (() => new Date());

  async function baseFor(tx: TenantTx, sub: repo.SubscriptionRow | null, status: SubscriptionStatus | null, settings: repo.SettingsRow): Promise<number> {
    if (status === "trialing") return settings.trialCredits;
    if ((status === "active" || status === "past_due") && sub?.planId) {
      const plan = await repo.getPlan(tx, sub.planId);
      if (plan) return plan.monthlyCredits;
    }
    const packs = await repo.listPacks(tx);
    return packs[0]?.credits ?? FALLBACK_BASE;
  }

  async function balance(tx: TenantTx, workspaceId: string): Promise<Balance> {
    const t = now();
    const settings = await repo.getSettings(tx);
    const sub = await repo.getSubscription(tx, workspaceId);
    const status = effectiveStatus(sub?.status ?? null, sub?.trialEndsAt ?? null, t);
    const scope = spendScope(status);
    const reserved = await repo.sumHeld(tx, workspaceId);
    const topupRemaining = await repo.sumRemaining(tx, workspaceId, t, ["topup"]);
    const testingRemaining = await repo.sumRemaining(tx, workspaceId, t, ["testing"]);
    // Testing credits stay spendable without a plan (0061); with a plan they are part of "all".
    const spendable = scope === "all" ? await repo.sumRemaining(tx, workspaceId, t, "all") : (scope === "topup_only" ? topupRemaining : 0) + testingRemaining;
    const available = Math.max(0, spendable - reserved);
    const base = scope !== "all" && testingRemaining > 0 ? settings.testingMonthlyCredits : await baseFor(tx, sub, status, settings);
    return {
      status,
      available,
      reserved,
      base,
      meter: meterState(available, base, { amberPct: settings.meterAmberPct, redPct: settings.meterRedPct }),
      topupRemaining,
      testingRemaining,
    };
  }

  async function alertIfCrossed(tx: TenantTx, workspaceId: string, before: Balance, after: Balance, actor: Actor) {
    const alert = meterAlert(before.meter, after.meter);
    if (!alert) return;
    await writeOutbox(tx, {
      eventType: `notify.${alert}`,
      aggregateType: "workspace",
      aggregateId: workspaceId,
      workspaceId,
      payload: { available: after.available, base: after.base },
      requestId: actor.requestId,
    });
  }

  async function holdLocked(tx: TenantTx, workspaceId: string, h: HoldRequest, actor: Actor) {
    if (!Number.isInteger(h.amount) || h.amount <= 0) throw new AppError("VALIDATION_FAILED", "This action is free and is never charged");
    if (h.amount !== h.confirmedCost) {
      throw new AppError("CONFLICT", "The cost of this action has changed. Please review it and confirm again.", {
        confirmedCost: h.confirmedCost,
        currentCost: h.amount,
      });
    }
    const before = await balance(tx, workspaceId);
    const planScope = spendScope(before.status);
    // Which lots may pay: a plan pays from all lots; without one, top-ups pay as before, and the monthly testing
    // allowance pays only for actions with no provider spend (0061). One reservation never mixes the two.
    let scope: "all" | "topup_only" | "testing_only";
    let available: number;
    const testingFree = Math.max(0, before.testingRemaining - (await repo.sumHeld(tx, workspaceId, "testing_only")));
    const testingAction = (TESTING_ACTIONS as readonly string[]).includes(h.action);
    if (planScope === "all") {
      scope = "all";
      available = before.available;
    } else if (planScope === "topup_only" && before.topupRemaining > 0 && (!testingAction || testingFree < h.amount)) {
      scope = "topup_only";
      available = Math.max(0, before.topupRemaining - (await repo.sumHeld(tx, workspaceId, "topup_only")));
    } else if (testingAction && (before.testingRemaining > 0 || (await repo.testingAllowanceOf(tx, workspaceId)).since)) {
      // An enrolled workspace that used this month's testing credits is told so (BUG-26), not asked to choose a plan.
      scope = "testing_only";
      available = testingFree;
      if (available < h.amount) {
        throw new AppError("INSUFFICIENT_CREDITS", `This month's testing credits are used up. They renew on ${karachiMonth(now()).end.toISOString().slice(0, 10)} (00:00 Pakistan time), or choose a plan.`, {
          required: h.amount,
          available,
          renewsAt: karachiMonth(now()).end.toISOString(),
        });
      }
    } else {
      throw new AppError("ENTITLEMENT_REQUIRED", before.testingRemaining > 0 ? "Testing credits pay for searches and contact reveals only. Choose a plan for this action." : "Choose a plan to use credit actions.", {
        reason: "no_active_plan",
        lostAccess: lostAccessFor(before.status, before.topupRemaining),
      });
    }
    if (available < h.amount) {
      throw new AppError("INSUFFICIENT_CREDITS", "You don't have enough credits for this action.", { required: h.amount, available });
    }
    const settings = await repo.getSettings(tx);
    const t = now();
    const reservation = await repo.insertReservation(tx, {
      workspaceId,
      amount: h.amount,
      action: h.action,
      confirmedCost: h.confirmedCost,
      status: "held",
      spendScope: scope,
      expiresAt: new Date(t.getTime() + settings.reservationTtlMinutes * 60_000),
      refType: h.refType,
      refId: h.refId,
      createdAt: t,
    });
    await repo.insertLedger(tx, [
      { workspaceId, amount: h.amount, kind: "reserve", action: h.action, reservationId: reservation.id, actorUserId: actor.userId },
    ]);
    await repo.scheduleJob(tx, workspaceId, "release_abandoned", reservation.expiresAt);
    await alertIfCrossed(tx, workspaceId, before, await balance(tx, workspaceId), actor);
    return { reservationId: reservation.id, amount: h.amount };
  }

  async function reserveLocked(tx: TenantTx, workspaceId: string, req: SpendRequest, actor: Actor) {
    const cost = await repo.getActionCost(tx, req.action);
    if (cost === 0) throw new AppError("VALIDATION_FAILED", "This action is free and is never charged");
    return holdLocked(tx, workspaceId, { action: req.action, amount: cost, confirmedCost: req.confirmedCost, refType: req.refType, refId: req.refId }, actor);
  }

  async function commitLocked(tx: TenantTx, workspaceId: string, reservationId: string, actor: Actor) {
    const r = await repo.getReservationForUpdate(tx, workspaceId, reservationId);
    if (!r) throw new AppError("NOT_FOUND", "Reservation not found");
    if (r.status === "committed") return;
    if (r.status !== "held") throw new AppError("CONFLICT", "This reservation was already released");
    const lots = await repo.lotsValidAt(tx, workspaceId, r.createdAt, r.spendScope);
    let plan: Allocation[];
    try {
      plan = allocateLots(lots, r.amount);
    } catch (err) {
      if (err instanceof InsufficientLotsError) {
        throw new AppError("INTERNAL", "Credit lots cannot cover a held reservation", { reservationId }, { cause: err });
      }
      throw err;
    }
    for (const a of plan) await repo.takeFromLot(tx, a.lotId, a.take);
    await repo.insertLedger(
      tx,
      plan.map((a) => ({
        workspaceId,
        amount: -a.take,
        kind: "spend" as const,
        action: r.action,
        lotId: a.lotId,
        reservationId: r.id,
        actorUserId: actor.userId,
      })),
    );
    await repo.finishReservation(tx, r.id, "committed", now());
  }

  /** Charges `amount` of a held reservation and returns the rest (live discovery, spec §5). Ledger stays append-only. */
  async function commitPartialLocked(tx: TenantTx, workspaceId: string, reservationId: string, amount: number, actor: Actor, note: string) {
    const r = await repo.getReservationForUpdate(tx, workspaceId, reservationId);
    if (!r) throw new AppError("NOT_FOUND", "Reservation not found");
    if (r.status === "committed") return;
    if (r.status !== "held") throw new AppError("CONFLICT", "This reservation was already released");
    if (!Number.isInteger(amount) || amount < 0 || amount > r.amount) throw new Error(`partial commit amount must be between 0 and ${r.amount}`);
    if (amount > 0) {
      const lots = await repo.lotsValidAt(tx, workspaceId, r.createdAt, r.spendScope);
      let plan: Allocation[];
      try {
        plan = allocateLots(lots, amount);
      } catch (err) {
        if (err instanceof InsufficientLotsError) throw new AppError("INTERNAL", "Credit lots cannot cover a held reservation", { reservationId }, { cause: err });
        throw err;
      }
      for (const a of plan) await repo.takeFromLot(tx, a.lotId, a.take);
      await repo.insertLedger(
        tx,
        plan.map((a) => ({ workspaceId, amount: -a.take, kind: "spend" as const, action: r.action, lotId: a.lotId, reservationId: r.id, actorUserId: actor.userId })),
      );
    }
    if (amount < r.amount) {
      await repo.insertLedger(tx, [
        { workspaceId, amount: r.amount - amount, kind: "release", action: r.action, reservationId: r.id, actorUserId: actor.userId, note: note.slice(0, 200) },
      ]);
    }
    await repo.finishReservation(tx, r.id, amount > 0 ? "committed" : "released", now());
  }

  async function costs<A extends CreditAction>(tx: TenantTx, actions: readonly A[]): Promise<Record<A, number>> {
    const out = {} as Record<A, number>;
    for (const a of actions) out[a] = await repo.getActionCost(tx, a);
    return out;
  }

  async function releaseLocked(
    tx: TenantTx,
    workspaceId: string,
    reservationId: string,
    reason: string,
    actor: Actor,
    status: "released" | "expired",
  ) {
    const r = await repo.getReservationForUpdate(tx, workspaceId, reservationId);
    if (!r) throw new AppError("NOT_FOUND", "Reservation not found");
    if (r.status === "committed") throw new AppError("CONFLICT", "This reservation was already spent");
    if (r.status !== "held") return;
    await repo.finishReservation(tx, r.id, status, now());
    await repo.insertLedger(tx, [
      { workspaceId, amount: r.amount, kind: "release", action: r.action, reservationId: r.id, actorUserId: actor.userId, note: reason.slice(0, 200) },
    ]);
  }

  async function grantLocked(tx: TenantTx, workspaceId: string, g: GrantRequest): Promise<string | null> {
    if (!Number.isInteger(g.amount) || g.amount <= 0) throw new Error("grant amount must be a positive integer");
    if (await repo.hasGrant(tx, workspaceId, g.sourceRef)) return null;
    const lotId = await repo.insertLot(tx, { workspaceId, source: g.source, amount: g.amount, expiresAt: g.expiresAt, paymentId: g.paymentId ?? null, period: g.period ?? null });
    await repo.insertLedger(tx, [{ workspaceId, amount: g.amount, kind: "grant", lotId, sourceRef: g.sourceRef, note: g.note ?? null }]);
    if (g.expiresAt) await repo.scheduleJob(tx, workspaceId, "expire_lots", g.expiresAt);
    await repo.scheduleJob(tx, workspaceId, "reconcile", new Date(now().getTime() + 86_400_000));
    return lotId;
  }

  async function expireLocked(tx: TenantTx, workspaceId: string): Promise<number> {
    if ((await repo.countHeld(tx, workspaceId)) > 0) return 0; // a running job may still need these credits
    const lots = await repo.expiredLots(tx, workspaceId, now());
    for (const lot of lots) {
      await repo.insertLedger(tx, [{ workspaceId, amount: -lot.remaining, kind: "expire", lotId: lot.id, note: "Expired" }]);
      await repo.zeroLot(tx, lot.id);
    }
    return lots.length;
  }

  const locked =
    <A extends unknown[], R>(fn: (tx: TenantTx, workspaceId: string, ...args: A) => Promise<R>) =>
    async (tx: TenantTx, workspaceId: string, ...args: A): Promise<R> => {
      await repo.lockCredits(tx, workspaceId);
      return fn(tx, workspaceId, ...args);
    };

  return {
    balance,
    reserve: locked(reserveLocked),
    commit: locked(commitLocked),
    costs,
    reserveAmount: locked(holdLocked),
    commitPartial: locked(commitPartialLocked),
    release: locked((tx, workspaceId, reservationId: string, reason: string, actor: Actor) =>
      releaseLocked(tx, workspaceId, reservationId, reason, actor, "released"),
    ),
    spendInstant: locked(async (tx, workspaceId, req: SpendRequest, actor: Actor) => {
      const held = await reserveLocked(tx, workspaceId, req, actor);
      await commitLocked(tx, workspaceId, held.reservationId, actor);
      return held;
    }),
    extend: locked(async (tx, workspaceId, reservationId: string) => {
      const settings = await repo.getSettings(tx);
      const until = new Date(now().getTime() + settings.reservationTtlMinutes * 60_000);
      if (!(await repo.extendReservation(tx, workspaceId, reservationId, until))) {
        throw new AppError("CONFLICT", "This reservation is no longer held");
      }
    }),
    grant: locked(grantLocked),
    startTrial: locked(async (tx, workspaceId) => {
      const settings = await repo.getSettings(tx);
      const trialEndsAt = new Date(now().getTime() + settings.trialDays * 86_400_000);
      if (!(await repo.insertTrialSubscription(tx, workspaceId, trialEndsAt))) return;
      await repo.scheduleJob(tx, workspaceId, "end_trials", trialEndsAt);
      await repo.scheduleJob(tx, workspaceId, "trial_notices", new Date(trialEndsAt.getTime() - settings.trialEndingNoticeDays * 86_400_000));
      await grantLocked(tx, workspaceId, {
        source: "trial",
        amount: settings.trialCredits,
        expiresAt: trialEndsAt,
        sourceRef: `trial:${workspaceId}`,
        note: "Free trial credits",
      });
    }),
    /**
     * The monthly testing allowance for the current Karachi month (0061): granted once (the ledger's unique source_ref),
     * expiring at the start of next month. Returns the grant's lot id, or null when already granted, turned off, or the
     * workspace is not enrolled. Schedules the next month's grant either way.
     */
    grantTesting: locked(async (tx, workspaceId) => {
      const t = now();
      const month = karachiMonth(t);
      const enrolled = await repo.testingAllowanceOf(tx, workspaceId);
      if (!enrolled.since || !enrolled.active) {
        await repo.setNextDue(tx, workspaceId, "testing_allowance", null);
        return null;
      }
      const settings = await repo.getSettings(tx);
      await repo.setNextDue(tx, workspaceId, "testing_allowance", month.end);
      if (settings.testingMonthlyCredits <= 0) return null;
      return grantLocked(tx, workspaceId, {
        source: "testing",
        amount: settings.testingMonthlyCredits,
        expiresAt: month.end,
        sourceRef: testingGrantRef(workspaceId, month.key),
        period: month.key,
        note: `Monthly testing credits (${month.key}, Asia/Karachi)`,
      });
    }),
    expireLots: locked(expireLocked),
    endLots: locked(async (tx, workspaceId, source: repo.LotSource) => {
      await repo.endLotsOfSource(tx, workspaceId, source, now());
      await repo.scheduleJob(tx, workspaceId, "expire_lots", now()); // retried by the job if a hold blocks it now
      await expireLocked(tx, workspaceId);
    }),
    releaseAbandoned: locked(async (tx, workspaceId) => {
      const rows = await repo.abandonedReservations(tx, workspaceId, now());
      for (const r of rows) await releaseLocked(tx, workspaceId, r.id, "Abandoned: the job stopped renewing its hold", { userId: null, requestId: null }, "expired");
      return rows.length;
    }),
    reconcile: (tx: TenantTx, workspaceId: string) => repo.lotLedgerMismatches(tx, workspaceId),
    useEntitlement: locked(async (tx, workspaceId, key: "audience_views" | "outreach_emails", limit: number | null) => {
      const period = allowancePeriodStart(await repo.getSubscription(tx, workspaceId), now());
      return repo.incrementUsage(tx, workspaceId, key, period.toISOString().slice(0, 10), limit);
    }),
    /**
     * Removes up to `target` credits from the given lots (refund or chargeback of the payment that granted them). Never
     * more than a lot still holds, and never credits already held for running work, so the balance cannot go negative
     * and a held charge can still be settled. Each removal is an `adjust` ledger row on its lot.
     */
    revoke: locked(async (tx, workspaceId, lots: repo.RevocableLot[], target: number, ref: string, note: string) => {
      const t = now();
      let headroom = Math.max(0, (await repo.sumRemaining(tx, workspaceId, t, "all")) - (await repo.sumHeld(tx, workspaceId)));
      let left = Math.max(0, target);
      let removed = 0;
      for (const lot of lots) {
        const take = Math.min(lot.remaining, left, headroom);
        if (take <= 0) continue;
        await repo.reduceLot(tx, workspaceId, lot.id, take);
        await repo.insertLedger(tx, [{ workspaceId, amount: -take, kind: "adjust", lotId: lot.id, sourceRef: ref, note, actorUserId: null }]);
        removed += take;
        left -= take;
        headroom -= take;
      }
      return { removed, shortfall: Math.max(0, target) - removed };
    }),
    /** The allowance period now in effect for this workspace (see rules.allowancePeriodStart). */
    allowancePeriod: async (tx: TenantTx, workspaceId: string) => allowancePeriodStart(await repo.getSubscription(tx, workspaceId), now()),
  };
}

export type CreditEngine = ReturnType<typeof createCreditEngine>;
