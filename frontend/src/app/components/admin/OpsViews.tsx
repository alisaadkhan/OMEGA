import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { eligibilityCoverageSchema, providerUsageSchema, staffAuditListSchema, staffJobDetailSchema, staffJobListSchema, staffOverviewSchema, staffWorkspaceListSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { JobActions } from "./OpsControls";
import { WorkspaceActivity } from "./WorkspaceActivity";

/** Staff operations views (canonical spec pages 20–23): instrumented values only, never a default "healthy". */
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
export function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-slate-900">{title}</h1>
      <p className="mt-1 text-[13px] text-slate-500">{sub}</p>
    </div>
  );
}
const Table = ({ head, children }: { head: string[]; children: React.ReactNode }) => (
  <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white">
    <table className="w-full text-left text-xs">
      <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr>{head.map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100">{children}</tbody>
    </table>
  </div>
);
const errorBody = (e: unknown) => (e instanceof Error ? e.message : undefined);

export function OpsOverview() {
  const q = useQuery({ queryKey: ["admin", "overview"], queryFn: () => adminRequest("/admin/v1/ops/overview", staffOverviewSchema), refetchInterval: 30_000 });
  return (
    <div>
      <Header title="Operations overview" sub="Counts read from the database just now. Metrics that are not instrumented are not shown." />
      {q.isPending ? <LoadingBlock lines={4} /> : q.isError ? <ErrorState body={errorBody(q.error)} onRetry={() => void q.refetch()} /> : (
        <>
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {([["Accounts", q.data.workspaces], ["Active users", q.data.users], ["Open tickets", q.data.openTickets], ["Pending removals", q.data.pendingRemovals], ["Open jobs", q.data.openJobs], ["Stuck jobs (>30 min)", q.data.stuckJobs]] as const).map(([l, v]) => (
              <div key={l} className="rounded-2xl border border-slate-200/80 bg-white p-3"><dt className="text-[11px] text-slate-500">{l}</dt><dd className="mt-0.5 tabular-nums text-slate-900" style={{ fontSize: 22, fontWeight: 700 }}>{v}</dd></div>
            ))}
          </dl>
          <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white p-4 text-xs">
            <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Jobs started in the last 24 hours, by outcome</div>
            {Object.keys(q.data.jobs24h).length === 0 ? <p className="mt-2 text-slate-500">No jobs in the last 24 hours.</p> : (
              <dl className="mt-2 grid grid-cols-2 gap-y-1 sm:grid-cols-4">{Object.entries(q.data.jobs24h).map(([k, v]) => <div key={k}><dt className="inline text-slate-500">{k}: </dt><dd className="inline tabular-nums text-slate-900">{v}</dd></div>)}</dl>
            )}
          </div>
          <EligibilityCoverageCard />
          <p className="mt-4 text-[11px] text-slate-500">Backups and uptime are not instrumented in this console: check Supabase directly. Provider spend against caps is on the Providers tab.</p>
        </>
      )}
    </div>
  );
}

const REASONS: Record<string, string> = {
  below_follower_minimum: "Below 10,000 followers",
  followers_unknown: "Follower count unknown",
  followers_stale: "Count older than 90 days",
  inactive: "No post in 90 days",
  invalid_profile_url: "Not an own profile link",
  profile_not_found: "Profile not found (confirmed)",
  profile_private: "Profile private",
  no_profile: "No profile",
  minor_protected: "Protected (possible minor)",
  account_not_individual_creator: "Not an individual creator",
  creator_not_active: "Creator removed or merged",
  evidence_expired: "Count or post date expired since indexing",
};

/** How much of the catalogue customers can see under the creator minimum. Counts only, never creator data. */
export function EligibilityCoverageCard() {
  const q = useQuery({ queryKey: ["admin", "eligibility"], queryFn: () => adminRequest("/admin/v1/ops/eligibility", eligibilityCoverageSchema) });
  return (
    <section className="mt-4 rounded-2xl border border-slate-200/80 bg-white p-4 text-xs" aria-label="Creator eligibility coverage">
      <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Creators customers can see (10,000-follower minimum)</div>
      {q.isPending ? <LoadingBlock lines={2} /> : q.isError ? <ErrorState body={errorBody(q.error)} onRetry={() => void q.refetch()} /> : (
        <>
          <p className="mt-1 text-slate-600">
            <span className="tabular-nums text-slate-900" style={{ fontWeight: 700 }}>{q.data.eligible}</span> of <span className="tabular-nums">{q.data.total}</span> creators in the search catalogue qualify (policy {q.data.policy}).
            {" "}{q.data.activityUnverified > 0 && <>{q.data.activityUnverified} of them have no recorded post date yet (activity unverified).</>}
          </p>
          {q.data.byReason.length === 0 && q.data.eligible < q.data.total && (
            // Documents written before the eligibility rules carry no verdict until the worker re-indexes them.
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-amber-900" role="status">{q.data.total - q.data.eligible} creators have not been evaluated yet. The worker evaluates them when it next starts; until then they are hidden from customers.</p>
          )}
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Qualifying creators by platform</div>
              {q.data.byPlatform.length === 0 ? <p className="mt-1 text-slate-500">None.</p> : (
                <dl className="mt-1 space-y-0.5">{q.data.byPlatform.map((p) => <div key={p.platform} className="flex justify-between gap-2"><dt className="capitalize text-slate-600">{p.platform}</dt><dd className="tabular-nums text-slate-900">{p.eligibleCreators}</dd></div>)}</dl>
              )}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Why creators are hidden</div>
              {q.data.byReason.length === 0 ? <p className="mt-1 text-slate-500">None hidden.</p> : (
                <dl className="mt-1 space-y-0.5">{q.data.byReason.map((r) => <div key={r.reason} className="flex justify-between gap-2"><dt className="text-slate-600">{REASONS[r.reason] ?? r.reason}</dt><dd className="tabular-nums text-slate-900">{r.creators}</dd></div>)}</dl>
              )}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">As of {when(q.data.at)}. A creator can be hidden for more than one reason.</p>
        </>
      )}
    </section>
  );
}

export function OpsJobs({ canAct = false }: { canAct?: boolean }) {
  const [status, setStatus] = useState<"" | "open" | "failed" | "stuck">("");
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["admin", "jobs", status], queryFn: () => adminRequest(`/admin/v1/ops/jobs?limit=100${status ? `&status=${status}` : ""}`, staffJobListSchema) });
  const detail = useQuery({ queryKey: ["admin", "job", openId], queryFn: () => adminRequest(`/admin/v1/ops/jobs/${openId ?? ""}`, staffJobDetailSchema), enabled: openId !== null });
  return (
    <div>
      <Header title="Live Scans" sub="Discovery, add-by-link and refresh jobs across accounts. Opening a job's funnel is recorded in the audit log." />
      <div className="mb-3 flex gap-1 text-xs" role="group" aria-label="Filter jobs">
        {(["", "open", "failed", "stuck"] as const).map((s) => <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s} className={`tab ${status === s ? "tab-on" : ""}`}>{s || "All"}</button>)}
      </div>
      {q.isPending ? <LoadingBlock lines={5} /> : q.isError ? <ErrorState body={errorBody(q.error)} onRetry={() => void q.refetch()} /> : q.data.jobs.length === 0 ? <p className="text-sm text-slate-500">No jobs match.</p> : (
        <Table head={["Created", "Account", "Kind", "Status", "Brief / handle", "Found (new)", "Charged / max", "Error", "", ...(canAct ? ["Actions"] : [])]}>
          {q.data.jobs.map((j) => (
            <tr key={j.id} className={openId === j.id ? "bg-indigo-50/50" : ""}>
              <td className="px-3 py-2 text-slate-500">{when(j.createdAt)}</td>
              <td className="px-3 py-2">{j.workspaceName}</td>
              <td className="px-3 py-2">{j.kind}</td>
              <td className="px-3 py-2">{j.status}{j.outcome ? ` · ${j.outcome}` : ""}{j.step && j.status === "running" ? ` · ${j.step}` : ""}{j.cancelRequested ? " · stop requested" : ""}</td>
              <td className="max-w-[16rem] truncate px-3 py-2">{j.brief ?? (j.handle ? `@${j.handle}` : "—")}</td>
              <td className="px-3 py-2 tabular-nums">{j.found} ({j.new})</td>
              <td className="px-3 py-2 tabular-nums">{j.creditsCharged} / {j.maxCost}</td>
              <td className="max-w-[14rem] truncate px-3 py-2 text-red-700" title={j.errorMessage ?? ""}>{j.errorCode ?? ""}</td>
              <td className="px-3 py-2"><button onClick={() => setOpenId(openId === j.id ? null : j.id)} className="text-indigo-600 hover:underline">{openId === j.id ? "Hide" : "Funnel"}</button></td>
              {canAct && <td className="px-3 py-2"><JobActions id={j.id} kind={j.kind} status={j.status} cancelRequested={j.cancelRequested} createdAt={j.createdAt} /></td>}
            </tr>
          ))}
        </Table>
      )}
      {openId && (
        <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white p-4 text-xs">
          {detail.isPending ? <LoadingBlock lines={3} /> : detail.isError ? <ErrorState body={errorBody(detail.error)} /> : (
            <div className="grid gap-4 lg:grid-cols-3">
              <div><div className="mb-1 text-slate-900" style={{ fontWeight: 600 }}>Funnel</div><dl>{Object.entries(detail.data.progress).map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-slate-500">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}</dl></div>
              <div><div className="mb-1 text-slate-900" style={{ fontWeight: 600 }}>Candidate decisions</div>{detail.data.decisions.length === 0 ? <p className="text-slate-500">None recorded.</p> : <ul>{detail.data.decisions.map((d) => <li key={`${d.stage}${d.decision}${d.reason}`} className="flex justify-between gap-2"><span className="text-slate-600">{d.stage} · {d.decision}{d.reason ? ` · ${d.reason}` : ""}</span><span className="tabular-nums">{d.count}</span></li>)}</ul>}</div>
              <div><div className="mb-1 text-slate-900" style={{ fontWeight: 600 }}>Provider calls</div>{detail.data.providerCalls.length === 0 ? <p className="text-slate-500">None recorded.</p> : <ul>{detail.data.providerCalls.map((c) => <li key={`${c.provider}${c.operation}${c.model}${c.status}${c.errorCode}`} className="flex justify-between gap-2"><span className="text-slate-600">{c.provider} {c.operation}{c.model ? ` (${c.model})` : ""} · {c.status}{c.errorCode ? ` (${c.errorCode})` : ""}{c.tokensIn + c.tokensOut > 0 ? ` · ${c.tokensIn}/${c.tokensOut} tokens` : ""}</span><span className="tabular-nums">{c.calls} · ${c.costUsd.toFixed(4)}</span></li>)}</ul>}<p className="mt-1 tabular-nums text-slate-600">Direct cost ${detail.data.cost.totalUsd.toFixed(4)} · {detail.data.cost.newCreators} new creator(s){detail.data.cost.costPerNewCreatorUsd !== null ? ` · ${detail.data.cost.costPerNewCreatorUsd.toFixed(4)} each` : ""} · {detail.data.cost.creditsCharged} credits charged · {detail.data.cost.attempts} attempt(s)</p></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function OpsWorkspaces() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [activityOf, setActivityOf] = useState<{ id: string; name: string } | null>(null);
  const r = useQuery({ queryKey: ["admin", "workspaces", query], queryFn: () => adminRequest(`/admin/v1/ops/workspaces?q=${encodeURIComponent(query)}`, staffWorkspaceListSchema) });
  return (
    <div>
      <Header title="Accounts" sub="Look up an account by name, owner email or id, and open its activity (admins). Emails are masked; searches and activity views are recorded in the audit log." />
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={120} placeholder="Name, email or account id" aria-label="Search accounts" className="w-80 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm" />
        <button type="submit" className="btn btn-primary btn-sm">Search</button>
      </form>
      {r.isPending ? <LoadingBlock lines={4} /> : r.isError ? <ErrorState body={errorBody(r.error)} onRetry={() => void r.refetch()} /> : r.data.workspaces.length === 0 ? <p className="text-sm text-slate-500">No accounts match.</p> : (
        <Table head={["Account", "Owner", "Members", "Subscription", "Jobs (30 days)", "Open tickets", "Created", ""]}>
          {r.data.workspaces.map((w) => (
            <tr key={w.id}><td className="px-3 py-2"><div style={{ fontWeight: 600 }}>{w.name}</div><div className="text-[10px] text-slate-500">{w.id}</div></td><td className="px-3 py-2">{w.ownerEmail}</td><td className="px-3 py-2 tabular-nums">{w.members}</td><td className="px-3 py-2">{w.subscriptionStatus ?? "none"}</td><td className="px-3 py-2 tabular-nums">{w.jobs30d}</td><td className="px-3 py-2 tabular-nums">{w.openTickets}</td><td className="px-3 py-2 text-slate-500">{when(w.createdAt)}</td><td className="px-3 py-2"><button onClick={() => setActivityOf({ id: w.id, name: w.name })} className="btn btn-outline btn-sm" aria-label={`Activity of ${w.name}`}>Activity</button></td></tr>
          ))}
        </Table>
      )}
      {activityOf && <WorkspaceActivity key={activityOf.id} workspace={activityOf} onClose={() => setActivityOf(null)} />}
    </div>
  );
}

export function OpsProviders() {
  const [hours, setHours] = useState(24);
  const q = useQuery({ queryKey: ["admin", "providers", hours], queryFn: () => adminRequest(`/admin/v1/ops/providers?hours=${hours}`, providerUsageSchema) });
  return (
    <div>
      <Header title="Data Sources" sub="Calls MUSHIN recorded to each external provider, and spend against each cap as the worker last checked it. A provider that does not report its balance shows Not reported." />
      <div className="mb-3 flex gap-1 text-xs" role="group" aria-label="Window">{[24, 168, 720].map((h) => <button key={h} onClick={() => setHours(h)} aria-pressed={hours === h} className={`tab ${hours === h ? "tab-on" : ""}`}>{h === 24 ? "24 hours" : h === 168 ? "7 days" : "30 days"}</button>)}</div>
      {q.isPending ? <LoadingBlock lines={4} /> : q.isError ? <ErrorState body={errorBody(q.error)} onRetry={() => void q.refetch()} /> : q.data.providers.length === 0 ? <p className="text-sm text-slate-500">No provider calls recorded in this window. That says nothing about the provider's health.</p> : (
        <Table head={["Provider", "Calls", "Errors", "Error rate", "p95 latency", "Recorded cost (USD)", "Last call", "Last error"]}>
          {q.data.providers.map((p) => (
            <tr key={p.provider}><td className="px-3 py-2" style={{ fontWeight: 600 }}>{p.provider}</td><td className="px-3 py-2 tabular-nums">{p.calls}</td><td className="px-3 py-2 tabular-nums">{p.errors}</td><td className="px-3 py-2 tabular-nums">{p.calls ? `${Math.round((p.errors / p.calls) * 100)}%` : "—"}</td><td className="px-3 py-2 tabular-nums">{p.p95LatencyMs === null ? "—" : `${p.p95LatencyMs} ms`}</td><td className="px-3 py-2 tabular-nums">{p.costUsd.toFixed(4)}</td><td className="px-3 py-2 text-slate-500">{when(p.lastCallAt)}</td><td className="px-3 py-2 text-red-700">{p.lastErrorCode ?? ""}</td></tr>
          ))}
        </Table>
      )}
      {q.data && q.data.status.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-sm text-slate-900" style={{ fontWeight: 600 }}>Status and spend against caps</div>
          <Table head={["Provider", "Configured", "Used / cap", "Source", "Checked", "Check error"]}>
            {q.data.status.map((s) => {
              const pct = s.quota && s.quota.limit > 0 ? Math.min(100, Math.round((s.quota.used / s.quota.limit) * 100)) : null;
              const fmt = (n: number) => (s.quota?.unit === "usd" ? `$${n.toFixed(2)}` : n.toLocaleString("en-US"));
              return (
                <tr key={s.provider}>
                  <td className="px-3 py-2" style={{ fontWeight: 600 }}>{s.provider}</td>
                  <td className="px-3 py-2">{s.configured ? "Yes" : "No"}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {s.quota ? (
                      <span className={pct !== null && pct >= 90 ? "text-rose-700" : pct !== null && pct >= 75 ? "text-amber-800" : ""}>
                        {fmt(s.quota.used)} / {fmt(s.quota.limit)}{pct !== null ? ` (${pct}%)` : ""}
                      </span>
                    ) : (
                      <span className="text-slate-500">Not reported</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{s.quota?.source ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{when(s.checkedAt)}</td>
                  <td className="px-3 py-2 text-slate-600">{s.checkError ?? "—"}</td>
                </tr>
              );
            })}
          </Table>
        </div>
      )}
    </div>
  );
}

export function OpsAudit() {
  const q = useQuery({ queryKey: ["admin", "audit"], queryFn: () => adminRequest("/admin/v1/audit?limit=200", staffAuditListSchema) });
  return (
    <div>
      <Header title="Audit log" sub="Staff sign-ins and actions, newest first. The history is append-only and cannot be edited here." />
      {q.isPending ? <LoadingBlock lines={5} /> : q.isError ? <ErrorState body={errorBody(q.error)} onRetry={() => void q.refetch()} /> : q.data.events.length === 0 ? <p className="text-sm text-slate-500">No staff activity recorded yet.</p> : (
        <Table head={["When", "Staff", "Action", "Details", "IP"]}>
          {q.data.events.map((e) => (
            <tr key={e.id}><td className="px-3 py-2 text-slate-500">{when(e.createdAt)}</td><td className="px-3 py-2">{e.staffName ?? "—"}{e.staffRole ? ` (${e.staffRole})` : ""}</td><td className="px-3 py-2" style={{ fontWeight: 600 }}>{e.action}</td><td className="max-w-[24rem] truncate px-3 py-2 text-slate-600" title={JSON.stringify(e.metadata)}>{JSON.stringify(e.metadata)}</td><td className="px-3 py-2 text-slate-500">{e.ip ?? ""}</td></tr>
          ))}
        </Table>
      )}
    </div>
  );
}
