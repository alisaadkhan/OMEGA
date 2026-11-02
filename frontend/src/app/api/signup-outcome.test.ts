import { describe, expect, it } from "vitest";
import { checkEmailText, normalizeEmail, signupOutcome } from "./signup-outcome";

describe("sign-up outcomes (duplicate-email bug)", () => {
  it("normalizes the address the way Supabase Auth compares it, without provider-specific rewriting", () => {
    expect(normalizeEmail("  Ayesha.Malik+brand@Gmail.COM ")).toBe("ayesha.malik+brand@gmail.com");
  });

  it("answers a new and an already-registered address identically (no account enumeration)", () => {
    const fresh = signupOutcome("a@b.pk", { session: null, user: { identities: [{ id: "x" }] } }, null);
    const existingHidden = signupOutcome("a@b.pk", { session: null, user: { identities: [] } }, null);
    const existingError = signupOutcome("a@b.pk", null, { code: "user_already_exists", status: 422, message: "User already registered" });
    expect(fresh).toEqual({ kind: "check_email", email: "a@b.pk" });
    expect(existingHidden).toEqual(fresh);
    expect(existingError).toEqual(fresh);
    expect(checkEmailText("a@b.pk")).toMatch(/sign in, or reset your password/);
  });

  it("signs in only when a session came back", () => {
    expect(signupOutcome("a@b.pk", { session: {}, user: { identities: [{}] } }, null)).toEqual({ kind: "signed_in" });
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
