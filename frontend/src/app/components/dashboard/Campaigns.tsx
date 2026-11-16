import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CalendarDays, Megaphone, Plus, Search, UserPlus } from "lucide-react";
import type { CampaignSummary, CreateCampaign } from "@mushin/contracts";
import { rupees, toMinor, useCampaigns, useCreateCampaign } from "../../api/campaigns";
import { useToast } from "../../lib/toast";
import { Alert, Button, EASE, EmptyState, Modal, Progress, Segmented, shortRupees, Skeleton, Stagger, StaggerItem } from "../../ui/kit";
import { cn } from "../ui/utils";
import { CampaignDetail } from "./CampaignDetail";
import type { Creator } from "./CreatorProfilePanel";
import { ErrorState } from "./states";

/**
 * Campaigns (owner design 2026-11-16): a hub of campaign cards and, per campaign, tabs for overview, creators,
 * pipeline, timeline, outreach, analytics and settings. Every figure comes from the campaign's own records.
 */
export function Campaigns({ onOpenCreator, onGoToSearch, initialId = null }: { onOpenCreator: (c: Creator) => void; onGoToSearch: () => void; initialId?: string | null }) {
  const [openId, setOpenId] = useState<string | null>(initialId);
  useEffect(() => setOpenId(initialId), [initialId]);
  return (
    <AnimatePresence mode="wait">
      {openId ? (
        <motion.div key="detail" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.3, ease: EASE }}>
          <CampaignDetail id={openId} onBack={() => setOpenId(null)} onOpenCreator={onOpenCreator} onGoToSearch={onGoToSearch} />
        </motion.div>
      ) : (
        <motion.div key="hub" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.3, ease: EASE }}>
          <CampaignHub onOpen={setOpenId} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const STATUS_LABEL = { draft: "Draft", active: "Active", paused: "Paused", completed: "Completed", archived: "Archived" } as const;
export const STATUS_TONE = { draft: "bg-surface-mid text-ink-soft", active: "bg-cyan-pale/40 text-teal", paused: "bg-danger-soft/40 text-danger-ink", completed: "bg-indigo-50 text-indigo-700", archived: "bg-surface-mid text-faint" } as const;
export const STATUS_DOT = { draft: "bg-faint", active: "bg-teal", paused: "bg-danger", completed: "bg-indigo-500", archived: "bg-line" } as const;
export const STAGE_LABEL = { identified: "Identified", contacted: "Contacted", negotiating: "Negotiating", confirmed: "Confirmed" } as const;
export const PLATFORM_NAME = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", mixed: "Multi-platform" } as const;

/** `archived` appears only when editing an archived campaign (archiving and restoring have their own buttons). */
export type CampaignFormValue = Required<Omit<CreateCampaign, "budgetMinor" | "status">> & { budgetMinor: number | null; status: keyof typeof STATUS_LABEL };

const input = "w-full rounded-xl bg-surface-low px-4 py-2.5 text-sm font-medium text-on outline-none ring-1 ring-surface-top/60 transition-all placeholder:text-faint focus:bg-white focus:ring-2 focus:ring-cyan";
const label = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft";

/** Create or edit a campaign in the design's dialog: name, flight dates, budget, channel pills, objective. */
export function CampaignModal({ open, initial, title, submitLabel, busy, error, onSubmit, onClose }: { open: boolean; initial?: Partial<CampaignFormValue>; title: string; submitLabel: string; busy: boolean; error: string | null; onSubmit: (v: CampaignFormValue) => void; onClose: () => void }) {
  const [v, setV] = useState({
    name: initial?.name ?? "",
    status: initial?.status ?? "draft",
    platform: initial?.platform ?? null,
    client: initial?.client ?? "",
    objective: initial?.objective ?? "",
    notes: initial?.notes ?? "",
    budget: initial?.budgetMinor == null ? "" : String(Math.round(initial.budgetMinor / 100)),
    startDate: initial?.startDate ?? "",
    endDate: initial?.endDate ?? "",
  });
  const [touched, setTouched] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const datesBad = v.startDate !== "" && v.endDate !== "" && v.endDate < v.startDate;
  const budgetBad = v.budget.trim() !== "" && toMinor(v.budget) === null;
  const presets = ["Festive Surge", "E-commerce Conversion", "Brand Awareness"];
  return (
    <Modal open={open} onClose={onClose} label={title} width="max-w-[560px]">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!v.name.trim() || datesBad || budgetBad) return;
          onSubmit({ name: v.name.trim(), status: v.status, platform: v.platform, client: v.client.trim(), objective: v.objective.trim(), notes: v.notes.trim(), budgetMinor: toMinor(v.budget), startDate: v.startDate || null, endDate: v.endDate || null });
        }}
      >
        <div className="flex items-start justify-between border-b border-surface-mid p-6 pb-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-on">{title}</h2>
            <p className="mt-1 text-xs text-ink-soft">Track creators from first contact to confirmed, with fees and an outreach log.</p>
          </div>
        </div>
        <div className="max-h-[62vh] space-y-4 overflow-y-auto p-6">
          <div>
            <label className={label} htmlFor="cmp-name">Campaign Name</label>
            <input id="cmp-name" autoFocus maxLength={120} value={v.name} onChange={set("name")} placeholder="e.g., Eid Sale 2026" className={cn(input, touched && !v.name.trim() && "ring-2 ring-danger/50")} />
            <AnimatePresence>{touched && !v.name.trim() && <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1 text-xs text-danger">Give the campaign a name.</motion.p>}</AnimatePresence>
          </div>
          <div>
            <span className={label}>Flight Date Window</span>
            <div className="grid grid-cols-2 gap-3">
              <input type="date" aria-label="Start date" value={v.startDate} onChange={set("startDate")} className={input} />
              <input type="date" aria-label="End date" value={v.endDate} onChange={set("endDate")} className={cn(input, datesBad && "ring-2 ring-danger/50")} />
            </div>
            {datesBad && <p className="mt-1 text-xs text-danger">The end date must be on or after the start date.</p>}
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className={label + " mb-0"} htmlFor="cmp-budget">Total Budget</label>
              <span className="rounded border border-cyan-pale bg-cyan-pale/30 px-1.5 py-0.5 text-[10px] font-semibold text-teal">PKR</span>
            </div>
            <div className="flex rounded-xl shadow-sm">
              <span className="inline-flex items-center rounded-l-xl bg-surface-high px-4 font-mono text-xs font-bold text-on">Rs.</span>
              <input id="cmp-budget" inputMode="numeric" value={v.budget} onChange={set("budget")} placeholder="1500000" className={cn(input, "rounded-l-none font-mono font-bold tabular-nums", budgetBad && "ring-2 ring-danger/50")} />
            </div>
            {budgetBad && <p className="mt-1 text-xs text-danger">Enter the budget as a number of rupees.</p>}
          </div>
          <div>
            <span className={label}>Target Creator Channels</span>
            <div className="flex flex-wrap items-center gap-2">
              {(["instagram", "tiktok", "youtube", "mixed"] as const).map((p) => {
                const on = v.platform === p;
                return (
                  <motion.button whileTap={{ scale: 0.95 }} key={p} type="button" onClick={() => setV((x) => ({ ...x, platform: on ? null : p }))} aria-pressed={on} className={cn("inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors", on ? "bg-[#0B112B] text-white ring-1 ring-cyan/40" : "bg-surface-low text-ink-soft ring-1 ring-surface-top hover:text-on")}>
                    {PLATFORM_NAME[p]}
                  </motion.button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="cmp-client">Client <span className="font-normal normal-case text-faint">(optional)</span></label>
              <input id="cmp-client" maxLength={120} value={v.client} onChange={set("client")} className={input} />
            </div>
            <div>
              <label className={label} htmlFor="cmp-status">Status</label>
              <select id="cmp-status" value={v.status} onChange={(e) => setV((x) => ({ ...x, status: e.target.value as CampaignFormValue["status"] }))} className={input}>
                {Object.entries(STATUS_LABEL).filter(([k]) => k !== "archived" || initial?.status === "archived").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <span className={label}>Objective</span>
            <div className="mb-2 flex flex-wrap gap-2">
              {presets.map((p) => (
                <button key={p} type="button" onClick={() => setV((x) => ({ ...x, objective: p }))} className={cn("rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition-colors", v.objective === p ? "bg-cyan-pale/40 text-teal-deep ring-cyan-soft" : "bg-surface-low text-ink-soft ring-surface-top hover:bg-surface-mid")}>{p}</button>
              ))}
            </div>
            <textarea aria-label="Objective" rows={2} maxLength={1000} value={v.objective} onChange={set("objective")} placeholder="What should this campaign achieve?" className={cn(input, "resize-none")} />
          </div>
          {error && <Alert tone="error">{error}</Alert>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-surface-mid bg-surface-low/50 p-6 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} className="bg-[#0B112B]">{submitLabel} <ArrowRight className="h-3.5 w-3.5 text-cyan-400" /></Button>
        </div>
      </form>
    </Modal>
  );
}

type Filter = "all" | "active" | "draft" | "paused" | "completed";

function CampaignHub({ onOpen }: { onOpen: (id: string) => void }) {
  const campaigns = useCampaigns();
  const create = useCreateCampaign();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [find, setFind] = useState("");
  const all = (campaigns.data?.campaigns ?? []).filter((c) => c.status !== "archived");
  const count = (s: Filter) => (s === "all" ? all.length : all.filter((c) => c.status === s).length);
  const shown = all.filter((c) => (filter === "all" || c.status === filter) && `${c.name} ${c.client}`.toLowerCase().includes(find.trim().toLowerCase()));
  const totalBudget = all.reduce((n, c) => n + (c.budgetMinor ?? 0), 0);
  const totalAgreed = all.reduce((n, c) => n + c.agreedFeesMinor, 0);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-7 py-2">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-[32px] font-bold leading-10 tracking-tight text-on">Campaigns</h1>
          <p className="mt-1 text-sm text-ink-soft">Track active campaigns, manage budgets, and coordinate with creators.</p>
        </motion.div>
        <div className="flex items-center gap-3">
          <div className="relative flex min-w-[260px] items-center">
            <Search className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-faint" />
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search campaigns..." aria-label="Search campaigns" className="w-full rounded-xl bg-white py-2 pl-9 pr-3 text-[13px] text-on shadow-sm focus:outline-none focus:ring-1 focus:ring-teal" />
          </div>
          <Button variant="dark" icon={Plus} onClick={() => setCreating(true)}>New Campaign</Button>
        </div>
      </div>

      <div className="flex flex-col justify-between gap-3 rounded-2xl bg-white px-5 py-2 shadow-sm lg:flex-row lg:items-center">
        <Segmented<Filter> dark value={filter} onChange={setFilter} className="bg-transparent" options={(["all", "active", "draft", "paused", "completed"] as const).map((s) => ({ id: s, label: `${s === "all" ? "All" : STATUS_LABEL[s]} (${count(s)})` }))} />
        <div className="flex flex-wrap items-center gap-3 self-end text-xs text-ink-soft lg:self-center">
          <span className="font-semibold text-on">Total Budget: {totalBudget ? shortRupees(totalBudget) : "—"}</span>
          <span className="text-surface-top">•</span>
          <span>Agreed fees: <strong className="font-semibold text-on">{shortRupees(totalAgreed)}</strong></span>
          {totalBudget > 0 && <span className="flex items-center gap-1.5 rounded-full bg-cyan-pale/30 px-2.5 py-1 text-teal"><span className="h-2 w-2 rounded-full bg-teal" /><span className="text-[10px] font-semibold uppercase tracking-wider">{Math.round((totalAgreed / totalBudget) * 100)}% committed</span></span>}
        </div>
      </div>

      <CampaignModal
        key={creating ? "open" : "closed"}
        open={creating}
        title="Create New Campaign"
        submitLabel="Create Campaign"
        busy={create.isPending}
        error={create.isError ? (create.error instanceof Error ? create.error.message : "Couldn't create the campaign.") : null}
        onClose={() => { setCreating(false); create.reset(); }}
        onSubmit={(v) => create.mutate({ ...v, status: v.status === "archived" ? "draft" : v.status }, { onSuccess: (c) => { setCreating(false); toast.success(`Created ${c.name}`); onOpen(c.id); } })}
      />

      {campaigns.isPending ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}</div>
      ) : campaigns.isError ? (
        <ErrorState body={campaigns.error instanceof Error ? campaigns.error.message : undefined} onRetry={() => void campaigns.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState icon={Megaphone} title="No campaigns yet" body="Create a campaign, then add creators from Search, a shortlist or a creator's profile." action={<Button icon={Plus} onClick={() => setCreating(true)}>New Campaign</Button>} />
      ) : (
        <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" gap={0.06}>
          {shown.map((c) => <StaggerItem key={c.id}><CampaignCard c={c} onOpen={() => onOpen(c.id)} /></StaggerItem>)}
          <StaggerItem>
            <button onClick={() => setCreating(true)} className="group flex h-full min-h-[260px] w-full flex-col items-center justify-center rounded-2xl bg-white/60 p-8 text-center shadow-sm transition-all hover:bg-white hover:shadow-md">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-mid text-ink-soft transition-all group-hover:rotate-90 group-hover:bg-black group-hover:text-white"><Plus className="h-6 w-6" /></span>
              <span className="text-[15px] font-semibold text-on">Create New Campaign</span>
              <span className="mt-1 max-w-[210px] text-xs text-ink-soft">Set budgets, add creators and track every deliverable.</span>
            </button>
          </StaggerItem>
        </Stagger>
      )}
      {all.length > 0 && <p className="text-xs text-ink-soft">Showing {shown.length} of {all.length} campaigns{(campaigns.data?.campaigns.length ?? 0) > all.length ? " · archived campaigns are hidden" : ""}</p>}
    </div>
  );
}

function CampaignCard({ c, onOpen }: { c: CampaignSummary; onOpen: () => void }) {
  const pct = c.budgetMinor ? Math.min(100, (c.agreedFeesMinor / c.budgetMinor) * 100) : 0;
  const people = c.creatorCount;
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()} className="group flex h-full cursor-pointer flex-col justify-between rounded-2xl bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
      <div>
        <div className="flex items-center justify-between">
          <span className="truncate text-[10px] font-bold uppercase tracking-wider text-faint">{c.client || (c.platform ? PLATFORM_NAME[c.platform] : "Campaign")}</span>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold", STATUS_TONE[c.status])}><span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[c.status])} />{STATUS_LABEL[c.status]}</span>
        </div>
        <h2 className="mb-4 mt-3 truncate text-lg font-bold text-on transition-colors group-hover:text-teal">{c.name}</h2>
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-low px-3 py-2">
          <div><span className="text-[10px] uppercase tracking-wider text-ink-soft">Budget</span><p className="text-xl font-bold tabular-nums text-on" title={rupees(c.budgetMinor)}>{shortRupees(c.budgetMinor)}</p></div>
          <div><span className="text-[10px] uppercase tracking-wider text-ink-soft">Agreed</span><p className={cn("text-xl font-bold tabular-nums", c.agreedFeesMinor ? "text-on" : "text-faint")} title={rupees(c.agreedFeesMinor)}>{shortRupees(c.agreedFeesMinor)}</p></div>
        </div>
        <div className="mt-5 flex items-center justify-between">
          {people === 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-ink-soft"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-mid text-faint"><UserPlus className="h-4 w-4" /></span>No creators added</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-ink-soft">{c.stageCounts.confirmed} confirmed · {c.stageCounts.negotiating} negotiating</span>
          )}
          <span className="text-[11px] font-semibold text-ink-soft">{people} Creator{people === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-1.5">
        <Progress value={pct} bar={c.status === "paused" ? "bg-faint" : "bg-black"} />
        <div className="flex items-center justify-between text-[11px] font-semibold">
          <span className={c.budgetMinor ? "text-on" : "text-faint"}>{c.budgetMinor ? `${Math.round(pct)}% committed` : "No budget set"}</span>
          <span className="flex items-center gap-1 text-ink-soft"><CalendarDays className="h-3 w-3" />{c.startDate ?? "No start"} → {c.endDate ?? "No end"}</span>
        </div>
      </div>
    </div>
  );
}

