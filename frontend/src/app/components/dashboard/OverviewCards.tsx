import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUpRight, Bookmark, FolderKanban, Megaphone, PauseCircle, Radar, Search, ShieldCheck, Zap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { analyticsSummarySchema, meResponseSchema } from "@mushin/contracts";
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
    <section className={`rounded-2xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md ${className}`} aria-label={title}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[18px] font-semibold leading-6 tracking-[-0.015em] text-slate-900">{title}</div>
          {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
        </div>
        {action && (
          <button onClick={action.onClick} className="inline-flex items-center gap-1 rounded text-[13px] font-semibold text-slate-900 transition-colors hover:text-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
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
        { label: "Credits used", icon: Zap, value: String(q.data.credits.spent), note: `${q.data.credits.refunded} refunded · ${q.data.discovery.creatorsDelivered} creators found`, accent: false },
        { label: "Shortlists", icon: Bookmark, value: String(q.data.lists.total), note: `${q.data.lists.savedCreators} creators saved`, accent: false },
        { label: "Active campaigns", icon: Megaphone, value: String(q.data.campaigns.byStatus.active ?? 0), note: `${rupees(q.data.pipeline.budgetMinor)} budget`, accent: true },
        { label: "Paused campaigns", icon: PauseCircle, value: String(q.data.campaigns.byStatus.paused ?? 0), note: `${q.data.campaigns.byStatus.draft ?? 0} drafts`, accent: false },
      ]
    : [];
  return (
    // Design: four figure tiles across the page. Every figure is the workspace's own record for the last 30 days.
    <section aria-label="Last 30 days">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">Last 30 days · from your account's records</h2>
      </div>
      {q.isPending ? <Loading /> : q.isError ? <Muted>Couldn't load your numbers. Try again shortly.</Muted> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="flex flex-col justify-between rounded-2xl bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t.label}</p>
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${t.accent ? "bg-cyan-50 text-cyan-700" : "bg-slate-50 text-slate-500"}`}>
                  <t.icon aria-hidden className="h-4 w-4" />
                </span>
              </div>
              <p className="text-[32px] font-bold leading-10 tracking-tight tabular-nums text-slate-900">{t.value}</p>
              <p className={`mt-2 text-xs font-medium ${t.accent ? "text-cyan-700" : "text-slate-500"}`}>{t.note}</p>
            </div>
          ))}
        </div>
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
    <Shell title="Shortlists" action={{ label: "All shortlists", onClick: () => go("lists") }} className="lg:col-span-2">
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

export function CampaignsCard({ go, className = "" }: { go: (v: DashView) => void; className?: string }) {
  const q = useCampaigns();
  const items = q.data?.campaigns.slice(0, 4) ?? [];
  return (
    <Shell title="Campaign overview" className={className} action={{ label: "View all", onClick: () => go("campaigns") }}>
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

export function ActivityCard({ go, className = "" }: { go: (v: DashView) => void; className?: string }) {
  const q = useRecentActivity(6);
  return (
    <Shell title="Recent activity" className={className} action={{ label: "Activity log", onClick: () => go("activity") }}>
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
  const { user, status } = useAuth();
  // Shown only after the current Terms are accepted: a new user sees the Terms dialog first, then this, never stacked.
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiRequest("/v1/me", meResponseSchema), enabled: status === "signedIn" });
  const termsAccepted = !!me.data && me.data.legal.acceptedVersion === me.data.legal.currentVersion;
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
  if (dismissed || !isNew || !termsAccepted) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* storage unavailable: hidden for this visit only */
    }
  };
  const points = [
    { icon: ShieldCheck, title: "Pakistani creators, checked per profile", body: "Each creator in search meets the follower minimum and shows when it was last checked." },
    { icon: Radar, title: "Find New Creators when the catalogue is thin", body: "Live discovery looks beyond MUSHIN's catalogue. You see the credit cost before anything runs." },
    { icon: FolderKanban, title: "Shortlists and campaigns", body: "Shortlist creators, then track them from first contact to confirmed, with fees and an outreach log." },
  ];
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="fixed inset-0 z-50 flex items-center justify-center bg-[#131b2e]/60 p-4 backdrop-blur-md">
        <motion.section
          role="dialog"
          aria-modal="true"
          aria-label="Welcome to MUSHIN"
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-[490px] overflow-hidden rounded-[28px] bg-white p-8 text-center shadow-2xl sm:p-10"
        >
          <div aria-hidden className="pointer-events-none absolute -top-16 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-cyan-200/30 blur-2xl" />
          <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#131b2e] shadow-lg shadow-cyan-900/20">
            <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-cyan-300/20" />
            <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-tr from-[#131b2e] via-[#004e5c] to-[#57dffe] p-0.5">
              <span className="flex h-full w-full items-center justify-center rounded-full bg-[#131b2e]">
                <Radar aria-hidden className="h-8 w-8 text-[#57dffe]" />
              </span>
            </span>
          </div>
          <h2 className="relative mt-6 text-2xl font-semibold tracking-tight text-slate-900">Welcome to MUSHIN.</h2>
          <p className="relative mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-600">Your account is ready. Let&apos;s find your first creators.</p>
          <ul className="relative mb-7 mt-7 flex flex-col gap-2.5 text-left">
            {points.map((p, i) => (
              <motion.li key={p.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.07, duration: 0.3 }} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3.5 py-3 transition-colors hover:bg-slate-100">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white text-cyan-700 shadow-sm">
                  <p.icon aria-hidden className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold leading-tight text-slate-900">{p.title}</span>
                  <span className="block text-xs text-slate-600">{p.body}</span>
                </span>
              </motion.li>
            ))}
          </ul>
          <button onClick={() => { dismiss(); go("search"); }} className="group relative inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#57dffe] px-6 py-3.5 text-sm font-semibold text-[#001f26] shadow-sm transition-all hover:bg-[#acedff] focus:outline-none focus:ring-2 focus:ring-cyan-400/60 active:scale-[0.99]">
            Start a search <ArrowRight aria-hidden className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
          <button onClick={dismiss} className="relative mt-4 block w-full rounded text-center text-xs text-slate-600 transition-colors hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
            Skip for now, take me to the dashboard
          </button>
        </motion.section>
      </motion.div>
    </AnimatePresence>
  );
}
