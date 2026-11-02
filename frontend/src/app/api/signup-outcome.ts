/**
 * Sign-up outcomes (duplicate-email bug, 2026-10-27). Supabase Auth is the authority for accounts and keeps emails
 * unique. With email confirmation on, signing up with an address that already has an account succeeds without a
 * session and with an empty `identities` list (Supabase hides whether the account exists); with confirmation off it
 * fails with `user_already_exists`. The app used to treat the first as a new account ("we've sent a link") although
 * no link is sent. Both now lead to one neutral answer that works for a new and an existing address alike, so the page
 * never says whether an account exists, and always offers sign-in and password reset.
 */
export type SignupOutcome =
  | { kind: "signed_in" }
  | { kind: "check_email"; email: string }
  | { kind: "uncertain"; message: string }
  | { kind: "error"; message: string };

/** The address as Supabase Auth compares it: surrounding spaces removed, lower case. No provider-specific rewriting. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

type AuthErrorLike = { message?: string; code?: string; status?: number; name?: string } | null;
type SignUpData = { session: unknown | null; user: { identities?: unknown[] | null } | null } | null;

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
    if (error.code && EXISTING.has(error.code)) return { kind: "check_email", email };
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
  if (data?.session) return { kind: "signed_in" };
  // New address (link sent) or an address that already has an account (no link): the same answer for both.
  return { kind: "check_email", email };
}

/** The one neutral message shown after a sign-up that did not sign the person in. */
export const checkEmailText = (email: string) =>
  `Check your inbox at ${email}. If this address is new to MUSHIN, we've sent a confirmation link. If you already have an account with it, no new link is sent: sign in, or reset your password.`;
