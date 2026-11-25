import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, ListPlus, Megaphone, Search, Send } from "lucide-react";
import { creatorStatsSchema, type CreatorStats } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { PlatformIcon, type Platform } from "../dashboard/PlatformIcon";
import { Card, CardTitle, Kpi, PageHeader, Pills, errText, fmtNum } from "./kit";

type Window = "7" | "30" | "90";
const PLATFORM_NAME: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", any: "Any platform" };

function TopList({ title, sub, rows, unit, accent }: { title: string; sub: string; rows: CreatorStats["mostOpened"]; unit: string; accent: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card label={title}>
      <CardTitle title={title} sub={sub} />
      {rows.length === 0 ? <p className="text-xs text-slate-500">Nothing recorded in this window yet.</p> : (
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.creatorId} className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-right text-[11px] font-bold tabular-nums text-slate-400">{i + 1}</span>
              <PlatformIcon platform={(r.platform as Platform) ?? "instagram"} className="h-4 w-4" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12.5px] font-semibold text-slate-900">{r.name} <span className="font-normal text-slate-500">@{r.handle}</span></span>
                  <span className="shrink-0 text-[12px] font-bold tabular-nums text-slate-800">{fmtNum(r.count)} <span className="font-normal text-slate-500">{unit}</span></span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${accent}`} style={{ width: `${(r.count / max) * 100}%` }} /></div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Bars({ title, rows, color, label = (l: string) => l }: { title: string; rows: CreatorStats["byNiche"]; color: string; label?: (l: string) => string }) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <Card label={title}>
      <CardTitle title={title} sub={total ? `${fmtNum(total)} searches` : "No searches in this window"} />
      <div className="space-y-2.5">
        {rows.slice(0, 12).map((r) => (
          <div key={r.label}>
            <div className="flex justify-between text-[12px]"><span className="font-medium text-slate-800">{label(r.label)}</span><span className="tabular-nums text-slate-600"><strong className="text-slate-900">{fmtNum(r.count)}</strong> · {total ? Math.round((r.count / total) * 100) : 0}%</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color}`} style={{ width: `${total ? (r.count / total) * 100 : 0}%` }} /></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Stats (owner, 25 Nov), under Creator Checks: which creators customers open, list, add to campaigns and reach out to
 * the most, and what they search for (niche, platform, follower tier). Counts only; no search text is stored.
 */
export function StatsPage() {
  const [days, setDays] = useState<Window>("30");
  const q = useQuery({ queryKey: ["admin", "creator-stats", days], queryFn: () => adminRequest(`/admin/v1/analytics/creator-stats?days=${days}&limit=10`, creatorStatsSchema) });
  const s = q.data;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Creators" title="Stats" sub="What customers do with creators, and what they search for." actions={<Pills<Window> value={days} onChange={setDays} label="Time window" options={[{ id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "90", label: "90 days" }]} />} />
      {q.isPending ? <LoadingBlock lines={6} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : s && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Kpi label="Searches" value={fmtNum(s.totals.searches)} icon={<Search className="h-4 w-4" />} tone="cyan" />
            <Kpi label="Profiles opened" value={fmtNum(s.totals.opened)} icon={<Eye className="h-4 w-4" />} tone="indigo" />
            <Kpi label="Added to lists" value={fmtNum(s.totals.listed)} icon={<ListPlus className="h-4 w-4" />} tone="emerald" />
            <Kpi label="Added to campaigns" value={fmtNum(s.totals.campaigned)} icon={<Megaphone className="h-4 w-4" />} tone="amber" />
            <Kpi label="Reached out" value={fmtNum(s.totals.reached)} icon={<Send className="h-4 w-4" />} tone="rose" />
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <TopList title="Most opened" sub="Creators whose profiles customers opened most" rows={s.mostOpened} unit="opens" accent="bg-indigo-500" />
            <TopList title="Most added to lists" sub="Creators saved to lists most often" rows={s.mostListed} unit="lists" accent="bg-emerald-500" />
            <TopList title="Most added to campaigns" sub="Creators put into campaigns most often" rows={s.mostCampaigned} unit="campaigns" accent="bg-amber-500" />
            <TopList title="Most reached out to" sub="Creators customers emailed or logged outreach with" rows={s.mostReached} unit="contacts" accent="bg-rose-500" />
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Bars title="Searched niches" rows={s.byNiche} color="bg-cyan-500" />
            <Bars title="Searched platforms" rows={s.byPlatform} color="bg-violet-500" label={(l) => PLATFORM_NAME[l] ?? l} />
            <Bars title="Searched follower size" rows={s.byTier} color="bg-emerald-500" />
          </div>
          <p className="text-[11px] text-slate-500">Search filters are counted from 25 November 2026; earlier searches count as "any".</p>
        </>
      )}
    </div>
  );
}
