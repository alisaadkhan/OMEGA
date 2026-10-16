import { describe, expect, it } from "vitest";
import type { BillingSummary } from "@mushin/contracts";
import { accountInitials, accountLabel, creditBadge, subscriptionBadge } from "../lib/billing-status";

const summary = (over: Partial<BillingSummary> = {}, meter: BillingSummary["balance"]["meter"] = "normal"): BillingSummary => ({
  plan: null,
  interval: null,
  status: "trialing",
  currentPeriodEnd: null,
  trialEndsAt: null,
  trialDaysLeft: 7,
  cancelAtPeriodEnd: false,
  scheduledChange: null,
  balance: { available: 200, reserved: 0, base: 200, meter },
  canPurchase: true,
  lostAccess: [],
  ...over,
});

describe("dashboard billing badges (E2E findings F-7, F-8)", () => {
  it("claims nothing while the billing summary is loading", () => {
    expect(creditBadge(undefined)).toBeNull();
    expect(subscriptionBadge(undefined)).toBeNull();
  });

  it("follows the server's credit meter instead of a fixed 'Healthy'", () => {
    expect(creditBadge(summary({}, "normal"))?.label).toBe("Healthy");
    expect(creditBadge(summary({}, "amber"))?.label).toBe("Running low");
    expect(creditBadge(summary({}, "red"))?.label).toBe("Very low");
  });

  it("names every subscription state, never 'Inactive' for a trial", () => {
    expect(subscriptionBadge(summary({ status: "trialing" }))?.label).toBe("Trial");
    expect(subscriptionBadge(summary({ status: "active" }))?.label).toBe("Active");
    expect(subscriptionBadge(summary({ status: "active", cancelAtPeriodEnd: true }))?.label).toBe("Ends at period end");
    expect(subscriptionBadge(summary({ status: "past_due" }))?.label).toBe("Payment due");
    expect(subscriptionBadge(summary({ status: "canceled" }))?.label).toBe("Canceled");
    expect(subscriptionBadge(summary({ status: "expired" }))?.label).toBe("Expired");
  });
});

describe("accountLabel", () => {
  it("shows the person's own name or email, never an invented one", () => {
    expect(accountLabel({ name: "Olivia Owner", email: "o@x.pk" })).toBe("Olivia Owner");
    expect(accountLabel({ name: "  ", email: "o@x.pk" })).toBe("o@x.pk");
    expect(accountLabel({ name: null, email: null })).toBe("Your account");
    expect(accountLabel(null)).toBe("Your account");
  });
});

describe("accountInitials", () => {
  it("derives initials from the shown label only", () => {
    expect(accountInitials("Olivia Owner")).toBe("OO");
    expect(accountInitials("olivia.owner@x.pk")).toBe("OO");
    expect(accountInitials("Your account")).toBe("YA");
    expect(accountInitials("")).toBe("?");
  });
});
