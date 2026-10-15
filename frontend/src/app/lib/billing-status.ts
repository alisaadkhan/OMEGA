import type { BillingSummary } from "@mushin/contracts";

export type Badge = { label: string; tone: "good" | "warn" | "bad" | "neutral" };

/**
 * The credit card's badge from the server's meter (the same thresholds the top bar uses). Null while the summary is
 * loading or unavailable, so nothing is claimed before the balance is known (E2E finding F-7: "Healthy" was fixed text).
 */
export function creditBadge(summary: BillingSummary | undefined): Badge | null {
  if (!summary) return null;
  switch (summary.balance.meter) {
    case "red":
      return { label: "Very low", tone: "bad" };
    case "amber":
      return { label: "Running low", tone: "warn" };
    default:
      return { label: "Healthy", tone: "good" };
  }
}

/** The subscription badge for every status; null while loading (F-8: it read "Inactive" before the summary arrived). */
export function subscriptionBadge(summary: BillingSummary | undefined): Badge | null {
  if (!summary) return null;
  switch (summary.status) {
    case "active":
      return summary.cancelAtPeriodEnd ? { label: "Ends at period end", tone: "warn" } : { label: "Active", tone: "good" };
    case "trialing":
      return { label: "Trial", tone: "neutral" };
    case "past_due":
      return { label: "Payment due", tone: "bad" };
    case "canceled":
      return { label: "Canceled", tone: "neutral" };
    case "expired":
      return { label: "Expired", tone: "neutral" };
  }
}

/** The name shown for the signed-in person: their own name, else their email, never an invented placeholder. */
export function accountLabel(user: { name?: string | null; email?: string | null } | null | undefined): string {
  return user?.name?.trim() || user?.email?.trim() || "Your account";
}

/** Up to two initials of the shown account label ("Olivia Owner" → "OO", "o@x.pk" → "O"). */
export function accountInitials(label: string): string {
  const words = label.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (words.map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "?");
}
