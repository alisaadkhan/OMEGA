import { useState } from "react";
import { ArrowRight, ArrowUpRight, Bookmark, FolderKanban, Radar, Search, ShieldCheck } from "lucide-react";
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
    <section className={`rounded-2xl border border-slate-200/80 bg-white p-6 ${className}`} aria-label={title}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[18px] font-semibold leading-6 tracking-[-0.015em] text-slate-900">{title}</div>
          {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
        </div>
        {action && (
          <button onClick={action.onClick} className="inline-flex items-center gap-1 text-[13px] font-medium text-indigo-600 hover:text-indigo-700">
            {action.label} <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="mt-4">{children}</div>
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
    // Design: four figure tiles across the page. Every figure is the workspace's own record for the last 30 days.
    <section aria-label="Last 30 days">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">Last 30 days · from your workspace's records</h2>
        <button onClick={() => go("analytics")} className="inline-flex items-center gap-1 text-[13px] font-medium text-indigo-600 hover:text-indigo-700">
          Analytics <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
      {q.isPending ? <Loading /> : q.isError ? <Muted>Couldn't load your numbers. Try again shortly.</Muted> : (
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl border border-slate-200/80 bg-white p-5">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">{t.label}</dt>
              <dd className="mt-3 text-[28px] font-semibold leading-8 tracking-[-0.02em] tabular-nums text-slate-900">{t.value}</dd>
              <dd className="mt-1 text-xs text-indigo-700">{t.note}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
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
                <Search className="h-3.5 w-3.5 text-slate-500" />
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
    <Shell title="Shortlistings" action={{ label: "All shortlistings", onClick: () => go("lists") }} className="lg:col-span-2">
      {q.isPending ? <Loading /> : q.isError ? <Muted>Couldn't load your lists.</Muted> : items.length === 0 ? <Muted>No lists yet. Save creators from Search to start a shortlist.</Muted> : (
        <ul className="divide-y divide-slate-100">
          {items.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2 text-xs">
              <Bookmark className="h-3.5 w-3.5 text-slate-500" />
              <span className="min-w-0 flex-1 truncate text-slate-800" style={{ fontWeight: 600 }}>{l.name}</span>
              <span className="flex -space-x-1.5">{l.preview.map((p) => <img key={p.id} src={p.avatarUrl ?? initialsAvatar(p.displayName)} alt="" className="h-5 w-5 rounded-full border border-white object-cover" />)}</span>
              <span className="w-20 text-right text-slate-500">{l.count} creator{l.count === 1 ? "" : "s"}</span>
              <span className="w-24 text-right text-slate-500">{relative(l.updatedAt)}</span>
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
                <FolderKanban className="h-3.5 w-3.5 text-slate-500" />
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

/**
 * First-run welcome (design "page for new user", 2026-10-27). Inline, not a modal, so it never blocks the page; shown
 * while the workspace has no lists, campaigns or activity, until dismissed. Every line describes what MUSHIN does today.
 */
export function WelcomeCard({ go }: { go: (v: DashView) => void }) {
  const { user } = useAuth();
  const lists = useLists();
  const campaigns = useCampaigns();
  const activity = useRecentActivity(6);
  const key = `mushin.welcomeDismissed.${user?.id ?? ""}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const isNew = lists.data?.lists.length === 0 && campaigns.data?.campaigns.length === 0 && activity.data?.events.length === 0;
  if (dismissed || !isNew) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* storage unavailable: hidden for this visit only */
    }
  };
  const points = [
    { icon: ShieldCheck, title: "Pakistani creators, checked per profile", body: "Every creator in search has at least 10,000 followers on the profile shown, and each count shows when it was last checked." },
    { icon: Radar, title: "Find New Creators when the catalogue is thin", body: "Live discovery looks beyond MUSHIN's catalogue. You see the credit cost before anything runs." },
    { icon: FolderKanban, title: "Lists and campaigns", body: "Shortlist creators, then track them from first contact to confirmed, with fees and an outreach log." },
  ];
  return (
    <section aria-label="Welcome to MUSHIN" className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(87,223,254,0.25), transparent)" }} />
      <div className="relative">
        <h2 className="text-[24px] font-semibold leading-8 tracking-[-0.02em] text-slate-900">Welcome to MUSHIN</h2>
        <p className="mt-1 text-sm text-slate-600">Your workspace is ready. Start by finding your first creators.</p>
        <ul className="mt-5 grid gap-3 md:grid-cols-3">
          {points.map((p) => (
            <li key={p.title} className="flex gap-3 rounded-xl bg-slate-50 p-4">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 ring-1 ring-slate-200">
                <p.icon aria-hidden className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-slate-900">{p.title}</span>
                <span className="mt-0.5 block text-xs leading-[18px] text-slate-600">{p.body}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={() => go("search")} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800">
            Search the catalogue <ArrowRight aria-hidden className="h-4 w-4" />
          </button>
          <button onClick={dismiss} className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Dismiss
          </button>
        </div>
      </div>
    </section>
  );
}
