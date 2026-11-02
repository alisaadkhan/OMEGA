import { describe, expect, it } from "vitest";
import { ALREADY_REGISTERED, checkEmailText, normalizeEmail, signupOutcome } from "./signup-outcome";

describe("sign-up outcomes (duplicate-email bug)", () => {
  it("normalizes the address the way Supabase Auth compares it, without provider-specific rewriting", () => {
    expect(normalizeEmail("  Ayesha.Malik+brand@Gmail.COM ")).toBe("ayesha.malik+brand@gmail.com");
  });

  it("tells the person when the address is already registered (owner decision 2026-11-02)", () => {
    const fresh = signupOutcome("a@b.pk", { session: null, user: { identities: [{ id: "x" }] } }, null);
    const existingHidden = signupOutcome("a@b.pk", { session: null, user: { identities: [] } }, null);
    const existingError = signupOutcome("a@b.pk", null, { code: "user_already_exists", status: 422, message: "User already registered" });
    expect(fresh).toEqual({ kind: "check_email", email: "a@b.pk" });
    expect(existingHidden).toEqual({ kind: "exists", message: ALREADY_REGISTERED });
    expect(existingError).toEqual({ kind: "exists", message: ALREADY_REGISTERED });
    expect(checkEmailText("a@b.pk")).toMatch(/verify your email/);
  });

  it("signs in only with a session for a confirmed email; an unverified account never reaches the dashboard", () => {
    expect(signupOutcome("a@b.pk", { session: {}, user: { identities: [{}], email_confirmed_at: "2026-11-02T00:00:00Z" } }, null)).toEqual({ kind: "signed_in" });
    expect(signupOutcome("a@b.pk", { session: {}, user: { identities: [{}], email_confirmed_at: null } }, null)).toEqual({ kind: "check_email", email: "a@b.pk" });
  });

  it("never claims success or failure when the service could not be reached", () => {
    const o = signupOutcome("a@b.pk", null, { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" });
    expect(o.kind).toBe("uncertain");
  });

  it("maps provider errors to plain messages, never raw provider text", () => {
    expect(signupOutcome("a@b.pk", null, { code: "weak_password", status: 422, message: "Password should be at least 6 characters." })).toMatchObject({ kind: "error", message: expect.stringContaining("stronger password") });
    expect(signupOutcome("a@b.pk", null, { code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" })).toMatchObject({ kind: "error", message: expect.stringContaining("Too many") });
    expect(signupOutcome("a@b.pk", null, { status: 500, message: "Database error saving new user: duplicate key" })).toEqual({ kind: "error", message: "Sign-up failed. Please try again." });
  });
});
