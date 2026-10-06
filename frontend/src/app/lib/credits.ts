import { useSyncExternalStore } from "react";
import { PLANS } from "./plans";

// Placeholder costs until final pricing is approved.
export const CREDIT_COST = {
  searchExisting: 0,
  findNew: 12,
  revealContact: 5,
  refreshData: 10,
} as const;

export const CURRENT_PLAN = PLANS.find((p) => p.id === "growth")!;
export const PLAN_CREDITS = CURRENT_PLAN.credits;

let balance = 8420;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getCredits = () => balance;

export function spendCredits(n: number): boolean {
  if (n > balance) return false;
  balance -= n;
  emit();
  return true;
}

export function useCredits() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getCredits,
  );
}
