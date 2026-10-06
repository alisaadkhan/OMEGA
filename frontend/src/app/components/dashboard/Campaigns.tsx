import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Plus,
  Search,
  ArrowLeft,
  Filter,
  MoreHorizontal,
  TrendingUp,
  Users,
  MessageSquare,
  Calendar,
  BarChart3,
  Settings as SettingsIcon,
  Files,
  ClipboardList,
  Kanban,
  Send,
  Instagram,
  Youtube,
  Music2,
  CheckCircle2,
  X,
} from "lucide-react";
import { profiles } from "../../auth/profiles";
import { useToast, useConfirm } from "../../lib/toast";
import {
  useCampaigns, setCampaigns, Campaign, CampaignCreator, PipelineStage,
  STAGES, STATUS_LABEL, FEE_LABEL, feeKindFor, progressLabel, progressRatio, formatDate,
} from "../../lib/campaignStore";

/**
 * CAMPAIGNS module — spec:
 * dashboard + detail tabs (Overview, Creators, Kanban Pipeline, Timeline, Messages, Files, Analytics, Settings).
 */

type Status = Campaign["status"];
type Platform = Campaign["platform"];

const pipelineTones: Record<PipelineStage, string> = {
  identified: "bg-slate-100 text-slate-700",
  contacted: "bg-indigo-50 text-indigo-700",
  negotiating: "bg-amber-50 text-amber-700",
  confirmed: "bg-emerald-50 text-emerald-700",
};

const statusMap: Record<Status, { label: string; dot: string; bg: string; text: string }> = {
  active: { label: "Active", dot: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
  draft: { label: "Draft", dot: "bg-slate-400", bg: "bg-slate-100", text: "text-slate-700" },
  completed: { label: "Completed", dot: "bg-indigo-500", bg: "bg-indigo-50", text: "text-indigo-700" },
  paused: { label: "Paused", dot: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-700" },
};

export function Campaigns() {
  const [openId, setOpenId] = useState<string | null>(null);
  const items = useCampaigns();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  const filtered = items.filter(
    (c) => !query || `${c.name} ${c.owner}`.toLowerCase().includes(query.toLowerCase())
  );

  const open = openId ? items.find((c) => c.id === openId) ?? null : null;

  const createCampaign = (draft: NewCampaignInput) => {
    const c: Campaign = {
      id: `cmp-${Date.now()}`,
      name: draft.name,
      status: "draft",
      platform: draft.platform,
      budget: draft.budget,
      spent: 0,
      creators: [],
      owner: "You",
      ownerAvatar: profiles.ahmed.avatar,
      startDate: draft.start || new Date().toISOString().slice(0, 10),
      endDate: draft.end || new Date().toISOString().slice(0, 10),
      goal: draft.objective,
      client: draft.client || undefined,
      objective: draft.objective || undefined,
      criteria: draft.criteria || undefined,
    };
    setCampaigns((prev) => [c, ...prev]);
    setCreating(false);
    toast.success("Campaign created", "Draft is ready — add creators from Search.");
    setOpenId(c.id);
  };

  if (open) {
    return <CampaignDetail campaign={open} onBack={() => setOpenId(null)} />;
  }

  const allCreators = items.flatMap((c) => c.creators);
  const stats = {
    total: items.length,
    active: items.filter((c) => c.status === "active").length,
    completed: items.filter((c) => c.status === "completed").length,
    draft: items.filter((c) => c.status === "draft").length,
    paused: items.filter((c) => c.status === "paused").length,
    spend: items.reduce((a, c) => a + c.spent, 0),
    contacted: allCreators.filter((cr) => cr.stage !== "identified").length,
    confirmed: allCreators.filter((cr) => cr.stage === "confirmed").length,
    creators: allCreators.length,
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="tracking-tight text-slate-900" style={{ fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-0.025em" }}>
            Campaigns
          </h1>
          <p className="mt-1 text-sm text-slate-500">End-to-end influencer campaigns — from outreach to completion.</p>
        </div>
        <button onClick={() => setCreating(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm text-white transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-md" style={{ fontWeight: 500 }}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          New campaign
        </button>
      </div>

      <AnimatePresence>
        {creating && <CreateCampaignModal onClose={() => setCreating(false)} onCreate={createCampaign} />}
      </AnimatePresence>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Total" value={String(stats.total)} />
        <Stat label="Active" value={String(stats.active)} tone="emerald" />
        <Stat label="Paused" value={String(stats.paused)} tone="amber" />
        <Stat label="Draft" value={String(stats.draft)} />
        <Stat label="Total spend" value={`Rs. ${(stats.spend / 100000).toFixed(1)}L`} />
        <Stat label="Contacted" value={String(stats.contacted)} />
        <Stat label="Confirmed" value={String(stats.confirmed)} tone="emerald" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search campaigns…"
            className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100"
          />
        </div>
        <button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
          <Filter className="mr-1 inline h-3 w-3" /> Filters
        </button>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {filtered.map((c) => (
          <CampaignCard key={c.id} campaign={c} onOpen={() => setOpenId(c.id)} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-6 py-16 text-center">
          <ClipboardList className="h-6 w-6 text-slate-400" strokeWidth={1.5} />
          <div className="mt-3 text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>No campaigns yet</div>
          <p className="mt-1 max-w-sm text-xs text-slate-500">Kick off outreach by creating your first campaign.</p>
          <button onClick={() => setCreating(true)} className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
            Create campaign
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "indigo" | "amber" }) {
  const color = tone === "emerald" ? "text-emerald-700" : tone === "indigo" ? "text-indigo-700" : tone === "amber" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 tabular-nums ${color}`} style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em" }}>
        {value}
      </div>
    </div>
  );
}

function PlatformChip({ platform }: { platform: Platform }) {
  if (platform === "mixed") return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600" style={{ fontWeight: 500 }}>Multi-platform</span>;
  const map = {
    instagram: { Icon: Instagram, label: "Instagram", color: "text-pink-600 bg-pink-50" },
    tiktok: { Icon: Music2, label: "TikTok", color: "text-slate-700 bg-slate-100" },
    youtube: { Icon: Youtube, label: "YouTube", color: "text-red-600 bg-red-50" },
  }[platform];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${map.color}`} style={{ fontWeight: 500 }}>
      <map.Icon className="h-2.5 w-2.5" strokeWidth={2} />
      {map.label}
    </span>
  );
}

function CampaignCard({ campaign, onOpen }: { campaign: Campaign; onOpen: () => void }) {
  const s = statusMap[campaign.status];
  return (
    <motion.button
      whileHover={{ y: -2 }}
      onClick={onOpen}
      className="group rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-slate-900" style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
              {campaign.name}
            </div>
            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${s.bg} ${s.text}`} style={{ fontWeight: 600 }}>
              <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
              {s.label}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
            <PlatformChip platform={campaign.platform} />
            <span>·</span>
            <span>{formatDate(campaign.startDate)} → {formatDate(campaign.endDate)}</span>
          </div>
        </div>
        <img src={campaign.ownerAvatar} className="h-7 w-7 rounded-full object-cover" alt={campaign.owner} />
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Budget</div>
          <div className="mt-0.5 tabular-nums text-slate-900" style={{ fontWeight: 600 }}>Rs. {(campaign.budget / 100000).toFixed(1)}L</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Spent</div>
          <div className="mt-0.5 tabular-nums text-slate-900" style={{ fontWeight: 600 }}>Rs. {(campaign.spent / 100000).toFixed(1)}L</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Creators</div>
          <div className="mt-0.5 tabular-nums text-slate-900" style={{ fontWeight: 600 }}>{campaign.creators.length}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Confirmed</div>
          <div className="mt-0.5 tabular-nums text-slate-900" style={{ fontWeight: 600 }}>{progressLabel(campaign)}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>{progressLabel(campaign)}</span>
          <span className="tabular-nums text-slate-700" style={{ fontWeight: 600 }}>{Math.round(progressRatio(campaign) * 100)}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.round(progressRatio(campaign) * 100)}%` }}
            transition={{ duration: 0.7 }}
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500"
          />
        </div>
      </div>
    </motion.button>
  );
}

/* ─────────────────────── detail ─────────────────────── */

type Tab = "overview" | "creators" | "pipeline" | "timeline" | "messages" | "files" | "analytics" | "settings";

function CampaignDetail({
  campaign,
  onBack,
}: {
  campaign: Campaign;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const toast = useToast();
  const confirm = useConfirm();
  const s = statusMap[campaign.status];

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "creators", label: "Creators", icon: Users },
    { id: "pipeline", label: "Pipeline", icon: Kanban },
    { id: "timeline", label: "Timeline", icon: Calendar },
    { id: "messages", label: "Messages", icon: MessageSquare },
    { id: "files", label: "Files", icon: Files },
    { id: "analytics", label: "Analytics", icon: TrendingUp },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];

  const archive = async () => {
    const ok = await confirm({
      title: `Archive "${campaign.name}"?`,
      body: "The campaign will move to Archived and stop accepting new outreach.",
      confirmLabel: "Archive",
    });
    if (ok) {
      toast.success("Campaign archived");
      onBack();
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-3 w-3" /> Back to campaigns
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="tracking-tight text-slate-900" style={{ fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
              {campaign.name}
            </h1>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${s.bg} ${s.text}`} style={{ fontWeight: 600 }}>
              <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
              {s.label}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <PlatformChip platform={campaign.platform} />
            <span>·</span>
            <span>Owner: {campaign.owner}</span>
            <span>·</span>
            <span>{formatDate(campaign.startDate)} → {formatDate(campaign.endDate)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <IconBtn label="Share" onClick={() => toast.info("Share link copied")} />
          <IconBtn label="Export" onClick={() => toast.success("Export started")} />
          <IconBtn label="Archive" onClick={archive} />
          <button className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs transition-colors ${
                active ? "text-slate-900" : "text-slate-500 hover:text-slate-900"
              }`}
              style={{ fontWeight: 500 }}
            >
              <t.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t.label}
              {active && (
                <motion.span layoutId="cmp-tab" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-slate-900" />
              )}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
        >
          {tab === "overview" && <OverviewTab campaign={campaign} />}
          {tab === "creators" && <CreatorsTab campaign={campaign} />}
          {tab === "pipeline" && <PipelineTab campaign={campaign} />}
          {tab === "timeline" && <TimelineTab />}
          {tab === "messages" && <MessagesTab />}
          {tab === "files" && <FilesTab />}
          {tab === "analytics" && <AnalyticsTab campaign={campaign} />}
          {tab === "settings" && <SettingsTab campaign={campaign} onBack={onBack} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function IconBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
      style={{ fontWeight: 500 }}
    >
      {label}
    </button>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-slate-900" style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>{children}</div>;
}

function OverviewTab({ campaign }: { campaign: Campaign }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <SectionTitle>Brief</SectionTitle>
        <p className="mt-2 text-sm text-slate-600" style={{ lineHeight: 1.6 }}>
          {campaign.objective || campaign.goal || "Add an objective to align creators and stakeholders."}
        </p>
        {(campaign.client || campaign.criteria) && (
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs">
            {campaign.client && (
              <div className="flex gap-2">
                <span className="w-20 flex-shrink-0 text-slate-400">Client</span>
                <span className="text-slate-700">{campaign.client}</span>
              </div>
            )}
            {campaign.criteria && (
              <div className="flex gap-2">
                <span className="w-20 flex-shrink-0 text-slate-400">Criteria</span>
                <span className="text-slate-700" style={{ lineHeight: 1.5 }}>{campaign.criteria}</span>
              </div>
            )}
          </div>
        )}
        <div className="mt-5 grid grid-cols-4 gap-3">
          <Metric label="Budget" value={`Rs. ${(campaign.budget / 100000).toFixed(1)}L`} />
          <Metric label="Spent" value={`Rs. ${(campaign.spent / 100000).toFixed(1)}L`} />
          <Metric label="Creators" value={String(campaign.creators.length)} />
          <Metric label="Confirmed" value={String(campaign.creators.filter(c => c.stage === "confirmed").length)} />
        </div>
        <div className="mt-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Overall progress</span>
            <span className="tabular-nums text-slate-700" style={{ fontWeight: 600 }}>{Math.round(progressRatio(campaign) * 100)}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
            <motion.div initial={{ width: 0 }} animate={{ width: `${Math.round(progressRatio(campaign) * 100)}%` }} transition={{ duration: 0.7 }} className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500" />
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>Performance</SectionTitle>
        <div className="mt-3 flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/40 px-4 py-8 text-center">
          <TrendingUp className="h-5 w-5 text-slate-400" strokeWidth={1.75} />
          <div className="mt-2 text-xs text-slate-700" style={{ fontWeight: 600 }}>No performance data yet</div>
          <p className="mt-1 text-[11px] text-slate-500" style={{ lineHeight: 1.5 }}>
            Reach, engagement, and ROAS appear here once posts go live and a provider reports results. We don't estimate these numbers.
          </p>
        </div>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 tabular-nums text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function CreatorsTab({ campaign }: { campaign: Campaign }) {
  const toast = useToast();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">{campaign.creators.length} creators in this campaign</div>
        <button onClick={() => toast.success("Ready to add creators", "Redirecting to Search")} className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
          <Plus className="h-3 w-3" /> Add creator
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-2.5 pl-4" style={{ fontWeight: 600 }}>Creator</th>
              <th style={{ fontWeight: 600 }}>Platform</th>
              <th className="text-right" style={{ fontWeight: 600 }}>Followers</th>
              <th className="text-right" style={{ fontWeight: 600 }}>Auth</th>
              <th className="text-right" style={{ fontWeight: 600 }}>Fee</th>
              <th style={{ fontWeight: 600 }}>Stage</th>
              <th className="pr-4" style={{ fontWeight: 600 }}>Priority</th>
            </tr>
          </thead>
          <tbody>
            {campaign.creators.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50/40">
                <td className="py-2.5 pl-4">
                  <div className="flex items-center gap-2.5">
                    <img src={c.avatar} className="h-7 w-7 rounded-full object-cover" alt={c.name} />
                    <div>
                      <div className="text-slate-900" style={{ fontSize: 12, fontWeight: 500 }}>{c.name}</div>
                      <div className="text-[11px] text-slate-500">@{c.handle}</div>
                    </div>
                  </div>
                </td>
                <td className="text-xs capitalize text-slate-600">{c.platform}</td>
                <td className="text-right tabular-nums text-xs text-slate-700">{c.followers}</td>
                <td className="text-right tabular-nums text-xs text-slate-700">{c.authenticity}</td>
                <td className="text-right tabular-nums text-xs text-slate-900" style={{ fontWeight: 500 }}>{c.fee}</td>
                <td>
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] capitalize text-slate-700" style={{ fontWeight: 500 }}>
                    {c.stage}
                  </span>
                </td>
                <td className="pr-4">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] capitalize ${
                    c.priority === "high" ? "bg-red-50 text-red-700" : c.priority === "med" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"
                  }`} style={{ fontWeight: 500 }}>
                    {c.priority}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PipelineTab({ campaign }: { campaign: Campaign }) {
  const toast = useToast();

  const moveTo = (creatorId: string, stage: PipelineStage) => {
    setCampaigns((prev) =>
      prev.map((c) =>
        c.id !== campaign.id
          ? c
          : { ...c, creators: c.creators.map((cr) => (cr.id === creatorId ? { ...cr, stage } : cr)) }
      )
    );
    toast.info(`Moved to ${STAGES.find((s) => s.id === stage)?.label}`);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {STAGES.map((s) => {
        const items = campaign.creators.filter((c) => c.stage === s.id);
        return (
          <div key={s.id} className="w-64 flex-shrink-0 rounded-xl border border-slate-200 bg-slate-50/40 p-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${pipelineTones[s.id]}`} style={{ fontWeight: 600 }}>
                {s.label}
              </span>
              <span className="text-[11px] tabular-nums text-slate-400">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((c) => (
                <PipelineCard key={c.id} creator={c} onMove={(next) => moveTo(c.id, next)} />
              ))}
              {items.length === 0 && (
                <div className="rounded-md border border-dashed border-slate-200 bg-white/50 px-3 py-4 text-center text-[11px] text-slate-400">
                  Empty
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PipelineCard({ creator, onMove }: { creator: CampaignCreator; onMove: (s: PipelineStage) => void }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="group relative rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
      <div className="flex items-start gap-2">
        <img src={creator.avatar} className="h-7 w-7 flex-shrink-0 rounded-full object-cover" alt={creator.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-slate-900" style={{ fontSize: 12, fontWeight: 500 }}>{creator.name}</div>
          <div className="truncate text-[11px] text-slate-500">@{creator.handle} · {creator.followers}</div>
        </div>
        <button onClick={() => setMenu((v) => !v)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px]">
        <span className="tabular-nums text-slate-900" style={{ fontWeight: 600 }}>{creator.fee}</span>
        <span className="text-slate-500">Due {creator.due}</span>
      </div>
      <AnimatePresence>
        {menu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute right-1 top-8 z-50 w-40 overflow-hidden rounded-md border border-slate-200 bg-white py-1 text-xs shadow-lg">
              <div className="border-b border-slate-100 px-2.5 py-1 text-[10px] uppercase tracking-wider text-slate-400">Move to</div>
              {STAGES.filter((s) => s.id !== creator.stage).map((s) => (
                <button
                  key={s.id}
                  onClick={() => { onMove(s.id); setMenu(false); }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-slate-700 hover:bg-slate-50"
                >
                  {s.label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function TimelineTab() {
  const events = [
    { date: "Jul 04", title: "@ayeshamalik post goes live", who: "Ayesha Malik", tone: "emerald" as const },
    { date: "Jul 06", title: "@sanaa.k content delivery", who: "Sana Riaz", tone: "amber" as const },
    { date: "Jul 08", title: "@usmantariq video drop", who: "Usman Tariq", tone: "amber" as const },
    { date: "Jul 12", title: "@fahad.q review upload", who: "Fahad Qureshi", tone: "indigo" as const },
    { date: "Jul 20", title: "Campaign closes · report auto-generated", who: "System", tone: "slate" as const },
  ];
  return (
    <Card>
      <SectionTitle>Milestones</SectionTitle>
      <div className="mt-4 space-y-3">
        {events.map((e, i) => (
          <div key={i} className="flex items-start gap-3 border-b border-slate-100 pb-3 last:border-0">
            <div className={`flex h-8 w-14 flex-shrink-0 items-center justify-center rounded-md text-[11px] tabular-nums ${
              e.tone === "emerald" ? "bg-emerald-50 text-emerald-700" :
              e.tone === "amber" ? "bg-amber-50 text-amber-700" :
              e.tone === "indigo" ? "bg-indigo-50 text-indigo-700" :
              "bg-slate-100 text-slate-600"
            }`} style={{ fontWeight: 600 }}>
              {e.date}
            </div>
            <div>
              <div className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{e.title}</div>
              <div className="text-xs text-slate-500">{e.who}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MessagesTab() {
  const [draft, setDraft] = useState("");
  const toast = useToast();
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <Card>
        <SectionTitle>Conversations</SectionTitle>
        <div className="mt-3 divide-y divide-slate-100">
          {[
            { name: "Ayesha Malik", avatar: profiles.ayesha.avatar, preview: "Sounds good — I'll draft the caption tonight.", time: "12m" },
            { name: "Sana Riaz", avatar: profiles.sana.avatar, preview: "Can we shift delivery to Jul 06?", time: "1h" },
            { name: "Usman Tariq", avatar: profiles.usman.avatar, preview: "Signed — sending across the video today.", time: "3h" },
          ].map((c, i) => (
            <div key={i} className={`flex items-start gap-2.5 py-2.5 ${i === 0 ? "bg-slate-50/60 -mx-2 rounded-md px-2" : ""}`}>
              <img src={c.avatar} className="h-8 w-8 rounded-full object-cover" alt={c.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="truncate text-xs text-slate-900" style={{ fontWeight: 500 }}>{c.name}</span>
                  <span className="text-[10px] text-slate-400">{c.time}</span>
                </div>
                <div className="truncate text-[11px] text-slate-500">{c.preview}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <div className="flex items-center gap-2">
          <img src={profiles.ayesha.avatar} className="h-8 w-8 rounded-full object-cover" alt="" />
          <div>
            <SectionTitle>Ayesha Malik</SectionTitle>
            <div className="text-[11px] text-slate-500">Instagram · @ayeshamalik</div>
          </div>
        </div>
        <div className="mt-4 space-y-3 text-sm">
          <Msg who="Ayesha" mine={false} text="Hey Ahmed — got the brief, looks good overall. Two thoughts on tone." />
          <Msg who="You" mine={true} text="All ears. What's the vibe you'd want to keep or adjust?" />
          <Msg who="Ayesha" mine={false} text="Less brand jargon, more real narration. I want to talk about how I actually wear it, not read a spec sheet." />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            toast.success("Message sent");
            setDraft("");
          }}
          className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply to Ayesha…"
            className="h-9 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100"
          />
          <button type="submit" className="inline-flex h-9 items-center gap-1 rounded-md bg-slate-900 px-3 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
            <Send className="h-3 w-3" /> Send
          </button>
        </form>
      </Card>
    </div>
  );
}

function Msg({ mine, text }: { who: string; mine: boolean; text: string }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-sm rounded-2xl px-3 py-2 text-sm ${mine ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-800"}`} style={{ lineHeight: 1.45 }}>
        {text}
      </div>
    </div>
  );
}

function FilesTab() {
  const files = [
    { name: "Eid_Sale_Brief.pdf", size: "1.4 MB", who: "Ahmed", when: "3d" },
    { name: "moodboard_v2.png", size: "2.1 MB", who: "Sana", when: "2d" },
    { name: "caption_variants.docx", size: "42 KB", who: "Ayesha", when: "1d" },
    { name: "spec_sheet.pdf", size: "612 KB", who: "Ahmed", when: "6h" },
  ];
  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionTitle>Files</SectionTitle>
        <button className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
          <Plus className="h-3 w-3" /> Upload
        </button>
      </div>
      <div className="mt-3 divide-y divide-slate-100">
        {files.map((f, i) => (
          <div key={i} className="flex items-center justify-between py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                <Files className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div>
                <div className="text-xs text-slate-900" style={{ fontWeight: 500 }}>{f.name}</div>
                <div className="text-[11px] text-slate-500">{f.size} · uploaded by {f.who} · {f.when} ago</div>
              </div>
            </div>
            <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AnalyticsTab({ campaign }: { campaign: Campaign }) {
  const posted = campaign.creators.filter((c) => c.stage === "confirmed").length;
  return (
    <div className="space-y-4">
      {/* Real structural counts derived from the pipeline */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Creators" value={String(campaign.creators.length)} />
        <Metric label="Content posted" value={String(posted)} />
        <Metric label="Budget" value={`Rs. ${(campaign.budget / 100000).toFixed(1)}L`} />
        <Metric label="Committed" value={`Rs. ${(campaign.spent / 100000).toFixed(1)}L`} />
      </div>
      <Card>
        <SectionTitle>Reach & engagement</SectionTitle>
        <div className="mt-3 flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/40 px-4 py-12 text-center">
          <TrendingUp className="h-6 w-6 text-slate-400" strokeWidth={1.5} />
          <div className="mt-3 text-sm text-slate-900" style={{ fontWeight: 600 }}>Performance tracking isn't connected</div>
          <p className="mt-1 max-w-sm text-xs text-slate-500" style={{ lineHeight: 1.55 }}>
            Reach, impressions, clicks, and ROAS will populate once creator posts are live and a
            measurement source reports back. Until then we show only what's verifiable — the pipeline
            counts above.
          </p>
        </div>
      </Card>
    </div>
  );
}

function SettingsTab({ campaign, onBack }: { campaign: Campaign; onBack: () => void }) {
  const [name, setName] = useState(campaign.name);
  const [goal, setGoal] = useState(campaign.goal);
  const [budget, setBudget] = useState(campaign.budget);
  const [status, setStatus] = useState<Status>(campaign.status);
  const toast = useToast();
  const confirm = useConfirm();

  const save = () => {
    setCampaigns((prev) => prev.map((c) => (c.id === campaign.id ? { ...c, name, goal, budget, status } : c)));
    toast.success("Campaign updated");
  };

  const del = async () => {
    const ok = await confirm({
      title: `Delete "${campaign.name}"?`,
      body: "This permanently deletes the campaign, pipeline, and all messages. This cannot be undone.",
      destructive: true,
      confirmLabel: "Delete forever",
    });
    if (ok) {
      setCampaigns((prev) => prev.filter((c) => c.id !== campaign.id));
      toast.success("Campaign deleted");
      onBack();
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <SectionTitle>General</SectionTitle>
        <div className="mt-4 space-y-3">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100" />
          </Field>
          <Field label="Goal">
            <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Budget (PKR)">
              <input value={budget} type="number" onChange={(e) => setBudget(Number(e.target.value))} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100" />
            </Field>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100">
                {(["active", "draft", "paused", "completed"] as Status[]).map((s) => <option key={s} value={s}>{statusMap[s].label}</option>)}
              </select>
            </Field>
          </div>
          <button onClick={save} className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
            <CheckCircle2 className="h-3 w-3" /> Save changes
          </button>
        </div>
      </Card>

      <Card className="border-red-200 bg-red-50/40">
        <div className="text-red-800" style={{ fontSize: 13, fontWeight: 600 }}>Danger zone</div>
        <p className="mt-1 text-xs text-red-700">Deletion is permanent and can't be reversed.</p>
        <button onClick={del} className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50" style={{ fontWeight: 500 }}>
          Delete campaign
        </button>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

/* ─────────────────── create campaign (§11) ─────────────────── */

type NewCampaignInput = {
  name: string;
  client: string;
  objective: string;
  platform: Platform;
  budget: number;
  start: string;
  end: string;
  criteria: string;
};

const inputCls =
  "h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100";

function CreateCampaignModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (draft: NewCampaignInput) => void;
}) {
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [objective, setObjective] = useState("");
  const [platform, setPlatform] = useState<Platform>("mixed");
  const [budget, setBudget] = useState<string>("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [criteria, setCriteria] = useState("");

  const canSubmit = name.trim().length > 1;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onCreate({
      name: name.trim(),
      client: client.trim(),
      objective: objective.trim(),
      platform,
      budget: Number(budget) || 0,
      start: start.trim(),
      end: end.trim(),
      criteria: criteria.trim(),
    });
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm"
      />
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <div className="text-slate-900" style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>
                New campaign
              </div>
              <p className="mt-0.5 text-xs text-slate-500">Set the brief now — you can refine everything later.</p>
            </div>
            <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={submit} className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-5">
            <Field label="Campaign name *">
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Eid Sale 2026" className={inputCls} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Client / brand">
                <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="e.g. Heritage Lahore" className={inputCls} />
              </Field>
              <Field label="Primary platform">
                <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} className={inputCls}>
                  <option value="mixed">Multi-platform</option>
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="youtube">YouTube</option>
                </select>
              </Field>
            </div>

            <Field label="Objective">
              <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} placeholder="What should this campaign achieve?" className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100" />
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Budget (PKR)">
                <input value={budget} onChange={(e) => setBudget(e.target.value)} type="number" min={0} placeholder="0" className={inputCls} />
              </Field>
              <Field label="Start">
                <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="e.g. Jun 20" className={inputCls} />
              </Field>
              <Field label="End">
                <input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="e.g. Jul 20" className={inputCls} />
              </Field>
            </div>

            <Field label="Creator criteria">
              <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} rows={2} placeholder="e.g. Bridal & lifestyle creators in Lahore, 50K+ followers, 5%+ engagement" className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100" />
            </Field>

            <p className="text-[11px] text-slate-400">
              The campaign starts as a Draft. Nothing is sent until you add creators and start outreach.
            </p>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={onClose} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
                Cancel
              </button>
              <button type="submit" disabled={!canSubmit} className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-1.5 text-xs text-white transition-colors hover:bg-slate-800 disabled:opacity-50" style={{ fontWeight: 500 }}>
                <Plus className="h-3 w-3" /> Create draft
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </>
  );
}

