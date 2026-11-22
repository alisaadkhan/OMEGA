import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, LifeBuoy, Trash2 } from "lucide-react";
import { staffAlertsSchema, staffJobListSchema, staffOverviewSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { OpsAlerts } from "../admin/OpsControls";
import { EligibilityCoverageCard } from "../admin/OpsViews";
import { Badge, Card, CardTitle, DataTable, Empty, Kpi, PageHeader, errText, fmtAgo, fmtNum } from "./kit";

/** Overview (owner design, 22 Nov): only measured values. Spend is in USD, the currency providers bill in. */
function Budgets() {
  const q = useQuery({ queryKey: ["admin", "alerts"], queryFn: () => adminRequest("/admin/v1/ops/alerts", staffAlertsSchema), refetchInterval: 60_000 });
  if (q.isPending) return <LoadingBlock lines={2} />;
  if (q.isError) return <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} />;
  const rows = q.data.providerStatus.filter((p) => p.quotaUsed !== null && p.quotaLimit !== null && p.quotaLimit > 0);
  const spend = Object.entries(q.data.monthSpendUsd);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Provider budgets and spend this month</h2>
        <span className="text-xs text-slate-500">{spend.length ? `Recorded: ${spend.map(([k, v]) => `${k} $${v.toFixed(2)}`).join(" · ")}` : "No spend recorded this month"}</span>
      </div>
      {rows.length === 0 ? (
        <Empty title="No provider reports a usage cap yet" body="Caps appear here once the worker reads them from the provider." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {rows.map((p) => {
            const used = p.quotaUsed ?? 0;
            const limit = p.quotaLimit ?? 1;
            const pct = Math.min(100, Math.round((used / limit) * 100));
            const tone = pct >= 85 ? "rose" : pct >= 60 ? "amber" : "emerald";
            const fmt = (n: number) => (p.quotaUnit === "usd" ? `$${n.toFixed(2)}` : fmtNum(n));
            return (
              <Card key={p.provider} className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div><h3 className="text-sm font-semibold capitalize text-slate-900">{p.provider}</h3><p className="mt-0.5 text-xs text-slate-500">{p.configured ? "Configured" : "Not configured"} · checked {fmtAgo(new Date(Date.now() - p.checkedSecondsAgo * 1000).toISOString())}</p></div>
                  <Badge tone={tone}>{pct >= 85 ? "Critical" : pct >= 60 ? "Warning" : "Healthy"} ({pct}%)</Badge>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs tabular-nums text-slate-600"><span>{fmt(used)} / {fmt(limit)}</span>{p.checkError && <span className="text-rose-700">{p.checkError}</span>}</div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${tone === "rose" ? "bg-rose-500" : tone === "amber" ? "bg-amber-500" : "bg-cyan-500"}`} style={{ width: `${pct}%` }} /></div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecentJobs() {
  const q = useQuery({ queryKey: ["admin", "jobs", "recent"], queryFn: () => adminRequest("/admin/v1/ops/jobs?limit=8", staffJobListSchema), refetchInterval: 30_000 });
  return (
    <Card>
      <CardTitle title="Latest customer jobs" sub="Discovery, add-by-link and refresh jobs, newest first" />
      {q.isPending ? <LoadingBlock lines={4} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : q.data.jobs.length === 0 ? <Empty title="No jobs yet" /> : (
        <DataTable head={["When", "Account", "Job", "Brief / handle"]}>
          {q.data.jobs.map((j) => (
            <tr key={j.id} className="hover:bg-slate-50/70">
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-slate-400">{fmtAgo(j.createdAt)}</td>
              <td className="px-4 py-2.5 font-medium text-slate-900">{j.workspaceName}</td>
              <td className="px-4 py-2.5"><Badge tone={j.status === "failed" ? "rose" : j.status === "running" || j.status === "queued" ? "cyan" : "emerald"}>{j.kind} · {j.status}</Badge></td>
              <td className="max-w-[220px] truncate px-4 py-2.5 text-slate-500">{j.brief ?? (j.handle ? `@${j.handle}` : "—")}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  );
}

export function OverviewPage({ canTest }: { canTest: boolean }) {
  const o = useQuery({ queryKey: ["admin", "overview"], queryFn: () => adminRequest("/admin/v1/ops/overview", staffOverviewSchema), refetchInterval: 30_000 });
  const a = useQuery({ queryKey: ["admin", "alerts"], queryFn: () => adminRequest("/admin/v1/ops/alerts", staffAlertsSchema), refetchInterval: 60_000 });
  const jobs24 = o.data ? Object.entries(o.data.jobs24h) : [];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Operations" title="Overview" sub="Counts read from the database just now. Anything the console does not measure is not shown." />
      {o.isPending ? <LoadingBlock lines={3} /> : o.isError ? <ErrorState body={errText(o.error)} onRetry={() => void o.refetch()} /> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Open tickets" value={fmtNum(o.data.openTickets)} icon={<LifeBuoy className="h-4 w-4" />} hint={`${fmtNum(o.data.workspaces)} accounts · ${fmtNum(o.data.users)} users`} />
          <Kpi label="Data removal requests" value={fmtNum(o.data.pendingRemovals)} tone="rose" icon={<Trash2 className="h-4 w-4" />} hint={a.data?.oldestRemovalDays != null ? `Oldest ${a.data.oldestRemovalDays} days` : "None waiting"} />
          <Kpi label="Open discovery jobs" value={fmtNum(o.data.openJobs)} tone="cyan" icon={<Activity className="h-4 w-4" />} hint={`${fmtNum(o.data.stuckJobs)} stuck over 30 min`} />
          <Kpi label="Approvals waiting" value={a.data ? fmtNum(a.data.pendingApprovals) : "—"} tone="indigo" icon={<CheckCircle2 className="h-4 w-4" />} hint="Two-person sign-off" />
        </div>
      )}
      <Budgets />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-6">
          <Card>
            <CardTitle title="Jobs in the last 24 hours, by outcome" />
            {jobs24.length === 0 ? <p className="text-xs text-slate-500">No jobs in the last 24 hours.</p> : (
              <div className="space-y-3">
                {jobs24.map(([k, v]) => {
                  const total = jobs24.reduce((s, [, n]) => s + n, 0) || 1;
                  return (
                    <div key={k} className="space-y-1.5">
                      <div className="flex justify-between text-xs tabular-nums"><span className="font-medium text-slate-800">{k}</span><strong className="text-slate-900">{fmtNum(v)}</strong></div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-900" style={{ width: `${Math.round((v / total) * 100)}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          <OpsAlerts canTest={canTest} />
        </div>
        <div className="lg:col-span-6"><RecentJobs /></div>
      </div>
      <EligibilityCoverageCard />
    </div>
  );
}
