import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { jobActionResultSchema, providerControlListSchema, staffAlertsSchema, staffAuditListSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { Header } from "./OpsViews";
import { ReasonAction, errText } from "./staff-ui";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");

/** Thresholds crossed now, with the measured values; an empty list says only that no threshold is crossed. */
export function OpsAlerts() {
  const q = useQuery({ queryKey: ["admin", "alerts"], queryFn: () => adminRequest("/admin/v1/ops/alerts", staffAlertsSchema), refetchInterval: 30_000 });
  if (q.isPending) return <LoadingBlock lines={2} />;
  if (q.isError) return <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} />;
  const a = q.data;
  return (
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-sm" aria-label="Alerts">
      <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Alerts</div>
      {a.alerts.length === 0 ? <p className="mt-1 text-slate-500">No alert threshold is crossed right now. This covers only what is measured below.</p> : (
        <ul className="mt-2 space-y-1">
          {a.alerts.map((x) => <li key={x.key} className={`rounded-md px-2 py-1 ${x.severity === "critical" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}><span style={{ fontWeight: 600 }}>{x.severity === "critical" ? "Critical" : "Warning"}:</span> {x.message}</li>)}
        </ul>
      )}
      <dl className="mt-3 grid gap-x-4 gap-y-1 text-slate-600 sm:grid-cols-3">
        <div><dt className="inline">Background work waiting: </dt><dd className="inline tabular-nums">{a.outboxPending}{a.outboxOldestSeconds !== null ? ` (oldest ${a.outboxOldestSeconds} s)` : ""}</dd></div>
        <div><dt className="inline">Stuck jobs: </dt><dd className="inline tabular-nums">{a.stuckJobs}</dd></div>
        <div><dt className="inline">Failed jobs (1 h): </dt><dd className="inline tabular-nums">{a.failedJobs1h}</dd></div>
        <div><dt className="inline">Approvals waiting: </dt><dd className="inline tabular-nums">{a.pendingApprovals}</dd></div>
        <div><dt className="inline">Removal requests open: </dt><dd className="inline tabular-nums">{a.pendingRemovals}{a.oldestRemovalDays !== null ? ` (oldest ${a.oldestRemovalDays} days)` : ""}</dd></div>
        <div><dt className="inline">Paused providers: </dt><dd className="inline">{a.pausedProviders.length ? a.pausedProviders.join(", ") : "none"}</dd></div>
        <div className="sm:col-span-3"><dt className="inline">Recorded spend this month (USD): </dt><dd className="inline tabular-nums">{Object.keys(a.monthSpendUsd).length ? Object.entries(a.monthSpendUsd).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(" · ") : "none recorded"}</dd></div>
      </dl>
    </section>
  );
}

/** Pause or resume a provider family. While paused, the worker refuses its calls and affected jobs refund. */
export function ProviderControls() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin", "provider-controls"], queryFn: () => adminRequest("/admin/v1/ops/provider-controls", providerControlListSchema) });
  const set = async (provider: string, paused: boolean, reason: string) => {
    await adminRequest(`/admin/v1/ops/provider-controls/${provider}`, providerControlListSchema, { method: "PUT", body: { paused, reason } });
    void qc.invalidateQueries({ queryKey: ["admin"] });
    toast.success(paused ? `${provider} paused` : `${provider} resumed`);
  };
  return (
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-sm" aria-label="Provider controls">
      <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Provider controls</div>
      <p className="mt-0.5 text-slate-500">A paused provider takes no new calls; runs that need it fail and return their credits. Budgets and quotas are deployment settings and are not changed here.</p>
      {q.isPending ? <LoadingBlock lines={2} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : (
        <ul className="mt-2 divide-y divide-slate-100">
          {q.data.providers.map((p) => (
            <li key={p.provider} className="flex flex-wrap items-center gap-2 py-2">
              <span className="w-20 text-slate-900" style={{ fontWeight: 600 }}>{p.provider}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${p.paused ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{p.paused ? "paused" : "running"}</span>
              <span className="flex-1 text-slate-500">{p.changedBy ? `${p.paused ? "Paused" : "Resumed"} by ${p.changedBy}, ${when(p.changedAt)}${p.reason ? `: ${p.reason}` : ""}` : "Never changed"}</span>
              {p.controllable ? <ReasonAction label={p.paused ? "Resume" : "Pause"} confirmLabel={p.paused ? "Resume" : "Pause provider"} destructive={!p.paused} onSubmit={(reason) => set(p.provider, !p.paused, reason)} /> : <span className="text-slate-400">Not pausable from the console</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Admin actions on one job row: stop a live run, or re-dispatch a stuck job (credits are never touched). */
export function JobActions({ id, kind, status, cancelRequested, createdAt }: { id: string; kind: string; status: string; cancelRequested: boolean; createdAt: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const open = status === "queued" || status === "running";
  if (!open) return null;
  const stuck = Date.now() - Date.parse(createdAt) > 10 * 60_000;
  const act = async (action: "cancel" | "retry", reason: string) => {
    const r = await adminRequest(`/admin/v1/ops/jobs/${id}/${action}`, jobActionResultSchema, { method: "POST", body: { reason } });
    void qc.invalidateQueries({ queryKey: ["admin", "jobs"] });
    toast.success(r.status === "requeued" ? "Job re-dispatched" : r.status === "already_requested" ? "A stop was already requested" : "Stop requested");
  };
  return (
    <div className="flex flex-wrap gap-1">
      {kind === "live" && !cancelRequested && <ReasonAction label="Stop run" confirmLabel="Stop run" destructive onSubmit={(r) => act("cancel", r)} />}
      {!cancelRequested && <ReasonAction label="Retry" confirmLabel="Re-dispatch" disabled={!stuck} disabledReason="Only a job queued or running for more than 10 minutes can be retried" onSubmit={(r) => act("retry", r)} />}
    </div>
  );
}

/** The audit history with filters (action prefix, staff, workspace) and older pages. */
export function AuditSearch() {
  const [action, setAction] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [filters, setFilters] = useState<{ action: string; workspaceId: string }>({ action: "", workspaceId: "" });
  const [before, setBefore] = useState<string | null>(null);
  const params = new URLSearchParams({ limit: "100" });
  if (filters.action) params.set("action", filters.action);
  if (filters.workspaceId) params.set("workspaceId", filters.workspaceId);
  if (before) params.set("before", before);
  const q = useQuery({ queryKey: ["admin", "audit-search", params.toString()], queryFn: () => adminRequest(`/admin/v1/audit/search?${params.toString()}`, staffAuditListSchema) });
  return (
    <div>
      <Header title="Audit log" sub="Staff sign-ins and actions, newest first. The history is append-only; nothing here can edit it." />
      <form className="mb-3 flex flex-wrap items-end gap-2 text-xs" onSubmit={(e) => { e.preventDefault(); setBefore(null); setFilters({ action: action.trim(), workspaceId: /^[0-9a-f-]{36}$/i.test(workspaceId.trim()) ? workspaceId.trim() : "" }); }}>
        <label className="text-slate-600">Action starts with<input value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. approvals. or support.access" maxLength={80} className="mt-0.5 block w-64 rounded-md border border-slate-200 px-2 py-1" /></label>
        <label className="text-slate-600">Workspace id<input value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className="mt-0.5 block w-80 rounded-md border border-slate-200 px-2 py-1" /></label>
        <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-white">Filter</button>
      </form>
      {q.isPending ? <LoadingBlock lines={5} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : q.data.events.length === 0 ? <p className="text-sm text-slate-500">No events match.</p> : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr>{["When", "Staff", "Action", "Workspace", "Details", "IP"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.events.map((e) => (
                  <tr key={e.id}><td className="px-3 py-2 text-slate-500">{when(e.createdAt)}</td><td className="px-3 py-2">{e.staffName ?? "—"}{e.staffRole ? ` (${e.staffRole})` : ""}</td><td className="px-3 py-2" style={{ fontWeight: 600 }}>{e.action}</td><td className="px-3 py-2 text-slate-500">{e.workspaceId ? `${e.workspaceId.slice(0, 8)}…` : ""}</td><td className="max-w-[24rem] truncate px-3 py-2 text-slate-600" title={JSON.stringify(e.metadata)}>{JSON.stringify(e.metadata)}</td><td className="px-3 py-2 text-slate-500">{e.ip ?? ""}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.data.events.length === 100 && <button onClick={() => setBefore(q.data.events.at(-1)?.createdAt ?? null)} className="mt-2 text-xs text-indigo-700 hover:underline">Older events</button>}
        </>
      )}
    </div>
  );
}
