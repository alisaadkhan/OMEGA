import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { meResponseSchema, type MeResponse } from "@mushin/contracts";
import { apiRequest } from "../api/client";
import { supabase } from "../lib/supabase";

export type AuthUser = { id: string; name: string; email: string; avatar: string; initials: string; role: "owner" | "admin" | "member" };
export type AuthStatus = "loading" | "signedIn" | "signedOut";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  logout: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
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

function messageOf(error: { message: string }): string {
  return error.message || "Something went wrong. Please try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) queryClient.removeQueries({ queryKey: ["me"] });
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const me = useQuery({
    queryKey: ["me", session?.user.id],
    queryFn: () => apiRequest("/v1/me", meResponseSchema),
    enabled: Boolean(session),
    staleTime: 60_000,
    retry: 1,
  });

  const status: AuthStatus =
    session === undefined ? "loading" : session === null ? "signedOut" : me.isPending ? "loading" : "signedIn";
  const user = session ? toAuthUser(session, me.data) : null;

  const value: AuthContextValue = {
    status,
    user,
    async login(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(messageOf(error));
    },
    async signup(name, email, password) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}/#/dashboard` },
      });
      if (error) throw new Error(messageOf(error));
      return { needsConfirmation: !data.session };
    },
    async logout() {
      await supabase.auth.signOut();
      queryClient.clear();
    },
    async requestPasswordReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/#/login` });
      if (error) throw new Error(messageOf(error));
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
