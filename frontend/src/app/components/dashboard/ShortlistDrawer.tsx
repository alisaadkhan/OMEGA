import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookmarkPlus, Check, PlusCircle, Search, X } from "lucide-react";
import { useAddToList, useCreateList, useLists, useRemoveFromList } from "../../api/lists";
import { useToast } from "../../lib/toast";
import { relative } from "../../lib/time";
import { Spinner } from "./states";

export type DrawerCreator = { id: string; name: string; handle: string; avatar: string; city?: string | null };

/**
 * "Save to Shortlist" side panel. One creator: the lists it is already on start ticked; ticking or unticking and then
 * saving adds it to or removes it from each list. Several creators (a search selection): tick the lists to add them to.
 * Every change is a server write; nothing is saved until "Save" is pressed.
 */
export function ShortlistDrawer({ open, creators, onClose }: { open: boolean; creators: DrawerCreator[]; onClose: () => void }) {
  const single = creators.length === 1 ? (creators[0] ?? null) : null;
  const lists = useLists(single?.id ?? null, open);
  const add = useAddToList();
  const remove = useRemoveFromList();
  const create = useCreateList();
  const toast = useToast();
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const initial = useMemo(() => new Set((lists.data?.lists ?? []).filter((l) => l.containsCreator === true).map((l) => l.id)), [lists.data]);
  useEffect(() => {
    if (open) setPicked(new Set(initial));
  }, [open, initial]);
  useEffect(() => {
    if (!open) {
      setFilter("");
      setCreating(false);
      setNewName("");
      setNameError(null);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const all = lists.data?.lists ?? [];
  const shown = all.filter((l) => l.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const toAdd = [...picked].filter((id) => !initial.has(id));
  const toRemove = single ? [...initial].filter((id) => !picked.has(id)) : [];
  const changes = toAdd.length + toRemove.length;
  const who = single ? single.name : `${creators.length} creators`;
  const ids = creators.map((c) => c.id);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function createList() {
    const n = newName.trim();
    if (!n) {
      setNameError("Give the new shortlist a name.");
      return;
    }
    setNameError(null);
    create.mutate(
      { name: n },
      {
        onSuccess: (l) => {
          setNewName("");
          setCreating(false);
          setPicked((prev) => new Set(prev).add(l.id));
          toast.success(`Created "${l.name}"`, "It's ticked below. Press Save to add the creator.");
        },
        onError: (err) => toast.error("Couldn't create the shortlist", err instanceof Error ? err.message : undefined),
      },
    );
  }

  async function save() {
    if (changes === 0) return;
    setSaving(true);
    const name = (id: string) => all.find((l) => l.id === id)?.name ?? "the shortlist";
    try {
      for (const id of toAdd) await add.mutateAsync({ id, creatorIds: ids });
      for (const id of toRemove) await remove.mutateAsync({ id, creatorIds: ids });
      const parts = [toAdd.length > 0 && `added to ${toAdd.length === 1 ? name(toAdd[0] as string) : `${toAdd.length} shortlists`}`, toRemove.length > 0 && `removed from ${toRemove.length === 1 ? name(toRemove[0] as string) : `${toRemove.length} shortlists`}`].filter(Boolean);
      toast.success(`${who} ${parts.join(" and ")}`);
      onClose();
    } catch (err) {
      toast.error("Couldn't save to the shortlists", err instanceof Error ? err.message : "Some changes may not have been saved. Open the panel again to check.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} className="fixed inset-0 z-[60] bg-[#0A0F24]/50 backdrop-blur-sm" />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Save to shortlist"
            className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-[420px] flex-col rounded-l-2xl bg-[#0A0F24] text-white shadow-2xl"
          >
            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#06B6D4] shadow-[0_0_8px_rgba(6,182,212,0.6)]" />
                  <h2 className="text-lg font-semibold tracking-tight">Save to Shortlist</h2>
                </div>
                <button onClick={onClose} aria-label="Close" className="rounded-xl p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/50">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <CreatorContext creators={creators} dark />
            </div>

            <div className="space-y-2.5 px-5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search your shortlists…" aria-label="Search your shortlists" className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3.5 text-sm text-white placeholder:text-slate-500 transition focus:border-cyan-400/60 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-400/30" />
              </div>
              <button onClick={() => setCreating((v) => !v)} aria-expanded={creating} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#06B6D4]/10 py-2.5 text-sm font-medium text-[#06B6D4] transition-colors hover:bg-[#06B6D4]/20 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                <PlusCircle className="h-4 w-4" /> Create New Shortlist
              </button>
              <AnimatePresence initial={false}>
                {creating && (
                  <motion.form
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="overflow-hidden"
                    onSubmit={(e) => {
                      e.preventDefault();
                      createList();
                    }}
                  >
                    <div className="space-y-2 rounded-xl bg-white/5 p-3">
                      <label htmlFor="new-shortlist" className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">New shortlist name</label>
                      <input id="new-shortlist" value={newName} maxLength={80} autoFocus onChange={(e) => { setNewName(e.target.value); if (nameError) setNameError(null); }} placeholder="e.g. Eid fashion picks" aria-invalid={nameError ? true : undefined} className={`w-full rounded-xl border bg-[#0A0F24] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 ${nameError ? "border-rose-500 focus:ring-rose-500/30" : "border-white/10 focus:ring-cyan-400/30"}`} />
                      {nameError && <p className="text-xs text-rose-400 animate-in fade-in slide-in-from-top-1 duration-200">{nameError}</p>}
                      <div className="flex justify-end">
                        <button type="submit" disabled={create.isPending} className="rounded-full bg-[#06B6D4] px-3.5 py-1.5 text-xs font-semibold text-[#0A0F24] transition-colors hover:bg-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/50 disabled:opacity-50">
                          {create.isPending ? "Creating…" : "Create"}
                        </button>
                      </div>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>
            </div>

            <div className="flex-1 space-y-1.5 overflow-y-auto px-5 py-4">
              <div className="flex items-center justify-between px-1 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Your shortlists ({all.length})</span>
                {picked.size > 0 && <span className="rounded-full bg-[#06B6D4]/15 px-2 py-0.5 text-[10px] font-semibold text-[#06B6D4]">{picked.size} selected</span>}
              </div>
              {lists.isPending ? (
                <div className="flex justify-center py-6"><Spinner /></div>
              ) : lists.isError ? (
                <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-300">
                  Couldn't load your shortlists. <button className="font-semibold underline" onClick={() => void lists.refetch()}>Try again</button>
                </div>
              ) : shown.length === 0 ? (
                <p className="px-1 py-4 text-sm text-slate-400">{all.length === 0 ? "No shortlists yet. Create your first one above." : "No shortlist matches that name."}</p>
              ) : (
                shown.map((l) => {
                  const on = picked.has(l.id);
                  return (
                    <button key={l.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(l.id)} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 ${on ? "bg-[#06B6D4]/10" : "bg-white/[0.03] hover:bg-white/[0.07]"}`}>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors ${on ? "bg-[#06B6D4] text-[#0A0F24]" : "border border-white/20"}`}>{on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{l.name}</span>
                        <span className="block text-xs text-slate-400"><span className="tabular-nums">{l.count} creator{l.count === 1 ? "" : "s"}</span> · Updated {relative(l.updatedAt)}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="space-y-2 border-t border-white/10 p-5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Changes</span>
                <span className="font-medium text-[#06B6D4]">{changes === 0 ? "Nothing to save yet" : `${toAdd.length > 0 ? `Add to ${toAdd.length}` : ""}${toAdd.length > 0 && toRemove.length > 0 ? " · " : ""}${toRemove.length > 0 ? `Remove from ${toRemove.length}` : ""}`}</span>
              </div>
              <button onClick={() => void save()} disabled={changes === 0 || saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#06B6D4] py-3 text-sm font-semibold text-[#0A0F24] shadow-lg transition-all hover:-translate-y-px hover:bg-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/50 disabled:translate-y-0 disabled:opacity-50">
                <BookmarkPlus className="h-4 w-4" /> {saving ? "Saving…" : "Save to Selected Shortlists"}
              </button>
              <button onClick={onClose} className="w-full rounded-xl py-1.5 text-sm text-slate-400 transition-colors hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/30">
                Cancel
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** The creator (or the selection) the side panel acts on. */
export function CreatorContext({ creators, dark = false }: { creators: DrawerCreator[]; dark?: boolean }) {
  const first = creators[0];
  if (!first) return null;
  const many = creators.length > 1;
  return (
    <div className={`flex items-center gap-3 rounded-xl p-3 ${dark ? "bg-white/5" : "bg-slate-50"}`}>
      <div className="flex -space-x-2">
        {creators.slice(0, 3).map((c) => (
          <img key={c.id} src={c.avatar} alt="" className={`h-10 w-10 rounded-full object-cover ring-2 ${dark ? "ring-[#0A0F24]" : "ring-white"}`} />
        ))}
      </div>
      <div className="min-w-0">
        <div className={`truncate text-sm font-semibold ${dark ? "text-white" : "text-slate-900"}`}>{many ? `${creators.length} creators selected` : first.name}</div>
        <div className={`truncate text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>{many ? creators.slice(0, 3).map((c) => `@${c.handle}`).join(", ") : `@${first.handle}${first.city ? ` · ${first.city}` : ""}`}</div>
      </div>
    </div>
  );
}
