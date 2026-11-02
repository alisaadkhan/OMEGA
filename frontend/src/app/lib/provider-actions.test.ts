import { describe, expect, it } from "vitest";
import type { BillingSummary } from "@mushin/contracts";
import { providerActionsLockedText } from "./provider-actions";

const summary = (over: Partial<BillingSummary>): BillingSummary =>
  ({
    plan: null,
    interval: null,
    status: "expired",
    currentPeriodEnd: null,
    trialStartedAt: null,
    trialEndsAt: null,
    trialDaysLeft: null,
    awaitingTrial: true,
    cancelAtPeriodEnd: false,
    scheduledChange: null,
    balance: { available: 500, reserved: 0, base: 500, meter: "normal" },
    canPurchase: true,
    lostAccess: [],
    testingAllowance: null,
    ...over,
  }) as BillingSummary;

describe("provider-backed actions (Find New Creators, Update info)", () => {
  it("are available with a plan, a trial or top-up credits (nothing lost)", () => {
    expect(providerActionsLockedText(summary({ lostAccess: [] }))).toBeNull();
    expect(providerActionsLockedText(undefined)).toBeNull();
  });

  it("explain before the click that testing credits do not pay for them", () => {
    const s = summary({ lostAccess: ["find_new", "refresh_data"], testingAllowance: { monthlyCredits: 500, remaining: 450, renewsAt: "2026-10-31T19:00:00.000Z", actions: ["search_existing", "reveal_contact"] } });
    expect(providerActionsLockedText(s)).toBe("Needs a plan or trial: testing credits cover catalogue searches and contact reveals only.");
  });

  it("say a plan or trial is needed when there is no allowance either", () => {
    expect(providerActionsLockedText(summary({ lostAccess: ["find_new"] }))).toBe("Needs a plan or trial.");
  });
});
