import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  LayoutDashboard,
  Users,
  Coins,
  TrendingUp,
  Search,
  Server,
  ShieldCheck,
  LifeBuoy,
  Activity,
  Settings,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  AlertTriangle,
  X,
  MoreHorizontal,
  Ban,
  Repeat,
  Zap,
  Circle,
} from "lucide-react";
import { profiles } from "../../auth/profiles";

/**
 * Volume 6 — Admin Platform, Support Console & Operations.
 * Sections: Admin Dashboard, User Management, Credits & Billing Admin,
 * Revenue & Analytics, Search Operations, Providers, Security Center,
 * Support Console, Monitoring & Alerts, System Settings.
 */

type AdminView =
  | "dashboard"
  | "users"
  | "credits"
  | "revenue"
  | "search-ops"
  | "providers"
  | "security"
  | "support"
  | "monitoring"
  | "settings";

const nav: { id: AdminView; label: string; icon: any }[] = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "credits", label: "Credits & billing", icon: Coins },
  { id: "revenue", label: "Revenue", icon: TrendingUp },
  { id: "search-ops", label: "Search operations", icon: Search },
  { id: "providers", label: "Providers", icon: Server },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "support", label: "Support console", icon: LifeBuoy },
  { id: "monitoring", label: "Monitoring", icon: Activity },
  { id: "settings", label: "System settings", icon: Settings },
];

export function AdminConsole({ onExit }: { onExit: () => void }) {
  const [view, setView] = useState<AdminView>("dashboard");

  return (
    <div className="flex h-full min-h-0 flex-1">
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50/60">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-900 text-white" style={{ fontSize: 10, fontWeight: 700 }}>
            A
          </span>
          <div className="text-slate-900" style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Admin console
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {nav.map((item) => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                  active ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white"
                }`}
                style={{ fontWeight: 500 }}
              >
                <item.icon className={`h-4 w-4 ${active ? "text-indigo-600" : "text-slate-500"}`} strokeWidth={1.75} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <button
            onClick={onExit}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs text-slate-600 transition-colors hover:bg-white"
            style={{ fontWeight: 500 }}
          >
            <X className="h-3.5 w-3.5" />
            Exit admin
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-white px-6 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22 }}
          >
            {view === "dashboard" && <AdminDashboard />}
            {view === "users" && <UserManagement />}
            {view === "credits" && <CreditsAdmin />}
            {view === "revenue" && <RevenueAnalytics />}
            {view === "search-ops" && <SearchOperations />}
            {view === "providers" && <ApiProviders />}
            {view === "security" && <SecurityCenter />}
            {view === "support" && <SupportConsole />}
            {view === "monitoring" && <Monitoring />}
            {view === "settings" && <SystemSettings />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

/* ─────────────────────── shared ─────────────────────── */

function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between">
      <div>
        <h1 className="tracking-tight text-slate-900" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
          {title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
      {actions}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

function KPI({ label, value, delta, positive = true }: { label: string; value: string; delta?: string; positive?: boolean }) {
  return (
    <Card>
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-2 tabular-nums text-slate-900" style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.025em" }}>
        {value}
      </div>
      {delta && (
        <div className={`mt-1 inline-flex items-center gap-0.5 text-xs ${positive ? "text-emerald-600" : "text-red-600"}`}>
          {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {delta}
        </div>
      )}
    </Card>
  );
}

function StatusPill({ tone, children }: { tone: "healthy" | "warn" | "critical" | "info"; children: React.ReactNode }) {
  const map = {
    healthy: "bg-emerald-50 text-emerald-700",
    warn: "bg-amber-50 text-amber-700",
    critical: "bg-red-50 text-red-700",
    info: "bg-indigo-50 text-indigo-700",
  }[tone];
  const dot = {
    healthy: "bg-emerald-500",
    warn: "bg-amber-500",
    critical: "bg-red-500",
    info: "bg-indigo-500",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${map}`} style={{ fontWeight: 600 }}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

/* ─────────────────────── Admin Dashboard ─────────────────────── */

function AdminDashboard() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Platform overview"
        subtitle="Live KPIs, system health, and queue status across MUSHIN."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPI label="MRR" value="Rs. 48.2L" delta="+8.2% MoM" />
        <KPI label="Active workspaces" value="1,284" delta="+124 (30d)" />
        <KPI label="Searches (24h)" value="9,214" delta="+18.4%" />
        <KPI label="Credit events (24h)" value="128,402" delta="+2.1%" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>System health</div>
                <div className="text-xs text-slate-500">All services in the last 60 minutes</div>
              </div>
              <StatusPill tone="healthy">Operational</StatusPill>
            </div>
            <div className="mt-4 h-40">
              <svg viewBox="0 0 600 160" className="h-full w-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="adminFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[30, 70, 110].map((y) => (
                  <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="rgb(241 245 249)" strokeDasharray="2 4" />
                ))}
                <motion.path
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.1 }}
                  d="M0,120 C60,110 100,90 160,88 C220,86 260,70 320,72 C380,74 420,60 480,58 C540,56 580,50 600,48"
                  stroke="rgb(5 150 105)"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                />
                <motion.path
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  d="M0,120 C60,110 100,90 160,88 C220,86 260,70 320,72 C380,74 420,60 480,58 C540,56 580,50 600,48 L600,160 L0,160 Z"
                  fill="url(#adminFill)"
                />
              </svg>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-3 text-xs">
              {[
                { l: "Latency p95", v: "184ms", t: "healthy" as const },
                { l: "Queue depth", v: "23", t: "healthy" as const },
                { l: "Error rate", v: "0.24%", t: "healthy" as const },
                { l: "Uptime 30d", v: "99.98%", t: "healthy" as const },
              ].map((m) => (
                <div key={m.l}>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{m.l}</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="tabular-nums text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>{m.v}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card>
          <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>Alerts</div>
          <div className="mt-3 space-y-2 text-xs">
            {[
              { tone: "warn" as const, text: "Provider `Modash` latency > 3s (12 min)", time: "8m" },
              { tone: "info" as const, text: "Feature flag `bulk-outreach` enabled for 5% cohort", time: "42m" },
              { tone: "healthy" as const, text: "Cron `nightly-rescore` completed in 2m 14s", time: "3h" },
            ].map((a, i) => (
              <div key={i} className="flex items-start gap-2 rounded-md border border-slate-100 bg-slate-50/50 p-2.5">
                <StatusPill tone={a.tone}>{a.tone === "healthy" ? "OK" : a.tone === "warn" ? "Warning" : "Info"}</StatusPill>
                <div className="min-w-0 flex-1">
                  <div className="text-slate-900" style={{ fontSize: 12, lineHeight: 1.4 }}>{a.text}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">{a.time} ago</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ─────────────────────── User Management ─────────────────────── */

const users = [
  { name: profiles.ahmed.name, avatar: profiles.ahmed.avatar, email: "ahmed@mushin.pk", workspace: "MUSHIN Karachi", role: "Owner", plan: "Growth", status: "active", credits: 84210 },
  { name: profiles.ayesha.name, avatar: profiles.ayesha.avatar, email: "ayesha@brandx.pk", workspace: "BrandX Apparel", role: "Admin", plan: "Scale", status: "active", credits: 24800 },
  { name: profiles.bilal.name, avatar: profiles.bilal.avatar, email: "bilal@mushin.pk", workspace: "MUSHIN Karachi", role: "Analyst", plan: "Growth", status: "active", credits: 84210 },
  { name: profiles.sana.name, avatar: profiles.sana.avatar, email: "sana@heritagelahore.pk", workspace: "Heritage Lahore", role: "Owner", plan: "Growth", status: "suspended", credits: 0 },
  { name: profiles.fahad.name, avatar: profiles.fahad.avatar, email: "fahad@glowkarachi.pk", workspace: "Glow Karachi", role: "Owner", plan: "Explorer", status: "trial", credits: 500 },
  { name: profiles.hira.name, avatar: profiles.hira.avatar, email: "hira@freshfit.pk", workspace: "FreshFit", role: "Admin", plan: "Growth", status: "active", credits: 12400 },
];

function UserManagement() {
  const [selected, setSelected] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const filtered = users.filter(
    (u) => !q || `${u.name} ${u.email} ${u.workspace}`.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title="User management"
        subtitle={`${users.length} users across ${new Set(users.map((u) => u.workspace)).size} workspaces`}
        actions={
          <button className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
            Invite user
          </button>
        }
      />
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search users, emails, workspaces…"
            className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100"
          />
        </div>
        <button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
          Filters
        </button>
        <button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
          Export CSV
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2.5" style={{ fontWeight: 600 }}>User</th>
              <th className="px-4 py-2.5" style={{ fontWeight: 600 }}>Workspace</th>
              <th className="px-4 py-2.5" style={{ fontWeight: 600 }}>Role</th>
              <th className="px-4 py-2.5" style={{ fontWeight: 600 }}>Plan</th>
              <th className="px-4 py-2.5" style={{ fontWeight: 600 }}>Status</th>
              <th className="px-4 py-2.5 text-right" style={{ fontWeight: 600 }}>Credits</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((u, i) => (
              <tr key={u.email} className="border-t border-slate-100 hover:bg-slate-50/40">
                <td className="px-4 py-2.5">
                  <button onClick={() => setSelected(i)} className="flex items-center gap-2.5 text-left">
                    <img src={u.avatar} alt={u.name} className="h-7 w-7 rounded-full object-cover" />
                    <div>
                      <div className="text-slate-900" style={{ fontSize: 12, fontWeight: 500 }}>{u.name}</div>
                      <div className="text-[11px] text-slate-500">{u.email}</div>
                    </div>
                  </button>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-700">{u.workspace}</td>
                <td className="px-4 py-2.5 text-xs text-slate-700">{u.role}</td>
                <td className="px-4 py-2.5 text-xs text-slate-700">{u.plan}</td>
                <td className="px-4 py-2.5">
                  <StatusPill tone={u.status === "active" ? "healthy" : u.status === "trial" ? "info" : "critical"}>
                    {u.status}
                  </StatusPill>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-xs text-slate-700">{u.credits.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right">
                  <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <UserDrawer user={selected != null ? filtered[selected] : null} onClose={() => setSelected(null)} />
    </div>
  );
}

function UserDrawer({ user, onClose }: { user: (typeof users)[number] | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {user && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-3">
                <img src={user.avatar} className="h-10 w-10 rounded-full object-cover" alt={user.name} />
                <div>
                  <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>{user.name}</div>
                  <div className="text-xs text-slate-500">{user.email}</div>
                </div>
              </div>
              <button onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <button className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
                  <ShieldCheck className="h-3.5 w-3.5" /> Verify
                </button>
                <button className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
                  <Ban className="h-3.5 w-3.5" /> Suspend
                </button>
                <button className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
                  <Repeat className="h-3.5 w-3.5" /> Reset password
                </button>
                <button className="inline-flex items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs text-white hover:bg-indigo-500" style={{ fontWeight: 500 }}>
                  <Zap className="h-3.5 w-3.5" /> Impersonate
                </button>
              </div>

              <Card>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Billing snapshot</div>
                <div className="mt-2 space-y-1.5 text-xs">
                  <Row l="Plan" v={user.plan} />
                  <Row l="Workspace" v={user.workspace} />
                  <Row l="Role" v={user.role} />
                  <Row l="Credits" v={user.credits.toLocaleString()} />
                  <Row l="Lifetime" v="Rs. 148,200" />
                </div>
              </Card>

              <Card>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Recent activity</div>
                <div className="mt-2 space-y-2 text-xs">
                  {["Signed in from Karachi · 2h", "Ran search 'Bridal Lahore Q3' · 3h", "Top-up Rs. 24,500 via JazzCash · Yesterday", "Invited Bilal Hussain · 2d"].map((r, i) => (
                    <div key={i} className="flex items-center gap-2 border-b border-slate-100 pb-1.5 last:border-0">
                      <Circle className="h-1.5 w-1.5 flex-shrink-0 fill-slate-400 text-slate-400" />
                      <span className="text-slate-700">{r}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Row({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{l}</span>
      <span className="text-slate-900" style={{ fontWeight: 500 }}>{v}</span>
    </div>
  );
}

/* ─────────────────────── Credits Admin ─────────────────────── */

function CreditsAdmin() {
  const ledger = [
    { when: "2m", who: "Ahmed Raza Khan", action: "Search deduction", delta: -12, balance: 84210 },
    { when: "18m", who: "Bilal Hussain", action: "Enrichment deduction", delta: -5, balance: 84222 },
    { when: "1h", who: "Sana Riaz", action: "Refund (search failed)", delta: 32, balance: 84227 },
    { when: "3h", who: "System", action: "Monthly grant", delta: 50000, balance: 84195 },
    { when: "Yesterday", who: "Admin · Faisal Ahmed", action: "Manual grant", delta: 5000, balance: 34195 },
    { when: "2d", who: "Ahmed Raza Khan", action: "JazzCash top-up", delta: 24500, balance: 29195 },
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Credits & billing admin"
        subtitle="Manual adjustments, grants, refunds, disputes and Paddle events."
        actions={
          <div className="flex gap-2">
            <button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
              Export ledger
            </button>
            <button className="rounded-md bg-slate-900 px-3 py-2 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
              Grant credits
            </button>
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <KPI label="Outstanding refunds" value="Rs. 4,200" delta="+2 today" positive={false} />
        <KPI label="Grants this month" value="128,400" delta="+3.1%" />
        <KPI label="Failed charges" value="7" delta="-2 WoW" />
        <KPI label="Paddle balance" value="Rs. 12.4L" delta="+8.2%" />
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>Transaction ledger</div>
          <div className="text-xs text-slate-500">Last 24h · 6 entries</div>
        </div>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="py-2" style={{ fontWeight: 600 }}>When</th>
              <th style={{ fontWeight: 600 }}>Actor</th>
              <th style={{ fontWeight: 600 }}>Action</th>
              <th className="text-right" style={{ fontWeight: 600 }}>Delta</th>
              <th className="text-right" style={{ fontWeight: 600 }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((r, i) => (
              <tr key={i} className="border-b border-slate-100 last:border-0">
                <td className="py-2 text-xs text-slate-500">{r.when} ago</td>
                <td className="text-xs text-slate-700">{r.who}</td>
                <td className="text-xs text-slate-700">{r.action}</td>
                <td className={`text-right tabular-nums text-xs ${r.delta > 0 ? "text-emerald-600" : "text-red-600"}`} style={{ fontWeight: 600 }}>
                  {r.delta > 0 ? "+" : ""}{r.delta.toLocaleString()}
                </td>
                <td className="text-right tabular-nums text-xs text-slate-900" style={{ fontWeight: 500 }}>
                  {r.balance.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ─────────────────────── Revenue Analytics ─────────────────────── */

function RevenueAnalytics() {
  return (
    <div className="space-y-4">
      <PageHeader title="Revenue & analytics" subtitle="MRR, ARR, churn, conversions, provider cost, CAC/LTV." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <KPI label="MRR" value="Rs. 48.2L" delta="+8.2%" />
        <KPI label="ARR" value="Rs. 5.78Cr" delta="+11.4%" />
        <KPI label="Churn" value="0.8%" delta="-0.2pp" />
        <KPI label="LTV / CAC" value="4.6×" delta="+0.3×" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>MRR trend</div>
              <div className="text-xs text-slate-500">12 months</div>
            </div>
            <StatusPill tone="healthy">+8.2%</StatusPill>
          </div>
          <div className="mt-4 flex h-48 items-end gap-1.5">
            {[32, 34, 33, 36, 38, 39, 41, 42, 44, 45, 46, 48].map((v, i) => (
              <motion.div
                key={i}
                initial={{ height: 0 }}
                animate={{ height: `${(v / 50) * 100}%` }}
                transition={{ duration: 0.5, delay: i * 0.04 }}
                className="flex-1 rounded-t bg-gradient-to-t from-indigo-500 to-indigo-300"
              />
            ))}
          </div>
        </Card>

        <Card>
          <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>Plan mix</div>
          <div className="mt-3 space-y-2 text-xs">
            {[
              { l: "Growth", pct: 54, color: "bg-indigo-500" },
              { l: "Scale", pct: 28, color: "bg-emerald-500" },
              { l: "Explorer", pct: 18, color: "bg-amber-500" },
            ].map((p) => (
              <div key={p.l}>
                <div className="flex justify-between">
                  <span className="text-slate-700">{p.l}</span>
                  <span className="tabular-nums text-slate-900" style={{ fontWeight: 600 }}>{p.pct}%</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${p.pct}%` }} transition={{ duration: 0.7 }} className={`h-full rounded-full ${p.color}`} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ─────────────────────── Search Ops ─────────────────────── */

function SearchOperations() {
  const jobs = [
    { id: "job_8241", user: "Ahmed Raza Khan", stage: "streaming", progress: 68, elapsed: "1m 12s" },
    { id: "job_8240", user: "Ayesha Malik", stage: "enriching", progress: 42, elapsed: "48s" },
    { id: "job_8239", user: "Bilal Hussain", stage: "queued", progress: 5, elapsed: "6s" },
    { id: "job_8238", user: "Sana Riaz", stage: "failed", progress: 22, elapsed: "3s" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Search operations" subtitle="Live job monitor, queue depth, worker status." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <KPI label="Jobs (24h)" value="9,214" delta="+18.4%" />
        <KPI label="Queue depth" value="23" delta="-4" />
        <KPI label="Avg latency" value="1.4s" delta="-120ms" />
        <KPI label="Failure rate" value="0.24%" delta="-0.03pp" />
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>Live jobs</div>
          <StatusPill tone="info">4 running</StatusPill>
        </div>
        <div className="space-y-2">
          {jobs.map((j) => (
            <div key={j.id} className="rounded-lg border border-slate-100 bg-slate-50/40 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <code className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-700 ring-1 ring-slate-200">{j.id}</code>
                  <span className="text-xs text-slate-700">{j.user}</span>
                </div>
                <StatusPill tone={j.stage === "failed" ? "critical" : j.stage === "queued" ? "info" : "healthy"}>
                  {j.stage}
                </StatusPill>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <motion.div
                    animate={{ width: `${j.progress}%` }}
                    transition={{ duration: 0.4 }}
                    className={`h-full rounded-full ${j.stage === "failed" ? "bg-red-500" : "bg-indigo-500"}`}
                  />
                </div>
                <span className="tabular-nums text-[10px] text-slate-500">{j.elapsed}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ─────────────────────── Providers ─────────────────────── */

function ApiProviders() {
  const providers = [
    { name: "Modash", tone: "warn" as const, latency: "3.1s", quota: 78, cost: "Rs. 1.2L", status: "Elevated latency" },
    { name: "HypeAuditor", tone: "healthy" as const, latency: "410ms", quota: 42, cost: "Rs. 82K", status: "Operational" },
    { name: "SocialInsider", tone: "healthy" as const, latency: "620ms", quota: 34, cost: "Rs. 48K", status: "Operational" },
    { name: "Internal graph", tone: "healthy" as const, latency: "88ms", quota: 12, cost: "—", status: "Operational" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Providers" subtitle="Health, quotas, usage, credentials, and fallback routing." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {providers.map((p) => (
          <Card key={p.name}>
            <div className="flex items-center justify-between">
              <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
              <StatusPill tone={p.tone}>{p.status}</StatusPill>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Latency</div>
                <div className="tabular-nums text-slate-900" style={{ fontWeight: 600 }}>{p.latency}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Quota</div>
                <div className="tabular-nums text-slate-900" style={{ fontWeight: 600 }}>{p.quota}%</div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${p.quota > 75 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${p.quota}%` }} />
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Cost 30d</div>
                <div className="tabular-nums text-slate-900" style={{ fontWeight: 600 }}>{p.cost}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────── Security Center ─────────────────────── */

function SecurityCenter() {
  const events = [
    { tone: "critical" as const, when: "3m", user: "unknown", event: "Suspicious login from Tor exit node", ip: "185.220.•••.42" },
    { tone: "warn" as const, when: "1h", user: "Sana Riaz", event: "MFA challenge failed 3× then succeeded", ip: "39.34.•••.18" },
    { tone: "info" as const, when: "4h", user: "Bilal Hussain", event: "New device signed in · iOS 18.1", ip: "103.240.•••.9" },
    { tone: "healthy" as const, when: "Yesterday", user: "Admin · Faisal Ahmed", event: "Rotated Modash access token", ip: "internal" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Security center" subtitle="Login events, MFA compliance, rate limits, incident workflow." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <KPI label="Open incidents" value="1" delta="-2 WoW" />
        <KPI label="MFA adoption" value="86%" delta="+4pp" />
        <KPI label="Blocked signups (24h)" value="34" delta="+8" positive={false} />
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>Recent security events</div>
          <button className="text-xs text-indigo-600 hover:text-indigo-700" style={{ fontWeight: 500 }}>Open audit log</button>
        </div>
        <div className="space-y-2">
          {events.map((e, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-100 p-3">
              <StatusPill tone={e.tone}>{e.tone === "healthy" ? "OK" : e.tone === "warn" ? "Warn" : e.tone === "critical" ? "Critical" : "Info"}</StatusPill>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-slate-900" style={{ fontWeight: 500 }}>{e.event}</div>
                <div className="text-[11px] text-slate-500">
                  {e.user} · <code className="rounded bg-slate-100 px-1 text-slate-600">{e.ip}</code>
                </div>
              </div>
              <div className="text-[11px] tabular-nums text-slate-500">{e.when} ago</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ─────────────────────── Support Console ─────────────────────── */

function SupportConsole() {
  const tickets = [
    { subject: "Search returned 0 results for niche 'bridal Lahore'", user: "Ayesha Malik", tone: "warn" as const, updated: "12m", status: "In progress" },
    { subject: "JazzCash top-up not credited", user: "Fahad Qureshi", tone: "critical" as const, updated: "42m", status: "Open" },
    { subject: "How to export campaign report?", user: "Hira Sheikh", tone: "info" as const, updated: "3h", status: "Waiting" },
    { subject: "Bot score seems too aggressive", user: "Sana Riaz", tone: "healthy" as const, updated: "Yesterday", status: "Resolved" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Support console" subtitle="Tickets, impersonation, credit adjustments, workspace repair." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <KPI label="Open tickets" value="12" delta="-3 today" />
        <KPI label="Median first-response" value="48m" delta="-12m" />
        <KPI label="CSAT (30d)" value="4.8 / 5" delta="+0.1" />
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>Ticket queue</div>
          <div className="flex gap-1.5">
            <button className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50">All</button>
            <button className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50">Assigned to me</button>
          </div>
        </div>
        <div className="space-y-2">
          {tickets.map((t, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-100 p-3 hover:bg-slate-50/40">
              <StatusPill tone={t.tone}>{t.status}</StatusPill>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-slate-900" style={{ fontWeight: 500 }}>{t.subject}</div>
                <div className="text-[11px] text-slate-500">{t.user}</div>
              </div>
              <div className="text-[11px] text-slate-500">{t.updated} ago</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ─────────────────────── Monitoring ─────────────────────── */

function Monitoring() {
  const endpoints = [
    { name: "api.mushin.pk", tone: "healthy" as const, p95: "184ms", uptime: "99.98%" },
    { name: "search-worker", tone: "healthy" as const, p95: "1.4s", uptime: "99.94%" },
    { name: "enrichment-worker", tone: "warn" as const, p95: "3.1s", uptime: "99.72%" },
    { name: "billing.mushin.pk", tone: "healthy" as const, p95: "96ms", uptime: "100%" },
    { name: "Paddle webhook", tone: "healthy" as const, p95: "220ms", uptime: "99.99%" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Monitoring & alerts" subtitle="Health endpoints, cron status, webhook failures, escalations." />
      <Card>
        <div className="mb-3 text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>Endpoints (30d)</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="py-2" style={{ fontWeight: 600 }}>Endpoint</th>
              <th style={{ fontWeight: 600 }}>Status</th>
              <th className="text-right" style={{ fontWeight: 600 }}>p95</th>
              <th className="text-right" style={{ fontWeight: 600 }}>Uptime</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((e) => (
              <tr key={e.name} className="border-b border-slate-100 last:border-0">
                <td className="py-2 text-xs text-slate-900" style={{ fontWeight: 500 }}>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5">{e.name}</code>
                </td>
                <td><StatusPill tone={e.tone}>{e.tone === "healthy" ? "Healthy" : "Degraded"}</StatusPill></td>
                <td className="text-right tabular-nums text-xs text-slate-700">{e.p95}</td>
                <td className="text-right tabular-nums text-xs text-slate-700">{e.uptime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ─────────────────────── System Settings ─────────────────────── */

function SystemSettings() {
  const flags = [
    { flag: "bulk-outreach", enabled: true, cohort: "5% cohort · Growth+", owner: "Ahmed" },
    { flag: "ai-summary-v2", enabled: false, cohort: "Internal only", owner: "Bilal" },
    { flag: "campaign-kanban", enabled: true, cohort: "All", owner: "Sana" },
    { flag: "urdu-transliteration", enabled: true, cohort: "Beta users", owner: "Fahad" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="System settings" subtitle="Feature flags, maintenance mode, release channels." />
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>Feature flags</div>
          <button className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>New flag</button>
        </div>
        <div className="divide-y divide-slate-100">
          {flags.map((f) => (
            <div key={f.flag} className="flex items-center justify-between py-2.5">
              <div>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">{f.flag}</code>
                <div className="mt-1 text-[11px] text-slate-500">{f.cohort} · owner {f.owner}</div>
              </div>
              <Toggle enabled={f.enabled} />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>Maintenance mode</div>
        <p className="mt-1 text-xs text-slate-500">Show a banner + block writes when enabled. Reads stay online.</p>
        <div className="mt-3 flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50/40 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" strokeWidth={2} />
            <div>
              <div className="text-xs text-slate-900" style={{ fontWeight: 500 }}>Not scheduled</div>
              <div className="text-[11px] text-slate-500">Next window: none</div>
            </div>
          </div>
          <button className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
            Schedule maintenance
          </button>
        </div>
      </Card>
    </div>
  );
}

function Toggle({ enabled: initial }: { enabled: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <button
      onClick={() => setOn((v) => !v)}
      className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-slate-300"}`}
      aria-pressed={on}
    >
      <motion.span
        animate={{ x: on ? 18 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm"
      />
    </button>
  );
}

/* export a helper for the "Overall status pill" so other components can reuse */
export function OverallStatusOK() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700" style={{ fontWeight: 600 }}>
      <CheckCircle2 className="h-3 w-3" /> All systems normal
    </span>
  );
}
