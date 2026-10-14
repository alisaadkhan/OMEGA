import { ArrowUpRight, Bookmark, FolderKanban, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { analyticsSummarySchema } from "@mushin/contracts";
import { useRecentActivity } from "../../api/activity";
import { rupees, useCampaigns } from "../../api/campaigns";
import { apiRequest } from "../../api/client";
import { useLists } from "../../api/lists";
import { initialsAvatar } from "../../api/search-mapping";
import { useSavedSearches } from "../../api/search";
import { useAuth } from "../../auth/AuthContext";
import { relative } from "../../lib/time";
import { ActivityRow } from "./ActivityLog";
import { STATUS_LABEL, STATUS_TONE } from "./Campaigns";
import type { DashView } from "./Sidebar";

/** Dashboard cards (canonical spec page 05): every number comes from the API; empty states say what will appear. */
function Shell({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: string; action?: { label: string; onClick: () => void }; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`} aria-label={title}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
          {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
        </div>
        {action && (
          <button onClick={action.onClick} className="inline-flex items-center gap-0.5 text-[11px] text-indigo-600 hover:text-indigo-700" style={{ fontWeight: 500 }}>
            {action.label} <ArrowUpRight className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const Muted = ({ children }: { children: React.ReactNode }) => <p className="py-4 text-center text-xs text-slate-500">{children}</p>;
const Loading = () => <div className="h-20 animate-pulse rounded-lg bg-slate-100" role="status" aria-label="Loading" />;

export function SnapshotCard({ go }: { go: (v: DashView) => void }) {
  const { status } = useAuth();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const q = useQuery({ queryKey: ["analytics", from, to], queryFn: () => apiRequest(`/v1/analytics/summary?from=${from}&to=${to}`, analyticsSummarySchema), enabled: status === "signedIn" });
  const tiles = q.data
    ? [
        { label: "Credits spent", value: String(q.data.credits.spent), note: `${q.data.credits.refunded} refunded` },
        { label: "Creators delivered", value: String(q.data.discovery.creatorsDelivered), note: `${q.data.discovery.liveRuns} Find New Creators runs` },
        { label: "Outreach logged", value: String(q.data.outreach.total), note: `${q.data.outreach.creatorsContacted} creators` },
        { label: "Confirmed creators", value: String(q.data.pipeline.byStage.confirmed), note: `${rupees(q.data.pipeline.agreedFeesMinor)} agreed` },
      ]
    : [];
  return (
    <Shell title="Last 30 days" subtitle="From your workspace's records" action={{ label: "Analytics", onClick: () => go("analytics") }} className="lg:col-span-2">
      {q.isPending ? <Loading /> : q.isError ? <Muted>Couldn't load your numbers. Try again shortly.</Muted> : (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg bg-slate-50 p-3">
              <dt className="text-[11px] text-slate-500">{t.label}</dt>
              <dd className="mt-0.5 tabular-nums text-slate-900" style={{ fontSize: 20, fontWeight: 700 }}>{t.value}</dd>
              <dd className="text-[11px] text-slate-500">{t.note}</dd>
            </div>
          ))}
        </dl>
      )}
    </Shell>
  );
}

export function SavedSearchesCard({ go }: { go: (v: DashView) => void }) {
  const q = useSavedSearches();
  const items = q.data?.searches.slice(0, 5) ?? [];
  return (
    <Shell title="Saved searches" action={{ label: "Search", onClick: () => go("search") }}>
      {q.isPending ? <Loading /> : q.isError ? <Muted>Couldn't load saved searches.</Muted> : items.length === 0 ? <Muted>Save a search from the Search page to rerun it from here.</Muted> : (
        <ul className="space-y-1.5">
          {items.map((s) => (
            <li key={s.id}>
              <button onClick={() => go("search")} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50">
                <Search className="h-3.5 w-3.5 text-slate-400" />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

export function ListsCard({ go }: { go: (v: DashView) => void }) {
  const q = useLists();
  const items = q.data?.lists.slice(0, 4) ?? [];
  return (
    <Shell title="Lists" action={{ label: "All lists", onClick: () => go("lists") }} className="lg:col-span-2">
      {q.isPending ? <Loading /> : q.isError ? <Muted>Couldn't load your lists.</Muted> : items.length === 0 ? <Muted>No lists yet. Save creators from Search to start a shortlist.</Muted> : (
        <ul className="divide-y divide-slate-100">
          {items.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2 text-xs">
              <Bookmark className="h-3.5 w-3.5 text-slate-400" />
              <span className="min-w-0 flex-1 truncate text-slate-800" style={{ fontWeight: 600 }}>{l.name}</span>
              <span className="flex -space-x-1.5">{l.preview.map((p) => <img key={p.id} src={p.avatarUrl ?? initialsAvatar(p.displayName)} alt="" className="h-5 w-5 rounded-full border border-white object-cover" />)}</span>
              <span className="w-20 text-right text-slate-500">{l.count} creator{l.count === 1 ? "" : "s"}</span>
              <span className="w-24 text-right text-slate-400">{relative(l.updatedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

export function CampaignsCard({ go }: { go: (v: DashView) => void }) {
  const q = useCampaigns();
  const items = q.data?.campaigns.slice(0, 4) ?? [];
  return (
    <Shell title="Campaigns" action={{ label: "All campaigns", onClick: () => go("campaigns") }}>
      {q.isPending ? <Loading /> : q.isError ? <Muted>Couldn't load campaigns.</Muted> : items.length === 0 ? <Muted>No campaigns yet.</Muted> : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id} className="text-xs">
              <div className="flex items-center gap-2">
                <FolderKanban className="h-3.5 w-3.5 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-slate-800" style={{ fontWeight: 600 }}>{c.name}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
              </div>
              <div className="ml-5 mt-0.5 text-[11px] text-slate-500">{c.creatorCount === 0 ? "No creators yet" : `${c.stageCounts.confirmed} of ${c.creatorCount - c.declinedCount} confirmed`}</div>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

export function ActivityCard({ go }: { go: (v: DashView) => void }) {
  const q = useRecentActivity(6);
  return (
    <Shell title="Recent activity" action={{ label: "Activity log", onClick: () => go("activity") }}>
      {q.isPending ? <Loading /> : q.isError ? <Muted>Couldn't load activity.</Muted> : q.data.events.length === 0 ? <Muted>No recorded activity yet.</Muted> : (
        <ol className="-mx-4 divide-y divide-slate-100">{q.data.events.map((e) => <ActivityRow key={e.id} e={e} />)}</ol>
      )}
    </Shell>
  );
}
