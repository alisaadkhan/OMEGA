import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { staffLoginResponseSchema, staffSessionResponseSchema } from "@mushin/contracts";
import { adminRequest, adminToken, refreshAdminSession, setAdminToken } from "./adminApi";
import { z } from "zod";
import { isStaffPath } from "../components/staff/path";

export type AdminRole = "support" | "admin" | "super_admin";
export type AdminUser = { id: string; name: string; email: string; role: AdminRole };

type Ctx = {
  admin: AdminUser | null;
  status: "loading" | "signedIn" | "signedOut";
  /** Returns the code challenge when two-factor is on; null when the password alone signed in. */
  startLogin: (email: string, password: string) => Promise<string | null>;
  completeLogin: (challengeToken: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  token: () => string | null;
};

const AdminAuthContext = createContext<Ctx | null>(null);

/** Staff sign-in (sub-project 1): password, then the 6-digit code; the session survives a reload through the refresh cookie. */
export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [status, setStatus] = useState<Ctx["status"]>("loading");

  // The staff session is restored only on the staff portal (/_omega_): customer pages and the public site never send
  // a staff refresh request (it failed with 401 on every customer page load and counted against the IP rate limit).
  useEffect(() => {
    let started = false;
    const restore = () => {
      if (started || !isStaffPath(window.location.pathname)) return;
      started = true;
      void refreshAdminSession()
        .then((s) => {
          setAdmin(s ? s.staff : null);
          setStatus(s ? "signedIn" : "signedOut");
        })
        .catch(() => setStatus("signedOut"));
    };
    restore();
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, []);

  // Access tokens last 15 minutes: refresh a minute early while signed in.
  useEffect(() => {
    if (status !== "signedIn") return;
    const t = window.setInterval(() => void refreshAdminSession().then((s) => !s && (setAdmin(null), setStatus("signedOut"))), 14 * 60_000);
    return () => window.clearInterval(t);
  }, [status]);

  const value: Ctx = {
    admin,
    status,
    async startLogin(email, password) {
      const r = await adminRequest("/admin/v1/auth/login", staffLoginResponseSchema, { method: "POST", body: { email, password } });
      if ("challengeToken" in r) return r.challengeToken;
      setAdminToken(r.accessToken);
      setAdmin(r.staff);
      setStatus("signedIn");
      return null;
    },
    async completeLogin(challengeToken, code) {
      const s = await adminRequest("/admin/v1/auth/totp", staffSessionResponseSchema, { method: "POST", body: { challengeToken, code } });
      setAdminToken(s.accessToken);
      setAdmin(s.staff);
      setStatus("signedIn");
    },
    async signOut() {
      await adminRequest("/admin/v1/auth/logout", z.unknown(), { method: "POST" }).catch(() => undefined);
      setAdminToken(null);
      setAdmin(null);
      setStatus("signedOut");
    },
    token: adminToken,
  };
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
}
