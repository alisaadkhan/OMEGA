import { describe, expect, it } from "vitest";
import {
  addMonths,
  allocateLots,
  classifyChange,
  daysLeft,
  decodeCursor,
  effectiveStatus,
  encodeCursor,
  InsufficientLotsError,
  lostAccessFor,
  meterAlert,
  meterState,
  monthStart,
  spendScope,
} from "./rules";

const lot = (id: string, remaining: number, day: number) => ({ id, remaining, expiresAt: new Date(Date.UTC(2026, 9, day)) });

describe("allocateLots", () => {
  it("spends the soonest-expiring lots first and splits across lots", () => {
    expect(allocateLots([lot("b", 10, 20), lot("a", 5, 10)], 8)).toEqual([
      { lotId: "a", take: 5 },
      { lotId: "b", take: 3 },
    ]);
  });

  it("breaks expiry ties by id and skips empty lots", () => {
    expect(allocateLots([lot("z", 4, 10), lot("y", 0, 1), lot("x", 4, 10)], 6)).toEqual([
      { lotId: "x", take: 4 },
      { lotId: "z", take: 2 },
    ]);
  });

  it("refuses amounts the lots cannot cover, and non-positive amounts", () => {
    expect(() => allocateLots([lot("a", 3, 1)], 4)).toThrow(InsufficientLotsError);
    expect(() => allocateLots([lot("a", 3, 1)], 0)).toThrow(/positive/);
  });
});

describe("credit meter", () => {
  const t = { amberPct: 20, redPct: 5 };

  it("turns amber below 20% and red below 5% of the base", () => {
    expect(meterState(40, 200, t)).toBe("normal");
    expect(meterState(39, 200, t)).toBe("amber");
    expect(meterState(9, 200, t)).toBe("red");
    expect(meterState(0, 0, t)).toBe("red");
    expect(meterState(5, 0, t)).toBe("normal");
  });

  it("alerts only when moving into a worse band", () => {
    expect(meterAlert("normal", "amber")).toBe("credits_low");
    expect(meterAlert("amber", "red")).toBe("credits_very_low");
    expect(meterAlert("normal", "red")).toBe("credits_very_low");
    expect(meterAlert("amber", "amber")).toBeNull();
    expect(meterAlert("red", "amber")).toBeNull();
  });
});

describe("classifyChange", () => {
  const growthMonth = { planId: "growth" as const, interval: "month" as const, monthlyCredits: 12_000 };
  it("compares monthly credits first, then the interval", () => {
    expect(classifyChange(growthMonth, { planId: "scale", interval: "month", monthlyCredits: 35_000 })).toBe("upgrade");
    expect(classifyChange(growthMonth, { planId: "explorer", interval: "year", monthlyCredits: 2_500 })).toBe("downgrade");
    expect(classifyChange(growthMonth, { planId: "growth", interval: "year", monthlyCredits: 12_000 })).toBe("upgrade");
    expect(classifyChange({ ...growthMonth, interval: "year" }, growthMonth)).toBe("downgrade");
    expect(classifyChange(growthMonth, growthMonth)).toBe("same");
  });
});

describe("effectiveStatus", () => {
  const now = new Date("2026-10-21T10:00:00Z");
  it("treats a trial past its end as expired even before the trial-end job runs", () => {
    expect(effectiveStatus("trialing", new Date("2026-10-21T09:59:59Z"), now)).toBe("expired");
    expect(effectiveStatus("trialing", new Date("2026-10-21T10:00:01Z"), now)).toBe("trialing");
    expect(effectiveStatus("active", new Date("2026-01-01T00:00:00Z"), now)).toBe("active");
    expect(effectiveStatus(null, null, now)).toBeNull();
  });
});

describe("access", () => {
  it("lets trialing and paying workspaces spend any credits, others top-ups only", () => {
    expect(spendScope("trialing")).toBe("all");
    expect(spendScope("past_due")).toBe("all");
    expect(spendScope("canceled")).toBe("topup_only");
    expect(spendScope("expired")).toBe("topup_only");
    expect(spendScope(null)).toBe("none");
  });

  it("lists what a workspace without a plan has lost", () => {
    expect(lostAccessFor("active", 0)).toEqual([]);
    expect(lostAccessFor("expired", 0)).toEqual([
      "search_existing",
      "find_new",
      "reveal_contact",
      "refresh_data",
      "monthly_credits",
      "outreach",
      "audience_details",
      "export",
    ]);
    expect(lostAccessFor("canceled", 500)).toEqual(["monthly_credits", "outreach", "audience_details", "export"]);
  });
});

describe("dates and cursors", () => {
  it("adds months in UTC and clamps to the month end", () => {
    expect(addMonths(new Date("2026-01-31T10:00:00Z"), 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonths(new Date("2026-10-07T00:00:00Z"), 12).toISOString()).toBe("2027-10-07T00:00:00.000Z");
    expect(monthStart(new Date("2026-10-07T23:00:00Z"))).toBe("2026-10-01");
  });

  it("counts whole days left, never negative", () => {
    const now = new Date("2026-10-07T00:00:00Z");
    expect(daysLeft(new Date("2026-10-21T00:00:00Z"), now)).toBe(14);
    expect(daysLeft(new Date("2026-10-07T12:00:00Z"), now)).toBe(1);
    expect(daysLeft(new Date("2026-10-01T00:00:00Z"), now)).toBe(0);
    expect(daysLeft(null, now)).toBeNull();
  });

  it("round-trips ledger cursors at microsecond precision and rejects garbage", () => {
    // Postgres keeps microseconds; a millisecond cursor would skip rows written in the same transaction.
    const c = { at: "2026-10-07T01:02:03.456789Z", id: "6f1c2a4e-8a51-4c0e-9d0a-2b7f4f1e9a10" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from("2026-10-07T00:00:00Z|nope").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(`2026-10-07T01:02:03.456Z|${c.id}`).toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(`2026-10-07T01:02:03.456789Z'--|${c.id}`).toString("base64url"))).toBeNull();
  });
});
