/**
 * Sign-up outcomes (duplicate-email bug, 2026-10-27). Supabase Auth is the authority for accounts and keeps emails
 * unique. With email confirmation on, signing up with an address that already has an account succeeds without a
 * session and with an empty `identities` list (Supabase hides whether the account exists); with confirmation off it
 * fails with `user_already_exists`. The app used to treat the first as a new account ("we've sent a link") although
 * no link is sent. Both now lead to one neutral answer that works for a new and an existing address alike, so the page
 * never says whether an account exists, and always offers sign-in and password reset.
 * Owner decision 2026-11-02: an address that is already registered now gets an explicit error ("already registered"),
 * accepting that the sign-up form reveals whether an address has an account. A session is only accepted for a
 * confirmed email; an unconfirmed one never reaches the dashboard.
 */
export type SignupOutcome =
  | { kind: "signed_in" }
  | { kind: "check_email"; email: string }
  | { kind: "exists"; message: string }
  | { kind: "uncertain"; message: string }
  | { kind: "error"; message: string };

/** The address as Supabase Auth compares it: surrounding spaces removed, lower case. No provider-specific rewriting. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

type AuthErrorLike = { message?: string; code?: string; status?: number; name?: string } | null;
type SignUpData = { session: unknown | null; user: { identities?: unknown[] | null; email_confirmed_at?: string | null } | null } | null;

export const ALREADY_REGISTERED = "This email is already registered. Sign in instead, or reset your password if you've forgotten it.";

const FRIENDLY: Record<string, string> = {
  weak_password: "Choose a stronger password: at least 8 characters, not a common one.",
  email_address_invalid: "Enter a valid email address.",
  validation_failed: "Check the email address and password, then try again.",
  over_email_send_rate_limit: "Too many sign-up emails were requested. Wait a few minutes, then try again.",
  over_request_rate_limit: "Too many attempts. Wait a few minutes, then try again.",
  signup_disabled: "New sign-ups are closed right now.",
};
const EXISTING = new Set(["user_already_exists", "email_exists", "identity_already_exists"]);

export function signupOutcome(email: string, data: SignUpData, error: AuthErrorLike): SignupOutcome {
  if (error) {
    if (error.code && EXISTING.has(error.code)) return { kind: "exists", message: ALREADY_REGISTERED };
    if (error.code && FRIENDLY[error.code]) return { kind: "error", message: FRIENDLY[error.code] as string };
    if (error.status === 429) return { kind: "error", message: FRIENDLY["over_request_rate_limit"] as string };
    // No answer from the sign-up service: the account may or may not have been created. Never claim either.
    if (error.name === "AuthRetryableFetchError" || error.status === 0 || /fetch|network|timed? ?out/i.test(error.message ?? "")) {
      return {
        kind: "uncertain",
        message: "We couldn't reach the sign-up service, so we can't tell whether your account was created. Check your inbox for a confirmation email, or try signing in, before you try again.",
      };
    }
    return { kind: "error", message: "Sign-up failed. Please try again." };
  }
  // With email confirmation on, Supabase answers an existing address with no session and an empty identities list.
  if (!data?.session && Array.isArray(data?.user?.identities) && data.user.identities.length === 0) return { kind: "exists", message: ALREADY_REGISTERED };
  // A session counts only for a confirmed email: an unverified account never proceeds to the dashboard.
  if (data?.session && data.user?.email_confirmed_at) return { kind: "signed_in" };
  return { kind: "check_email", email };
}

/** The one neutral message shown after a sign-up that did not sign the person in. */
export const checkEmailText = (email: string) =>
  `Check your inbox at ${email}. We've sent a confirmation link. Open it to verify your email before you sign in.`;
