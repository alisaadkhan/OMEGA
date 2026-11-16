import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarClock, CheckCircle2, Clock3, Lock, MapPin, Pencil, Search, ShieldCheck, Trash2, Undo2, UserPlus, Users, X, XCircle } from "lucide-react";
import type { CampaignCreator, CampaignDetail, PipelineStage, UpdateCampaignCreator } from "@mushin/contracts";
import { rupees, toMinor, useRemoveFromCampaign, useUpdateCampaignCreator } from "../../api/campaigns";
import { avatarFallback, formatCount, toCreator } from "../../api/search-mapping";
import { ineligibleText } from "../../lib/eligibility";
import { relative } from "../../lib/time";
import { useConfirm, useToast } from "../../lib/toast";
import { Alert, Button, Drawer, EASE, EmptyState, Segmented } from "../../ui/kit";
import { cn } from "../ui/utils";
import { PLATFORM_NAME, STAGE_LABEL } from "./Campaigns";
import type { Creator } from "./CreatorProfilePanel";

const STAGES: PipelineStage[] = ["identified", "contacted", "negotiating", "confirmed"];
const STAGE_DOT: Record<PipelineStage, string> = { identified: "bg-faint", contacted: "bg-cyan-soft", negotiating: "bg-teal", confirmed: "bg-ink" };
const CONTENT_LABEL = { none: "Not started", content_pending: "Content pending", posted: "Posted", completed: "Completed" } as const;
const FEE_LABEL = { estimated: "Estimated", quoted: "Quoted", agreed: "Agreed" } as const;
const PRIORITY_LABEL = { low: "Low", med: "Medium", high: "High" } as const;
type Member = CampaignCreator;

/** Saves one member change with the version the user saw; a newer server version (409) reloads instead of overwriting. */
function useMemberChange(campaignId: string) {
  const save = useUpdateCampaignCreator();
  const toast = useToast();
  const change = (m: Member, patch: Omit<UpdateCampaignCreator, "expectedVersion">, ok?: string, done?: () => void) =>
    save.mutate({ id: campaignId, creatorId: m.creator.id, patch: { expectedVersion: m.version, ...patch } }, {
      onSuccess: () => { if (ok) toast.success(ok); done?.(); },
      onError: (err) => {
        if ((err as { code?: unknown }).code === "CONFLICT") toast.warning("Updated by someone else", "We loaded their change. Check it, then try again.");
        else toast.error("Couldn't save the change", err instanceof Error ? err.message : undefined);
      },
    });
  return { change, saving: save.isPending, error: save.error };
}

function Who({ m, onOpen }: { m: Member; onOpen: () => void }) {
  const card = toCreator(m.creator);
  return (
    <button onClick={onOpen} className="flex items-center gap-3 rounded text-left focus:outline-none focus:ring-2 focus:ring-cyan/40">
      <img src={card.avatar} alt="" onError={avatarFallback(m.creator.displayName)} className="h-10 w-10 shrink-0 rounded-full bg-surface-high object-cover shadow-sm" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-semibold text-on">{m.creator.displayName}</span>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-ink-soft">
          @{m.creator.handle}
          {m.creator.city && <><span>•</span><span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{m.creator.city}</span></>}
        </span>
        {!m.creator.eligibility.eligible && <span className="text-[11px] text-amber-800" data-testid="member-ineligible">{ineligibleText(m.creator.eligibility)} · kept in this campaign</span>}
      </span>
    </button>
  );
}

function StagePill({ m }: { m: Member }) {
  if (m.outcome === "declined") return <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft/40 px-2.5 py-1 text-[10px] font-semibold text-danger-ink"><span className="h-1.5 w-1.5 rounded-full bg-danger" />Declined</span>;
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-soft/20 px-2.5 py-1 text-[10px] font-semibold text-[#006172]"><span className={cn("h-1.5 w-1.5 rounded-full", STAGE_DOT[m.stage])} />{STAGE_LABEL[m.stage]}</span>;
}

export function RosterTab({ c, onOpenCreator, onGoToSearch }: { c: CampaignDetail; onOpenCreator: (x: Creator) => void; onGoToSearch: () => void }) {
  const remove = useRemoveFromCampaign();
  const confirm = useConfirm();
  const toast = useToast();
  const [find, setFind] = useState("");
  const [stage, setStage] = useState<"all" | PipelineStage | "declined">("all");
  const [editing, setEditing] = useState<Member | null>(null);
  const rows = c.creators.filter((m) => `${m.creator.displayName} ${m.creator.handle}`.toLowerCase().includes(find.trim().toLowerCase()) && (stage === "all" || (stage === "declined" ? m.outcome === "declined" : m.outcome === "open" && m.stage === stage)));
  const committed = c.creators.filter((m) => m.outcome === "open").reduce((n, m) => n + (m.feeMinor ?? 0), 0);
  async function onRemove(m: Member) {
    if (!(await confirm({ title: `Remove ${m.creator.displayName} from the campaign?`, body: "Their stage, fee and outreach log in this campaign are deleted.", confirmLabel: "Remove", cancelLabel: "Keep", destructive: true }))) return;
    remove.mutate({ id: c.id, creatorId: m.creator.id }, { onSuccess: () => toast.success(`Removed ${m.creator.displayName}`), onError: (e) => toast.error("Couldn't remove the creator", e instanceof Error ? e.message : undefined) });
  }
  if (c.creators.length === 0) return <EmptyState icon={Users} title="No creators in this campaign yet" body="Add creators from Search, a shortlist or a creator's profile with Add to Campaign." action={<Button icon={UserPlus} onClick={onGoToSearch}>Add Creator</Button>} />;
  // Fresh copy of the member being edited (the list refetches after each save).
  const live = editing ? c.creators.find((m) => m.creator.id === editing.creator.id) ?? null : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex max-w-xl flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-faint" />
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search creator or handle..." aria-label="Search creators in this campaign" className="w-full rounded-lg bg-white py-2 pl-9 pr-3 text-xs text-on shadow-sm placeholder:text-line focus:outline-none focus:ring-1 focus:ring-teal" />
          </div>
          <select value={stage} onChange={(e) => setStage(e.target.value as typeof stage)} aria-label="Filter stage" className="rounded-lg bg-white px-3 py-2 text-[13px] font-medium text-on shadow-sm focus:outline-none focus:ring-1 focus:ring-teal">
            <option value="all">Filter Stage: All ({c.creators.length})</option>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            <option value="declined">Declined</option>
          </select>
        </div>
        <Button variant="primary" icon={UserPlus} onClick={onGoToSearch}>+ Add Creator</Button>
      </div>
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="bg-surface-low text-[10px] font-semibold uppercase tracking-wider text-ink-soft"><th className="min-w-[240px] px-4 py-3">Creator</th><th className="px-4 py-3">Platform</th><th className="px-4 py-3 text-right">Audience</th><th className="px-4 py-3 text-right">Campaign Fee</th><th className="px-4 py-3">Stage</th><th className="px-4 py-3">Content</th><th className="w-24 px-4 py-3 text-right"><span className="sr-only">Actions</span></th></tr></thead>
            <motion.tbody initial="h" animate="s" variants={{ h: {}, s: { transition: { staggerChildren: 0.04 } } }} className="divide-y divide-surface-high text-xs text-on">
              {rows.map((m) => (
                <motion.tr key={m.creator.id} variants={{ h: { opacity: 0, y: 6 }, s: { opacity: 1, y: 0 } }} className="group transition-colors hover:bg-surface-low">
                  <td className="px-4 py-3.5"><Who m={m} onOpen={() => onOpenCreator(toCreator(m.creator))} /></td>
                  <td className="px-4 py-3.5"><span className="rounded bg-surface-mid px-2 py-1 text-[10px] font-semibold">{PLATFORM_NAME[m.creator.platform]}</span></td>
                  <td className="px-4 py-3.5 text-right text-[15px] font-semibold tabular-nums">{formatCount(m.creator.followers)}</td>
                  <td className="px-4 py-3.5 text-right"><span className="text-[15px] font-semibold tabular-nums">{rupees(m.feeMinor)}</span><span className="block text-[10px] text-ink-soft">{FEE_LABEL[m.feeKind]}</span></td>
                  <td className="px-4 py-3.5"><StagePill m={m} /></td>
                  <td className="px-4 py-3.5"><span className="rounded bg-surface-high px-2 py-0.5 text-[10px] text-ink-soft">{CONTENT_LABEL[m.contentStatus]}</span></td>
                  <td className="px-4 py-3.5 text-right">
                    <span className="flex justify-end gap-1">
                      <button onClick={() => setEditing(m)} title="Edit creator terms" aria-label={`Edit terms for ${m.creator.displayName}`} className="flex h-7 w-7 items-center justify-center rounded text-faint transition-all hover:bg-surface-mid hover:text-on"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => void onRemove(m)} title="Remove from roster" aria-label={`Remove ${m.creator.displayName}`} className="flex h-7 w-7 items-center justify-center rounded text-faint opacity-60 transition-all hover:bg-danger-soft/30 hover:text-danger group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>
                    </span>
                  </td>
                </motion.tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-ink-soft">No creator matches this filter.</td></tr>}
            </motion.tbody>
          </table>
        </div>
        <div className="flex flex-col justify-between gap-2 bg-surface-low px-5 py-3.5 text-xs md:flex-row md:items-center">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="text-[11px] font-semibold uppercase text-ink-soft">Roster Commitment: <span className="text-[15px] normal-case tabular-nums text-on">{rupees(committed)}</span></span>
            <span className="text-line">•</span>
            <span className="text-[11px] font-semibold uppercase text-ink-soft">Total Creators: <span className="normal-case text-on">{c.creators.length}</span></span>
          </div>
          <div className="flex items-center gap-4 text-[10px] font-semibold text-ink-soft">
            {STAGES.map((s) => <span key={s} className="flex items-center gap-1"><span className={cn("h-2 w-2 rounded-full", STAGE_DOT[s])} />{c.stageCounts[s] ?? 0} {STAGE_LABEL[s]}</span>)}
          </div>
        </div>
      </div>
      <TermsDrawer campaignId={c.id} m={live} onClose={() => setEditing(null)} />
    </div>
  );
}

/** "Edit Creator Terms" slide-over: stage, fee and its kind, content status, priority, due date and an internal note. */
function TermsDrawer({ campaignId, m, onClose }: { campaignId: string; m: Member | null; onClose: () => void }) {
  const { change, saving, error } = useMemberChange(campaignId);
  const [form, setForm] = useState<null | { id: string; stage: PipelineStage; outcome: Member["outcome"]; fee: string; feeKind: Member["feeKind"]; contentStatus: Member["contentStatus"]; priority: Member["priority"]; dueDate: string; note: string }>(null);
  if (m && form?.id !== m.creator.id) setForm({ id: m.creator.id, stage: m.stage, outcome: m.outcome, fee: m.feeMinor === null ? "" : String(Math.round(m.feeMinor / 100)), feeKind: m.feeKind, contentStatus: m.contentStatus, priority: m.priority, dueDate: m.dueDate ?? "", note: m.note });
  if (!m && form) setForm(null);
  const feeBad = !!form && form.fee.trim() !== "" && toMinor(form.fee) === null;
  const save = () => {
    if (!m || !form || feeBad) return;
    const patch: Omit<UpdateCampaignCreator, "expectedVersion"> = {};
    if (form.stage !== m.stage) patch.stage = form.stage;
    if (form.outcome !== m.outcome) patch.outcome = form.outcome;
    if (toMinor(form.fee) !== m.feeMinor) patch.feeMinor = toMinor(form.fee);
    if (form.feeKind !== m.feeKind) patch.feeKind = form.feeKind;
    if (form.contentStatus !== m.contentStatus) patch.contentStatus = form.contentStatus;
    if (form.priority !== m.priority) patch.priority = form.priority;
    if ((form.dueDate || null) !== m.dueDate) patch.dueDate = form.dueDate || null;
    if (form.note.trim() !== m.note) patch.note = form.note.trim();
    if (Object.keys(patch).length === 0) return onClose();
    change(m, patch, "Creator terms saved", onClose);
  };
  const lbl = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft";
  const fld = "w-full rounded-xl bg-[#F1F5F9] px-3.5 py-2.5 text-xs font-medium text-on outline-none transition-colors focus:bg-white focus:ring-2 focus:ring-cyan/30";
  return (
    <Drawer open={m !== null} onClose={onClose} label="Edit creator terms" width="w-[400px]">
      {m && form && (
        <>
          <header className="shrink-0 border-b border-surface-mid p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-cyan-600"><span className="h-1.5 w-1.5 rounded-full bg-cyan" />Edit Creator Terms</span>
              <button onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-lg text-faint hover:bg-surface-mid hover:text-on"><X className="h-4 w-4" /></button>
            </div>
            <div className="rounded-2xl border border-surface-top/70 bg-surface-low/80 p-3"><Who m={m} onOpen={() => undefined} /></div>
          </header>
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <section>
              <span className={lbl}>Campaign Stage</span>
              <div className="grid grid-cols-2 gap-1.5">
                {STAGES.map((s) => (
                  <button key={s} type="button" onClick={() => setForm({ ...form, stage: s, outcome: "open" })} className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all", form.outcome === "open" && form.stage === s ? "bg-ink text-white shadow-md" : "bg-[#F1F5F9] text-on hover:bg-surface-high")}>
                    <span className={cn("h-2 w-2 rounded-full", STAGE_DOT[s])} />{STAGE_LABEL[s]}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setForm({ ...form, outcome: form.outcome === "declined" ? "open" : "declined" })} className={cn("mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors", form.outcome === "declined" ? "bg-danger text-white" : "bg-danger-soft/30 text-danger-ink hover:bg-danger-soft/50")}>
                {form.outcome === "declined" ? <><Undo2 className="h-3.5 w-3.5" /> Declined · tap to reopen</> : <><XCircle className="h-3.5 w-3.5" /> Mark declined</>}
              </button>
            </section>
            <section>
              <span className={lbl}>Agreed Deliverable Fee</span>
              <div className="relative"><span className="absolute inset-y-0 left-3.5 flex items-center text-xs font-bold text-faint">Rs.</span><input aria-label="Fee in rupees" inputMode="numeric" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} placeholder="Not set" className={cn(fld, "pl-10 text-base font-semibold tabular-nums", feeBad && "ring-2 ring-danger/40")} /></div>
              <Segmented<Member["feeKind"]> value={form.feeKind} onChange={(v) => setForm({ ...form, feeKind: v })} className="mt-2" options={(["estimated", "quoted", "agreed"] as const).map((k) => ({ id: k, label: FEE_LABEL[k] }))} />
            </section>
            <section className="grid grid-cols-2 gap-3">
              <label><span className={lbl}>Content</span><select value={form.contentStatus} onChange={(e) => setForm({ ...form, contentStatus: e.target.value as Member["contentStatus"] })} className={fld}>{Object.entries(CONTENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span className={lbl}>Priority</span><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Member["priority"] })} className={fld}>{Object.entries(PRIORITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            </section>
            <label className="block"><span className={lbl}>Due Date</span><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={fld} /></label>
            <label className="block"><span className={lbl}>Deliverables &amp; Notes</span><textarea aria-label="Deliverables and notes" rows={4} maxLength={2000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. 1 Reel + 2 Stories, swipe-up link" className={cn(fld, "resize-none")} /></label>
            <Alert tone="error">{feeBad ? "Enter the fee as a number of rupees." : error ? (error instanceof Error ? error.message : "Couldn't save.") : null}</Alert>
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-surface-mid bg-white p-4">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button loading={saving} disabled={feeBad} onClick={save} className="bg-[#0B112B]"><CheckCircle2 className="h-4 w-4 text-cyan-400" /> Save Creator Terms</Button>
          </footer>
        </>
      )}
    </Drawer>
  );
}

/** Kanban board: drag a card to another stage (or use its menu); Declined sits at the end. */
export function PipelineTab({ c, onOpenCreator, onGoToSearch }: { c: CampaignDetail; onOpenCreator: (x: Creator) => void; onGoToSearch: () => void }) {
  const { change, saving } = useMemberChange(c.id);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  if (c.creators.length === 0) return <EmptyState icon={Users} title="No creators in the pipeline yet" body="Add creators to this campaign to move them from Identified to Confirmed." action={<Button icon={UserPlus} onClick={onGoToSearch}>Add Creator</Button>} />;
  const byId = (id: string) => c.creators.find((m) => m.creator.id === id);
  const drop = (col: PipelineStage | "declined") => {
    const m = dragging ? byId(dragging) : undefined;
    setDragging(null);
    setOver(null);
    if (!m) return;
    if (col === "declined") { if (m.outcome !== "declined") change(m, { outcome: "declined" }, `${m.creator.displayName} marked declined`); return; }
    if (m.stage === col && m.outcome === "open") return;
    change(m, { stage: col, ...(m.outcome === "declined" ? { outcome: "open" as const } : {}) }, `${m.creator.displayName} moved to ${STAGE_LABEL[col]}`);
  };
  const cols: { id: PipelineStage | "declined"; title: string; items: Member[] }[] = [
    ...STAGES.map((s) => ({ id: s, title: STAGE_LABEL[s], items: c.creators.filter((m) => m.outcome === "open" && m.stage === s) })),
    { id: "declined" as const, title: "Declined", items: c.creators.filter((m) => m.outcome === "declined") },
  ];
  return (
    <div className="overflow-x-auto pb-2">
      <p className="mb-3 text-xs text-ink-soft">Drag a creator to another column to change their stage.</p>
      <div className="grid min-w-[1180px] grid-cols-5 gap-3">
        {cols.map((col) => {
          const fees = col.items.reduce((n, m) => n + (m.feeMinor ?? 0), 0);
          return (
            <section key={col.id} aria-label={`${col.title}: ${col.items.length}`} onDragOver={(e) => { e.preventDefault(); setOver(col.id); }} onDragLeave={() => setOver((o) => (o === col.id ? null : o))} onDrop={() => drop(col.id)} className={cn("flex min-h-[520px] flex-col rounded-xl bg-surface-low p-2 transition-all", over === col.id && "bg-cyan-pale/30 ring-2 ring-cyan-soft", col.id === "declined" && "opacity-80")}>
              <div className="mb-1 flex items-center justify-between px-1 py-2">
                <span className="flex items-center gap-1.5 text-[15px] font-semibold text-on"><span className={cn("h-2.5 w-2.5 rounded-full", col.id === "declined" ? "bg-danger" : STAGE_DOT[col.id])} />{col.title}</span>
                <span className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold", col.id === "confirmed" ? "bg-ink text-white" : "bg-surface-high text-ink-soft")}>{col.items.length}</span>
              </div>
              <div className="mx-1 mb-2 flex items-center justify-between rounded bg-white/80 px-2 py-1 text-[10px] font-semibold text-ink-soft shadow-sm">
                <span>{col.id === "confirmed" ? "Confirmed fees" : "Fees on cards"}</span>
                <span className={cn("text-on", col.id === "confirmed" && "text-teal")}>{rupees(fees)}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <AnimatePresence initial={false}>
                  {col.items.map((m) => (
                    <motion.article
                      layout
                      key={m.creator.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: dragging === m.creator.id ? 0.4 : 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.25, ease: EASE }}
                      draggable
                      onDragStart={() => setDragging(m.creator.id)}
                      onDragEnd={() => { setDragging(null); setOver(null); }}
                      className={cn("cursor-grab rounded-xl bg-white p-3 shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_4px_16px_rgba(15,23,42,0.08)] active:cursor-grabbing", col.id === "contacted" && "border-l-4 border-l-teal", saving && "pointer-events-none")}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2"><Who m={m} onOpen={() => onOpenCreator(toCreator(m.creator))} /></div>
                      <div className="mb-2 flex flex-col gap-1 rounded-lg bg-surface-low p-2 text-[10px]">
                        <div className="flex justify-between"><span className="font-semibold uppercase tracking-wider text-faint">Content</span><span className="text-on">{CONTENT_LABEL[m.contentStatus]}</span></div>
                        <div className="flex justify-between"><span className="font-semibold uppercase tracking-wider text-faint">Audience</span><span className="font-semibold text-on">{formatCount(m.creator.followers)}</span></div>
                      </div>
                      <div className="flex items-end justify-between">
                        <span><span className="block text-[10px] text-faint">{FEE_LABEL[m.feeKind]} Fee</span><span className="text-[15px] font-bold tracking-tight text-on">{rupees(m.feeMinor)}</span></span>
                        {col.id === "confirmed" ? <span className="flex items-center gap-1 text-[10px] font-semibold text-teal"><Lock className="h-3.5 w-3.5" />Confirmed</span> : <span className="text-[10px] text-ink-soft">{m.lastOutreach ? relative(m.lastOutreach.occurredAt) : `Added ${relative(m.addedAt)}`}</span>}
                      </div>
                    </motion.article>
                  ))}
                </AnimatePresence>
                {col.items.length === 0 && <div className="flex flex-1 items-center justify-center rounded-xl border-2 border-dashed border-surface-high p-4 text-center text-[11px] text-faint">Drop a creator here</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Deliverable timeline: members by due date; "Verify Post" marks a deliverable posted, then completed. */
export function TimelineTab({ c, onOpenCreator }: { c: CampaignDetail; onOpenCreator: (x: Creator) => void }) {
  const { change, saving } = useMemberChange(c.id);
  const [verify, setVerify] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const items = c.creators.filter((m) => m.outcome === "open").sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const dueToday = items.find((m) => m.dueDate === today && m.contentStatus !== "posted" && m.contentStatus !== "completed");
  if (items.length === 0) return <EmptyState icon={CalendarClock} title="Nothing scheduled yet" body="Set a due date on a creator's terms to see their deliverable here." />;
  const when = (d: string | null) => (!d ? "No due date" : d === today ? "Today" : new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }));
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      {dueToday && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="relative flex flex-col justify-between gap-3 overflow-hidden rounded-xl bg-white p-4 shadow-sm ring-1 ring-line/30 md:flex-row md:items-center">
          <span className="absolute bottom-0 left-0 top-0 w-1 bg-teal" />
          <div className="flex items-center gap-3 pl-1"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-soft/20 text-teal"><Clock3 className="h-5 w-5" /></span><div><span className="text-[11px] font-semibold uppercase tracking-wider text-teal">Scheduled Today</span><p className="text-[13px] font-medium text-on">{dueToday.creator.displayName}'s deliverable is due today.</p></div></div>
          <Button size="sm" icon={ShieldCheck} onClick={() => setVerify(dueToday.creator.id)}>Verify Post</Button>
        </motion.div>
      )}
      <div className="flex items-center justify-between border-b border-surface-high pb-3"><div><h2 className="text-lg font-semibold text-on">Deliverable Milestones</h2><p className="text-xs text-ink-soft">Creators by due date, with their content status.</p></div></div>
      <div className="relative flex flex-col gap-7 pl-8">
        <div className="absolute bottom-6 left-3.5 top-3 w-0.5 bg-surface-top" />
        {items.map((m, i) => {
          const done = m.contentStatus === "posted" || m.contentStatus === "completed";
          const isToday = m.dueDate === today && !done;
          return (
            <motion.div key={m.creator.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06, ease: EASE }} className="relative flex flex-col gap-2">
              <div className="absolute -left-8 top-1.5 flex items-center justify-center">
                <span className={cn("flex h-6 w-6 items-center justify-center rounded-full shadow-sm ring-4 ring-surface", done ? "bg-teal text-white" : isToday ? "bg-cyan-soft" : "bg-surface-high text-faint")}>
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : isToday ? <span className="h-2.5 w-2.5 animate-ping rounded-full bg-teal" /> : <CalendarClock className="h-3.5 w-3.5" />}
                </span>
              </div>
              <span className={cn("w-fit rounded-full px-2.5 py-0.5 text-[11px] font-semibold", isToday ? "bg-cyan-soft/30 text-teal" : "bg-surface-mid text-ink-soft")}>{when(m.dueDate)}</span>
              <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-line/30">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <Who m={m} onOpen={() => onOpenCreator(toCreator(m.creator))} />
                  <span className={cn("flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", done ? "bg-cyan-soft/20 text-teal" : "bg-surface-mid text-ink-soft")}>{CONTENT_LABEL[m.contentStatus]}</span>
                </div>
                {m.note && <p className="mt-2 text-[13px] text-on">{m.note}</p>}
                <div className="relative mt-4 flex flex-col justify-between gap-3 border-t border-surface-high pt-3 sm:flex-row sm:items-center">
                  <span className="text-xs text-ink-soft">{PLATFORM_NAME[m.creator.platform]} · {rupees(m.feeMinor)} {FEE_LABEL[m.feeKind].toLowerCase()}</span>
                  {m.contentStatus !== "completed" && <Button size="sm" variant={done ? "soft" : "primary"} icon={ShieldCheck} onClick={() => setVerify(verify === m.creator.id ? null : m.creator.id)}>{done ? "Mark Completed" : "Verify Post"}</Button>}
                  <AnimatePresence>
                    {verify === m.creator.id && (
                      <motion.div initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6 }} className="absolute bottom-full right-0 z-30 mb-2 w-80 rounded-xl bg-white p-4 shadow-xl ring-1 ring-line/40">
                        <p className="text-[15px] font-semibold text-on">{done ? "Is this deliverable finished?" : "Did the creator post this deliverable?"}</p>
                        <p className="mt-1 text-xs text-ink-soft">Confirm that {m.creator.displayName} has {done ? "completed everything agreed" : "published the agreed content"}.</p>
                        <div className="mt-3 flex justify-end gap-2">
                          <Button size="sm" variant="soft" onClick={() => setVerify(null)}>Not yet</Button>
                          <Button size="sm" loading={saving} icon={CheckCircle2} onClick={() => change(m, { contentStatus: done ? "completed" : "posted" }, done ? "Marked completed" : "Marked posted", () => setVerify(null))}>{done ? "Mark Completed" : "Mark Posted"}</Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
