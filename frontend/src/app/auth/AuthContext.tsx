import { normalizeEmail, signupOutcome, type SignupOutcome } from "../api/signup-outcome";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { meResponseSchema, type MeResponse } from "@mushin/contracts";
import { apiRequest } from "../api/client";
import { linkResultFromUrl, rememberEmailLink, supabase } from "../lib/supabase";
import { clearSessionNotice, markSessionExpired } from "../api/session";

// Set while the person signs out on purpose, so that sign-out is not reported as an expired session.
let signingOut = false;

export type AuthUser = { id: string; name: string; email: string; avatar: string; initials: string; role: "owner" | "admin" | "member" };
export type AuthStatus = "loading" | "signedIn" | "signedOut";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<SignupOutcome>;
  logout: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  /** Sends a new sign-up confirmation email (expired or used link, gap UX-08). */
  resendConfirmation: (email: string) => Promise<void>;
  /** Sets a new password for the signed-in person (after a recovery link, audit UX-02). */
  updatePassword: (password: string) => Promise<void>;
  /** Why an email link failed (expired, already used), when the Auth server said so. */
  linkError: string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("")
      .replace(/[^A-Z]/g, "") || "MU"
  );
}

function initialsAvatar(initials: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' rx='32' fill='#4f46e5'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' font-family='Inter,Arial,sans-serif' font-size='24' fill='white'>${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function toAuthUser(session: Session, me: MeResponse | undefined): AuthUser {
  const email = me?.user.email ?? session.user.email ?? "";
  const metaName = session.user.user_metadata?.["full_name"];
  const name = me?.user.displayName ?? (typeof metaName === "string" && metaName ? metaName : email.split("@")[0] ?? "You");
  const initials = initialsOf(name);
  return { id: me?.user.id ?? session.user.id, name, email, initials, avatar: me?.user.avatarUrl ?? initialsAvatar(initials), role: me?.workspace.role ?? "member" };
}

function messageOf(error: { message: string; code?: string }): string {
  if (error.code === "email_not_confirmed" || /email not confirmed/i.test(error.message)) return "Please verify your email first. Open the confirmation link we sent you, then sign in.";
  if (error.code === "invalid_credentials") return "That email and password don't match. Try again or reset your password.";
  return error.message || "Something went wrong. Please try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [linkError, setLinkError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    // getSession waits for the client's own code exchange from the URL; only then is the code removed from it.
    void supabase.auth.getSession().then(({ data }) => {
      const { error } = linkResultFromUrl();
      if (error) setLinkError(error); // kept: a second run (StrictMode) finds the address already cleaned
      setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      // A recovery link always ends on the set-new-password screen, wherever the redirect landed.
      if (event === "PASSWORD_RECOVERY") window.location.hash = "/reset-password";
      // A session that ends without the person signing out (refresh token expired or revoked) is an expiry (AUTH-08).
      if (event === "SIGNED_OUT" && !signingOut) markSessionExpired();
      setSession(next);
      if (!next) queryClient.removeQueries({ queryKey: ["me"] });
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const me = useQuery({
    queryKey: ["me", session?.user.id],
    queryFn: () => apiRequest("/v1/me", meResponseSchema),
    enabled: Boolean(session?.user.email_confirmed_at),
    staleTime: 60_000,
    retry: 1,
  });

  // Only a confirmed email gets in: a session for an unverified address is treated as signed out (owner 2026-11-02).
  const verified = Boolean(session?.user.email_confirmed_at);
  useEffect(() => {
    if (session && !session.user.email_confirmed_at) {
      signingOut = true; // not an expiry: the account simply is not verified yet
      void supabase.auth.signOut().finally(() => { signingOut = false; });
    }
  }, [session]);
  const status: AuthStatus =
    session === undefined ? "loading" : session === null || !verified ? "signedOut" : me.isPending ? "loading" : "signedIn";
  const user = session && verified ? toAuthUser(session, me.data) : null;

  const value: AuthContextValue = {
    status,
    user,
    async login(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
      if (error) throw new Error(messageOf(error));
    },
    async signup(name, email, password) {
      rememberEmailLink("signup");
      const address = normalizeEmail(email);
      const { data, error } = await supabase.auth.signUp({
        email: address,
        password,
        options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}/#/confirmed` },
      });
      // Supabase decides; an already-registered address gets an explicit message (signup-outcome.ts).
      return signupOutcome(address, data, error);
    },
    async logout() {
      signingOut = true;
      clearSessionNotice();
      try {
        await supabase.auth.signOut();
      } finally {
        signingOut = false;
      }
      queryClient.clear();
    },
    async resendConfirmation(email) {
      rememberEmailLink("signup");
      const { error } = await supabase.auth.resend({ type: "signup", email: normalizeEmail(email), options: { emailRedirectTo: `${window.location.origin}/#/confirmed` } });
      if (error) throw new Error(messageOf(error));
    },
    async requestPasswordReset(email) {
      rememberEmailLink("recovery");
      const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), { redirectTo: `${window.location.origin}/#/reset-password` });
      if (error) throw new Error(messageOf(error));
    },
    async updatePassword(password) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(messageOf(error));
    },
    linkError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
