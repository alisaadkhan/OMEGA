import type { BillingSummary } from "@mushin/contracts";

/**
 * Find New Creators and Update info call paid providers (Apify, Serper). Monthly testing credits never pay for them
 * (owner decision 2026-10-28); without a plan, a trial or top-up credits they are unavailable, and the page says so
 * before the click instead of letting the action fail. Null when they are available (or the summary is not loaded).
 */
export function providerActionsLockedText(summary: BillingSummary | undefined): string | null {
  if (!summary || !summary.lostAccess.includes("find_new")) return null;
  return summary.testingAllowance
    ? "Needs a plan or trial: testing credits cover catalogue searches and contact reveals only."
    : "Needs a plan or trial.";
}
