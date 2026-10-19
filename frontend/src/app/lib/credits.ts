import { useBillingSummary } from "../api/billing";

/**
 * Available credits from the billing API, or null while unknown (loading or failed). An unknown balance is never shown as
 * 0 (mandate v3 §7.5: missing is not zero).
 */
export function useCredits(): number | null {
  return useBillingSummary().data?.balance.available ?? null;
}

/**
 * Demo credit actions on other screens become real in sub-projects 3-4. Until then they no longer
 * change the displayed balance, so the meter always shows real data.
 */
export function spendCredits(cost: number): boolean {
  return Number.isInteger(cost) && cost >= 0;
}
