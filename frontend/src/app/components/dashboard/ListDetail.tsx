import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Bookmark, Download, Edit3, Lock, MapPin, Megaphone, NotebookPen, Plus, Save, Search, Star, Trash2, TrendingUp, UserMinus, Users, X } from "lucide-react";
import type { ListMember } from "@mushin/contracts";
import { dataExportSchema } from "@mushin/contracts";
import { apiDownload, apiRequest } from "../../api/client";
import { useDeleteList, useList, useRemoveFromList, useSetListNote, useUpdateList } from "../../api/lists";
import { avatarFallback, formatCount, formatEr, toCreator } from "../../api/search-mapping";
import { erLevel } from "../../api/levels";
import { blockedReasonFor, ineligibleText } from "../../lib/eligibility";
import { relative } from "../../lib/time";
import { useConfirm, useToast } from "../../lib/toast";
import { Alert, Button, Drawer, EASE, EmptyState, Skeleton } from "../../ui/kit";
import { CampaignDrawer } from "./CampaignDrawer";
import type { Creator } from "./CreatorProfilePanel";
import { ListFormModal } from "./Lists";
import type { DrawerCreator } from "./ShortlistDrawer";
import { ErrorState } from "./states";

const PLATFORM_LABEL = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" } as const;

/** One shortlist (owner design 2026-11-16): figures strip, filterable table, dark note panel and floating batch bar. */
export function ListDetail({ id, onBack, onOpenCreator, onGoToSearch }: { id: string; onBack: () => void; onOpenCreator: (c: Creator) => void; onGoToSearch: () => void }) {
  const list = useList(id);
  const update = useUpdateList();
  const del = useDeleteList();
  const remove = useRemoveFromList();
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [minEr, setMinEr] = useState(false);
  const [noteFor, setNoteFor] = useState<ListMember | null>(null);
  const [campaignFor, setCampaignFor] = useState<DrawerCreator[] | null>(null);
  const [exporting, setExporting] = useState(false);

  if (list.isPending) return <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-24" /><Skeleton className="h-80" /></div>;
  if (list.isError) return <ErrorState body={list.error instanceof Error ? list.error.message : undefined} onRetry={() => void list.refetch()} />;
  const l = list.data;
  const q = filter.trim().toLowerCase();
  const members = l.members.filter((m) => `${m.creator.displayName} ${m.creator.handle} ${m.creator.city ?? ""} ${m.note}`.toLowerCase().includes(q) && (!minEr || (m.creator.engagementRate ?? 0) > 5));
  const allSelected = members.length > 0 && members.every((m) => selected.has(m.creator.id));
  const chosen = l.members.filter((m) => selected.has(m.creator.id));
  const blocked = blockedReasonFor(chosen.map((m) => m.creator.eligibility));
  const ers = l.members.map((m) => m.creator.engagementRate).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const medianEr = ers.length === 0 ? null : ers.length % 2 ? ers[(ers.length - 1) / 2]! : (ers[ers.length / 2 - 1]! + ers[ers.length / 2]!) / 2;
  const fits = l.members.map((m) => m.creator.authenticityScore).filter((x): x is number => x !== null);
  const reach = l.members.reduce((n, m) => n + (m.creator.followers ?? 0), 0);
  const err = (e: unknown) => (e instanceof Error ? e.message : undefined);

  async function onDelete() {
    if (!(await confirm({ title: `Delete ${l.name}?`, body: "The shortlist is removed for everyone on your team. The creators stay in MUSHIN.", confirmLabel: "Delete shortlist", cancelLabel: "Keep", destructive: true }))) return;
    del.mutate(id, { onSuccess: () => { toast.success(`Deleted ${l.name}`); onBack(); }, onError: (e) => toast.error("Couldn't delete the shortlist", err(e)) });
  }
  function onRemove(ids: string[]) {
    remove.mutate({ id, creatorIds: ids }, {
      onSuccess: (r) => { setSelected(new Set()); toast.success(`Removed ${r.removed} creator${r.removed === 1 ? "" : "s"} from ${l.name}`); },
      onError: (e) => toast.error("Couldn't remove creators", err(e)),
    });
  }
  async function onExport() {
    setExporting(true);
    try {
      const ex = await apiRequest("/v1/exports", dataExportSchema, { method: "POST", body: { kind: "lists", scopeId: id } });
      await apiDownload(`/v1/exports/${ex.id}/download`, `${l.name.replace(/[^\w-]+/g, "_")}.csv`);
      toast.success("Export downloaded");
    } catch (e) {
      toast.error("Couldn't export this shortlist", err(e) ?? "Data export is included on plans that offer it.");
    } finally {
      setExporting(false);
    }
  }
  const toggle = (cid: string) => setSelected((s) => { const n = new Set(s); if (n.has(cid)) n.delete(cid); else n.add(cid); return n; });

  return (
    <div className="flex flex-col pb-28">
      <header className="mb-6 flex flex-col gap-3 pt-1">
        <nav className="flex items-center gap-1 text-[11px] font-semibold text-ink-soft" aria-label="Breadcrumb">
          <button onClick={onBack} className="group flex items-center gap-1 transition-colors hover:text-on"><ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" /> Back to Shortlists</button>
          <span className="text-line">/</span>
          <span className="text-on">Lists</span>
          <span className="text-line">/</span>
          <span className="truncate font-semibold text-black">{l.name}</span>
        </nav>
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <motion.span initial={{ scale: 0.6, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 15 }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-top shadow-sm"><Bookmark className="h-6 w-6 text-on" /></motion.span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[28px] font-semibold leading-10 tracking-[-0.025em] text-on sm:text-[32px]">{l.name}</h1>
                <span className="inline-flex items-center gap-1 rounded bg-surface-mid px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft"><Lock className="h-3 w-3 text-faint" /> Team Private</span>
                {l.favorite && <Star className="h-4 w-4 fill-amber-400 text-amber-500" />}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                <span className="text-[15px] font-semibold tabular-nums text-on">{l.count}</span> Creators curated
                <span className="h-1 w-1 rounded-full bg-line" />
                <span>Updated {relative(l.updatedAt)}</span>
                {l.description && <><span className="h-1 w-1 rounded-full bg-line" /><span className="truncate">{l.description}</span></>}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" icon={Download} loading={exporting} onClick={() => void onExport()}>Export CSV</Button>
            <Button variant="outline" size="sm" icon={Edit3} onClick={() => setEditing(true)}>Rename</Button>
            <Button variant="outline" size="sm" icon={Trash2} onClick={() => void onDelete()} className="text-danger">Delete</Button>
          </div>
        </div>
      </header>

      <ListFormModal key={editing ? "e" : "e0"} open={editing} initial={{ name: l.name, description: l.description }} title="Rename shortlist" submitLabel="Save changes" busy={update.isPending} error={update.isError ? err(update.error) ?? "Couldn't save." : null}
        onClose={() => { setEditing(false); update.reset(); }}
        onSubmit={(v) => update.mutate({ id, patch: v }, { onSuccess: () => { setEditing(false); toast.success("Shortlist updated"); } })} />

      {l.members.length > 0 && (
        <section className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            { label: "Aggregated Reach", value: formatCount(reach), side: "Followers" },
            { label: "Median Engagement", value: medianEr === null ? "—" : formatEr(medianEr), side: `${ers.length} of ${l.members.length} measured` },
            { label: "Avg. Authenticity", value: fits.length ? String(Math.round(fits.reduce((a, b) => a + b, 0) / fits.length)) : "—", side: fits.length ? `${fits.length} assessed` : "Not assessed yet" },
            { label: "Creators", value: String(l.count), side: `Updated ${relative(l.updatedAt)}` },
          ].map((f, i) => (
            <motion.div key={f.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, ease: EASE }} className="flex flex-col justify-between rounded-xl bg-white p-3 shadow-sm">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-soft">{f.label}</span>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-xl font-semibold tabular-nums tracking-tight text-on">{f.value}</span>
                <span className="truncate text-[10px] font-semibold text-teal">{f.side}</span>
              </div>
            </motion.div>
          ))}
        </section>
      )}

      {l.members.length === 0 ? (
        <EmptyState icon={Users} title="No creators on this shortlist yet" body="Open a creator from Search and use Save to Shortlist to add them here." action={<Button onClick={onGoToSearch} icon={Search}>Search creators</Button>} />
      ) : (
        <div className="flex flex-col overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-low px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 h-4 w-4 text-faint" />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this shortlist..." aria-label="Filter this shortlist" className="w-52 rounded-lg bg-white py-1 pl-8 pr-3 text-xs text-on shadow-sm placeholder:text-ink-soft focus:outline-none focus:ring-2 focus:ring-cyan/30" />
              </div>
              <button onClick={() => setMinEr((v) => !v)} aria-pressed={minEr} className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold shadow-sm transition-colors ${minEr ? "bg-ink text-white" : "bg-white text-on"}`}>
                <TrendingUp className="h-3 w-3" /> ER &gt; 5.0%
              </button>
            </div>
            <span className="text-[10px] font-semibold tracking-wide text-ink-soft">Displaying <span className="text-[15px] tabular-nums text-on">{members.length}</span> of {l.members.length} records</span>
          </div>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Shortlist members">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface-mid text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                  <th className="w-12 px-3 py-2 text-center"><input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(members.map((m) => m.creator.id)))} className="h-4 w-4 cursor-pointer align-middle accent-black" /></th>
                  <th className="px-2 py-2">Creator</th>
                  <th className="px-2 py-2">Platform</th>
                  <th className="px-2 py-2 text-right">Followers</th>
                  <th className="px-2 py-2 text-right">Avg. ER</th>
                  <th className="px-3 py-2">Notes</th>
                  <th className="w-24 px-2 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <motion.tbody initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }} className="text-[13px] text-on">
                {members.map((m) => {
                  const c = toCreator(m.creator);
                  const on = selected.has(m.creator.id);
                  return (
                    <motion.tr key={m.creator.id} variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }} className={`transition-colors ${on ? "bg-cyan-pale/20 hover:bg-cyan-pale/30" : "hover:bg-surface-low"}`}>
                      <td className="px-3 py-2 text-center"><input type="checkbox" aria-label={`Select ${m.creator.displayName}`} checked={on} onChange={() => toggle(m.creator.id)} className="h-4 w-4 cursor-pointer align-middle accent-black" /></td>
                      <td className="px-2 py-2">
                        <button onClick={() => onOpenCreator(c)} className="flex items-center gap-2 rounded text-left focus:outline-none focus:ring-2 focus:ring-cyan/40">
                          <img src={c.avatar} alt="" onError={avatarFallback(m.creator.displayName)} className="h-10 w-10 shrink-0 rounded-full bg-surface-high object-cover shadow-sm" />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-[15px] font-semibold text-on">{m.creator.displayName}</span>
                            <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-ink-soft">
                              @{m.creator.handle}
                              {m.creator.city && <><span className="h-0.5 w-0.5 rounded-full bg-faint" /><span className="flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" />{m.creator.city}</span></>}
                            </span>
                            {!m.creator.eligibility.eligible && <span className="text-[11px] text-amber-800" data-testid="member-ineligible">{ineligibleText(m.creator.eligibility)} · kept on this shortlist</span>}
                          </span>
                        </button>
                      </td>
                      <td className="px-2 py-2"><span className="inline-flex items-center rounded bg-white px-2 py-0.5 text-[10px] font-semibold text-on shadow-sm ring-1 ring-surface-mid">{PLATFORM_LABEL[m.creator.platform]}</span></td>
                      <td className="px-2 py-2 text-right text-[15px] font-semibold tabular-nums">{formatCount(m.creator.followers)}</td>
                      <td className="px-2 py-2 text-right">{m.creator.engagementRate === null ? <span className="text-ink-soft">—</span> : <span className={`inline-block rounded px-1.5 py-0.5 text-[15px] font-semibold tabular-nums ${erLevel(m.creator.engagementRate).chip}`} title={`${erLevel(m.creator.engagementRate).word} engagement`}>{formatEr(m.creator.engagementRate)}</span>}</td>
                      <td className="px-3 py-2">
                        {m.note ? (
                          <div className="flex max-w-md items-center justify-between gap-2">
                            <p className="truncate text-xs text-on">{m.note}</p>
                            <button onClick={() => setNoteFor(m)} className="flex shrink-0 items-center gap-0.5 rounded bg-white px-2 py-1 text-[10px] font-semibold text-teal shadow-sm ring-1 ring-surface-mid hover:text-teal-deep"><NotebookPen className="h-3 w-3" /> Edit Note</button>
                          </div>
                        ) : (
                          <button onClick={() => setNoteFor(m)} className="inline-flex items-center gap-1 text-xs text-faint hover:text-on"><Plus className="h-3.5 w-3.5" /> Add note...</button>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button onClick={() => onRemove([m.creator.id])} disabled={remove.isPending} title="Remove from list" aria-label={`Remove ${m.creator.displayName}`} className="rounded p-1 text-ink-soft transition-colors hover:bg-danger-soft/40 hover:text-danger disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </motion.tr>
                  );
                })}
              </motion.tbody>
            </table>
          </div>
          <div className="flex items-center justify-between bg-surface-low p-2 px-3 text-[11px] font-semibold text-ink-soft">
            <span>{members.length} of {l.members.length} shown</span>
            {selected.size > 0 && <button onClick={() => setSelected(new Set())} className="hover:text-on">Clear selection</button>}
          </div>
        </div>
      )}

      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div initial={{ opacity: 0, y: 40, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 40, scale: 0.96 }} transition={{ type: "spring", stiffness: 380, damping: 30 }} role="region" aria-label="Selected creators" className="fixed bottom-6 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-5 rounded-2xl bg-ink/95 px-5 py-2 text-white shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <span className="flex -space-x-2 overflow-hidden">
                {chosen.slice(0, 3).map((m) => <img key={m.creator.id} src={toCreator(m.creator).avatar} alt="" onError={avatarFallback(m.creator.displayName)} className="h-7 w-7 rounded-full object-cover ring-2 ring-ink" />)}
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-[15px] font-semibold tabular-nums">{selected.size} Selected</span>
                <span className="text-[10px] font-semibold tracking-wide text-steel">Batch actions available</span>
              </span>
            </div>
            <span className="h-6 w-px bg-steel/20" />
            <button onClick={() => setCampaignFor(chosen.map((m) => ({ id: m.creator.id, name: m.creator.displayName, handle: m.creator.handle, avatar: toCreator(m.creator).avatar, city: m.creator.city })))} disabled={blocked !== null} title={blocked ?? undefined} className="flex items-center gap-1.5 rounded-lg bg-cyan-soft px-3 py-1.5 text-[13px] font-medium text-[#001f26] shadow-md transition-all hover:bg-cyan-pale active:scale-95 disabled:opacity-50">
              <Megaphone className="h-4 w-4" /> Add to Campaign
            </button>
            <button onClick={() => onRemove([...selected])} disabled={remove.isPending} className="flex items-center gap-1 rounded-lg bg-danger-soft/20 px-2 py-1.5 text-[13px] font-medium text-danger-soft transition-all hover:bg-danger-soft/30 disabled:opacity-50">
              <UserMinus className="h-4 w-4" /> Bulk Remove
            </button>
            <button onClick={() => setSelected(new Set())} aria-label="Clear selection" className="rounded-full p-1 text-steel hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <NotePanel listId={id} listName={l.name} member={noteFor} onClose={() => setNoteFor(null)} />
      <CampaignDrawer open={campaignFor !== null} creators={campaignFor ?? []} onClose={() => { setCampaignFor(null); setSelected(new Set()); }} />
    </div>
  );
}

/** The dark slide-over note editor from the design: creator card, the note, and save with an animated result. */
function NotePanel({ listId, listName, member, onClose }: { listId: string; listName: string; member: ListMember | null; onClose: () => void }) {
  const save = useSetListNote();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (member && shownFor !== member.creator.id) {
    setShownFor(member.creator.id);
    setDraft(member.note);
    save.reset();
  }
  const c = member ? toCreator(member.creator) : null;
  const dirty = !!member && draft.trim() !== member.note;
  const submit = () => {
    if (!member) return;
    save.mutate({ id: listId, creatorId: member.creator.id, note: draft.trim() }, { onSuccess: () => { toast.success("Note saved"); onClose(); } });
  };
  return (
    <Drawer open={member !== null} onClose={onClose} label="Creator note" dark>
      {member && c && (
        <>
          <div className="flex items-center justify-between p-5">
            <div className="flex flex-col">
              <span className="text-lg font-semibold tracking-tight">Creator Internal Note</span>
              <span className="text-[10px] font-semibold tracking-wide text-steel">Private to your team</span>
            </div>
            <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg bg-shell transition-colors hover:bg-shell/80"><X className="h-[18px] w-[18px]" /></button>
          </div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-2">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between rounded-xl bg-shell p-2">
              <div className="flex items-center gap-2">
                <img src={c.avatar} alt="" onError={avatarFallback(member.creator.displayName)} className="h-9 w-9 rounded-full object-cover" />
                <span className="flex flex-col">
                  <span className="text-[15px] font-semibold leading-tight">{member.creator.displayName}</span>
                  <span className="text-[10px] font-semibold tracking-wide text-steel">{listName} • @{member.creator.handle}</span>
                </span>
              </div>
              {member.creator.engagementRate !== null && <span className="rounded bg-cyan-soft/20 px-2 py-0.5 text-[13px] font-semibold tabular-nums text-cyan-soft shadow-[0_0_8px_rgba(6,182,212,0.25)]">{formatEr(member.creator.engagementRate)} ER</span>}
            </motion.div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="list-note" className="text-[10px] font-semibold uppercase tracking-wider text-steel">Note</label>
                <span className="text-[10px] font-semibold tabular-nums text-steel">{draft.length}/1000</span>
              </div>
              <textarea id="list-note" autoFocus value={draft} maxLength={1000} onChange={(e) => setDraft(e.target.value)} rows={7} placeholder="Log details, outreach status, exclusivity caveats or rate quotes..." className="w-full resize-none rounded-xl bg-shell p-2.5 text-xs leading-relaxed text-white shadow-inner placeholder:text-steel focus:outline-none focus:ring-1 focus:ring-cyan-soft" />
            </div>
            <div className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-steel">
              <Bookmark className="h-3.5 w-3.5" /> Added to this shortlist {relative(member.addedAt)}
            </div>
            <Alert tone="error">{save.isError ? (save.error instanceof Error ? save.error.message : "Couldn't save the note.") : null}</Alert>
          </div>
          <div className="flex flex-col gap-1 bg-shell p-5">
            <button onClick={submit} disabled={!dirty || save.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-soft px-3 py-2.5 text-[15px] font-semibold text-[#001f26] shadow-lg shadow-cyan-soft/20 transition-all hover:bg-cyan-pale active:scale-[0.98] disabled:opacity-50">
              <Save className="h-[18px] w-[18px]" /> {save.isPending ? "Saving…" : "Save Note"}
            </button>
            <button onClick={onClose} className="py-1.5 text-center text-[13px] font-medium text-steel transition-colors hover:text-white">Cancel</button>
          </div>
        </>
      )}
    </Drawer>
  );
}
