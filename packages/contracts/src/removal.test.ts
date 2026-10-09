import { describe, expect, it } from "vitest";
import { removalRequestSchema, staffRejectSchema } from "./removal";

describe("removal request contracts", () => {
  const ok = { urls: ["https://instagram.com/someone"], email: "me@example.com", confirm: true };

  it("needs 1-3 links, a real email and the confirmation tick", () => {
    expect(removalRequestSchema.safeParse(ok).success).toBe(true);
    expect(removalRequestSchema.safeParse({ ...ok, urls: [] }).success).toBe(false);
    expect(removalRequestSchema.safeParse({ ...ok, urls: ["a.com/1", "a.com/2", "a.com/3", "a.com/4"] }).success).toBe(false);
    expect(removalRequestSchema.safeParse({ ...ok, email: "not-an-email" }).success).toBe(false);
    expect(removalRequestSchema.safeParse({ ...ok, confirm: false }).success).toBe(false);
    expect(removalRequestSchema.safeParse({ ...ok, reason: "x".repeat(501) }).success).toBe(false);
  });

  it("accepts the bot-trap field so the server can ignore the request silently", () => {
    expect(removalRequestSchema.safeParse({ ...ok, website: "http://spam.example" }).success).toBe(true);
  });

  it("needs a short note to reject", () => {
    expect(staffRejectSchema.safeParse({ note: "ok" }).success).toBe(false);
    expect(staffRejectSchema.safeParse({ note: "Requester could not show they own the account." }).success).toBe(true);
  });
});
