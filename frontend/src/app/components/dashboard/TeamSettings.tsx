import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createdInvitationSchema, deletionResultSchema, invitationListSchema, meResponseSchema, myWorkspacesSchema, workspaceExportSchema, workspaceMembersSchema } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { selectWorkspace } from "../../api/workspace";
import { useAuth } from "../../auth/AuthContext";
import { relative } from "../../lib/time";
import { useConfirm, useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "./states";

type Role = "owner" | "admin" | "member";
const card = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";
const errText = (err: unknown) => (err instanceof Error ? err.message : undefined);

/** Members (roles, removal, ownership) and invitations. What a role may do is enforced again by the API. */
export function TeamSection({ role, me }: { role: Role; me: string }) {
  const { status } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const members = useQuery({ queryKey: ["workspace", "members"], queryFn: () => apiRequest("/v1/workspace/members", workspaceMembersSchema), enabled: status === "signedIn" });
  const manage = role === "owner" || role === "admin";
  const invites = useQuery({ queryKey: ["workspace", "invitations"], queryFn: () => apiRequest("/v1/workspace/invitations", invitationListSchema), enabled: status === "signedIn" && manage });
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["workspace"] });
  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      refresh();
    } catch (err) {
      toast.error(`Couldn't ${what}`, errText(err));
    }
  };
  const invite = useMutation({
    mutationFn: () => apiRequest("/v1/workspace/invitations", createdInvitationSchema, { method: "POST", body: { email: email.trim(), role: inviteRole } }),
    onSuccess: (r) => { setLink({ email: r.email, url: r.acceptUrl }); setEmail(""); refresh(); },
    onError: (err) => toast.error("Couldn't create the invitation", errText(err)),
  });
  const none = z.null();
  return (
    <section className={`${card} space-y-3`} aria-label="Team">
      <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Team</div>
      {members.isPending ? <LoadingBlock lines={2} /> : members.isError ? <ErrorState body={errText(members.error)} /> : (
        <ul className="divide-y divide-slate-100 text-sm">
          {members.data.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1"><span className="text-slate-900" style={{ fontWeight: 600 }}>{m.name}{m.id === me ? " (you)" : ""}</span> <span className="text-slate-500">{m.email}</span></span>
              <span className="text-xs text-slate-500">joined {relative(m.joinedAt)}</span>
              {role === "owner" && m.role !== "owner" ? (
                <select aria-label={`Role of ${m.name}`} value={m.role} onChange={(e) => void run("change the role", () => apiRequest(`/v1/workspace/members/${m.id}`, none, { method: "PATCH", body: { role: e.target.value } }), "Role changed")} className="rounded-md border border-slate-200 px-1.5 py-1 text-xs">
                  <option value="admin">Admin</option><option value="member">Member</option>
                </select>
              ) : <span className="text-xs capitalize text-slate-600">{m.role}</span>}
              {role === "owner" && m.role !== "owner" && (
                <button onClick={async () => { if (await confirm({ title: `Make ${m.name} the owner?`, body: "They will control billing, roles and deletion. You become an admin.", confirmLabel: "Transfer ownership", destructive: true })) void run("transfer ownership", () => apiRequest("/v1/workspace/transfer-ownership", none, { method: "POST", body: { userId: m.id } }), "Ownership transferred"); }} className="text-xs text-slate-600 underline-offset-2 hover:underline">Make owner</button>
              )}
              {m.role !== "owner" && (m.id === me || role === "owner" || (role === "admin" && m.role === "member")) && (
                <button onClick={async () => { if (await confirm({ title: m.id === me ? "Leave this workspace?" : `Remove ${m.name}?`, body: m.id === me ? "You lose access to its lists, campaigns and searches." : "They lose access at once. Their past work stays in the workspace.", confirmLabel: m.id === me ? "Leave" : "Remove", destructive: true })) void run(m.id === me ? "leave" : "remove the member", async () => { await apiRequest(`/v1/workspace/members/${m.id}`, none, { method: "DELETE" }); if (m.id === me) { selectWorkspace(null); window.location.reload(); } }, m.id === me ? "You left the workspace" : "Member removed"); }} className="text-xs text-red-700 underline-offset-2 hover:underline">{m.id === me ? "Leave" : "Remove"}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {manage && (
        <>
          <form className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3" onSubmit={(e) => { e.preventDefault(); if (email.trim()) invite.mutate(); }}>
            <label className="text-xs text-slate-600" style={{ fontWeight: 600 }}>Invite by email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} className="mt-1 block w-64 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm" /></label>
            <label className="text-xs text-slate-600" style={{ fontWeight: 600 }}>Role<select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "member" | "admin")} className="mt-1 block rounded-md border border-slate-200 px-2 py-1.5 text-sm"><option value="member">Member</option>{role === "owner" && <option value="admin">Admin</option>}</select></label>
            <button type="submit" disabled={invite.isPending || !email.trim()} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50">Create invitation</button>
          </form>
          {link && (
            <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900" role="status">
              <div style={{ fontWeight: 600 }}>Send this link to {link.email}. MUSHIN does not email invitations yet.</div>
              <div className="mt-1 break-all font-mono">{link.url}</div>
              <div className="mt-1 flex gap-3"><button onClick={() => void navigator.clipboard?.writeText(link.url).then(() => toast.success("Link copied"))} className="underline">Copy link</button><button onClick={() => setLink(null)} className="underline">Done</button></div>
              <p className="mt-1 text-indigo-800">Only {link.email}, signed in with that confirmed address, can use it. It expires in 7 days.</p>
            </div>
          )}
          {invites.data && invites.data.invitations.length > 0 && (
            <ul className="divide-y divide-slate-100 text-xs">
              {invites.data.invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="flex-1">{i.email} · {i.role} · <span className="capitalize">{i.status}</span> · invited by {i.invitedBy} {relative(i.createdAt)}</span>
                  {i.status === "pending" && <button onClick={() => void run("revoke the invitation", () => apiRequest(`/v1/workspace/invitations/${i.id}`, none, { method: "DELETE" }), "Invitation revoked")} className="text-red-700 hover:underline">Revoke</button>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** The workspaces you belong to; switching reloads the app in the chosen one. */
export function WorkspaceSwitcher({ current }: { current: string }) {
  const { status } = useAuth();
  const q = useQuery({ queryKey: ["my-workspaces"], queryFn: () => apiRequest("/v1/me/workspaces", myWorkspacesSchema), enabled: status === "signedIn" });
  if (!q.data || q.data.workspaces.length < 2) return null;
  return (
    <label className="block text-xs text-slate-600" style={{ fontWeight: 600 }}>
      Current workspace
      <select value={current} onChange={(e) => { selectWorkspace(e.target.value); window.location.reload(); }} className="mt-1 block w-full max-w-md rounded-md border border-slate-200 px-2.5 py-1.5 text-sm">
        {q.data.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.role})</option>)}
      </select>
    </label>
  );
}

/**
 * The same switch in the account menu (FRONTEND_REQUIREMENTS APP-01): one item per workspace, the current one ticked.
 * Shown only to people in two or more workspaces; switching reloads the app in the chosen one.
 */
export function WorkspaceMenuItems({ onPicked }: { onPicked: () => void }) {
  const { status } = useAuth();
  const list = useQuery({ queryKey: ["my-workspaces"], queryFn: () => apiRequest("/v1/me/workspaces", myWorkspacesSchema), enabled: status === "signedIn" });
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiRequest("/v1/me", meResponseSchema), enabled: status === "signedIn" });
  if (!list.data || list.data.workspaces.length < 2) return null;
  const current = me.data?.workspace.id;
  return (
    <div className="border-t border-slate-100 py-1">
      <div className="px-4 pb-1 pt-1.5 text-[11px] uppercase tracking-wider text-slate-500" style={{ fontWeight: 600 }}>Workspaces</div>
      {list.data.workspaces.map((w) => (
        <button
          key={w.id}
          role="menuitemradio"
          aria-checked={w.id === current}
          onClick={() => {
            onPicked();
            if (w.id === current) return;
            selectWorkspace(w.id);
            window.location.reload();
          }}
          className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
          style={{ fontWeight: w.id === current ? 600 : 500 }}
        >
          <span className="truncate">{w.name}</span>
          <span className="flex-shrink-0 text-[11px] text-slate-500">{w.id === current ? "✓ current" : w.role}</span>
        </button>
      ))}
    </div>
  );
}

/** Export, workspace deletion and account deletion, each stating exactly what happens and what is kept. */
export function PrivacySection({ role, workspaceName, email, onOpenSupport }: { role: Role; workspaceName: string; email: string; onOpenSupport?: (() => void) | undefined }) {
  const toast = useToast();
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [result, setResult] = useState<string[] | null>(null);
  const exportData = async () => {
    setBusy(true);
    try {
      const data = await apiRequest("/v1/workspace/export", workspaceExportSchema);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `mushin-workspace-export-${data.exportedAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      if (data.truncated.length > 0) toast.error("Export downloaded, but incomplete", `Cut at the row limit: ${data.truncated.join(", ")}. Ask Support for a complete copy.`);
      else toast.success("Export downloaded");
    } catch (err) {
      toast.error("Couldn't export the workspace", errText(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (path: string, body: object, after: () => void) => {
    setBusy(true);
    try {
      const r = await apiRequest(path, deletionResultSchema, { method: "POST", body });
      // Audit SEC-13: the sign-in login is removed with the account; say so plainly when the provider did not do it.
      setResult(r.identityProviderAccount === "not_deleted_requires_provider" ? [...r.retained, "Your sign-in login could not be removed automatically. It can no longer open MUSHIN, and MUSHIN staff will remove it."] : r.retained);
      after();
    } catch (err) {
      toast.error("Not deleted", errText(err));
    } finally {
      setBusy(false);
    }
  };
  if (result) {
    return (
      <section className={`${card} space-y-2 text-sm text-slate-600`} role="status">
        <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Deleted</div>
        <p>What was kept, and why:</p>
        <ul className="list-disc pl-5">{result.map((r) => <li key={r}>{r}</li>)}</ul>
        {accountDeleted && <button onClick={() => void logout().finally(() => { window.location.hash = "/"; })} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white" style={{ fontWeight: 600 }}>Sign out</button>}
      </section>
    );
  }
  return (
    <section className={`${card} space-y-4 text-sm text-slate-600`}>
      <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Privacy & data</div>
      <p>Your lists, campaigns, notes, outreach log and support requests are private to this workspace. Creator profiles are public data that MUSHIN keeps for every customer. Creators who want their own profile removed can use the public removal form linked in the site footer.</p>
      <div>
        <div className="text-slate-900" style={{ fontWeight: 600 }}>Export this workspace</div>
        <p className="text-xs">A JSON file with your lists, campaigns, outreach log, saved searches, support requests, jobs and credit history. Contact details you revealed are not included (they belong to the creators).</p>
        {role === "owner" || role === "admin" ? <button onClick={() => void exportData()} disabled={busy} className="mt-2 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Download export</button> : <p className="mt-1 text-xs text-slate-500">Only the owner or an admin can export the workspace.</p>}
      </div>
      {role === "owner" && (
        <form className="space-y-2 rounded-lg border border-red-200 p-3" onSubmit={(e) => { e.preventDefault(); void remove("/v1/workspace/delete", { confirmName }, () => { selectWorkspace(null); }); }}>
          <div className="text-red-800" style={{ fontWeight: 600 }}>Delete this workspace</div>
          <p className="text-xs">Erases its lists, campaigns, outreach log, searches, support requests and discovery history, and removes everyone's access. Cancel any paid subscription first. Billing records are kept for accounting. This cannot be undone.</p>
          <label className="block text-xs">Type <span className="font-mono">{workspaceName}</span> to confirm<input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} className="mt-1 block w-full max-w-md rounded-md border border-slate-200 px-2.5 py-1.5 text-sm" /></label>
          <button type="submit" disabled={busy || confirmName.trim() !== workspaceName} className="rounded-md bg-red-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">Delete workspace</button>
        </form>
      )}
      <form className="space-y-2 rounded-lg border border-red-200 p-3" onSubmit={(e) => { e.preventDefault(); void remove("/v1/me/delete", { confirmEmail }, () => { selectWorkspace(null); setAccountDeleted(true); }); }}>
        <div className="text-red-800" style={{ fontWeight: 600 }}>Delete my account</div>
        <p className="text-xs">Ends your access to every workspace and erases your profile. Workspaces you own alone are deleted too; if others use a workspace you own, transfer ownership first. Your sign-in login is removed too, so the address can be used again later.</p>
        <label className="block text-xs">Type your email <span className="font-mono">{email}</span> to confirm<input value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} className="mt-1 block w-full max-w-md rounded-md border border-slate-200 px-2.5 py-1.5 text-sm" /></label>
        <button type="submit" disabled={busy || confirmEmail.trim().toLowerCase() !== email.toLowerCase()} className="rounded-md bg-red-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">Delete my account</button>
      </form>
      {onOpenSupport && <button onClick={onOpenSupport} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">Ask Support about your data</button>}
    </section>
  );
}
