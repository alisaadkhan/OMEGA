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
import type { DashView } from "./Sidebar";
import { ActivityCard, CampaignsCard, ListsCard, SavedSearchesCard, SnapshotCard, WelcomeCard } from "./OverviewCards";
import { useBillingPlans, useBillingSummary } from "../../api/billing";
import { COPY } from "../../lib/copy";
import { creditBadge, subscriptionBadge } from "../../lib/billing-status";

/**
 * Volume 2 §5 — Dashboard specification.
 * Widgets: welcome header, credit balance, subscription, quick actions,
 * usage analytics, recent searches, saved lists, campaign summary,
 * activity feed. Each defines loading + empty states.
 */

export function Overview({ credits, setView }: { credits: number | null; setView?: (v: DashView) => void }) {
  const go = (v: DashView) => setView?.(v);
  const { user } = useAuth();
  const summary = useBillingSummary();
  const loading = summary.isPending;
  const [entryQuery, setEntryQuery] = useState("");

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
            className="text-[32px] font-semibold leading-10 tracking-[-0.025em] text-slate-900"
          >
            Welcome back, {firstName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Here's what's happening across your MUSHIN workspace today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => go("lists")} className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-slate-200/80 bg-white px-4 text-sm font-medium text-slate-800 transition-all hover:bg-slate-50">
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            New list
          </button>
          <button onClick={() => go("search")} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition-all hover:bg-slate-800">
            <Search className="h-3.5 w-3.5" strokeWidth={2} />
            New search
          </button>
        </div>
      </div>

      {/* Inline AI search entry (§6) */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          value={entryQuery}
          onChange={(e) => setEntryQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && startSearch()}
          placeholder="Describe who you're looking for — e.g. bridal creators in Lahore, 50k+, 5%+ engagement…"
          className="h-12 w-full rounded-2xl border border-slate-200/80 bg-white pl-11 pr-28 text-sm text-slate-900 transition-all placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100"
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

      {/* The data-freshness notice (§6, §8.3) returns when lists are backed by the API: it must reflect real list data. */}

      <WelcomeCard go={go} />

      {/* MUSHIN design (2026-10-27): figures first, then activity beside campaigns, then account and saved work. */}
      <SnapshotCard go={go} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ActivityCard go={go} />
        <CampaignsCard go={go} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CreditBalanceCard credits={credits} loading={loading} go={go} />
        <SubscriptionCard loading={loading} go={go} />
        <QuickActionsCard go={go} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ListsCard go={go} />
        <SavedSearchesCard go={go} />
      </div>
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
      className={`rounded-2xl border border-slate-200/80 bg-white p-6 ${className}`}
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

const BADGE_TONE = { good: "bg-emerald-50 text-emerald-700", warn: "bg-amber-50 text-amber-800", bad: "bg-red-50 text-red-700", neutral: "bg-indigo-50 text-indigo-700" } as const;


function CreditBalanceCard({ credits, loading, go }: { credits: number | null; loading: boolean; go: (v: DashView) => void }) {
  const summary = useBillingSummary().data;
  const badge = creditBadge(summary);
  const max = Math.max(1, summary?.balance.base ?? 1);
  const renewal = summary?.currentPeriodEnd
    ? `${summary.cancelAtPeriodEnd ? "Ends" : "Renews"} on ${new Date(summary.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
    : summary?.status === "trialing"
      ? `Trial: ${summary.trialDaysLeft ?? 0} days left`
      : "No active plan";
  const remainingPct = Math.max(0, Math.min(100, ((credits ?? 0) / max) * 100));
  const bar =
    remainingPct > 50 ? "bg-emerald-500" : remainingPct >= 20 ? "bg-amber-500" : "bg-red-500";

  return (
    <Card>
      <CardHead
        title="Credit balance"
        subtitle="Search + enrichment pool"
        action={
          badge && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${BADGE_TONE[badge.tone]}`} style={{ fontWeight: 600 }} data-testid="credit-badge">
              <Sparkles className="h-2.5 w-2.5" /> {badge.label}
            </span>
          )
        }
      />
      {loading ? (
        <>
          <Skeleton className="mt-5 h-8 w-32" />
          <Skeleton className="mt-4 h-1.5 w-full" />
          <Skeleton className="mt-4 h-3 w-40" />
        </>
      ) : credits === null ? (
        <p className="mt-4 text-sm text-slate-600" role="status">Your balance could not be loaded. Open Credits & billing to try again.</p>
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
  const badge = subscriptionBadge(summary);
  const plans = useBillingPlans().data;
  const plan = plans?.plans.find((p) => p.id === summary?.plan?.id);
  const price = plan ? (summary?.interval === "year" ? plan.display.yearlyPerMonth : plan.display.monthly) : null;
  return (
    <Card>
      <CardHead
        title="Subscription"
        subtitle={summary?.plan ? `${summary.plan.name} · ${summary.interval === "year" ? "Yearly" : "Monthly"}` : summary?.status === "trialing" ? "Free trial" : "No active plan"}
        action={
          badge && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${BADGE_TONE[badge.tone]}`} style={{ fontWeight: 600 }} data-testid="subscription-badge">
              {badge.label}
            </span>
          )
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
              <li key={f} className="flex items-center gap-1.5">
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

