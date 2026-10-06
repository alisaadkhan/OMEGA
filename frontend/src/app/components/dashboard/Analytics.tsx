import { motion } from "motion/react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { FolderKanban, Users, Wallet, Radio, TrendingUp } from "lucide-react";
import { EmptyState } from "./states";
import { useCampaigns, STAGES } from "../../lib/campaignStore";

/**
 * Analytics — spec §12.
 * Real-only, structural numbers derived from the workspace's campaigns and lists.
 * Nothing here fabricates performance the product cannot measure yet: outreach
 * results render an explicit "not connected" empty state instead of fake rates.
 * Every chart is paired with a text summary for accessibility (§28).
 */

const PKR = (n: number) =>
  n >= 100000 ? `Rs. ${(n / 100000).toFixed(1)}L` : `Rs. ${(n / 1000).toFixed(0)}K`;

const STATUS_COLORS: Record<string, string> = {
  active: "#10b981",
  paused: "#f59e0b",
  draft: "#94a3b8",
  completed: "#6366f1",
};

export function Analytics() {
  const campaigns = useCampaigns();

  const allCreators = campaigns.flatMap((c) => c.creators);
  const creatorsByStage = STAGES.map((s) => ({
    stage: s.label,
    count: allCreators.filter((cr) => cr.stage === s.id).length,
  }));

  const statusGroups = ["active", "paused", "draft", "completed"] as const;
  const campaignStatus = statusGroups
    .map((st) => ({
      name: st.charAt(0).toUpperCase() + st.slice(1),
      value: campaigns.filter((c) => c.status === st).length,
      color: STATUS_COLORS[st],
    }))
    .filter((g) => g.value > 0);

  const budgetData = campaigns.map((c) => ({
    campaign: c.name.length > 12 ? c.name.slice(0, 12) + "…" : c.name,
    planned: c.budget,
    committed: c.spent,
  }));

  const totalCreators = allCreators.length;
  const confirmedCount = allCreators.filter((cr) => cr.stage === "confirmed").length;
  const totalCampaigns = campaigns.length;
  const totalPlanned = campaigns.reduce((a, c) => a + c.budget, 0);
  const totalCommitted = campaigns.reduce((a, c) => a + c.spent, 0);
  const committedPct = totalPlanned > 0 ? Math.round((totalCommitted / totalPlanned) * 100) : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="tracking-tight text-slate-900" style={{ fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-0.025em" }}>
          Analytics
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Structural view of your workspace — campaigns, pipeline, and committed budget.
        </p>
      </div>

      {/* Summary tiles — real structural counts */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={FolderKanban} label="Campaigns" value={String(totalCampaigns)} sub={`${campaigns.filter(c => c.status === "active").length} active`} />
        <StatTile icon={Users} label="Creators in pipeline" value={String(totalCreators)} sub={`${confirmedCount} confirmed`} />
        <StatTile icon={Wallet} label="Budget committed" value={PKR(totalCommitted)} sub={`${committedPct}% of ${PKR(totalPlanned)} planned`} />
        <StatTile icon={TrendingUp} label="Confirmation rate" value={totalCreators > 0 ? `${Math.round((confirmedCount / totalCreators) * 100)}%` : "—"} sub="Confirmed ÷ total in pipeline" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Creators by stage */}
        <ChartCard
          className="lg:col-span-2"
          title="Creators by pipeline stage"
          summary={`${totalCreators} creators across the pipeline: ${creatorsByStage.map((s) => `${s.count} ${s.stage.toLowerCase()}`).join(", ")}.`}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={creatorsByStage} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="stage" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: "#f8fafc" }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="count" name="Creators" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={64} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Campaign status donut */}
        <ChartCard
          title="Campaigns by status"
          summary={campaignStatus.map((c) => `${c.value} ${c.name.toLowerCase()}`).join(", ") + "."}
        >
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={campaignStatus} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2}>
                {campaignStatus.map((c) => (
                  <Cell key={c.name} fill={c.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            {campaignStatus.map((c) => (
              <span key={c.name} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
                <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                {c.name} · {c.value}
              </span>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* Budget planned vs committed */}
      <ChartCard
        title="Budget — planned vs committed"
        summary={budgetData.map((b) => `${b.campaign}: ${PKR(b.committed)} committed of ${PKR(b.planned)} planned`).join("; ") + "."}
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={budgetData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="campaign" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => PKR(v)} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={64} />
            <Tooltip
              cursor={{ fill: "#f8fafc" }}
              formatter={(v: number) => PKR(v)}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Bar dataKey="planned" name="Planned" fill="#cbd5e1" radius={[6, 6, 0, 0]} maxBarSize={40} />
            <Bar dataKey="committed" name="Committed" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-2 flex justify-center gap-4 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-300" /> Planned</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Committed</span>
        </div>
      </ChartCard>

      {/* Outreach performance — honestly unavailable (§12) */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-slate-500" strokeWidth={2} />
          <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Outreach & delivery performance
          </div>
        </div>
        <EmptyState
          className="mt-4"
          title="Performance tracking isn't connected yet"
          body="Open, reply, and delivery rates will appear here once outreach is sent through MUSHIN and a provider confirms results. We don't estimate these numbers — they stay empty until they're real."
        />
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
        <Icon className="h-3 w-3" strokeWidth={2} /> {label}
      </div>
      <div className="mt-1.5 tabular-nums text-slate-900" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>
    </motion.div>
  );
}

function ChartCard({
  title,
  summary,
  children,
  className = "",
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
        {title}
      </div>
      <div className="mt-4">{children}</div>
      <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500" style={{ lineHeight: 1.5 }}>
        {summary}
      </p>
    </div>
  );
}
