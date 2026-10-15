import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { approvalListSchema, approvalSchema, staffCreatedSchema, staffDirectorySchema, type Approval, type ApprovalRequest } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import type { AdminRole } from "../../admin/AdminAuthContext";
import { useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { Header } from "./OpsViews";
import { ReasonAction, errText } from "./staff-ui";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
const ACTION_LABEL: Record<Approval["action"], string> = { "credits.grant": "Credit correction", "staff.role.change": "Staff role change", "staff.suspend": "Staff suspension" };
const describe = (a: Approval) => {
  const p = a.payload as Record<string, unknown>;
  if (a.action === "credits.grant") return `${String(p["amount"])} credits to workspace ${a.targetId.slice(0, 8)}…, expiring after ${String(p["expiresInDays"])} days`;
  if (a.action === "staff.role.change") return `Make staff ${a.targetId.slice(0, 8)}… ${String(p["role"])}`;
  return `${p["suspended"] ? "Suspend" : "Reinstate"} staff ${a.targetId.slice(0, 8)}…`;
};

/** Two-person approvals (staff spec §2): nobody decides their own request; co-sign requests need a Super Admin. */
export function Approvals({ me, role }: { me: string; role: AdminRole }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<"pending" | "">("pending");
  const q = useQuery({ queryKey: ["admin", "approvals", status], queryFn: () => adminRequest(`/admin/v1/approvals${status ? `?status=${status}` : ""}`, approvalListSchema) });
  const decide = (id: string, decision: "approve" | "reject", note: string) =>
    adminRequest(`/admin/v1/approvals/${id}/decision`, approvalSchema, { method: "POST", body: { decision, note } }).then((a) => {
      void qc.invalidateQueries({ queryKey: ["admin"] });
      toast.success(a.status === "executed" ? "Approved and carried out" : a.status === "failed" ? "Approved, but it could not be carried out" : `Request ${a.status}`);
    });
  return (
    <div>
      <Header title="Approvals" sub="High-impact actions wait here until a second staff member decides. Approved requests are carried out once and recorded in the audit log." />
      <div className="mb-3 flex gap-1 text-xs" role="group" aria-label="Filter approvals">
        {(["pending", ""] as const).map((s) => <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s} className={`rounded-md px-2.5 py-1 ${status === s ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-700"}`}>{s ? "Waiting" : "All"}</button>)}
      </div>
      <CreditCorrectionForm />
      {q.isPending ? <LoadingBlock lines={3} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : q.data.approvals.length === 0 ? <p className="text-sm text-slate-500">{status ? "Nothing is waiting for a decision." : "No requests yet."}</p> : (
        <ul className="space-y-2">
          {q.data.approvals.map((a) => {
            const mine = a.requestedBy.id === me;
            const needsSuper = a.requiresSuperAdmin && role !== "super_admin";
            return (
              <li key={a.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-slate-900" style={{ fontWeight: 600 }}>{ACTION_LABEL[a.action]}</span>
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600">{a.status}</span>
                  {a.requiresSuperAdmin && <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] text-violet-800">Super Admin co-sign</span>}
                  <span className="ml-auto text-slate-500">expires {when(a.expiresAt)}</span>
                </div>
                <p className="mt-1 text-slate-700">{describe(a)}</p>
                <p className="mt-1 text-slate-600">Reason: {a.reason}</p>
                <p className="mt-1 text-slate-500">Requested by {a.requestedBy.name} · {when(a.createdAt)}{a.decidedBy ? ` · decided by ${a.decidedBy.name} ${when(a.decidedAt)}` : ""}{a.decisionNote ? ` · “${a.decisionNote}”` : ""}</p>
                {a.result && a.status !== "pending" && <p className="mt-1 text-slate-500">Result: {JSON.stringify(a.result)}</p>}
                {a.status === "pending" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {mine ? <span className="text-slate-500">Your request: another staff member must decide it.</span> : needsSuper ? <span className="text-slate-500">Only a Super Admin can decide this request.</span> : (
                      <>
                        <ReasonAction label="Approve" confirmLabel="Approve and carry out" onSubmit={(note) => decide(a.id, "approve", note)} />
                        <ReasonAction label="Reject" confirmLabel="Reject" destructive onSubmit={(note) => decide(a.id, "reject", note)} />
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Asks for a credit correction: a new adjustment grant after a second person approves it; history is never edited. */
function CreditCorrectionForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const [workspaceId, setWorkspaceId] = useState("");
  const [amount, setAmount] = useState(100);
  const [days, setDays] = useState(90);
  const valid = /^[0-9a-f-]{36}$/i.test(workspaceId.trim()) && amount >= 1 && amount <= 100_000 && days >= 1 && days <= 365;
  return (
    <details className="mb-4 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm">
      <summary className="cursor-pointer text-sm text-slate-900" style={{ fontWeight: 600 }}>Request a credit correction</summary>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-slate-600">Workspace id<input value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className="mt-0.5 block w-80 rounded-md border border-slate-200 px-2 py-1" /></label>
        <label className="text-slate-600">Credits<input type="number" min={1} max={100000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="mt-0.5 block w-24 rounded-md border border-slate-200 px-2 py-1" /></label>
        <label className="text-slate-600">Expire after (days)<input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-0.5 block w-24 rounded-md border border-slate-200 px-2 py-1" /></label>
        <ReasonAction label="Request" confirmLabel="Send for approval" disabled={!valid} disabledReason="Enter a workspace id, 1–100,000 credits and 1–365 days" onSubmit={async (reason) => {
          const body: ApprovalRequest = { action: "credits.grant", payload: { workspaceId: workspaceId.trim(), amount, expiresInDays: days }, reason };
          await adminRequest("/admin/v1/approvals", approvalSchema, { method: "POST", body });
          void qc.invalidateQueries({ queryKey: ["admin", "approvals"] });
          toast.success("Sent for approval", "Another staff member must approve it.");
        }} />
      </div>
      <p className="mt-2 text-slate-500">Only additions are possible: a correction is a new grant with its own expiry. Removing credits is not supported.</p>
    </details>
  );
}

/** Staff directory; a Super Admin adds staff (always as Support) and requests role changes or suspension. */
export function StaffDirectory({ me, role }: { me: string; role: AdminRole }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin", "staff"], queryFn: () => adminRequest("/admin/v1/staff", staffDirectorySchema) });
  const [created, setCreated] = useState<{ email: string; password: string; totpSecret: string } | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: (reason: string) => adminRequest("/admin/v1/staff", staffCreatedSchema, { method: "POST", body: { email: email.trim(), name: name.trim(), reason } }),
    onSuccess: (r) => {
      setCreated({ email: email.trim(), password: r.temporaryPassword, totpSecret: r.totpSecret });
      setEmail("");
      setName("");
      void qc.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
  });
  const request = async (body: ApprovalRequest) => {
    await adminRequest("/admin/v1/approvals", approvalSchema, { method: "POST", body });
    toast.success("Sent for approval", "A different Super Admin must approve it.");
    void qc.invalidateQueries({ queryKey: ["admin", "approvals"] });
  };
  const superAdmin = role === "super_admin";
  return (
    <div>
      <Header title="Staff" sub="Staff accounts and their access. Super Admin accounts are created and recovered only through the owner's bootstrap process, never from this console." />
      {q.isPending ? <LoadingBlock lines={4} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr>{["Name", "Email", "Role", "Status", "Keys", "Last sign-in", ""].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {q.data.staff.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2" style={{ fontWeight: 600 }}>{s.name}{s.id === me ? " (you)" : ""}</td>
                  <td className="px-3 py-2">{s.email}</td>
                  <td className="px-3 py-2">{s.role.replace("_", " ")}</td>
                  <td className="px-3 py-2">{s.status}</td>
                  <td className="px-3 py-2 tabular-nums">{s.keys}</td>
                  <td className="px-3 py-2 text-slate-500">{when(s.lastLoginAt)}</td>
                  <td className="px-3 py-2">
                    {superAdmin && s.id !== me && s.role !== "super_admin" && (
                      <div className="flex flex-wrap gap-1">
                        <ReasonAction label={s.role === "support" ? "Make admin" : "Make support"} confirmLabel="Send for approval" onSubmit={(reason) => request({ action: "staff.role.change", payload: { staffId: s.id, role: s.role === "support" ? "admin" : "support" }, reason })} />
                        <ReasonAction label={s.status === "suspended" ? "Reinstate" : "Suspend"} confirmLabel="Send for approval" destructive={s.status !== "suspended"} onSubmit={(reason) => request({ action: "staff.suspend", payload: { staffId: s.id, suspended: s.status !== "suspended" }, reason })} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {superAdmin && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm">
          <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Add a staff member</div>
          <p className="mt-1 text-slate-500">New staff start as Support. Hand the temporary password and authenticator key over in person or by another secure channel; they are shown once.</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-slate-600">Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="mt-0.5 block w-48 rounded-md border border-slate-200 px-2 py-1" /></label>
            <label className="text-slate-600">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} className="mt-0.5 block w-64 rounded-md border border-slate-200 px-2 py-1" /></label>
            <ReasonAction label="Add" confirmLabel="Create account" disabled={!name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())} disabledReason="Enter a name and a valid email" onSubmit={(reason) => create.mutateAsync(reason)} />
          </div>
          {created && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900" role="status">
              <div style={{ fontWeight: 600 }}>Account created for {created.email}. Copy these now; they will not be shown again.</div>
              <div className="mt-1 font-mono">Temporary password: {created.password}</div>
              <div className="font-mono">Authenticator key: {created.totpSecret}</div>
              <button onClick={() => setCreated(null)} className="mt-1 underline">I have handed these over</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
