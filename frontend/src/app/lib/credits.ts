import { useBillingSummary } from "../api/billing";

/** Shown before confirming; the server enforces the real costs (and refuses a stale one). */
export const CREDIT_COST = {
  searchExisting: 0,
  findNew: 12,
  revealContact: 5,
  refreshData: 10,
} as const;

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
