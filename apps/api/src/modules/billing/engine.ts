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
  monthStart,
  spendScope,
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
};
export type Balance = {
  status: SubscriptionStatus | null;
  available: number;
  reserved: number;
  base: number;
  meter: MeterState;
  topupRemaining: number;
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
    const spendable = scope === "all" ? await repo.sumRemaining(tx, workspaceId, t, "all") : scope === "topup_only" ? topupRemaining : 0;
    const available = Math.max(0, spendable - reserved);
    const base = await baseFor(tx, sub, status, settings);
    return {
      status,
      available,
      reserved,
      base,
      meter: meterState(available, base, { amberPct: settings.meterAmberPct, redPct: settings.meterRedPct }),
      topupRemaining,
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
    const scope = spendScope(before.status);
    if (scope === "none" || (scope === "topup_only" && before.topupRemaining === 0)) {
      throw new AppError("ENTITLEMENT_REQUIRED", "Choose a plan to use credit actions.", {
        reason: "no_active_plan",
        lostAccess: lostAccessFor(before.status, before.topupRemaining),
      });
    }
    if (before.available < h.amount) {
      throw new AppError("INSUFFICIENT_CREDITS", "You don't have enough credits for this action.", { required: h.amount, available: before.available });
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
    const lotId = await repo.insertLot(tx, { workspaceId, source: g.source, amount: g.amount, expiresAt: g.expiresAt, paymentId: g.paymentId ?? null });
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
    useEntitlement: locked((tx, workspaceId, key: "audience_views" | "outreach_emails", limit: number | null) =>
      repo.incrementUsage(tx, workspaceId, key, monthStart(now()), limit),
    ),
  };
}

export type CreditEngine = ReturnType<typeof createCreditEngine>;
