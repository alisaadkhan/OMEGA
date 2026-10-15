import { useState } from "react";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { adminRequest } from "../../admin/adminApi";
import { keyErrorMessage, registerKey, securityState, webauthnSupported } from "../../admin/webauthn";
import { useConfirm, useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { Header } from "./OpsViews";
import { errText, needsKey, useStepUp } from "./staff-ui";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "never");

/** Your security keys (WebAuthn). Admin and Super Admin need one; a TOTP code is never a substitute (DOC-029). */
export function StaffSecurity() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const step = useStepUp();
  const q = useQuery({ queryKey: ["admin", "security"], queryFn: securityState });
  const [nickname, setNickname] = useState("Security key");
  const [busy, setBusy] = useState(false);
  const supported = webauthnSupported();
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "security"] });

  async function add() {
    setBusy(true);
    try {
      await registerKey(nickname.trim() || "Security key");
      toast.success("Security key registered");
    } catch (err) {
      if (needsKey(err)) toast.error("Confirm with an existing security key first, then add the new one.");
      else toast.error("The key was not registered", keyErrorMessage(err));
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function remove(id: string, name: string) {
    if (!(await confirm({ title: `Remove ${name}?`, body: "You will no longer be able to confirm admin actions with it.", confirmLabel: "Remove key", destructive: true }))) return;
    try {
      await adminRequest(`/admin/v1/security/keys/${id}`, z.null(), { method: "DELETE" }); // 204: no body
      toast.success("Security key removed");
    } catch (err) {
      toast.error("The key was not removed", errText(err));
    } finally {
      void refresh();
    }
  }

  return (
    <div>
      <Header title="Security" sub="Hardware security keys for this staff account. Admin actions need one confirmed in the current session; codes from an authenticator app are a second factor at sign-in only." />
      {!supported && <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">This browser does not support security keys. Use a current Chrome, Edge, Firefox or Safari.</p>}
      {q.isPending ? <LoadingBlock lines={3} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div style={{ fontWeight: 600 }}>This session</div>
            <p className="mt-1 text-xs text-slate-600">
              Signed in with password and authenticator code{q.data.factors.includes("hwk") ? "; security key confirmed." : "."}
              {q.data.hardwareKeyRequired ? " Your role's admin actions need a confirmed security key." : " Your role does not need a security key."}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3 text-sm" style={{ fontWeight: 600 }}>Registered keys</div>
            {q.data.keys.length === 0 ? <p className="px-4 py-3 text-xs text-slate-500">No security key registered yet.</p> : (
              <ul className="divide-y divide-slate-100">
                {q.data.keys.map((k) => (
                  <li key={k.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                    <KeyRound className="h-4 w-4 text-slate-500" />
                    <div className="flex-1"><div className="text-slate-900" style={{ fontWeight: 600 }}>{k.nickname}</div><div className="text-slate-500">Added {when(k.createdAt)} · last used {when(k.lastUsedAt)}</div></div>
                    <button onClick={() => void remove(k.id, k.nickname)} disabled={!step.confirmed || q.data.keys.length === 1} title={q.data.keys.length === 1 ? "Add another key before removing your last one" : !step.confirmed ? "Confirm with a security key first" : undefined} className="rounded-md border border-red-200 px-2 py-1 text-[11px] text-red-700 disabled:cursor-not-allowed disabled:opacity-50">Remove</button>
                  </li>
                ))}
              </ul>
            )}
            {q.data.hardwareKeyRequired && (
              <form className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3" onSubmit={(e) => { e.preventDefault(); void add(); }}>
                <label className="text-xs text-slate-600">Name <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={60} className="ml-1 w-48 rounded-md border border-slate-200 px-2 py-1 text-xs" /></label>
                <button type="submit" disabled={busy || !supported || (q.data.keys.length > 0 && !step.confirmed)} title={q.data.keys.length > 0 && !step.confirmed ? "Confirm with an existing key first" : undefined} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50" style={{ fontWeight: 600 }}>{busy ? "Touch your key…" : "Add security key"}</button>
                {q.data.keys.length > 0 && !step.confirmed && <span className="text-[11px] text-slate-500">Adding another key needs one of your keys first.</span>}
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
