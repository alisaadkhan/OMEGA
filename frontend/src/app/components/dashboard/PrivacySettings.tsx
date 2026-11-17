import { useState } from "react";
import { deletionResultSchema, workspaceExportSchema } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { selectWorkspace } from "../../api/workspace";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../lib/toast";

type Role = "owner" | "admin" | "member";
const card = "rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm";
const errText = (err: unknown) => (err instanceof Error ? err.message : undefined);

/** Export and account deletion, each stating exactly what happens and what is kept. There are no teams (owner, 17 Nov). */
export function PrivacySection({ role, email, onOpenSupport }: { role: Role; email: string; onOpenSupport?: (() => void) | undefined }) {
  const toast = useToast();
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [result, setResult] = useState<string[] | null>(null);
  const exportData = async () => {
    setBusy(true);
    try {
      const data = await apiRequest("/v1/workspace/export", workspaceExportSchema);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `mushin-export-${data.exportedAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      if (data.truncated.length > 0) toast.error("Export downloaded, but incomplete", `Cut at the row limit: ${data.truncated.join(", ")}. Ask Support for a complete copy.`);
      else toast.success("Export downloaded");
    } catch (err) {
      toast.error("Couldn't export your data", errText(err));
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
        {accountDeleted && <button onClick={() => void logout().finally(() => { window.location.hash = "/"; })} className="rounded-xl bg-[#0A0F24] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:-translate-y-px hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:translate-y-0" style={{ fontWeight: 600 }}>Sign out</button>}
      </section>
    );
  }
  return (
    <section className={`${card} space-y-5 text-sm text-slate-600 sm:p-8`}>
      <div>
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-slate-900">Data &amp; privacy</h2>
        <p className="mt-1 text-[13px] text-slate-500">Download your data, or delete your account.</p>
      </div>
      <p>Your lists, campaigns, notes, outreach log and support requests are private to your account. Creator profiles are public data that MUSHIN keeps for every customer. Creators who want their own profile removed can use the public removal form linked in the site footer.</p>
      <div className="rounded-xl bg-slate-50 p-5">
        <div className="text-[15px] text-slate-900" style={{ fontWeight: 600 }}>Export your data</div>
        <p className="text-xs">A JSON file with your lists, campaigns, outreach log, saved searches, support requests, jobs and credit history. Contact details you revealed are not included (they belong to the creators).</p>
        {role === "owner" || role === "admin" ? <button onClick={() => void exportData()} disabled={busy} className="mt-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 disabled:opacity-50">Download export</button> : <p className="mt-1 text-xs text-slate-500">Only the account owner can export.</p>}
      </div>
      <form className="space-y-2 rounded-xl border border-rose-200 bg-rose-50/30 p-4" onSubmit={(e) => { e.preventDefault(); void remove("/v1/me/delete", { confirmEmail }, () => { selectWorkspace(null); setAccountDeleted(true); }); }}>
        <div className="text-red-800" style={{ fontWeight: 600 }}>Delete my account</div>
        <p className="text-xs">Erases your profile, lists, campaigns, outreach log, searches and support requests. Billing records are kept for accounting. Your sign-in login is removed too, so the address can be used again later.</p>
        <label className="block text-xs">Type your email <span className="font-mono">{email}</span> to confirm<input value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} className="mt-1 block w-full max-w-md rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/30" /></label>
        <button type="submit" disabled={busy || confirmEmail.trim().toLowerCase() !== email.toLowerCase()} className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold shadow-sm transition-colors hover:bg-rose-700 text-white disabled:opacity-50">Delete my account</button>
      </form>
      {onOpenSupport && <button onClick={onOpenSupport} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40">Ask Support about your data</button>}
    </section>
  );
}
