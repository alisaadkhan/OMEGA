import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowRight, Bolt, Bookmark, Compass, FolderPlus, Megaphone, PauseCircle, PlusCircle, Radar, Search, Zap } from "lucide-react";
import { analyticsSummarySchema } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { useRecentActivity } from "../../api/activity";
import { useBillingSummary } from "../../api/billing";
import { rupees, useCampaigns } from "../../api/campaigns";
import { useLists } from "../../api/lists";
import { useAuth } from "../../auth/AuthContext";
import { Button, Card, CountUp, EASE, Pill, Progress, Skeleton, Stagger, StaggerItem } from "../../ui/kit";
import { ActivityRow } from "./ActivityRow";
import type { Creator } from "./CreatorProfilePanel";
import { FeaturedCreators } from "./FeaturedCreators";
import type { DashView } from "./Sidebar";

const monthRange = () => {
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  return { from, to: d.toISOString().slice(0, 10) };
};

/** Dashboard home (owner design 2026-11-16): greeting, quick actions, four metrics, running projects, activity, plan. */
export function Home({ setView, onOpenCampaign, onTour, onOpenCreator }: { setView: (v: DashView) => void; onOpenCampaign: (id: string) => void; onTour: () => void; onOpenCreator: (c: Creator) => void }) {
  const { user, status } = useAuth();
  const summary = useBillingSummary().data;
  const campaigns = useCampaigns();
  const lists = useLists();
  const { from, to } = monthRange();
  const analytics = useQuery({ queryKey: ["analytics", from, to], queryFn: () => apiRequest(`/v1/analytics/summary?from=${from}&to=${to}`, analyticsSummarySchema), enabled: status === "signedIn" });
  const [q, setQ] = useState("");
  const first = (user?.name || user?.email || "").split(/[\s@]/)[0];

  const all = campaigns.data?.campaigns.filter((c) => !c.archivedAt) ?? [];
  const active = all.filter((c) => c.status === "active");
  const paused = all.filter((c) => c.status === "paused");
  const running = all.filter((c) => c.status === "active" || c.status === "paused" || c.status === "draft").slice(0, 4);
  const listCount = lists.data?.lists.length ?? 0;
  const saved = lists.data?.lists.reduce((n, l) => n + l.count, 0) ?? 0;
  const activeFees = active.reduce((n, c) => n + c.agreedFeesMinor, 0);

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) {
      try { sessionStorage.setItem("mushin.pendingQuery", q.trim()); } catch { /* storage unavailable: the search page opens empty */ }
    }
    setView("search");
  };

  return (
    <div className="flex flex-col pb-16">
      <section className="mb-8 flex flex-col justify-between gap-5 pt-2 lg:flex-row lg:items-center">
        <motion.div className="min-w-0" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease: EASE }}>
          <h1 className="text-[32px] font-bold leading-10 tracking-[-0.025em] text-on">Welcome back{first ? `, ${first}` : ""}.</h1>
          <p className="mt-1 text-sm text-ink-soft">Here is the overview of your account, creator shortlists and campaigns.</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease: EASE, delay: 0.05 }} className="flex shrink-0 flex-wrap items-center gap-3 lg:flex-nowrap">
          <div className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-cyan-pale/50 px-4 py-2.5 text-[11px] font-semibold tracking-wide text-teal-deep ring-1 ring-cyan-soft/40">
            <Bolt className="h-[18px] w-[18px] text-teal" />
            {summary ? <CountUp value={summary.balance.available} /> : "—"} CREDITS
            <span className="mx-0.5 text-line">·</span>
            <button onClick={() => setView("billing")} className="font-bold text-teal hover:underline">Top up</button>
          </div>
          <Button variant="outline" icon={Compass} onClick={onTour}>Tour</Button>
          <Button variant="outline" icon={Radar} onClick={() => setView("search")}>+ Run Live Search</Button>
          <Button variant="dark" icon={PlusCircle} onClick={() => setView("campaigns")}>+ New Campaign</Button>
        </motion.div>
      </section>

      <div data-tour="metrics" className="mb-6">
      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Credits Used" icon={Zap} value={analytics.data?.credits.spent} sub="This month" loading={analytics.isPending} />
          <Metric label="Active Shortlists" icon={Bookmark} value={lists.data ? listCount : undefined} sub={`${saved.toLocaleString("en-PK")} creators saved`} loading={lists.isPending} />
          <Metric label="Active Campaigns" icon={Megaphone} accent value={campaigns.data ? active.length : undefined} sub={`${rupees(activeFees)} agreed fees`} loading={campaigns.isPending} />
          <Metric label="Paused Campaigns" icon={PauseCircle} value={campaigns.data ? paused.length : undefined} sub={paused.length ? "Waiting to resume" : "Nothing paused"} loading={campaigns.isPending} />
      </Stagger>
      </div>

      <motion.form data-tour="search" onSubmit={go} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, ease: EASE }} className="mb-8 flex items-center gap-2 rounded-2xl bg-white p-2 shadow-sm">
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-surface-low px-3 py-2.5 focus-within:ring-2 focus-within:ring-cyan/30">
          <Search className="h-5 w-5 text-teal" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search creators by niche, city or keywords, e.g. Lahore fashion creators" className="w-full bg-transparent text-sm text-on outline-none placeholder:text-faint" aria-label="Search creators" />
        </div>
        <Button type="submit" variant="primary" icon={ArrowRight}>Search</Button>
      </motion.form>

      <FeaturedCreators onOpenCreator={onOpenCreator} />

      <section className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-7">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-lg font-semibold tracking-tight text-[#0B112B]">Running Projects</h2>
            <button onClick={() => setView("campaigns")} className="text-xs font-medium text-ink-soft transition-colors hover:text-[#0B112B]">View all campaigns →</button>
          </div>
          <Card className="flex flex-col p-6 ring-1 ring-surface-top/70">
            {campaigns.isPending ? (
              <div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : running.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <FolderPlus className="h-8 w-8 text-teal" />
                <p className="mt-3 text-sm font-semibold text-on">No campaigns yet</p>
                <p className="mt-1 text-xs text-ink-soft">Create a campaign to track creators, stages and agreed fees.</p>
                <Button className="mt-4" size="sm" onClick={() => setView("campaigns")}>Create campaign</Button>
              </div>
            ) : (
              <Stagger>
                {running.map((c, i) => (
                  <StaggerItem key={c.id}>
                    {i > 0 && <div className="my-1 h-px bg-surface-high" />}
                    <div className="flex flex-col justify-between gap-4 py-4 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-col">
                        <h3 className="truncate text-base font-semibold tracking-tight text-[#0B112B]">{c.name}</h3>
                        <span className="mt-0.5 text-xs text-ink-soft">{c.creatorCount} creator{c.creatorCount === 1 ? "" : "s"} participating</span>
                      </div>
                      <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end">
                        <Pill tone={c.status === "active" ? "cyan" : c.status === "paused" ? "amber" : "neutral"} dot>{c.status[0]!.toUpperCase() + c.status.slice(1)}</Pill>
                        <span className="hidden text-xs text-ink-soft md:inline">{(c.stageCounts.confirmed ?? 0)} confirmed</span>
                        <button aria-label={`Open ${c.name}`} onClick={() => onOpenCampaign(c.id)} className="group flex h-9 w-9 items-center justify-center rounded-full border border-surface-top text-ink-soft transition-all hover:border-[#0B112B] hover:bg-[#0B112B] hover:text-white">
                          <ArrowRight className="h-[18px] w-[18px] transition-transform group-hover:translate-x-0.5" />
                        </button>
                      </div>
                    </div>
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <RecentActivity />
          <PlanCard setView={setView} />
        </div>
      </section>
    </div>
  );
}

function Metric({ label, icon: Icon, value, sub, accent, loading }: { label: string; icon: typeof Zap; value: number | undefined; sub: string; accent?: boolean; loading: boolean }) {
  return (
    <StaggerItem>
      <Card hover className="flex h-full flex-col justify-between p-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-soft">{label}</span>
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent ? "bg-cyan-pale/40 text-teal" : "bg-surface-low text-ink-soft"}`}><Icon className="h-[18px] w-[18px]" /></span>
        </div>
        {loading ? <Skeleton className="h-10 w-20" /> : <div className="text-[32px] font-bold leading-10 tracking-tight tabular-nums text-on">{value === undefined ? "—" : <CountUp value={value} />}</div>}
        <div className={`mt-2 text-xs ${accent ? "font-semibold text-teal" : "text-ink-soft"}`}>{sub}</div>
      </Card>
    </StaggerItem>
  );
}

function RecentActivity() {
  const q = useRecentActivity(4);
  const events = q.data?.events ?? [];
  return (
    <Card className="flex flex-col gap-3 p-6 ring-1 ring-surface-top/70">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold tracking-tight text-[#0B112B]">Recent Activity</h3>
      </div>
      {q.isPending ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : events.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-soft">Nothing yet. Shortlists, campaigns and searches will appear here.</p>
      ) : (
        <ul className="-mx-2">{events.map((e) => <ActivityRow key={e.id} e={e} />)}</ul>
      )}
    </Card>
  );
}

function PlanCard({ setView }: { setView: (v: DashView) => void }) {
  const s = useBillingSummary().data;
  if (!s) return <Skeleton className="h-40 rounded-2xl" />;
  const allowance = s.plan?.monthlyCredits ?? s.testingAllowance?.monthlyCredits ?? 0;
  const left = s.testingAllowance && !s.plan ? s.testingAllowance.remaining : s.balance.available;
  const used = allowance ? Math.max(0, allowance - Math.min(left, allowance)) : 0;
  const ends = s.currentPeriodEnd ?? s.trialEndsAt ?? s.testingAllowance?.renewsAt ?? null;
  const days = ends ? Math.max(0, Math.ceil((Date.parse(ends) - Date.now()) / 86_400_000)) : null;
  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-soft">Current plan</span>
          <h3 className="mt-0.5 text-[15px] font-bold text-on">{s.plan?.name ?? (s.status === "trialing" ? "Free trial" : s.awaitingTrial ? "Trial pending approval" : "No plan yet")}</h3>
        </div>
        <Pill tone={s.status === "active" || s.status === "trialing" ? "cyan" : "neutral"} dot>{s.status[0]!.toUpperCase() + s.status.slice(1).replace("_", " ")}</Pill>
      </div>
      {allowance > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-ink-soft">Monthly credits</span>
            <span className="font-semibold tabular-nums text-on">{used.toLocaleString("en-PK")} / {allowance.toLocaleString("en-PK")} used</span>
          </div>
          <Progress value={(used / allowance) * 100} bar="bg-black" />
          {days !== null && <span className="text-[10px] font-semibold tracking-wide text-faint">Resets in {days} day{days === 1 ? "" : "s"}</span>}
        </div>
      )}
      <div className="flex items-center justify-end pt-1">
        <button onClick={() => setView("billing")} className="text-[11px] font-semibold text-faint transition-colors hover:text-on">Manage Billing →</button>
      </div>
    </Card>
  );
}
