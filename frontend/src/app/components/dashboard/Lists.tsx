import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUpDown, Bookmark, FolderHeart, MoreHorizontal, Pencil, Plus, Search, Star, Trash2, UserPlus, Users, Zap } from "lucide-react";
import type { ListSummary } from "@mushin/contracts";
import { useCreateList, useDeleteList, useLists, useUpdateList } from "../../api/lists";
import { initialsAvatar } from "../../api/search-mapping";
import { relative } from "../../lib/time";
import { useConfirm, useToast } from "../../lib/toast";
import { Button, Card, CountUp, EASE, EmptyState, Field, Modal, Skeleton, Stagger, StaggerItem } from "../../ui/kit";
import type { Creator } from "./CreatorProfilePanel";
import { ImportCreators } from "./ImportCreators";
import { ListDetail } from "./ListDetail";
import { ErrorState } from "./states";

/**
 * Shortlists (owner design 2026-11-16): roster cards with avatar stacks, a figures strip and a create/rename dialog.
 * Private to the account's team; every change is saved on the server.
 */
export function Lists({ onOpenCreator, onGoToSearch }: { onOpenCreator: (c: Creator) => void; onGoToSearch: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <AnimatePresence mode="wait">
      {openId ? (
        <motion.div key="detail" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.3, ease: EASE }}>
          <ListDetail id={openId} onBack={() => setOpenId(null)} onOpenCreator={onOpenCreator} onGoToSearch={onGoToSearch} />
        </motion.div>
      ) : (
        <motion.div key="index" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.3, ease: EASE }}>
          <ListIndex onOpen={setOpenId} onGoToSearch={onGoToSearch} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Create or rename a shortlist in a dialog, with the server's error shown inline. */
export function ListFormModal({ open, initial, title, submitLabel, busy, error, onSubmit, onClose }: { open: boolean; initial?: { name: string; description: string }; title: string; submitLabel: string; busy: boolean; error: string | null; onSubmit: (v: { name: string; description: string }) => void; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [touched, setTouched] = useState(false);
  return (
    <Modal open={open} onClose={onClose} label={title} width="max-w-[480px]">
      <form
        className="flex flex-col gap-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (name.trim()) onSubmit({ name: name.trim(), description: description.trim() });
        }}
      >
        <div>
          <h2 className="text-lg font-bold tracking-tight text-on">{title}</h2>
          <p className="mt-1 text-xs text-ink-soft">Shortlists are private to your team.</p>
        </div>
        <Field label="Name" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bridal Lahore Q3" error={touched && !name.trim() ? "Give the shortlist a name." : null} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="list-desc" className="text-[13px] font-medium text-on">Description <span className="font-normal text-faint">(optional)</span></label>
          <textarea id="list-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} placeholder="Who belongs on this shortlist?" className="w-full resize-none rounded-xl bg-surface-low p-3.5 text-[13px] text-on outline-none transition-all placeholder:text-faint focus:bg-white focus:shadow-md focus:ring-2 focus:ring-cyan/30" />
        </div>
        {error && <p role="alert" className="animate-shake rounded-xl bg-danger-soft/70 px-3.5 py-2.5 text-[13px] text-danger-ink">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="soft" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ListIndex({ onOpen, onGoToSearch }: { onOpen: (id: string) => void; onGoToSearch: () => void }) {
  const lists = useLists();
  const create = useCreateList();
  const update = useUpdateList();
  const remove = useDeleteList();
  const toast = useToast();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [renaming, setRenaming] = useState<ListSummary | null>(null);
  const [find, setFind] = useState("");
  const [sort, setSort] = useState<"updated" | "name" | "size">("updated");
  const all = lists.data?.lists ?? [];
  const shown = all
    .filter((l) => `${l.name} ${l.description}`.toLowerCase().includes(find.trim().toLowerCase()))
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "size" ? b.count - a.count : b.updatedAt.localeCompare(a.updatedAt)));
  const weekAgo = Date.now() - 7 * 86_400_000;
  const stats = [
    { label: "Total Creators", value: all.reduce((n, l) => n + l.count, 0), note: "Across all shortlists", icon: Users },
    { label: "Active Lists", value: all.length, note: `${all.filter((l) => l.favorite).length} favourite`, icon: FolderHeart, accent: true },
    { label: "Updated This Week", value: all.filter((l) => new Date(l.updatedAt).getTime() > weekAgo).length, note: "Changed in 7 days", icon: Pencil },
    { label: "Empty Lists", value: all.filter((l) => l.count === 0).length, note: "Ready for creators", icon: UserPlus },
  ];
  const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Try again.");

  async function onDelete(l: ListSummary) {
    const ok = await confirm({ title: `Delete "${l.name}"?`, body: "The shortlist and its notes are removed for your whole team. Creators stay in MUSHIN.", confirmLabel: "Delete shortlist", destructive: true });
    if (ok) remove.mutate(l.id, { onSuccess: () => toast.success(`Deleted ${l.name}`), onError: (e) => toast.error("Couldn't delete the shortlist", err(e)) });
  }

  return (
    <div className="flex flex-col pb-16">
      <div className="flex flex-col justify-between gap-4 py-2 lg:flex-row lg:items-center">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: EASE }}>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-on">Shortlists</h1>
            <span className="rounded-full bg-cyan-pale/50 px-2 py-0.5 text-[10px] font-semibold text-teal-deep">Roster Hub</span>
          </div>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">Organize and curate creators into targeted rosters before activating campaigns.</p>
        </motion.div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-faint" />
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a list..." aria-label="Find a list" className="w-64 rounded-xl bg-white py-2 pl-9 pr-3 text-[13px] text-on shadow-sm transition-all placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cyan-soft" />
          </div>
          <Button variant="outline" onClick={() => setImporting(true)}>Import creators</Button>
          <Button onClick={() => setCreating(true)} icon={Plus} className="bg-cyan-soft font-semibold text-[#001f26] hover:bg-cyan-dim">Create List</Button>
        </div>
      </div>

      {importing && <div className="mt-4"><ImportCreators onClose={() => setImporting(false)} /></div>}

      <ListFormModal
        key={creating ? "c" : "c0"}
        open={creating}
        title="Create a shortlist"
        submitLabel="Create list"
        busy={create.isPending}
        error={create.isError ? err(create.error) : null}
        onClose={() => { setCreating(false); create.reset(); }}
        onSubmit={(v) => create.mutate(v, { onSuccess: (l) => { setCreating(false); toast.success(`Created ${l.name}`); onOpen(l.id); } })}
      />
      <ListFormModal
        key={renaming?.id ?? "r0"}
        open={renaming !== null}
        initial={renaming ? { name: renaming.name, description: renaming.description } : undefined}
        title="Rename shortlist"
        submitLabel="Save changes"
        busy={update.isPending}
        error={update.isError ? err(update.error) : null}
        onClose={() => { setRenaming(null); update.reset(); }}
        onSubmit={(v) => renaming && update.mutate({ id: renaming.id, patch: v }, { onSuccess: () => { toast.success(`Saved ${v.name}`); setRenaming(null); } })}
      />

      <Stagger className="mb-8 mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((t) => (
          <StaggerItem key={t.label}>
            <Card hover className="flex h-full flex-col justify-between p-5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-soft">{t.label}</span>
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${t.accent ? "bg-cyan-pale/30 text-teal" : "bg-surface-low text-ink-soft"}`}><t.icon className="h-[18px] w-[18px]" /></span>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                {lists.isPending ? <Skeleton className="h-10 w-16" /> : <span className="text-[32px] font-bold leading-10 tabular-nums text-on"><CountUp value={t.value} /></span>}
                <span className="text-[10px] font-semibold tracking-wide text-ink-soft">{t.note}</span>
              </div>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>

      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="text-[15px] font-semibold text-on">Your Creator Rosters</span>
          <span className="text-[11px] font-semibold text-ink-soft">· {all.length} Total</span>
        </div>
        <button onClick={() => setSort((s) => (s === "updated" ? "name" : s === "name" ? "size" : "updated"))} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold text-on shadow-sm transition-colors hover:bg-surface-mid">
          <ArrowUpDown className="h-4 w-4" /> {sort === "updated" ? "Recently Updated" : sort === "name" ? "Name A–Z" : "Most creators"}
        </button>
      </div>

      {lists.isPending ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-60 rounded-2xl" />)}</div>
      ) : lists.isError ? (
        <ErrorState body={err(lists.error)} onRetry={() => void lists.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState icon={Bookmark} title="No shortlists yet" body="Create a shortlist, then save creators to it from Search or a creator's profile." action={<Button onClick={() => setCreating(true)} icon={Plus}>Create List</Button>} />
      ) : (
        <Stagger className="grid grid-cols-1 gap-5 md:grid-cols-2" gap={0.07}>
          {shown.length === 0 && <p className="col-span-full py-6 text-center text-sm text-ink-soft">No shortlist matches "{find}".</p>}
          {shown.map((l) => (
            <StaggerItem key={l.id}>
              <RosterCard l={l} onOpen={() => onOpen(l.id)} onRename={() => setRenaming(l)} onDelete={() => void onDelete(l)} />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mt-10 flex flex-col items-center justify-between gap-4 rounded-2xl bg-surface-low p-6 sm:flex-row">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-pale/40 text-teal"><Zap className="h-5 w-5" /></span>
          <div>
            <h4 className="text-[15px] font-semibold text-on">Need to assemble a multi-city campaign roster?</h4>
            <p className="text-xs text-ink-soft">Search Pakistan-based creators and add them to shortlists in one click.</p>
          </div>
        </div>
        <Button variant="outline" onClick={onGoToSearch} className="shrink-0">Open Search Discovery <ArrowRight className="h-4 w-4" /></Button>
      </motion.div>
    </div>
  );
}

function RosterCard({ l, onOpen, onRename, onDelete }: { l: ListSummary; onOpen: () => void; onRename: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  const update = useUpdateList();
  const toast = useToast();
  return (
    <div className="group relative flex h-full flex-col justify-between rounded-2xl bg-white p-6 shadow-sm transition-all duration-300 focus-within:ring-2 focus-within:ring-cyan hover:-translate-y-1 hover:shadow-lg">
      <div>
        <div className="flex items-center justify-between">
          <button onClick={onOpen} className="flex min-w-0 items-center gap-2 text-left text-lg font-bold tracking-tight text-on after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus:outline-none">
            <span className="truncate">{l.name}</span>
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ring-4 ring-cyan-pale/30 ${l.count > 0 ? "bg-cyan-soft" : "bg-line"}`} />
          </button>
          <span className="relative z-10 flex items-center gap-1">
            <button
              onClick={() => update.mutate({ id: l.id, patch: { favorite: !l.favorite } }, { onError: (e) => toast.error("Couldn't update the list", e instanceof Error ? e.message : undefined) })}
              aria-label={l.favorite ? "Remove from favourites" : "Mark as favourite"}
              aria-pressed={l.favorite}
              className="rounded-lg p-1.5 text-faint transition-colors hover:text-amber-500"
            >
              <motion.span key={String(l.favorite)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 12 }} className="block">
                <Star className={`h-4 w-4 ${l.favorite ? "fill-amber-400 text-amber-500" : ""}`} />
              </motion.span>
            </button>
            <span className="relative">
              <button onClick={() => setMenu((m) => !m)} aria-label={`More actions for ${l.name}`} aria-expanded={menu} className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-low text-on transition-colors hover:bg-surface-mid">
                <MoreHorizontal className="h-[18px] w-[18px]" />
              </button>
              <AnimatePresence>
                {menu && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
                    <motion.div role="menu" initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }} transition={{ duration: 0.15 }} style={{ transformOrigin: "top right" }} className="absolute right-0 top-10 z-30 flex w-48 flex-col gap-0.5 rounded-xl bg-white p-1 shadow-xl ring-1 ring-surface-top/60">
                      <button role="menuitem" onClick={() => { setMenu(false); onRename(); }} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-on hover:bg-surface-low"><Pencil className="h-4 w-4 text-ink-soft" /> Rename List</button>
                      <div className="mx-1 my-1 h-px bg-surface-mid" />
                      <button role="menuitem" onClick={() => { setMenu(false); onDelete(); }} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-danger hover:bg-danger-soft/40"><Trash2 className="h-4 w-4" /> Delete List</button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </span>
          </span>
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2.5em] text-xs text-ink-soft">{l.description || "No description"}</p>
      </div>
      <div className="flex items-center py-6">
        {l.preview.length === 0 ? (
          <span className="text-xs text-faint">No creators yet</span>
        ) : (
          <span className="flex items-center -space-x-2.5 p-0.5">
            {l.preview.map((p, i) => (
              <motion.img key={p.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.06 }} src={p.avatarUrl ?? initialsAvatar(p.displayName)} alt="" className="inline-block h-11 w-11 rounded-full bg-surface-mid object-cover shadow-sm ring-2 ring-white transition-transform group-hover:translate-x-0.5" />
            ))}
            {l.count > l.preview.length && <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-mid text-[13px] font-semibold tabular-nums text-on shadow-sm ring-2 ring-white">+{l.count - l.preview.length}</span>}
          </span>
        )}
      </div>
      <div className="-mx-6 -mb-6 flex items-center justify-between rounded-b-2xl bg-surface-low/60 px-6 py-4">
        <span className="flex items-center gap-2 text-[13px] font-medium text-ink-soft"><Users className="h-[18px] w-[18px]" /> {l.count} Creator{l.count === 1 ? "" : "s"}</span>
        <span className="text-xs text-ink-soft">Updated {relative(l.updatedAt)}</span>
      </div>
    </div>
  );
}
