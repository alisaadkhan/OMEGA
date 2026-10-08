import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  Search,
  Zap,
  FolderKanban,
  Plus,
  ArrowUpRight,
  Sparkles,
  Users,
  Activity as ActivityIcon,
  CheckCircle2,
  AlertTriangle,
  Info,
  Instagram,
  Youtube,
  Music2,
} from "lucide-react";
import { AnimatedNumber } from "./AnimatedNumber";
import { useAuth } from "../../auth/AuthContext";
import { profiles } from "../../auth/profiles";
import type { DashView } from "./Sidebar";
import { useCampaigns, progressRatio, type Campaign, type CampaignStatus } from "../../lib/campaignStore";
import { useBillingPlans, useBillingSummary } from "../../api/billing";
import { COPY } from "../../lib/copy";

/**
 * Volume 2 §5 — Dashboard specification.
 * Widgets: welcome header, credit balance, subscription, quick actions,
 * usage analytics, recent searches, saved lists, campaign summary,
 * activity feed. Each defines loading + empty states.
 */

const recentSearches = [
  { platform: "instagram" as const, query: "Pakistani lifestyle creators 50k+ Karachi", time: "2m", count: 128 },
  { platform: "tiktok" as const, query: "Urdu comedy creators >5% engagement", time: "18m", count: 74 },
  { platform: "youtube" as const, query: "Tech reviewers Lahore 100k+", time: "1h", count: 32 },
  { platform: "instagram" as const, query: "Bridal & fashion 30k–80k Pakistan", time: "3h", count: 96 },
];

const savedLists = [
  { name: "Bridal Lahore Q3", count: 24, updated: "2h", avatars: [profiles.ayesha.avatar, profiles.hira.avatar, profiles.sana.avatar] },
  { name: "Karachi tech reviewers", count: 12, updated: "Yesterday", avatars: [profiles.fahad.avatar, profiles.usman.avatar, profiles.bilal.avatar] },
  { name: "Ramadan food creators", count: 38, updated: "3d", avatars: [profiles.zainab.avatar, profiles.hira.avatar, profiles.sana.avatar] },
];


const activity = [
  { tone: "success" as const, text: "5 creators reviewed in 'Bridal Lahore Q3'", who: "Sana Riaz", time: "2m" },
  { tone: "info" as const, text: "Campaign 'Eid Sale 2026' moved 3 creators to outreach", who: "Bilal Hussain", time: "14m" },
  { tone: "warning" as const, text: "Bot score >40 flagged on @glamlhr.studio", who: "System", time: "47m" },
  { tone: "info" as const, text: "Lookalike returned 28 matches for @sanaa.k", who: "Fahad Qureshi", time: "1h" },
];

export function Overview({ credits, setView }: { credits: number; setView?: (v: DashView) => void }) {
  const go = (v: DashView) => setView?.(v);
  const { user } = useAuth();
  const campaigns = useCampaigns();
  const [loading, setLoading] = useState(true);
  const [entryQuery, setEntryQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setLoading(false), 550);
    return () => clearTimeout(id);
  }, []);

  const firstName = (user?.name ?? "there").split(" ")[0];

  const startSearch = () => {
    if (entryQuery.trim()) {
      try {
        sessionStorage.setItem("mushin.pendingQuery", entryQuery.trim());
      } catch {
        /* storage unavailable — search opens without prefill */
      }
    }
    go("search");
  };

  return (
    <div className="space-y-6">
      {/* Welcome header — Volume 2 §5 */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1
            className="tracking-tight text-slate-900"
            style={{ fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-0.025em" }}
          >
            Welcome back, {firstName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Here's what's happening across your MUSHIN workspace today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => go("lists")} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 transition-all hover:-translate-y-px hover:bg-slate-50 hover:shadow-sm">
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            New list
          </button>
          <button onClick={() => go("search")} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm text-white transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-md">
            <Search className="h-3.5 w-3.5" strokeWidth={2} />
            New search
          </button>
        </div>
      </div>

      {/* Inline AI search entry (§6) */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={entryQuery}
          onChange={(e) => setEntryQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && startSearch()}
          placeholder="Describe who you're looking for — e.g. bridal creators in Lahore, 50k+, 5%+ engagement…"
          className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-28 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100"
        />
        <button
          onClick={startSearch}
          className="absolute right-2 top-1/2 inline-flex h-9 -translate-y-1/2 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-xs text-white transition-all hover:-translate-y-1/2 hover:bg-slate-800"
          style={{ fontWeight: 500 }}
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
          Search
        </button>
      </div>

      {/* Data-freshness notice (§6, §8.3) */}
      {!loading && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-900" style={{ fontWeight: 600 }}>
              Some creator data is aging
            </div>
            <p className="mt-0.5 text-[11px] text-slate-600" style={{ lineHeight: 1.5 }}>
              A portion of the creators in your lists were last refreshed over two weeks ago. Followers and engagement
              may have shifted. Run live discovery on a profile to refresh it before making a decision.
            </p>
          </div>
          <button
            onClick={() => go("lists")}
            className="flex-shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] text-amber-800 transition-colors hover:bg-amber-100"
            style={{ fontWeight: 500 }}
          >
            Review lists
          </button>
        </div>
      )}

      {/* Row 1: Credit balance · Subscription · Quick actions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CreditBalanceCard credits={credits} loading={loading} go={go} />
        <SubscriptionCard loading={loading} go={go} />
        <QuickActionsCard go={go} />
      </div>

      {/* Row 2: Usage analytics (2/3) + Recent searches (1/3) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <UsageAnalyticsCard loading={loading} />
        <RecentSearchesCard loading={loading} go={go} />
      </div>

      {/* Row 3: Saved lists (2/3) + Campaign summary (1/3) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SavedListsCard loading={loading} go={go} />
        <CampaignSummaryCard campaigns={campaigns} loading={loading} go={go} />
      </div>

      {/* Row 4: Activity feed */}
      <ActivityFeedCard loading={loading} go={go} />
    </div>
  );
}

/* ─────────────────────── shared bits ─────────────────────── */

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}
    >
      {children}
    </motion.div>
  );
}

function CardHead({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
          {title}
        </div>
        {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-md bg-slate-100 ${className}`}
      style={{ animation: "mushinShimmer 1.4s ease-in-out infinite" }}
    >
      <style>{`
        @keyframes mushinShimmer {
          0%,100% { background: rgb(241 245 249); }
          50% { background: rgb(226 232 240); }
        }
      `}</style>
    </div>
  );
}

/* ─────────────────────── credit balance ─────────────────────── */

function CreditBalanceCard({ credits, loading, go }: { credits: number; loading: boolean; go: (v: DashView) => void }) {
  const summary = useBillingSummary().data;
  const max = Math.max(1, summary?.balance.base ?? 1);
  const renewal = summary?.currentPeriodEnd
    ? `${summary.cancelAtPeriodEnd ? "Ends" : "Renews"} on ${new Date(summary.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
    : summary?.status === "trialing"
      ? `Trial: ${summary.trialDaysLeft ?? 0} days left`
      : "No active plan";
  const remainingPct = Math.max(0, Math.min(100, (credits / max) * 100));
  const bar =
    remainingPct > 50 ? "bg-emerald-500" : remainingPct >= 20 ? "bg-amber-500" : "bg-red-500";

  return (
    <Card>
      <CardHead
        title="Credit balance"
        subtitle="Search + enrichment pool"
        action={
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700" style={{ fontWeight: 600 }}>
            <Sparkles className="h-2.5 w-2.5" /> Healthy
          </span>
        }
      />
      {loading ? (
        <>
          <Skeleton className="mt-5 h-8 w-32" />
          <Skeleton className="mt-4 h-1.5 w-full" />
          <Skeleton className="mt-4 h-3 w-40" />
        </>
      ) : (
        <>
          <div className="mt-4 text-slate-900 tabular-nums" style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.03em" }}>
            <AnimatedNumber value={credits} />
          </div>
          <div className="mt-1 text-xs text-slate-500">of {max.toLocaleString()} {summary?.status === "trialing" ? "trial" : "monthly"} credits</div>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${remainingPct}%` }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              className={`h-full rounded-full ${bar}`}
            />
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>{renewal}</span>
            <button onClick={() => go("billing")} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700" style={{ fontWeight: 500 }}>
              Top up <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

/* ─────────────────────── subscription ─────────────────────── */

function SubscriptionCard({ loading, go }: { loading: boolean; go: (v: DashView) => void }) {
  const summary = useBillingSummary().data;
  const plans = useBillingPlans().data;
  const plan = plans?.plans.find((p) => p.id === summary?.plan?.id);
  const price = plan ? (summary?.interval === "year" ? plan.display.yearlyPerMonth : plan.display.monthly) : null;
  return (
    <Card>
      <CardHead
        title="Subscription"
        subtitle={summary?.plan ? `${summary.plan.name} · ${summary.interval === "year" ? "Yearly" : "Monthly"}` : summary?.status === "trialing" ? "Free trial" : "No active plan"}
        action={
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700" style={{ fontWeight: 600 }}>
            {summary?.status === "active" ? "Active" : summary?.status === "trialing" ? "Trial" : "Inactive"}
          </span>
        }
      />
      {loading ? (
        <>
          <Skeleton className="mt-5 h-6 w-28" />
          <Skeleton className="mt-3 h-3 w-36" />
          <Skeleton className="mt-5 h-9 w-full" />
        </>
      ) : (
        <>
          <div className="mt-4 flex items-baseline gap-1.5">
            <span className="text-slate-900" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
              {price ? `Rs. ${(price.amountMinor / 100).toLocaleString("en-PK")}` : "—"}
            </span>
            <span className="text-xs text-slate-500">/ month</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">{summary?.currentPeriodEnd ? `Renews ${new Date(summary.currentPeriodEnd).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : "Choose a plan in Credits & billing"}</div>
          <ul className="mt-4 space-y-1.5 text-xs text-slate-600">
            {["Multi-platform discovery", COPY.suspiciousActivity, COPY.priorityRefresh].map((f) => (
              <li key={f} className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> {f}
              </li>
            ))}
          </ul>
          <button onClick={() => go("billing")} className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 transition-colors hover:bg-slate-50" style={{ fontWeight: 500 }}>
            Manage subscription
            <ArrowUpRight className="h-3 w-3" />
          </button>
        </>
      )}
    </Card>
  );
}

/* ─────────────────────── quick actions ─────────────────────── */

function QuickActionsCard({ go }: { go: (v: DashView) => void }) {
  const actions: { icon: any; label: string; tone: string; target: DashView }[] = [
    { icon: Search, label: "Start a search", tone: "text-indigo-600 bg-indigo-50", target: "search" },
    { icon: Plus, label: "New list", tone: "text-emerald-600 bg-emerald-50", target: "lists" },
    { icon: FolderKanban, label: "New campaign", tone: "text-amber-600 bg-amber-50", target: "campaigns" },
    { icon: Zap, label: "Top up credits", tone: "text-purple-600 bg-purple-50", target: "billing" },
  ];
  return (
    <Card>
      <CardHead title="Quick actions" subtitle="Start something new" />
      <div className="mt-4 grid grid-cols-2 gap-2">
        {actions.map((a, i) => (
          <motion.button
            key={a.label}
            onClick={() => go(a.target)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i, duration: 0.25 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            className="group flex flex-col items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-left transition-all hover:border-slate-300 hover:shadow-sm"
          >
            <span className={`flex h-7 w-7 items-center justify-center rounded-md ${a.tone}`}>
              <a.icon className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <span className="text-xs text-slate-900" style={{ fontWeight: 500 }}>{a.label}</span>
          </motion.button>
        ))}
      </div>
    </Card>
  );
}

/* ─────────────────────── usage analytics ─────────────────────── */

function UsageAnalyticsCard({ loading }: { loading: boolean }) {
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");
  return (
    <div className="lg:col-span-2">
      <Card className="lg:col-span-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
                Usage analytics
              </div>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-500" style={{ fontWeight: 600 }}>
                Sample
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate-500">Illustrative figures — live usage appears once tracking is connected</div>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
            {(["7d", "30d", "90d"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded px-2 py-1 text-[11px] transition-colors ${
                  range === r ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
                style={{ fontWeight: 500 }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <Skeleton className="mt-5 h-56 w-full" />
        ) : (
          <div className="mt-5 h-56">
            <svg viewBox="0 0 600 200" className="h-full w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="usageFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[40, 80, 120, 160].map((y) => (
                <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="rgb(241 245 249)" strokeDasharray="2 4" />
              ))}
              <motion.path
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 1.1, ease: "easeInOut" }}
                d="M0,150 C50,130 90,90 150,100 C210,110 250,60 320,75 C390,90 430,40 500,60 C560,75 580,55 600,45"
                fill="none"
                stroke="rgb(79 70 229)"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <motion.path
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.4 }}
                d="M0,150 C50,130 90,90 150,100 C210,110 250,60 320,75 C390,90 430,40 500,60 C560,75 580,55 600,45 L600,200 L0,200 Z"
                fill="url(#usageFill)"
              />
            </svg>
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
          {[
            { label: "Searches", value: "1,284", delta: "+12.4%" },
            { label: "Enrichments", value: "8,421", delta: "+3.1%" },
            { label: "Events", value: "23,410", delta: "+24.7%" },
          ].map((m) => (
            <div key={m.label}>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">{m.label}</div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="tabular-nums text-slate-900" style={{ fontSize: 16, fontWeight: 600 }}>
                  {m.value}
                </span>
                <span className="text-[11px] text-emerald-600">{m.delta}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ─────────────────────── recent searches ─────────────────────── */

function PlatformDot({ platform }: { platform: "instagram" | "tiktok" | "youtube" }) {
  const map = {
    instagram: { Icon: Instagram, bg: "bg-gradient-to-br from-pink-500 to-orange-400" },
    tiktok: { Icon: Music2, bg: "bg-slate-900" },
    youtube: { Icon: Youtube, bg: "bg-red-500" },
  }[platform];
  return (
    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-white ${map.bg}`}>
      <map.Icon className="h-3 w-3" strokeWidth={2} />
    </span>
  );
}

function RecentSearchesCard({ loading, go }: { loading: boolean; go: (v: DashView) => void }) {
  return (
    <Card>
      <CardHead
        title="Recent searches"
        subtitle="Last 5 queries"
        action={
          <button onClick={() => go("search")} className="inline-flex items-center gap-0.5 text-[11px] text-indigo-600 hover:text-indigo-700" style={{ fontWeight: 500 }}>
            View all <ArrowUpRight className="h-3 w-3" />
          </button>
        }
      />
      {loading ? (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : recentSearches.length === 0 ? (
        <EmptyState icon={Search} title="No searches yet" body="Kick off your first search to see it here." />
      ) : (
        <div className="mt-3 divide-y divide-slate-100">
          {recentSearches.map((r) => (
            <div key={r.query} className="flex items-center gap-3 py-2.5">
              <PlatformDot platform={r.platform} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-slate-900" style={{ fontWeight: 500 }}>
                  {r.query}
                </div>
                <div className="text-[11px] text-slate-500">{r.count} results · {r.time}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────── saved lists ─────────────────────── */

function SavedListsCard({ loading, go }: { loading: boolean; go: (v: DashView) => void }) {
  return (
    <div className="lg:col-span-2">
      <Card className="lg:col-span-2">
        <CardHead
          title="Saved lists"
          subtitle="Recently updated shortlists"
          action={
            <button onClick={() => go("lists")} className="inline-flex items-center gap-0.5 text-[11px] text-indigo-600 hover:text-indigo-700" style={{ fontWeight: 500 }}>
              Open Lists <ArrowUpRight className="h-3 w-3" />
            </button>
          }
        />
        {loading ? (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : savedLists.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No saved lists yet"
            body="Build a shortlist from search results."
            cta="New list"
          />
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {savedLists.map((l) => (
              <motion.button
                key={l.name}
                whileHover={{ y: -2 }}
                className="group flex flex-col items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-left transition-all hover:border-slate-300 hover:shadow-sm"
              >
                <div className="flex -space-x-1.5">
                  {l.avatars.map((a, i) => (
                    <img
                      key={i}
                      src={a}
                      alt=""
                      className="h-6 w-6 rounded-full border-2 border-white object-cover"
                    />
                  ))}
                </div>
                <div className="text-xs text-slate-900" style={{ fontWeight: 500 }}>
                  {l.name}
                </div>
                <div className="text-[11px] text-slate-500">
                  {l.count} creators · updated {l.updated} ago
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─────────────────────── campaign summary ─────────────────────── */

function CampaignSummaryCard({ campaigns, loading, go }: { campaigns: readonly Campaign[]; loading: boolean; go: (v: DashView) => void }) {
  // Same labels and dot colours as the Campaigns screen.
  const statusMap: Record<CampaignStatus, { color: string; label: string }> = {
    active: { color: "bg-emerald-500", label: "Active" },
    draft: { color: "bg-slate-400", label: "Draft" },
    paused: { color: "bg-amber-500", label: "Paused" },
    completed: { color: "bg-indigo-500", label: "Completed" },
  };
  return (
    <Card>
      <CardHead
        title="Campaigns"
        subtitle="Active pipelines"
        action={
          <button onClick={() => go("campaigns")} className="inline-flex items-center gap-0.5 text-[11px] text-indigo-600 hover:text-indigo-700" style={{ fontWeight: 500 }}>
            All <ArrowUpRight className="h-3 w-3" />
          </button>
        }
      />
      {loading ? (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No campaigns" body="Create your first campaign to track outreach." cta="New campaign" />
      ) : (
        <div className="mt-4 space-y-3">
          {campaigns.map((c) => (
            <div key={c.name}>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="truncate text-xs text-slate-900" style={{ fontWeight: 500 }}>
                    {c.name}
                  </div>
                  <div className="text-[11px] text-slate-500">{c.creators.length} creators</div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-700" style={{ fontWeight: 500 }}>
                  <span className={`h-1.5 w-1.5 rounded-full ${statusMap[c.status].color}`} />
                  {statusMap[c.status].label}
                </span>
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.round(progressRatio(c) * 100)}%` }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                  className="h-full rounded-full bg-indigo-500"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────── activity feed ─────────────────────── */

function ActivityFeedCard({ loading, go }: { loading: boolean; go: (v: DashView) => void }) {
  const toneIcon = { success: CheckCircle2, info: Info, warning: AlertTriangle };
  const toneColor = { success: "text-emerald-600", info: "text-indigo-600", warning: "text-amber-600" };

  return (
    <Card>
      <CardHead
        title="Recent activity"
        subtitle="Sample events — real activity appears as your team works"
        action={
          <button onClick={() => go("activity")} className="inline-flex items-center gap-0.5 text-[11px] text-indigo-600 hover:text-indigo-700" style={{ fontWeight: 500 }}>
            Open activity log <ArrowUpRight className="h-3 w-3" />
          </button>
        }
      />
      {loading ? (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : activity.length === 0 ? (
        <EmptyState icon={ActivityIcon} title="Quiet in here" body="No workspace activity in the last 24 hours." />
      ) : (
        <div className="mt-3 divide-y divide-slate-100">
          {activity.map((a, i) => {
            const Icon = toneIcon[a.tone];
            return (
              <div key={i} className="flex items-start gap-3 py-3">
                <Icon className={`h-4 w-4 flex-shrink-0 ${toneColor[a.tone]}`} strokeWidth={2} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-900" style={{ lineHeight: 1.5 }}>
                    {a.text}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {a.who} · {a.time} ago
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────── empty state ─────────────────────── */

function EmptyState({
  icon: Icon,
  title,
  body,
  cta,
}: {
  icon: any;
  title: string;
  body: string;
  cta?: string;
}) {
  return (
    <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <div className="mt-3 text-xs text-slate-900" style={{ fontWeight: 600 }}>
        {title}
      </div>
      <p className="mt-1 max-w-xs text-[11px] text-slate-500">{body}</p>
      {cta && (
        <button className="mt-3 inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] text-white transition-colors hover:bg-slate-800" style={{ fontWeight: 500 }}>
          <Plus className="h-3 w-3" strokeWidth={2} />
          {cta}
        </button>
      )}
    </div>
  );
}
