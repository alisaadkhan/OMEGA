import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Archive, ArrowLeft, ArrowRight, CheckCircle2, Clock3, PauseCircle, XCircle, PlayCircle, Save, Settings2, Trash2, Users, Wallet } from "lucide-react";
import type { CampaignDetail as Detail } from "@mushin/contracts";
import { rupees, toMinor, useCampaign, useDeleteCampaign, useUpdateCampaign } from "../../api/campaigns";
import { relative } from "../../lib/time";
import { useConfirm, useToast } from "../../lib/toast";
import { Alert, Button, Card, CountUp, EASE, Progress, shortRupees, Skeleton, Stagger, StaggerItem, Toggle } from "../../ui/kit";
import { cn } from "../ui/utils";
import { CampaignModal, PLATFORM_NAME, STAGE_LABEL, STATUS_DOT, STATUS_LABEL, STATUS_TONE } from "./Campaigns";
import { CampaignOutreachTab } from "./CampaignOutreachTab";
import { PipelineTab, RosterTab, TimelineTab } from "./CampaignRoster";
import type { Creator } from "./CreatorProfilePanel";
import { ErrorState } from "./states";

type Tab = "overview" | "creators" | "pipeline" | "timeline" | "outreach" | "analytics" | "settings";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "creators", label: "Creators" },
  { id: "pipeline", label: "Pipeline" },
  { id: "timeline", label: "Timeline" },
  { id: "outreach", label: "Outreach" },
  { id: "analytics", label: "Analytics" },
  { id: "settings", label: "Settings" },
];

export function CampaignDetail({ id, onBack, onOpenCreator, onGoToSearch, initialMailFor = null }: { id: string; onBack: () => void; onOpenCreator: (c: Creator) => void; onGoToSearch: () => void; initialMailFor?: string | null }) {
  const campaign = useCampaign(id);
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(initialMailFor ? "outreach" : "overview");
  const [mailFor, setMailFor] = useState<string | null>(initialMailFor);
  if (campaign.isPending) return <div className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-10" /><Skeleton className="h-72" /></div>;
  if (campaign.isError) return <ErrorState body={campaign.error instanceof Error ? campaign.error.message : undefined} onRetry={() => void campaign.refetch()} />;
  const c = campaign.data;

  return (
    <div className="flex flex-col pb-16">
      <div className="mb-6 flex flex-col gap-4">
        <nav className="flex items-center gap-2 text-[11px] font-semibold text-ink-soft" aria-label="Breadcrumb">
          <button onClick={onBack} className="group flex items-center gap-1 transition-colors hover:text-on"><ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" /> Campaigns</button>
          <span className="text-line">/</span>
          <span className="truncate font-semibold text-on">{c.name}</span>
        </nav>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-[32px] font-semibold leading-10 tracking-tight text-on">{c.name}</h1>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold shadow-sm", STATUS_TONE[c.status])}>
                <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[c.status], c.status === "active" && "animate-pulse")} />{STATUS_LABEL[c.status]}
              </span>
            </div>
            <p className="text-xs text-ink-soft">
              {[c.platform ? PLATFORM_NAME[c.platform] : null, c.client || null, `Created ${relative(c.createdAt)}`, c.startDate || c.endDate ? `${c.startDate ?? "?"} → ${c.endDate ?? "?"}` : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button variant="outline" icon={Settings2} onClick={() => setTab("settings")} aria-label="Campaign settings" />
          </div>
        </div>
      </div>

      <div className="no-scrollbar mb-8 flex items-center gap-7 overflow-x-auto border-b border-surface-high" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("relative flex items-center gap-1.5 whitespace-nowrap pb-3 text-[13px] transition-colors", tab === t.id ? "font-semibold text-black" : "text-ink-soft hover:text-on")}>
            {t.label}
            {t.id === "creators" && <span className="rounded bg-surface-high px-1.5 text-[10px] font-semibold text-ink-soft">{c.creators.length}</span>}
            {tab === t.id && <motion.span layoutId="cmp-tab" className="absolute bottom-[-1px] left-0 right-0 h-0.5 rounded-full bg-cyan-dim shadow-[0_0_8px_rgba(6,182,212,0.6)]" />}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25, ease: EASE }}>
          {tab === "overview" && <OverviewTab c={c} />}
          {tab === "creators" && <RosterTab c={c} onOpenCreator={onOpenCreator} onGoToSearch={onGoToSearch} />}
          {tab === "pipeline" && <PipelineTab c={c} onOpenCreator={onOpenCreator} onGoToSearch={onGoToSearch} />}
          {tab === "timeline" && <TimelineTab c={c} onOpenCreator={onOpenCreator} />}
          {tab === "outreach" && <CampaignOutreachTab c={c} initialId={mailFor} />}
          {tab === "analytics" && <AnalyticsTab c={c} onViewMail={(cid) => { setMailFor(cid); setTab("outreach"); }} />}
          {tab === "settings" && <SettingsTab c={c} onDeleted={onBack} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

const live = (c: Detail) => c.creators.filter((x) => x.outcome === "open");

function BudgetCard({ c }: { c: Detail }) {
  const pct = c.budgetMinor ? (c.agreedFeesMinor / c.budgetMinor) * 100 : 0;
  return (
    <Card className="flex h-full flex-col justify-between p-6">
      <div>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-soft">Budget vs. Agreed Fees</span>
          <Wallet className="h-5 w-5 text-teal" />
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-2.5">
          <span className="text-[32px] font-semibold tracking-tight tabular-nums text-on" title={rupees(c.agreedFeesMinor)}>{shortRupees(c.agreedFeesMinor)}</span>
          <span className="text-[13px] text-ink-soft">{c.budgetMinor ? `agreed of ${shortRupees(c.budgetMinor)} budget` : "agreed · no budget set"}</span>
        </div>
        <Progress value={pct} className="my-5 h-3" bar="bg-ink" />
      </div>
      <div className="flex items-center justify-between pt-2 text-[13px] text-ink-soft">
        <span className="font-semibold text-on">{c.budgetMinor ? `${Math.round(pct)}% committed` : "Set a budget in Settings"}</span>
        {c.budgetMinor !== null && <span>{shortRupees(Math.max(0, c.budgetMinor - c.agreedFeesMinor))} remaining</span>}
      </div>
    </Card>
  );
}

function OverviewTab({ c }: { c: Detail }) {
  const open = live(c);
  const due = open.filter((x) => x.contentStatus === "content_pending").length;
  const posted = open.filter((x) => x.contentStatus === "posted" || x.contentStatus === "completed").length;
  const tiles = [
    { label: "Creators", icon: Users, value: open.length, note: `${c.stageCounts.confirmed} confirmed` },
    { label: "Deliverables Due", icon: Clock3, value: due, note: "Content pending" },
    { label: "Posts Live", icon: CheckCircle2, value: posted, note: "Posted or completed" },
    { label: "Declined", icon: XCircle, value: c.declinedCount, note: "Said no or dropped out" },
  ];
  return (
    <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
      <motion.div className="lg:col-span-5" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}><BudgetCard c={c} /></motion.div>
      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
        {tiles.map((t) => (
          <StaggerItem key={t.label}>
            <Card hover className="flex h-full flex-col justify-between p-5">
              <div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-soft">{t.label}</span><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-low text-ink-soft"><t.icon className="h-[18px] w-[18px]" /></span></div>
              <div className="mt-4"><div className="text-2xl font-semibold tabular-nums text-on"><CountUp value={t.value} /></div><div className="mt-1 flex items-center gap-1.5 text-xs text-teal"><span className="h-1.5 w-1.5 rounded-full bg-teal" />{t.note}</div></div>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}

const CONTENT = { none: "Not started", content_pending: "Content pending", posted: "Posted", completed: "Completed" } as const;

/** Analytics (owner design 2026-11-16): spend and creators posted, then per-creator performance with a link to the mail. */
function AnalyticsTab({ c, onViewMail }: { c: Detail; onViewMail: (creatorId: string) => void }) {
  const open = live(c);
  const isPosted = (x: Detail["creators"][number]) => x.contentStatus === "posted" || x.contentStatus === "completed";
  const posted = open.filter(isPosted).length;
  const pending = open.length - posted;
  const onTrack = open.length > 0 && posted / open.length >= 0.5;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="flex h-full flex-col justify-between p-6">
            <div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-soft">Total Spend</span><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-low text-ink-soft"><Wallet className="h-[18px] w-[18px]" /></span></div>
            <div className="my-3">
              <div className="text-[32px] font-semibold tracking-tight tabular-nums text-on" title={rupees(c.agreedFeesMinor)}>{shortRupees(c.agreedFeesMinor)}</div>
              <p className="mt-1 text-xs text-ink-soft">{c.budgetMinor ? `${Math.round((c.agreedFeesMinor / c.budgetMinor) * 100)}% of ${shortRupees(c.budgetMinor)} budget, in agreed fees` : "Agreed fees · no budget set"}</p>
            </div>
            <Progress value={c.budgetMinor ? (c.agreedFeesMinor / c.budgetMinor) * 100 : 0} bar="bg-ink" />
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}>
          <Card className="flex h-full flex-col justify-between p-6">
            <div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-soft">Creators Posted</span><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-low text-ink-soft"><Users className="h-[18px] w-[18px]" /></span></div>
            <div className="my-3">
              <div className="flex items-baseline gap-2"><span className="text-[32px] font-semibold tracking-tight tabular-nums text-on">{posted} of {open.length}</span>{open.length > 0 && <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", onTrack ? "bg-cyan-pale/50 text-[#001f26]" : "bg-amber-50 text-amber-800")}>{onTrack ? "On Track" : "Behind"}</span>}</div>
              <p className="mt-1 text-xs text-ink-soft">{pending} pending submission{pending === 1 ? "" : "s"} verification</p>
            </div>
            <div className="flex items-center gap-1.5">{open.map((x, i) => <motion.span key={x.creator.id} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.1 + i * 0.05, ease: EASE }} className={cn("h-2 flex-1 origin-left rounded-full", isPosted(x) ? "bg-ink" : "bg-surface-high")} />)}</div>
          </Card>
        </motion.div>
      </div>
      <Card className="flex flex-col p-6">
        <div className="mb-4 flex items-center justify-between">
          <div><h2 className="text-lg font-semibold text-on">Creator Performance</h2><p className="text-xs text-ink-soft">Each creator's deliverables and conversation</p></div>
          <span className="rounded-full bg-surface-mid px-2.5 py-1 text-[10px] font-semibold text-ink-soft">{posted} Posts Live</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="bg-surface-low/60 text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-soft"><th className="rounded-l-xl px-4 py-3">Creator</th><th className="px-4 py-3">Platform</th><th className="px-4 py-3">Deliverables Posted</th><th className="px-4 py-3">Total Views</th><th className="rounded-r-xl px-4 py-3 text-right">Action</th></tr></thead>
            <motion.tbody initial="h" animate="s" variants={{ h: {}, s: { transition: { staggerChildren: 0.05 } } }} className="divide-y divide-surface-mid">
              {open.map((x) => (
                <motion.tr key={x.creator.id} variants={{ h: { opacity: 0, y: 6 }, s: { opacity: 1, y: 0 } }} className="group transition-colors hover:bg-surface-low/40">
                  <td className="px-4 py-4"><span className="text-[15px] font-semibold text-on">{x.creator.displayName}</span><span className="block text-xs text-ink-soft">@{x.creator.handle}</span></td>
                  <td className="whitespace-nowrap px-4 py-4"><span className="rounded-lg bg-surface-mid px-2.5 py-1 text-[11px] font-medium text-on">{PLATFORM_NAME[x.creator.platform]}</span></td>
                  <td className="px-4 py-4 text-[13px] text-on">{x.note ? <span className="line-clamp-1 max-w-xs">{x.note}</span> : null}<span className="block text-[11px] text-ink-soft">{CONTENT[x.contentStatus]}</span></td>
                  <td className="whitespace-nowrap px-4 py-4 text-[13px] text-faint" title="Post views are not tracked yet">—</td>
                  <td className="whitespace-nowrap px-4 py-4 text-right"><button onClick={() => onViewMail(x.creator.id)} className="inline-flex items-center gap-1 text-[13px] font-medium text-on transition-colors hover:text-teal">View Mail <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></button></td>
                </motion.tr>
              ))}
              {open.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-ink-soft">No creators in this campaign yet.</td></tr>}
            </motion.tbody>
          </table>
        </div>
        {open.length > 0 && <div className="mt-4 flex items-center gap-2 pt-2 text-xs text-ink-soft"><span className="h-2 w-2 rounded-full bg-teal" />Showing {posted} creator{posted === 1 ? "" : "s"} with posts live · {pending} pending deliverable verification</div>}
      </Card>
    </div>
  );
}

function SettingsTab({ c, onDeleted }: { c: Detail; onDeleted: () => void }) {
  const update = useUpdateCampaign();
  const del = useDeleteCampaign();
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [budget, setBudget] = useState(c.budgetMinor === null ? "" : String(Math.round(c.budgetMinor / 100)));
  const [saved, setSaved] = useState(false);
  const budgetBad = budget.trim() !== "" && toMinor(budget) === null;
  const dirty = name.trim() !== c.name || toMinor(budget) !== c.budgetMinor;
  const err = (e: unknown) => (e instanceof Error ? e.message : undefined);
  const save = () => update.mutate({ id: c.id, patch: { name: name.trim(), budgetMinor: toMinor(budget) } }, { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2500); } });
  const setStatus = (status: "paused" | "active" | "archived", msg: string) => update.mutate({ id: c.id, patch: { status } }, { onSuccess: () => toast.success(msg), onError: (e) => toast.error("Couldn't update the campaign", err(e)) });
  async function onDelete() {
    if (!(await confirm({ title: `Delete ${c.name}?`, body: "The campaign, its pipeline and its outreach log are deleted. Creators stay in MUSHIN.", confirmLabel: "Delete campaign", cancelLabel: "Keep", destructive: true }))) return;
    del.mutate(c.id, { onSuccess: () => { toast.success(`Deleted ${c.name}`); onDeleted(); }, onError: (e) => toast.error("Couldn't delete the campaign", err(e)) });
  }
  const fieldCls = "w-full rounded-lg bg-surface-low px-3 py-2.5 text-sm text-on shadow-sm outline-none transition-all focus:bg-white focus:ring-2 focus:ring-teal/40";
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
      <aside className="flex flex-col gap-1 rounded-xl bg-white p-2 shadow-sm lg:sticky lg:top-6 lg:col-span-3">
        {[["General", "#cs-general"], ["Budget", "#cs-budget"], ["Notifications", "#cs-notify"], ["Danger Zone", "#cs-danger"]].map(([l, h]) => (
          <a key={h} href={h} onClick={(e) => { e.preventDefault(); document.querySelector(h!)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className={cn("rounded-lg px-3 py-2 text-[13px] transition-colors hover:bg-surface-low", l === "Danger Zone" ? "text-danger" : "text-ink-soft hover:text-on")}>{l}</a>
        ))}
      </aside>
      <div className="flex flex-col gap-5 lg:col-span-9">
        <Card className="flex flex-col gap-5 p-5" >
          <div id="cs-general" className="flex scroll-mt-24 items-start justify-between border-b border-surface-high/60 pb-2"><div><h2 className="text-lg font-semibold text-on">General</h2><p className="mt-0.5 text-xs text-ink-soft">Campaign name and details.</p></div><Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit all details</Button></div>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-on">Campaign Name<input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={fieldCls} /></label>
          <div id="cs-budget" className="scroll-mt-24 border-t border-surface-high/60 pt-4">
            <h2 className="text-lg font-semibold text-on">Budget</h2>
            <p className="mt-0.5 text-xs text-ink-soft">Set the total spend limit for this campaign.</p>
            <div className="relative mt-3 flex max-w-lg items-center"><span className="absolute left-3 text-lg font-semibold text-faint">Rs.</span><input inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No budget" className={cn(fieldCls, "pl-12 text-xl font-semibold tabular-nums", budgetBad && "ring-2 ring-danger/50")} /></div>
          </div>
          <Alert tone="error">{budgetBad ? "Enter the budget as a number of rupees." : update.isError ? err(update.error) ?? "Couldn't save." : null}</Alert>
          <Alert tone="success">{saved ? "Campaign settings saved." : null}</Alert>
          <div className="flex justify-end"><Button icon={Save} disabled={!dirty || budgetBad || !name.trim()} loading={update.isPending} onClick={save}>Save Changes</Button></div>
        </Card>
        <Card className="flex flex-col gap-4 p-5">
          <div id="cs-notify" className="scroll-mt-24 border-b border-surface-high/60 pb-2"><h2 className="text-lg font-semibold text-on">Notifications</h2><p className="mt-0.5 text-xs text-ink-soft">Reminders appear in the bell.</p></div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-low p-3">
            <span className="flex flex-col"><span className="text-[13px] font-medium text-on">Remind me when a creator is due to post</span><span className="text-xs text-ink-soft">On the due date set for each creator, until their content is marked posted.</span></span>
            <Toggle checked={c.notifyPostDue} disabled={update.isPending} label="Remind me when a creator is due to post"
              onChange={(on) => update.mutate({ id: c.id, patch: { notifyPostDue: on } }, { onSuccess: () => toast.success(on ? "Post-day reminders on" : "Post-day reminders off"), onError: (e) => toast.error("Couldn't change the reminder", err(e)) })} />
          </div>
        </Card>
        <section id="cs-danger" className="flex scroll-mt-24 flex-col gap-3 rounded-xl bg-danger-soft/20 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-danger">Danger Zone</h2>
          <p className="text-[13px] text-ink-soft">Pause tracking, archive the campaign from your active view (it then no longer counts towards your plan's campaign limit), or delete it.</p>
          <div className="flex flex-wrap gap-2">
            {c.status === "paused" ? <Button variant="outline" icon={PlayCircle} onClick={() => setStatus("active", `Resumed ${c.name}`)}>Resume Campaign</Button> : c.status !== "archived" && <Button variant="outline" icon={PauseCircle} onClick={() => setStatus("paused", `Paused ${c.name}`)}>Pause Campaign</Button>}
            {c.status === "archived" ? <Button variant="outline" icon={Archive} onClick={() => setStatus("paused", `Restored ${c.name}`)}>Restore Campaign</Button> : <Button variant="outline" icon={Archive} onClick={() => setStatus("archived", `Archived ${c.name}`)} className="text-danger">Archive Campaign</Button>}
            <Button variant="danger" icon={Trash2} loading={del.isPending} onClick={() => void onDelete()}>Delete Campaign</Button>
          </div>
        </section>
      </div>
      <CampaignModal key={editing ? "e" : "e0"} open={editing} initial={c} title="Edit campaign" submitLabel="Save changes" busy={update.isPending} error={editing && update.isError ? err(update.error) ?? null : null}
        onClose={() => { setEditing(false); update.reset(); }}
        onSubmit={(v) => update.mutate({ id: c.id, patch: v }, { onSuccess: () => { setEditing(false); setName(v.name); setBudget(v.budgetMinor === null ? "" : String(Math.round(v.budgetMinor / 100))); toast.success("Campaign updated"); } })} />
    </div>
  );
}


