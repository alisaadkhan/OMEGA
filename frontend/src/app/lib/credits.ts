import { useBillingSummary } from "../api/billing";

/** Available credits from the billing API (0 while loading). */
export function useCredits(): number {
  return useBillingSummary().data?.balance.available ?? 0;
}

/**
 * Demo credit actions on other screens become real in sub-projects 3-4. Until then they no longer
 * change the displayed balance, so the meter always shows real data.
 */
export function spendCredits(cost: number): boolean {
  return Number.isInteger(cost) && cost >= 0;
}
