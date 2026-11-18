import type * as repo from "./repository";

/** Subscription facts shared by the billing service and its scheduled jobs. */
export const minDate = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);
/**
 * A downgrade is sent to the provider this long before the period ends, billed from the next period: the provider
 * renews at the period end, so a change sent after it would charge the old plan for another period. The
 * scheduled_changes job runs hourly, so this leaves one retry before the boundary.
 */
const DOWNGRADE_LEAD_MS = 2 * 3_600_000;
export const downgradeDue = (periodEnd: Date) => new Date(periodEnd.getTime() - DOWNGRADE_LEAD_MS);
export const isPaying = (s: repo.SubscriptionRow | null) => s?.status === "active" || s?.status === "past_due";
/** A complimentary plan's subscription reference (never a payment provider's). */
export const COMP_REF_PREFIX = "comp:";
export const isComp = (s: repo.SubscriptionRow | null) => Boolean(s?.paddleSubscriptionId?.startsWith(COMP_REF_PREFIX));
