import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { analyticsSummarySchema } from "@mushin/contracts";
import { rupees } from "../../api/campaigns";
import { apiRequest } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { ErrorState, LoadingBlock } from "./states";

/**
 * Analytics (canonical frontend spec page 12): aggregates of persisted workspace data only. Pipeline numbers are the
 * current state; outreach, discovery and credits are for the chosen period. No reach, ROI or response rates are
 * estimated. Every bar carries its value as text, so the page reads the same as a table.
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const PRESETS = [7, 30, 90] as const;

function useAnalytics(from: string, to: string) {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["analytics", from, to],
    queryFn: () => apiRequest(`/v1/analytics/summary?from=${from}&to=${to}`, analyticsSummarySchema),
    enabled: status === "signedIn" && from <= to,
  });
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 tabular-nums text-slate-900" style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{note}</div>
    </div>
  );
}

/** One-series horizontal bars: one hue, value printed beside each bar, hover title repeats it. */
function Bars({ title, definition, rows }: { title: string; definition: string; rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((n, r) => n + r.value, 0);
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4" aria-label={title}>
      <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>{title}</div>
      <p className="mt-0.5 text-[11px] text-slate-500">{definition}</p>
      {total === 0 ? (
        <p className="mt-4 text-xs text-slate-500">Nothing recorded yet.</p>
      ) : (
        <dl className="mt-3 space-y-2">
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[8rem_1fr] items-center gap-2 text-xs" title={`${r.label}: ${r.value}`}>
              <dt className="truncate text-slate-600">{r.label}</dt>
              {/* A definition list holds only terms and definitions (WCAG 1.3.1): the bar is part of the value, hidden from screen readers. */}
              <dd className="flex items-center gap-2">
                <span className="h-2.5 flex-1 rounded-full bg-slate-100" aria-hidden="true">
                  <span className="block h-2.5 rounded-full bg-indigo-500" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? 4 : 0 }} />
                </span>
                <span className="w-12 text-right tabular-nums text-slate-700">{r.value}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function Analytics() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(iso(new Date()));
  const q = useAnalytics(from, to);
  const pickPreset = (days: number) => { setFrom(daysAgo(days - 1)); setTo(iso(new Date())); };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-semibold leading-10 tracking-[-0.025em] text-slate-900">Analytics</h1>
          <p className="mt-1 text-sm text-slate-500">Counts from your workspace's own records. Nothing here is estimated.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Period">
          {PRESETS.map((d) => (
            <button key={d} onClick={() => pickPreset(d)} aria-pressed={from === daysAgo(d - 1) && to === iso(new Date())} className={`rounded-md px-2.5 py-1.5 text-xs ${from === daysAgo(d - 1) && to === iso(new Date()) ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700"}`}>Last {d} days</button>
          ))}
          <label className="inline-flex items-center gap-1 text-slate-600">From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-slate-200 px-1.5 py-1 text-xs" /></label>
          <label className="inline-flex items-center gap-1 text-slate-600">To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-200 px-1.5 py-1 text-xs" /></label>
        </div>
      </div>
      {from > to ? (
        <p className="text-sm text-red-600">The start date must be on or before the end date.</p>
      ) : q.isPending ? (
        <LoadingBlock lines={6} />
      ) : q.isError ? (
        <ErrorState body={q.error instanceof Error ? q.error.message : undefined} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Campaigns" value={String(q.data.campaigns.total)} note={`${q.data.campaigns.byStatus.active} active · ${q.data.campaigns.byStatus.completed} completed`} />
            <Tile label="Agreed fees" value={rupees(q.data.pipeline.agreedFeesMinor)} note={`of ${rupees(q.data.pipeline.budgetMinor)} total campaign budgets`} />
            <Tile label="Outreach logged" value={String(q.data.outreach.total)} note={`${q.data.outreach.creatorsContacted} creators, in this period`} />
            <Tile label="Credits spent" value={String(q.data.credits.spent)} note={`${q.data.credits.refunded} refunded, in this period`} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Bars
              title="Creators by pipeline stage"
              definition="Current stage of every creator in your campaigns. Declined creators are counted separately, not as a stage."
              rows={[
                { label: "Identified", value: q.data.pipeline.byStage.identified },
                { label: "Contacted", value: q.data.pipeline.byStage.contacted },
                { label: "Negotiating", value: q.data.pipeline.byStage.negotiating },
                { label: "Confirmed", value: q.data.pipeline.byStage.confirmed },
                { label: "Declined", value: q.data.pipeline.declined },
              ]}
            />
            <Bars
              title="Content delivery"
              definition="Content status of every creator in your campaigns, as your team recorded it."
              rows={[
                { label: "No content yet", value: q.data.pipeline.byContent.none },
                { label: "Content pending", value: q.data.pipeline.byContent.content_pending },
                { label: "Posted", value: q.data.pipeline.byContent.posted },
                { label: "Completed", value: q.data.pipeline.byContent.completed },
              ]}
            />
            <Bars
              title="Outreach outcomes"
              definition="Outreach your team logged in this period, by what happened. MUSHIN doesn't track replies."
              rows={[
                { label: "Reached out", value: q.data.outreach.byOutcome.attempted },
                { label: "Replied", value: q.data.outreach.byOutcome.replied },
                { label: "No response", value: q.data.outreach.byOutcome.no_response },
                { label: "Agreed", value: q.data.outreach.byOutcome.agreed },
                { label: "Declined", value: q.data.outreach.byOutcome.declined },
              ]}
            />
            <section className="rounded-2xl border border-slate-200/80 bg-white p-4 text-xs text-slate-700" aria-label="Discovery and lists">
              <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Discovery and lists</div>
              <dl className="mt-3 grid grid-cols-2 gap-y-2">
                <dt className="text-slate-500">Find New Creators runs finished (period)</dt><dd className="text-right tabular-nums">{q.data.discovery.liveRuns}</dd>
                <dt className="text-slate-500">Creators delivered (period)</dt><dd className="text-right tabular-nums">{q.data.discovery.creatorsDelivered}</dd>
                <dt className="text-slate-500">…of which new to MUSHIN</dt><dd className="text-right tabular-nums">{q.data.discovery.newCreators}</dd>
                <dt className="text-slate-500">Lists</dt><dd className="text-right tabular-nums">{q.data.lists.total}</dd>
                <dt className="text-slate-500">Creators saved to lists</dt><dd className="text-right tabular-nums">{q.data.lists.savedCreators}</dd>
              </dl>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
