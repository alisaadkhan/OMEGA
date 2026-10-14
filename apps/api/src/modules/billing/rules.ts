import type { BillingInterval, LostAccessItem, MeterState, PlanId, SubscriptionStatus } from "@mushin/contracts";

export type LotForSpend = { id: string; remaining: number; expiresAt: Date };
export type Allocation = { lotId: string; take: number };

export class InsufficientLotsError extends Error {
  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(`lots cover ${available} of ${required} credits`);
    this.name = "InsufficientLotsError";
  }
}

/** Takes credits from the soonest-expiring lots first (ties by id, so the order is deterministic). */
export function allocateLots(lots: readonly LotForSpend[], amount: number): Allocation[] {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("amount must be a positive integer");
  const ordered = lots
    .filter((l) => l.remaining > 0)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id));
  const out: Allocation[] = [];
  let left = amount;
  for (const lot of ordered) {
    if (left === 0) break;
    const take = Math.min(lot.remaining, left);
    out.push({ lotId: lot.id, take });
    left -= take;
  }
  if (left > 0) throw new InsufficientLotsError(amount, amount - left);
  return out;
}

export function meterState(available: number, base: number, t: { amberPct: number; redPct: number }): MeterState {
  if (base <= 0) return available > 0 ? "normal" : "red";
  if (available * 100 < base * t.redPct) return "red";
  if (available * 100 < base * t.amberPct) return "amber";
  return "normal";
}

export type MeterAlert = "credits_low" | "credits_very_low";

export function meterAlert(before: MeterState, after: MeterState): MeterAlert | null {
  if (after === "red" && before !== "red") return "credits_very_low";
  if (after === "amber" && before === "normal") return "credits_low";
  return null;
}

export type PlanChoice = { planId: PlanId; interval: BillingInterval; monthlyCredits: number };

/** More monthly credits = upgrade; same credits: switching to yearly = upgrade, to monthly = downgrade. */
export function classifyChange(current: PlanChoice, target: PlanChoice): "upgrade" | "downgrade" | "same" {
  if (current.planId === target.planId && current.interval === target.interval) return "same";
  if (target.monthlyCredits !== current.monthlyCredits) return target.monthlyCredits > current.monthlyCredits ? "upgrade" : "downgrade";
  return target.interval === "year" ? "upgrade" : "downgrade";
}

/** A trial past its end is expired at read time, so a late or blocked trial-end job never extends it. */
export function effectiveStatus(status: SubscriptionStatus | null, trialEndsAt: Date | null, now: Date): SubscriptionStatus | null {
  if (status === "trialing" && trialEndsAt && trialEndsAt.getTime() <= now.getTime()) return "expired";
  return status;
}

export type SpendScope = "all" | "topup_only" | "none";

/** Spec D3/D14: without a plan only paid top-up credits stay spendable. */
export function spendScope(status: SubscriptionStatus | null): SpendScope {
  if (status === "trialing" || status === "active" || status === "past_due") return "all";
  if (status === "canceled" || status === "expired") return "topup_only";
  return "none";
}

export function lostAccessFor(status: SubscriptionStatus | null, topupRemaining: number): LostAccessItem[] {
  if (spendScope(status) === "all") return [];
  const lost: LostAccessItem[] = ["monthly_credits", "outreach", "audience_details", "export"];
  return topupRemaining > 0 ? lost : ["search_existing", "find_new", "reveal_contact", "refresh_data", ...lost];
}

export function daysLeft(until: Date | null, now: Date): number | null {
  if (!until) return null;
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 86_400_000));
}

export function addMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const result = new Date(date.getTime());
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function monthStart(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** `at` is the row's exact created_at in UTC with microseconds: rows written in one transaction share it. */
export type LedgerCursor = { at: string; id: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MICRO_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeCursor(c: LedgerCursor): string {
  return Buffer.from(`${c.at}|${c.id}`, "utf8").toString("base64url");
}

export function decodeCursor(s: string): LedgerCursor | null {
  const [at, id] = Buffer.from(s, "base64url").toString("utf8").split("|");
  if (!at || !id || !MICRO_ISO.test(at) || !UUID.test(id)) return null;
  return Number.isNaN(new Date(at).getTime()) ? null : { at, id };
}
