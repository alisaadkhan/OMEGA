import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { supportAccessListSchema, supportAccessSchema, supportAccessViewSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { Header } from "./OpsViews";
import { errText } from "./staff-ui";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
const STATUS: Record<string, string> = { requested: "Waiting for the customer", granted: "Granted", declined: "Declined", ended: "Ended", expired: "Expired" };

/**
 * Consented, read-only support access (DOC-029). You ask with a purpose; the workspace owner or an admin decides; a
 * grant lasts at most 60 minutes. The view is read-only and leaves out balances, contacts and notes; every view is
 * recorded in the audit log with the workspace.
 */
export function SupportAccessStaff({ initialWorkspaceId }: { initialWorkspaceId?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId ?? "");
  const [purpose, setPurpose] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["admin", "access"], queryFn: () => adminRequest("/admin/v1/access-requests", supportAccessListSchema), refetchInterval: 20_000 });
  const ask = useMutation({
    mutationFn: () => adminRequest("/admin/v1/access-requests", supportAccessSchema, { method: "POST", body: { workspaceId: workspaceId.trim(), purpose: purpose.trim() } }),
    onSuccess: () => { setPurpose(""); toast.success("Access requested", "The workspace owner sees your request and purpose."); void qc.invalidateQueries({ queryKey: ["admin", "access"] }); },
    onError: (err) => toast.error("Access not requested", errText(err)),
  });
  if (viewing) return <AccessView id={viewing} onClose={() => { setViewing(null); void qc.invalidateQueries({ queryKey: ["admin", "access"] }); }} />;
  return (
    <div>
      <Header title="Workspace access" sub="Read-only access to a customer's workspace, only with their consent, for at most 60 minutes. You cannot change, buy, export or send anything during it." />
      <form className="mb-4 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm" onSubmit={(e) => { e.preventDefault(); ask.mutate(); }}>
        <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Ask for access</div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-slate-600">Workspace id<input value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className="mt-0.5 block w-80 rounded-md border border-slate-200 px-2 py-1" /></label>
          <label className="flex-1 text-slate-600">Purpose (shown to the customer)<input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={500} placeholder="e.g. Check why your list shows no creators (ticket from 14 Oct)" className="mt-0.5 block w-full rounded-md border border-slate-200 px-2 py-1" /></label>
          <button type="submit" disabled={ask.isPending || purpose.trim().length < 12 || !/^[0-9a-f-]{36}$/i.test(workspaceId.trim())} className="rounded-md bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50" style={{ fontWeight: 600 }}>Ask for access</button>
        </div>
      </form>
      {q.isPending ? <LoadingBlock lines={3} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : q.data.requests.length === 0 ? <p className="text-sm text-slate-500">You have not asked for access to any workspace.</p> : (
        <ul className="space-y-2">
          {q.data.requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
              <div className="flex-1"><div className="text-slate-900" style={{ fontWeight: 600 }}>Workspace {r.workspaceId.slice(0, 8)}… · {STATUS[r.status] ?? r.status}</div><div className="text-slate-500">{r.purpose} · asked {when(r.createdAt)}{r.expiresAt ? ` · until ${when(r.expiresAt)}` : ""}</div></div>
              {r.status === "granted" && <button onClick={() => setViewing(r.id)} className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-white"><Eye className="h-3 w-3" />Open read-only view</button>}
              {(r.status === "requested" || r.status === "granted") && <button onClick={() => void adminRequest(`/admin/v1/access-requests/${r.id}/end`, supportAccessSchema, { method: "POST" }).then(() => qc.invalidateQueries({ queryKey: ["admin", "access"] }))} className="rounded-md border border-slate-200 px-2.5 py-1">{r.status === "requested" ? "Withdraw" : "End access"}</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccessView({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["admin", "access-view", id], queryFn: () => adminRequest(`/admin/v1/access-requests/${id}/view`, supportAccessViewSchema), retry: false });
  const end = async () => {
    await adminRequest(`/admin/v1/access-requests/${id}/end`, supportAccessSchema, { method: "POST" });
    onClose();
  };
  return (
    <div>
      <div className="sticky top-0 z-10 -mx-6 -mt-6 mb-4 flex flex-wrap items-center gap-2 bg-violet-700 px-6 py-2.5 text-xs text-white" role="status">
        <Eye className="h-4 w-4" />
        <span style={{ fontWeight: 600 }}>Read-only support access{q.data ? ` to ${q.data.workspace.name}` : ""}</span>
        {q.data?.access.expiresAt && <span>· ends {when(q.data.access.expiresAt)}</span>}
        <span className="opacity-80">· this view is recorded in the audit log</span>
        <button onClick={() => void end()} className="ml-auto rounded-md bg-white/15 px-2.5 py-1 hover:bg-white/25" style={{ fontWeight: 600 }}>End access</button>
        <button onClick={onClose} className="rounded-md px-2 py-1 underline">Back</button>
      </div>
      {q.isPending ? <LoadingBlock lines={5} /> : q.isError ? <ErrorState title="Access is not available" body={errText(q.error)} /> : (
        <div className="grid gap-4 text-xs lg:grid-cols-2">
          <Block title="Workspace">
            <dl className="space-y-1">
              <Row k="Name" v={q.data.workspace.name} /><Row k="Created" v={when(q.data.workspace.createdAt)} /><Row k="Members" v={String(q.data.workspace.members)} />
              <Row k="Subscription" v={q.data.workspace.subscriptionStatus ?? "none"} /><Row k="Plan" v={q.data.workspace.planId ?? "—"} />
            </dl>
          </Block>
          <Block title={`Recent jobs (${q.data.jobs.length})`}>{q.data.jobs.length === 0 ? <p className="text-slate-500">None.</p> : <ul className="space-y-1">{q.data.jobs.map((j) => <li key={j.id} className="flex justify-between gap-2"><span>{j.kind} · {j.status}{j.outcome ? ` · ${j.outcome}` : ""}{j.errorCode ? ` · ${j.errorCode}` : ""}</span><span className="text-slate-500">{when(j.createdAt)}</span></li>)}</ul>}</Block>
          <Block title={`Lists (${q.data.lists.length})`}>{q.data.lists.length === 0 ? <p className="text-slate-500">None.</p> : <ul className="space-y-1">{q.data.lists.map((l) => <li key={l.id} className="flex justify-between gap-2"><span>{l.name}</span><span className="tabular-nums text-slate-500">{l.creators} creators</span></li>)}</ul>}</Block>
          <Block title={`Campaigns (${q.data.campaigns.length})`}>{q.data.campaigns.length === 0 ? <p className="text-slate-500">None.</p> : <ul className="space-y-1">{q.data.campaigns.map((c) => <li key={c.id} className="flex justify-between gap-2"><span>{c.name} · {c.status}</span><span className="tabular-nums text-slate-500">{c.creators} creators</span></li>)}</ul>}</Block>
          <Block title={`Support tickets (${q.data.tickets.length})`}>{q.data.tickets.length === 0 ? <p className="text-slate-500">None.</p> : <ul className="space-y-1">{q.data.tickets.map((t) => <li key={t.id} className="flex justify-between gap-2"><span>{t.subject} · {t.status}</span><span className="text-slate-500">{when(t.lastMessageAt)}</span></li>)}</ul>}</Block>
          <p className="text-slate-500 lg:col-span-2">Credit balances, budgets, fees, contact details and notes are not part of support access.</p>
        </div>
      )}
    </div>
  );
}

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="mb-1.5 text-sm text-slate-900" style={{ fontWeight: 600 }}>{title}</div>{children}</section>
);
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-2"><dt className="text-slate-500">{k}</dt><dd className="text-slate-900">{v}</dd></div>;
