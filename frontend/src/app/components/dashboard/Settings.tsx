import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bell, ChevronRight, KeyRound, LifeBuoy, ShieldCheck, Smartphone, User, Users, Zap, BadgeCheck, LogOut } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { meResponseSchema } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { useBillingSummary } from "../../api/billing";
import { useAuth } from "../../auth/AuthContext";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "./states";
import { SupportAccessSettings } from "./SupportAccessSettings";
import { PrivacySection, TeamSection, WorkspaceSwitcher } from "./TeamSettings";

/**
 * Account settings (owner mockup 2026-11-03): section navigation and an account summary on the left, white cards on the
 * right. Only what the server stores is editable; what MUSHIN does not support yet (two-factor sign-in, a device list,
 * profile photos, job title, timezone, bio) is stated plainly or left out, never shown as a control that saves nothing.
 */
export type SettingsTab = "profile" | "workspace" | "security" | "notifications" | "access" | "privacy";
type Tab = SettingsTab;
const TABS: { id: Tab; label: string; icon: typeof User }[] = [
  { id: "profile", label: "Personal profile", icon: User },
  { id: "security", label: "Password & sessions", icon: KeyRound },
  { id: "workspace", label: "Team", icon: Users },
  { id: "access", label: "Support access", icon: LifeBuoy },
  { id: "privacy", label: "Privacy & data", icon: ShieldCheck },
  { id: "notifications", label: "Notifications", icon: Bell },
];

const card = "rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-8";
const inset = "rounded-xl bg-slate-50 p-5";
const field =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 shadow-inner transition-all placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400/30 disabled:text-slate-500";
const invalidField = "border-rose-300 focus:border-rose-400 focus:ring-rose-300/30";
const primary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#0A0F24] px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none";
const quiet =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-5 py-2.5 text-[13px] font-semibold text-slate-800 transition-colors hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 disabled:opacity-50";
const fieldLabel = "text-[13px] font-semibold text-slate-900";
const smallLabel = "text-[10px] font-semibold uppercase tracking-wider text-slate-500";

function useMe() {
  const { status } = useAuth();
  return useQuery({ queryKey: ["me"], queryFn: () => apiRequest("/v1/me", meResponseSchema), enabled: status === "signedIn" });
}

function CardHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-semibold tracking-[-0.02em] text-slate-900">{title}</h2>
      <p className="mt-1 text-[13px] text-slate-500">{sub}</p>
    </div>
  );
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);

export function Settings({ onOpenSupport, onOpenBilling, initialTab = "profile" }: { onOpenSupport?: () => void; onOpenBilling?: () => void; initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl bg-slate-100/70 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-100 text-cyan-800 shadow-sm">
            <BadgeCheck className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-slate-900">Your account is verified</p>
            <p className="text-xs text-slate-600">Your email is confirmed. Change your password or sign out of other devices under Password &amp; sessions.</p>
          </div>
        </div>
      </div>

      <div>
        <h1 className="text-[32px] font-bold leading-10 tracking-[-0.025em] text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your profile, security, team and account preferences.</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:col-span-4">
          <nav className="flex gap-1.5 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white p-2 shadow-sm lg:flex-col" aria-label="Settings sections">
            {TABS.map((t) => {
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  aria-current={on ? "page" : undefined}
                  className={`flex shrink-0 items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${on ? "bg-[#0A0F24] text-white shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                >
                  <span className="flex items-center gap-3 whitespace-nowrap">
                    <t.icon aria-hidden className={`h-[18px] w-[18px] ${on ? "text-cyan-300" : ""}`} strokeWidth={1.75} />
                    {t.label}
                  </span>
                  <ChevronRight aria-hidden className={`hidden h-4 w-4 lg:block ${on ? "opacity-80" : "opacity-40"}`} />
                </button>
              );
            })}
          </nav>
          <AccountSummary onOpenBilling={onOpenBilling} />
        </aside>

        <div className="min-w-0 lg:col-span-8">
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              {tab === "profile" && <ProfileTab />}
              {tab === "workspace" && <WorkspaceTab />}
              {tab === "security" && <SecurityTab />}
              {tab === "notifications" && <NotificationsTab />}
              {tab === "access" && <AccessTab />}
              {tab === "privacy" && <PrivacyTab onOpenSupport={onOpenSupport} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" } as const;

/** The account record from the mockup, with real data only: email, team role, plan and credits. */
function AccountSummary({ onOpenBilling }: { onOpenBilling?: (() => void) | undefined }) {
  const me = useMe();
  const billing = useBillingSummary();
  if (!me.data) return null;
  const s = billing.data;
  const planName = s?.plan ? (s.complimentary ? `${s.plan.name} (complimentary)` : s.plan.name) : s?.status === "trialing" ? "Free trial" : "No plan yet";
  const until = s?.status === "trialing" ? fmtDate(s.trialEndsAt) : fmtDate(s?.currentPeriodEnd ?? null);
  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm" aria-label="Account summary">
      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
        <span className={smallLabel}>Account</span>
        <span className="text-[11px] font-semibold text-cyan-700">{ROLE_LABEL[me.data.workspace.role]}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className={smallLabel}>Sign-in email</span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-slate-900">{me.data.user.email}</span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-800 ring-1 ring-cyan-200">
            <BadgeCheck className="h-3 w-3" aria-hidden /> Verified
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className={smallLabel}>Team</span>
        <span className="truncate text-[13px] font-semibold text-slate-900">{me.data.workspace.name}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className={smallLabel}>Plan</span>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[15px] font-semibold text-slate-900">{s ? planName : "…"}</span>
          {until && <span className="text-[11px] text-slate-500">{s?.status === "trialing" ? "Ends" : s?.cancelAtPeriodEnd ? "Ends" : "Renews"} {until}</span>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
          <Zap className="h-4 w-4 text-cyan-700" aria-hidden />
          {s ? `${s.balance.available.toLocaleString("en-PK")} credits` : "…"}
        </span>
        {onOpenBilling && (
          <button type="button" onClick={onOpenBilling} className="rounded-md text-[12px] font-semibold text-cyan-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50">
            Top up
          </button>
        )}
      </div>
    </section>
  );
}

function ProfileTab() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (displayName: string) => apiRequest("/v1/me", meResponseSchema, { method: "PATCH", body: { displayName } }),
    onSuccess: () => {
      setName(null);
      toast.success("Profile saved");
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => toast.error("Couldn't save your profile", err instanceof Error ? err.message : undefined),
  });
  if (me.isPending) return <LoadingBlock lines={3} />;
  if (me.isError) return <ErrorState body={me.error instanceof Error ? me.error.message : undefined} onRetry={() => void me.refetch()} />;
  const value = name ?? me.data.user.displayName ?? "";
  const empty = name !== null && !value.trim();
  const shown = (me.data.user.displayName ?? me.data.user.email).trim();
  const initials = shown.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
  return (
    <section className={card}>
      <CardHeader title="Personal profile" sub="Your name as your team sees it on lists, campaigns and the activity log." />
      <div className="mb-6 flex flex-col items-start gap-5 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center">
        <span className="relative shrink-0">
          <span aria-hidden className="flex h-20 w-20 items-center justify-center rounded-full bg-[#0A0F24] text-2xl font-semibold text-white shadow-sm ring-4 ring-white">{initials}</span>
          <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-100 text-cyan-800 shadow-sm">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
          </span>
        </span>
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold text-slate-900">{shown}</div>
          <p className="text-xs text-slate-500">Profile photos are not supported yet; your initials are shown instead.</p>
        </div>
      </div>
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) save.mutate(value.trim());
        }}
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className={fieldLabel}>Your name</span>
            <input value={value} maxLength={80} onChange={(e) => setName(e.target.value)} aria-invalid={empty} className={`${field} ${empty ? invalidField : ""}`} />
            {empty && <span className="text-[11px] text-rose-600">Enter your name.</span>}
          </label>
          <div className="flex flex-col gap-2">
            <span className="flex items-center justify-between">
              <span className={fieldLabel}>Sign-in email</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-700">
                <BadgeCheck className="h-3 w-3" aria-hidden /> Verified
              </span>
            </span>
            <input value={me.data.user.email} readOnly aria-label="Sign-in email" className={`${field} cursor-default`} />
            <span className="text-[11px] text-slate-500">Managed by your login; it can't be changed here.</span>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => setName(null)} disabled={name === null} className={quiet}>
            Cancel
          </button>
          <button type="submit" disabled={save.isPending || name === null || !value.trim()} className={primary}>
            {save.isPending ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </section>
  );
}

function WorkspaceTab() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (n: string) => apiRequest("/v1/workspace", meResponseSchema, { method: "PATCH", body: { name: n } }),
    onSuccess: () => {
      setName(null);
      toast.success("Team renamed");
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => toast.error("Couldn't rename the team", err instanceof Error ? err.message : undefined),
  });
  if (me.isPending) return <LoadingBlock lines={3} />;
  if (me.isError) return <ErrorState body={me.error instanceof Error ? me.error.message : undefined} onRetry={() => void me.refetch()} />;
  const canRename = me.data.workspace.role === "owner" || me.data.workspace.role === "admin";
  const value = name ?? me.data.workspace.name;
  const empty = name !== null && !value.trim();
  return (
    <div className="space-y-6">
      <section className={card}>
        <CardHeader title="Team" sub="The name everyone in your team sees, the people in it and their roles." />
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) save.mutate(value.trim());
          }}
        >
          <label className="flex max-w-md flex-col gap-2">
            <span className={fieldLabel}>Team name</span>
            <input value={value} maxLength={80} disabled={!canRename} onChange={(e) => setName(e.target.value)} aria-invalid={empty} className={`${field} ${empty ? invalidField : ""}`} />
            {empty && <span className="text-[11px] text-rose-600">Enter a team name.</span>}
          </label>
          {canRename ? (
            <div>
              <button type="submit" disabled={save.isPending || name === null || !value.trim()} className={primary}>
                {save.isPending ? "Saving…" : "Save name"}
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">Only the owner or an admin can rename the team.</p>
          )}
        </form>
      </section>
      <WorkspaceSwitcher current={me.data.workspace.id} />
      <TeamSection role={me.data.workspace.role} me={me.data.user.id} />
    </div>
  );
}

/** Same four steps as sign-up: length 8+, 12+, a capital and a digit, a symbol. */
function strengthOf(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: "Minimum 8 characters" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return { score: Math.max(score, 1), label: pw.length < 8 ? "Too short" : score <= 1 ? "Weak" : score === 2 ? "Fair" : "Strong" };
}

function SecurityTab() {
  const me = useMe();
  const { requestPasswordReset } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [wrongCurrent, setWrongCurrent] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const mismatch = pw.confirm !== "" && pw.next !== pw.confirm;
  const strength = strengthOf(pw.next);
  const email = me.data?.user.email ?? null;

  /** The current password is checked first (a stolen open session alone cannot set a new password from this screen). */
  async function changePassword() {
    if (!email) return;
    setBusy(true);
    setWrongCurrent(false);
    const check = await supabase.auth.signInWithPassword({ email, password: pw.current });
    if (check.error) {
      setBusy(false);
      setWrongCurrent(true);
      toast.error("Your current password is not right", "Check it, or use Forgot password? to get a reset link.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setBusy(false);
    if (error) toast.error("Couldn't change your password", error.message);
    else {
      setPw({ current: "", next: "", confirm: "" });
      toast.success("Password changed");
    }
  }
  async function sendReset() {
    if (!email) return;
    try {
      await requestPasswordReset(email);
      toast.success("Reset link sent", `Check ${email} for a link to set a new password.`);
    } catch (err) {
      toast.error("Couldn't send the reset link", err instanceof Error ? err.message : undefined);
    }
  }
  async function signOutOthers() {
    setSigningOut(true);
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setSigningOut(false);
    if (error) toast.error("Couldn't sign out other sessions", error.message);
    else toast.success("Signed out on your other devices");
  }
  const canSubmit = pw.current.length > 0 && pw.next.length >= 8 && !mismatch && pw.confirm !== "";
  return (
    <section className={card}>
      <CardHeader title="Security" sub="Manage your password and where you are signed in." />
      <form
        className={`${inset} mb-5 flex flex-col gap-4`}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void changePassword();
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-semibold text-slate-900">Change password</span>
          <button type="button" onClick={() => void sendReset()} className="rounded-md text-[12px] font-semibold text-cyan-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50">
            Forgot password?
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className={smallLabel}>Current password</span>
            <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => { setPw({ ...pw, current: e.target.value }); setWrongCurrent(false); }} aria-invalid={wrongCurrent} className={`${field} bg-white ${wrongCurrent ? invalidField : ""}`} />
            {wrongCurrent && <span className="text-[11px] text-rose-600">This is not your current password.</span>}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between">
              <span className={smallLabel}>New password (at least 8 characters)</span>
            </span>
            <input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className={`${field} bg-white`} />
            <span className="flex gap-1" aria-hidden>
              {[1, 2, 3, 4].map((n) => (
                <span key={n} className={`h-1 flex-1 rounded-full transition-colors ${n <= strength.score ? (strength.score >= 3 ? "bg-cyan-500" : strength.score === 2 ? "bg-amber-400" : "bg-rose-400") : "bg-slate-200"}`} />
              ))}
            </span>
            <span className={`text-[11px] font-semibold ${strength.score >= 3 ? "text-cyan-700" : pw.next && pw.next.length < 8 ? "text-rose-600" : "text-slate-500"}`} aria-live="polite">
              {strength.label}
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={smallLabel}>Repeat new password</span>
            <input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} aria-invalid={mismatch} className={`${field} bg-white ${mismatch ? invalidField : ""}`} />
            {mismatch && <span className="text-[11px] text-rose-600">The passwords don't match.</span>}
          </label>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={busy || !canSubmit} className={primary}>
            {busy ? "Changing…" : "Change password"}
          </button>
        </div>
      </form>

      <div className={`${inset} mb-5 flex items-start gap-4`}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm">
          <Smartphone className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-slate-900">Two-step sign-in</span>
            <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Not available yet</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">MUSHIN accounts sign in with email and password for now. A strong, unique password is your best protection.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900">Sessions</h3>
          <p className="text-xs text-slate-500">Sign out everywhere except this browser, for example after using a shared computer.</p>
        </div>
        <button type="button" onClick={() => void signOutOthers()} disabled={signingOut} className={quiet}>
          <LogOut className="h-4 w-4" aria-hidden />
          {signingOut ? "Signing out…" : "Sign out other sessions"}
        </button>
      </div>
    </section>
  );
}

function NotificationsTab() {
  return (
    <section className={card}>
      <CardHeader title="Notifications" sub="Where MUSHIN tells you about your work." />
      <p className="text-sm text-slate-600">
        MUSHIN doesn't send notification emails yet. Finished Find New Creators runs, list and campaign changes and outreach appear in the bell and the Activity log.
      </p>
    </section>
  );
}

function PrivacyTab({ onOpenSupport }: { onOpenSupport?: (() => void) | undefined }) {
  const me = useMe();
  if (me.isPending) return <LoadingBlock lines={3} />;
  if (me.isError) return <ErrorState body={me.error instanceof Error ? me.error.message : undefined} onRetry={() => void me.refetch()} />;
  return <PrivacySection role={me.data.workspace.role} workspaceName={me.data.workspace.name} email={me.data.user.email} onOpenSupport={onOpenSupport} />;
}

function AccessTab() {
  const me = useMe();
  if (me.isPending) return <LoadingBlock lines={2} />;
  if (me.isError) return <ErrorState body={me.error instanceof Error ? me.error.message : undefined} onRetry={() => void me.refetch()} />;
  return <SupportAccessSettings canManage={me.data.workspace.role === "owner" || me.data.workspace.role === "admin"} />;
}
