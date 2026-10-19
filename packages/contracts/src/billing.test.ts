import { describe, expect, it } from "vitest";
import { billingSummarySchema, checkoutRequestSchema, ledgerQuerySchema, planChangeRequestSchema } from "./index";

describe("billing contracts", () => {
  it("accepts a subscription or a top-up checkout and nothing in between", () => {
    expect(checkoutRequestSchema.safeParse({ kind: "subscription", planId: "growth", interval: "month" }).success).toBe(true);
    expect(checkoutRequestSchema.safeParse({ kind: "topup", packId: "credits_1000" }).success).toBe(true);
    expect(checkoutRequestSchema.safeParse({ kind: "topup", planId: "growth" }).success).toBe(false);
    expect(checkoutRequestSchema.safeParse({ kind: "subscription", planId: "platinum", interval: "month" }).success).toBe(false);
  });

  it("bounds the ledger page size", () => {
    expect(ledgerQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(ledgerQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });

  it("describes the summary, including a workspace with no plan", () => {
    const ok = billingSummarySchema.safeParse({
      plan: null,
      interval: null,
      status: "expired",
      currentPeriodEnd: null,
      trialStartedAt: "2026-10-07T00:00:00.000Z",
      trialEndsAt: "2026-10-21T00:00:00.000Z",
      trialDaysLeft: 0,
      awaitingTrial: false,
      cancelAtPeriodEnd: false,
      scheduledChange: null,
      balance: { available: 0, reserved: 0, base: 1000, meter: "red" },
      canPurchase: true,
      lostAccess: ["find_new", "reveal_contact", "refresh_data", "monthly_credits", "outreach", "audience_details", "export"],
    });
    expect(ok.success).toBe(true);
    expect(planChangeRequestSchema.safeParse({ planId: "scale", interval: "year" }).success).toBe(true);
  });
});
