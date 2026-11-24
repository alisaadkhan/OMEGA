import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Lock, MessageSquare, ShieldX } from "lucide-react";
import { eligibilityCoverageSchema, staffAlertsSchema, staffFeatureUsageSchema, staffJobListSchema, staffOverviewSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { OpsAlerts } from "../admin/OpsControls";
import { Card, Empty, errText, fmtAgo, fmtNum } from "./kit";

/**
 * Overview (owner design, 23 Nov): four counters, provider budgets, feature use, the live job stream and the catalogue
 * qualification audit. Every figure is read from the database or the providers just now; nothing is simulated, and a
 * figure the console does not measure is left out rather than estimated. Spend is in USD, the currency providers bill in.
 */

type Accent = "slate" | "rose" | "amber" | "cyan" | "indigo" | "emerald";
const ICON_BG: Record<Accent, string> = {
  slate: "bg-slate-100 text-slate-600",
  rose: "bg-rose-50 text-rose-600",
  amber: "bg-amber-50 text-amber-600",
  cyan: "bg-cyan-50 text-[#00687a]",
  indigo: "bg-indigo-50 text-indigo-600",
  emerald: "bg-emerald-50 text-emerald-600",
};
// 700 shades: the 600s fail WCAG AA contrast for small text on white (found by the staff e2e a11y check, 24 Nov).
const TEXT: Record<Accent, string> = { slate: "text-slate-600", rose: "text-rose-700", amber: "text-amber-700", cyan: "text-[#00687a]", indigo: "text-indigo-700", emerald: "text-emerald-700" };
const BAR: Record<Accent, string> = { slate: "bg-[#0f172a]", rose: "bg-rose-500", amber: "bg-amber-500", cyan: "bg-[#06B6D4]", indigo: "bg-indigo-500", emerald: "bg-emerald-500" };
const go = (view: string) => () => { window.location.hash = `#/${view}`; };

function Counter({ label, value, note, accent, icon, onOpen }: { label: string; value: string; note: string; accent: Accent; icon: ReactNode; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-[0_10px_24px_-14px_rgba(6,182,212,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${ICON_BG[accent]}`}>{icon}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-2.5">
        <span className="text-3xl font-extrabold leading-none text-[#0f172a] tabular-nums">{value}</span>
        <span className={`text-[12px] font-bold tabular-nums ${TEXT[accent]}`}>{note}</span>
      </div>
    </button>
  );
}

function Counters() {
  const o = useQuery({ queryKey: ["admin", "overview"], queryFn: () => adminRequest("/admin/v1/ops/overview", staffOverviewSchema), refetchInterval: 30_000 });
  const a = useQuery({ queryKey: ["admin", "alerts"], queryFn: () => adminRequest("/admin/v1/ops/alerts", staffAlertsSchema), refetchInterval: 60_000 });
  if (o.isPending) return <LoadingBlock lines={2} />;
  if (o.isError) return <ErrorState body={errText(o.error)} onRetry={() => void o.refetch()} />;
  const d = o.data;
  // Data removal requests are answered within 30 days (privacy policy); the counter shows the time left on the oldest.
  const oldest = a.data?.oldestRemovalDays ?? null;
  const left = oldest === null ? null : 30 - oldest;
  return (
    <section aria-label="Counters" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Counter label="Open support tickets" value={fmtNum(d.openTickets)} accent={d.openTickets > 0 ? "rose" : "emerald"} note={d.openTickets > 0 ? "Waiting for a reply" : "All answered"} icon={<MessageSquare className="h-4 w-4" />} onOpen={go("tickets")} />
      <Counter label="Data removal requests" value={fmtNum(d.pendingRemovals)} accent={left !== null && left <= 7 ? "rose" : d.pendingRemovals > 0 ? "amber" : "emerald"} note={left === null ? "None waiting" : left <= 0 ? "Oldest is overdue" : `${left} days left on oldest`} icon={<ShieldX className="h-4 w-4" />} onOpen={go("removals")} />
      <Counter label="Discovery jobs running" value={fmtNum(d.openJobs)} accent={d.stuckJobs > 0 ? "rose" : "cyan"} note={d.stuckJobs > 0 ? `${fmtNum(d.stuckJobs)} stuck over 30 min` : "None stuck"} icon={<Activity className="h-4 w-4" />} onOpen={go("scans")} />
      <Counter label="Two-person approvals" value={a.data ? fmtNum(a.data.pendingApprovals) : "—"} accent="indigo" note={a.data && a.data.pendingApprovals > 0 ? "Waiting for a second person" : "Nothing waiting"} icon={<Lock className="h-4 w-4" />} onOpen={go("approvals")} />
    </section>
  );
}

/** What each provider does for MUSHIN, in the words staff use. */
const PURPOSE: Record<string, string> = {
  apify: "Instagram and TikTok profile scraping",
  serper: "Web search for live discovery",
  youtube: "YouTube channel data",
  groq: "AI assessment of creators",
  gemini: "AI assessment and search understanding",
  openrouter: "AI assessment (backup)",
  yepapi: "AI assessment (backup)",
  resend: "Outreach and notification email",
};

function Budgets() {
  const q = useQuery({ queryKey: ["admin", "alerts"], queryFn: () => adminRequest("/admin/v1/ops/alerts", staffAlertsSchema), refetchInterval: 60_000 });
  if (q.isPending) return <LoadingBlock lines={3} />;
  if (q.isError) return <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const names = [...new Set([...d.providerStatus.map((p) => p.provider), ...Object.keys(d.monthSpendUsd), ...Object.keys(d.providerCalls1h)])].sort();
  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const daysLeft = Math.ceil((reset.getTime() - now.getTime()) / 86_400_000);
  return (
    <section aria-label="Provider budgets" className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <h2 className="text-base font-bold text-[#0f172a]">Provider budgets and spend this month</h2>
        <span className="text-[11.5px] font-medium text-slate-500 tabular-nums">Spend counter resets in {daysLeft} day{daysLeft === 1 ? "" : "s"} (1st of the month, UTC)</span>
      </div>
      {names.length === 0 ? (
        <Empty title="No provider has been used yet" body="Providers appear here after their first call." />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {names.map((name) => {
            const st = d.providerStatus.find((p) => p.provider === name);
            const paused = d.pausedProviders.includes(name);
            const calls = d.providerCalls1h[name] ?? 0;
            const errors = d.providerErrors1h[name] ?? 0;
            const auth = d.providerAuthErrors1h[name] ?? 0;
            const spend = d.monthSpendUsd[name] ?? 0;
            const capped = st && st.quotaUsed !== null && st.quotaLimit !== null && st.quotaLimit > 0;
            const pct = capped ? Math.min(100, Math.round(((st.quotaUsed ?? 0) / (st.quotaLimit ?? 1)) * 100)) : null;
            const accent: Accent = paused ? "slate" : auth > 0 || (pct ?? 0) >= 85 || st?.checkError ? "rose" : (pct ?? 0) >= 60 || errors > 0 ? "amber" : "emerald";
            const state = paused ? "Paused" : auth > 0 ? "Key refused" : st?.checkError ? "Check failed" : pct === null ? (calls > 0 ? "Working" : "Idle") : pct >= 85 ? "Critical" : pct >= 60 ? "Warning" : "Healthy";
            const unit = (n: number) => (st?.quotaUnit === "usd" ? `$${n.toFixed(2)}` : fmtNum(n));
            return (
              <div key={name} className="flex flex-col justify-between rounded-2xl border border-slate-200/90 p-5 transition hover:border-cyan-300">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${BAR[accent]}`} />
                        <h3 className="truncate text-[15px] font-bold capitalize text-[#0f172a]">{name}</h3>
                      </div>
                      <p className="mt-0.5 text-[12px] text-slate-500">{PURPOSE[name] ?? "External data provider"}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider tabular-nums ${accent === "rose" ? "border-rose-200 bg-rose-50 text-rose-700" : accent === "amber" ? "border-amber-200 bg-amber-50 text-amber-800" : accent === "slate" ? "border-slate-300 bg-slate-100 text-slate-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                      {state}{pct !== null ? ` (${pct}%)` : ""}
                    </span>
                  </div>
                  <div className="mt-4 flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-semibold text-slate-600 tabular-nums">{capped ? `${unit(st.quotaUsed ?? 0)} / ${unit(st.quotaLimit ?? 0)}` : "No cap reported"}</span>
                    <span className="text-[14px] font-extrabold text-[#0f172a] tabular-nums">${spend.toFixed(2)}</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full transition-all ${BAR[accent]}`} style={{ width: `${pct ?? 0}%` }} />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[11.5px]">
                  <span className="text-slate-500 tabular-nums">
                    {calls === 0 ? "No calls in the last hour" : `${fmtNum(calls)} calls · ${((errors / calls) * 100).toFixed(1)}% errors (1h)`}
                  </span>
                  <button type="button" onClick={go("sources")} className="btn btn-soft btn-sm">{paused ? "Resume" : "Manage"}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function FeatureUse() {
  const q = useQuery({ queryKey: ["admin", "feature-usage"], queryFn: () => adminRequest("/admin/v1/ops/feature-usage", staffFeatureUsageSchema), refetchInterval: 120_000 });
  const tones: Accent[] = ["slate", "cyan", "indigo", "amber", "emerald", "rose"];
  return (
    <Card className="!p-6">
      <h2 className="text-base font-bold text-[#0f172a]">Feature adoption</h2>
      <p className="mt-0.5 text-[12.5px] text-slate-500">How often customers used each feature in the last 7 days, and by how many accounts</p>
      {q.isPending ? <LoadingBlock lines={4} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : (() => {
        const total = q.data.features.reduce((s, f) => s + f.count, 0);
        if (total === 0) return <div className="mt-5"><Empty title="No customer activity in the last 7 days" /></div>;
        return (
          <div className="mt-5 space-y-4">
            {[...q.data.features].sort((x, y) => y.count - x.count).map((f, i) => {
              const pct = Math.round((f.count / total) * 100);
              const t = tones[i % tones.length] as Accent;
              return (
                <div key={f.key}>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="font-bold text-slate-800">{f.label}</span>
                    <span className="text-[12px] text-slate-600 tabular-nums">{fmtNum(f.count)} · {fmtNum(f.accounts)} account{f.accounts === 1 ? "" : "s"} <strong className={`ml-1 font-extrabold ${t === "slate" ? "text-[#0f172a]" : TEXT[t]}`}>{pct}%</strong></span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${BAR[t]}`} style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </Card>
  );
}

const KIND: Record<string, { label: string; cls: string }> = {
  live: { label: "Live discovery", cls: "border-cyan-200 bg-cyan-50 text-[#00687a]" },
  add_by_url: { label: "Add by link", cls: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  refresh: { label: "Update info", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};

function LiveStream() {
  const [paused, setPaused] = useState(false);
  const q = useQuery({ queryKey: ["admin", "jobs", "stream"], queryFn: () => adminRequest("/admin/v1/ops/jobs?limit=8", staffJobListSchema), refetchInterval: paused ? false : 15_000 });
  return (
    <Card className="!p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-[#0f172a]">Live customer jobs</h2>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase ${paused ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-amber-500" : "animate-pulse bg-emerald-500 motion-reduce:animate-none"}`} />
              {paused ? "Paused" : "Live"}
            </span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-slate-500">Discovery, add-by-link and update jobs as customers start them, newest first</p>
        </div>
        <button type="button" onClick={() => setPaused((p) => !p)} className={`btn btn-sm ${paused ? "btn-warn" : "btn-soft"}`}>{paused ? "Resume feed" : "Pause feed"}</button>
      </div>
      {q.isPending ? <LoadingBlock lines={4} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : q.data.jobs.length === 0 ? <Empty title="No customer jobs yet" /> : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Live customer jobs">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <th className="py-2 pr-2">When</th><th className="px-2 py-2">Account</th><th className="px-2 py-2">Job</th><th className="py-2 pl-2 text-right">Brief or profile</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[12px]">
              {q.data.jobs.map((j) => {
                const k = KIND[j.kind] ?? { label: j.kind, cls: "border-slate-200 bg-slate-50 text-slate-700" };
                return (
                  <tr key={j.id} className="hover:bg-slate-50/90">
                    <td className="whitespace-nowrap py-3 pr-2 text-[11px] text-slate-400 tabular-nums">{fmtAgo(j.createdAt)}</td>
                    <td className="whitespace-nowrap px-2 py-3 font-bold text-slate-800">{j.workspaceName}</td>
                    <td className="whitespace-nowrap px-2 py-3">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10.5px] font-bold ${j.status === "failed" ? "border-rose-200 bg-rose-50 text-rose-700" : k.cls}`}>{k.label}{j.status !== "completed" ? ` · ${j.status}` : ""}</span>
                    </td>
                    <td className="max-w-[200px] truncate py-3 pl-2 text-right text-[11.5px] font-semibold text-slate-700">{j.brief ? `"${j.brief}"` : j.handle ? `@${j.handle}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const REASON: Record<string, string> = {
  below_follower_minimum: "Below 10,000 followers",
  followers_unknown: "Follower count unknown",
  followers_stale: "Follower count older than 90 days",
  inactive: "No post in 90 days",
  invalid_profile_url: "Not an own profile link",
  profile_not_found: "Profile not found",
  profile_private: "Profile private",
  no_profile: "No profile",
  minor_protected: "Protected (possible minor)",
  account_not_individual_creator: "Brand, business or celebrity account",
  creator_not_active: "Removed or merged",
  evidence_expired: "Figures expired since indexing",
  country_unknown: "Location not proven Pakistani",
  country_not_pakistan: "Outside Pakistan",
};

function QualificationAudit() {
  const q = useQuery({ queryKey: ["admin", "eligibility"], queryFn: () => adminRequest("/admin/v1/ops/eligibility", eligibilityCoverageSchema), refetchInterval: 300_000 });
  const tones: Accent[] = ["slate", "cyan", "amber", "indigo", "rose", "emerald"];
  return (
    <section aria-label="Creator eligibility coverage" className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {q.isPending ? <LoadingBlock lines={4} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : (() => {
        const d = q.data;
        const out = d.total - d.eligible;
        const reasons = [...d.byReason].sort((a, b) => b.creators - a.creators);
        return (
          <>
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-base font-bold text-[#0f172a]">Catalogue qualification audit</h2>
                <p className="mt-0.5 text-[12.5px] text-slate-500 tabular-nums">{d.eligible} of {d.total} creators in the search catalogue qualify ({d.policy} rules) and appear in search</p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-center">
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-extrabold text-emerald-700 tabular-nums">Qualify ({fmtNum(d.eligible)})</span>
                <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-extrabold text-slate-800 tabular-nums">Don't qualify ({fmtNum(out)})</span>
              </div>
            </div>
            {reasons.length === 0 ? <p className="text-[12.5px] text-slate-500">No creator is held back.</p> : (
              <div className="space-y-4">
                {reasons.map((r, i) => {
                  const pct = out > 0 ? (r.creators / out) * 100 : 0;
                  const t = tones[i % tones.length] as Accent;
                  return (
                    <button key={r.reason} type="button" onClick={go("checks")} className="group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-[12.5px]">
                        <span className="font-bold text-slate-800 group-hover:text-[#0891B2]">{REASON[r.reason] ?? r.reason}</span>
                        <span className="shrink-0 text-[12px] text-slate-600 tabular-nums"><strong className={`font-extrabold ${t === "slate" ? "text-[#0f172a]" : TEXT[t]}`}>{fmtNum(r.creators)} creators</strong> ({pct.toFixed(1)}%)</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${BAR[t]}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
                    </button>
                  );
                })}
                <p className="text-[11px] text-slate-500">A creator can be held back for more than one reason, so the shares can add up to more than 100%.</p>
              </div>
            )}
          </>
        );
      })()}
    </section>
  );
}

export function OverviewPage({ canTest }: { canTest: boolean }) {
  return (
    <div className="space-y-6">
      <h1 className="sr-only">Overview</h1>
      <Counters />
      <Budgets />
      <section className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-12">
        <div className="xl:col-span-6"><FeatureUse /></div>
        <div className="xl:col-span-6"><LiveStream /></div>
      </section>
      <QualificationAudit />
      <OpsAlerts canTest={canTest} />
    </div>
  );
}
