import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { meResponseSchema, workspaceMembersSchema } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { supabase } from "../../lib/supabase";
import { relative } from "../../lib/time";
import { useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "./states";
import { SupportAccessSettings } from "./SupportAccessSettings";
import { PrivacySection, TeamSection, WorkspaceSwitcher } from "./TeamSettings";

/**
 * Settings (canonical spec page 14): only settings the server actually stores are editable. Anything MUSHIN does not
 * support yet is stated plainly instead of shown as a toggle that saves nothing.
 */
export type SettingsTab = "profile" | "workspace" | "security" | "notifications" | "access" | "privacy";
type Tab = SettingsTab;
const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "workspace", label: "Team" },
  { id: "security", label: "Password & sessions" },
  { id: "notifications", label: "Notifications" },
  { id: "access", label: "Support access" },
  { id: "privacy", label: "Privacy & data" },
];

const card = "rounded-2xl border border-slate-200/80 bg-white p-5";
const field = "mt-1 w-full max-w-md rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none";
const button = "rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50";

function useMe() {
  const { status } = useAuth();
  return useQuery({ queryKey: ["me"], queryFn: () => apiRequest("/v1/me", meResponseSchema), enabled: status === "signedIn" });
}

export function Settings({ onOpenSupport, initialTab = "profile" }: { onOpenSupport?: () => void; initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="space-y-5">
      <h1 className="text-[32px] font-semibold leading-10 tracking-[-0.025em] text-slate-900">Settings</h1>
      <div className="flex flex-col gap-5 md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-52 md:flex-col" aria-label="Settings sections">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined} className={`whitespace-nowrap rounded-md px-3 py-2 text-left text-sm ${tab === t.id ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white"}`}>{t.label}</button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {tab === "profile" && <ProfileTab />}
          {tab === "workspace" && <WorkspaceTab />}
          {tab === "security" && <SecurityTab />}
          {tab === "notifications" && <NotificationsTab />}
          {tab === "access" && <AccessTab />}
          {tab === "privacy" && <PrivacyTab onOpenSupport={onOpenSupport} />}
        </div>
      </div>
    </div>
  );
}

function ProfileTab() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (displayName: string) => apiRequest("/v1/me", meResponseSchema, { method: "PATCH", body: { displayName } }),
    onSuccess: () => { setName(null); toast.success("Profile saved"); void qc.invalidateQueries({ queryKey: ["me"] }); },
    onError: (err) => toast.error("Couldn't save your profile", err instanceof Error ? err.message : undefined),
  });
  if (me.isPending) return <LoadingBlock lines={3} />;
  if (me.isError) return <ErrorState body={me.error instanceof Error ? me.error.message : undefined} onRetry={() => void me.refetch()} />;
  const value = name ?? me.data.user.displayName ?? "";
  return (
    <form className={`${card} space-y-3`} onSubmit={(e) => { e.preventDefault(); if (value.trim()) save.mutate(value.trim()); }}>
      <label className="block text-xs text-slate-600" style={{ fontWeight: 600 }}>Your name<input value={value} maxLength={80} onChange={(e) => setName(e.target.value)} className={field} /></label>
      <div className="text-xs text-slate-600"><span style={{ fontWeight: 600 }}>Email</span><p className="mt-1 text-sm text-slate-800">{me.data.user.email}</p><p className="text-[11px] text-slate-500">Your sign-in email is managed by your login and can't be changed here.</p></div>
      <p className="text-[11px] text-slate-500">Profile photos are not supported yet; your initials are shown instead.</p>
      <button type="submit" disabled={save.isPending || name === null || !value.trim()} className={button}>{save.isPending ? "Saving…" : "Save profile"}</button>
    </form>
  );
}

function WorkspaceTab() {
  const me = useMe();
  const { status } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (n: string) => apiRequest("/v1/workspace", meResponseSchema, { method: "PATCH", body: { name: n } }),
    onSuccess: () => { setName(null); toast.success("Team renamed"); void qc.invalidateQueries({ queryKey: ["me"] }); },
    onError: (err) => toast.error("Couldn't rename the team", err instanceof Error ? err.message : undefined),
  });
  if (me.isPending) return <LoadingBlock lines={3} />;
  if (me.isError) return <ErrorState body={me.error instanceof Error ? me.error.message : undefined} onRetry={() => void me.refetch()} />;
  const canRename = me.data.workspace.role === "owner" || me.data.workspace.role === "admin";
  const value = name ?? me.data.workspace.name;
  return (
    <div className="space-y-4">
      <form className={`${card} space-y-3`} onSubmit={(e) => { e.preventDefault(); if (value.trim()) save.mutate(value.trim()); }}>
        <label className="block text-xs text-slate-600" style={{ fontWeight: 600 }}>Team name<input value={value} maxLength={80} disabled={!canRename} onChange={(e) => setName(e.target.value)} className={`${field} disabled:bg-slate-50`} /></label>
        {canRename ? <button type="submit" disabled={save.isPending || name === null || !value.trim()} className={button}>Save name</button> : <p className="text-[11px] text-slate-500">Only the owner or an admin can rename the team.</p>}
      </form>
      <WorkspaceSwitcher current={me.data.workspace.id} />
      <TeamSection role={me.data.workspace.role} me={me.data.user.id} />
    </div>
  );
}

function SecurityTab() {
  const toast = useToast();
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const mismatch = pw.confirm !== "" && pw.next !== pw.confirm;
  async function changePassword() {
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setBusy(false);
    if (error) toast.error("Couldn't change your password", error.message);
    else { setPw({ next: "", confirm: "" }); toast.success("Password changed"); }
  }
  async function signOutOthers() {
    const { error } = await supabase.auth.signOut({ scope: "others" });
    if (error) toast.error("Couldn't sign out other sessions", error.message);
    else toast.success("Signed out on your other devices");
  }
  return (
    <div className="space-y-4">
      <form className={`${card} space-y-3`} onSubmit={(e) => { e.preventDefault(); if (!mismatch && pw.next.length >= 8) void changePassword(); }}>
        <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Change password</div>
        <label className="block text-xs text-slate-600">New password (at least 8 characters)<input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className={field} /></label>
        <label className="block text-xs text-slate-600">Repeat new password<input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} aria-invalid={mismatch} className={field} /></label>
        {mismatch && <p className="text-[11px] text-red-600">The passwords don't match.</p>}
        <button type="submit" disabled={busy || mismatch || pw.next.length < 8} className={button}>{busy ? "Changing…" : "Change password"}</button>
      </form>
      <section className={card}>
        <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Sessions</div>
        <p className="mt-1 text-xs text-slate-500">Sign out everywhere except this browser, for example after using a shared computer.</p>
        <button onClick={() => void signOutOthers()} className="mt-2 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">Sign out other sessions</button>
      </section>
    </div>
  );
}

function NotificationsTab() {
  return (
    <section className={card}>
      <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Notifications</div>
      <p className="mt-1 text-sm text-slate-600">MUSHIN doesn't send notification emails yet. Finished Find New Creators runs, list and campaign changes and outreach appear in the bell and the Activity log.</p>
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
