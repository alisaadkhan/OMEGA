import { useState } from "react";
import { blockedReasonFor, ineligibleText } from "../../lib/eligibility";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, FolderPlus, ListChecks, Megaphone, MoreHorizontal, Pencil, Plus, Search, Star, Trash2, UserMinus, Users, X } from "lucide-react";
import type { ListMember, ListSummary } from "@mushin/contracts";
import { useCreateList, useDeleteList, useList, useLists, useRemoveFromList, useSetListNote, useUpdateList } from "../../api/lists";
import { ImportCreators } from "./ImportCreators";
import { avatarFallback, formatCount, initialsAvatar, toCreator } from "../../api/search-mapping";
import { relative } from "../../lib/time";
import { useConfirm, useToast } from "../../lib/toast";
import type { Creator } from "./CreatorProfilePanel";
import { EmptyState, ErrorState, LoadingBlock } from "./states";
import { CampaignDrawer } from "./CampaignDrawer";
import type { DrawerCreator } from "./ShortlistDrawer";

/**
 * Shortlists (canonical frontend spec page 09): private to the account's team, every change saved on the server.
 * Creators are saved from Search or a creator profile ("Save"); a creator hidden since being saved drops out.
 */
export function Lists({ onOpenCreator, onGoToSearch }: { onOpenCreator: (c: Creator) => void; onGoToSearch: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return openId ? <ListDetail id={openId} onBack={() => setOpenId(null)} onOpenCreator={onOpenCreator} onGoToSearch={onGoToSearch} /> : <ListIndex onOpen={setOpenId} onGoToSearch={onGoToSearch} />;
}

function ListForm({ initial, submitLabel, busy, onSubmit, onCancel }: { initial?: { name: string; description: string }; submitLabel: string; busy: boolean; onSubmit: (v: { name: string; description: string }) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  return (
    <form
      className="space-y-2 rounded-2xl border border-slate-200/80 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit({ name: name.trim(), description: description.trim() });
      }}
    >
      <label className="block text-xs text-slate-600" style={{ fontWeight: 600 }}>
        Name
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      </label>
      <label className="block text-xs text-slate-600" style={{ fontWeight: 600 }}>
        Description <span className="text-slate-500" style={{ fontWeight: 400 }}>(optional)</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100">Cancel</button>
        <button type="submit" disabled={busy || !name.trim()} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50" style={{ fontWeight: 600 }}>{submitLabel}</button>
      </div>
    </form>
  );
}

function FavoriteButton({ list }: { list: ListSummary }) {
  const update = useUpdateList();
  const toast = useToast();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        update.mutate({ id: list.id, patch: { favorite: !list.favorite } }, { onError: (err) => toast.error("Couldn't update the list", err instanceof Error ? err.message : undefined) });
      }}
      disabled={update.isPending}
      aria-label={list.favorite ? "Remove from favourites" : "Mark as favourite"}
      aria-pressed={list.favorite}
      className="rounded p-1 text-slate-500 hover:text-amber-500"
    >
      <Star className={`h-4 w-4 ${list.favorite ? "fill-amber-400 text-amber-500" : ""}`} />
    </button>
  );
}

function ListIndex({ onOpen, onGoToSearch }: { onOpen: (id: string) => void; onGoToSearch: () => void }) {
  const lists = useLists();
  const create = useCreateList();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [find, setFind] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ListSummary | null>(null);
  const update = useUpdateList();
  const remove = useDeleteList();
  const confirm = useConfirm();
  const all = lists.data?.lists ?? [];
  const shown = all.filter((l) => `${l.name} ${l.description}`.toLowerCase().includes(find.trim().toLowerCase()));
  const weekAgo = Date.now() - 7 * 86_400_000;
  const stats = [
    { label: "Saved creators", value: all.reduce((n, l) => n + l.count, 0), note: "Across all shortlists", icon: Users },
    { label: "Shortlists", value: all.length, note: `${all.filter((l) => l.favorite).length} favourite`, icon: ListChecks },
    { label: "Updated this week", value: all.filter((l) => new Date(l.updatedAt).getTime() > weekAgo).length, note: "Shortlists changed in 7 days", icon: Pencil },
    { label: "Empty shortlists", value: all.filter((l) => l.count === 0).length, note: "Ready for creators", icon: FolderPlus },
  ];
  async function onDelete(l: ListSummary) {
    setMenuId(null);
    const ok = await confirm({ title: `Delete "${l.name}"?`, body: "The shortlist and its notes are removed. Creators stay in MUSHIN.", confirmLabel: "Delete shortlist", destructive: true });
    if (!ok) return;
    remove.mutate(l.id, { onSuccess: () => toast.success(`Deleted ${l.name}`), onError: (err) => toast.error("Couldn't delete the shortlist", err instanceof Error ? err.message : undefined) });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Shortlists</h1>
            <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-800">Roster hub</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">Organise creators into shortlists before adding them to campaigns. Private to your team.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a shortlist…" aria-label="Find a shortlist" className="h-10 w-56 rounded-xl bg-white pl-9 pr-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-300" />
          </div>
          <button onClick={() => setImporting(true)} className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl bg-white px-4 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">Import creators</button>
          <button onClick={() => setCreating(true)} className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#57dffe] px-4 text-sm font-semibold text-[#001f26] shadow-sm transition-all hover:bg-[#4cd7f6] focus:outline-none focus:ring-2 focus:ring-cyan-400/60 active:scale-95">
            <Plus className="h-4 w-4" /> Create List
          </button>
        </div>
      </div>
      {importing && <ImportCreators onClose={() => setImporting(false)} />}
      {creating && (
        <ListForm
          submitLabel="Create list"
          busy={create.isPending}
          onCancel={() => setCreating(false)}
          onSubmit={(v) =>
            create.mutate(v, {
              onSuccess: (l) => {
                setCreating(false);
                toast.success(`Created ${l.name}`);
              },
              onError: (err) => toast.error("Couldn't create the list", err instanceof Error ? err.message : undefined),
            })
          }
        />
      )}
      {renaming && (
        <ListForm
          initial={{ name: renaming.name, description: renaming.description }}
          submitLabel="Save"
          busy={update.isPending}
          onCancel={() => setRenaming(null)}
          onSubmit={(v) =>
            update.mutate({ id: renaming.id, patch: v }, {
              onSuccess: () => {
                toast.success(`Renamed to ${v.name}`);
                setRenaming(null);
              },
              onError: (err) => toast.error("Couldn't rename the shortlist", err instanceof Error ? err.message : undefined),
            })
          }
        />
      )}
      {all.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((t) => (
            <div key={t.label} className="rounded-2xl bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t.label}</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500"><t.icon aria-hidden className="h-4 w-4" /></span>
              </div>
              <div className="mt-3 text-[32px] font-bold leading-10 tabular-nums text-slate-900">{t.value}</div>
              <div className="text-xs text-slate-500">{t.note}</div>
            </div>
          ))}
        </div>
      )}
      {lists.isPending ? (
        <LoadingBlock lines={4} />
      ) : lists.isError ? (
        <ErrorState body={lists.error instanceof Error ? lists.error.message : undefined} onRetry={() => void lists.refetch()} />
      ) : lists.data.lists.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-5 w-5" />}
          title="No lists yet"
          body="Create a list, then save creators to it from Search or a creator's profile."
          action={<button onClick={onGoToSearch} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white" style={{ fontWeight: 600 }}>Search creators</button>}
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {shown.length === 0 && <p className="col-span-full py-6 text-center text-sm text-slate-500">No shortlist matches "{find}".</p>}
          {shown.map((l) => (
            // The list name is the card's button, stretched over the whole card; the favourite star sits above it, so no
            // control is nested inside another (WCAG nested-interactive).
            <div
              key={l.id}
              // MUSHIN design (2026-10-27): name, description, the first members' photos, then a figures bar.
              className="relative rounded-2xl bg-white p-6 text-left shadow-sm transition-all duration-200 focus-within:ring-2 focus-within:ring-cyan-400 hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  onClick={() => onOpen(l.id)}
                  className="flex min-w-0 items-center gap-2 text-left text-[20px] font-semibold tracking-[-0.02em] text-slate-900 after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus:outline-none"
                >
                  <span aria-hidden className="h-2 w-2 flex-shrink-0 rounded-full bg-[#57dffe] ring-4 ring-cyan-50" />
                  <span className="truncate">{l.name}</span>
                </button>
                <span className="relative z-10 flex items-center gap-1">
                  <FavoriteButton list={l} />
                  <span className="relative">
                    <button onClick={() => setMenuId(menuId === l.id ? null : l.id)} aria-label={`More actions for ${l.name}`} aria-expanded={menuId === l.id} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {menuId === l.id && (
                      <div role="menu" className="absolute right-0 top-10 z-30 flex w-44 flex-col gap-0.5 rounded-xl bg-white p-1 shadow-xl ring-1 ring-slate-200/70 animate-in fade-in slide-in-from-top-2 duration-150">
                        <button role="menuitem" onClick={() => { setMenuId(null); setRenaming(l); }} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-slate-800 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none">
                          <Pencil className="h-4 w-4 text-slate-500" /> Rename
                        </button>
                        <div className="mx-1 my-1 h-px bg-slate-100" />
                        <button role="menuitem" onClick={() => void onDelete(l)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-rose-600 hover:bg-rose-50 focus:bg-rose-50 focus:outline-none">
                          <Trash2 className="h-4 w-4" /> Delete
                        </button>
                      </div>
                    )}
                  </span>
                </span>
              </div>
              <p className="mt-2 line-clamp-2 min-h-[2.5em] text-sm text-slate-600">{l.description || "No description"}</p>
              <div className="mt-5 flex h-12 items-center">
                {l.preview.length === 0 ? (
                  <span className="text-xs text-slate-500">No creators yet</span>
                ) : (
                  <span className="flex -space-x-3">
                    {l.preview.map((p) => (
                      <img key={p.id} src={p.avatarUrl ?? initialsAvatar(p.displayName)} alt="" className="h-12 w-12 rounded-full border-[3px] border-white object-cover" />
                    ))}
                    {l.count > l.preview.length && (
                      <span className="flex h-12 w-12 items-center justify-center rounded-full border-[3px] border-white bg-slate-100 text-xs font-semibold text-slate-700">
                        +{l.count - l.preview.length}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="mt-5 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">Creators</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold tabular-nums text-slate-900">
                    <Users aria-hidden className="h-4 w-4 text-slate-500" /> {l.count} creator{l.count === 1 ? "" : "s"}
                  </div>
                </div>
                <span className="text-xs text-slate-600">Updated {relative(l.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NoteCell({ listId, member }: { listId: string; member: ListMember }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = useSetListNote();
  const toast = useToast();
  const commit = () => {
    if (draft === null || draft.trim() === member.note) return setDraft(null);
    save.mutate({ id: listId, creatorId: member.creator.id, note: draft.trim() }, {
      onSuccess: () => setDraft(null),
      onError: (err) => toast.error("Couldn't save the note", err instanceof Error ? err.message : undefined),
    });
  };
  if (draft !== null) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={1000}
        disabled={save.isPending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => (e.key === "Enter" ? commit() : e.key === "Escape" && setDraft(null))}
        aria-label={`Note for ${member.creator.displayName}`}
        className="w-full rounded-lg border border-cyan-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-200"
      />
    );
  }
  return (
    <button onClick={() => setDraft(member.note)} className="w-full truncate text-left text-xs text-slate-600 hover:text-slate-900" title="Edit note">
      {member.note || <span className="text-slate-500">+ Add note…</span>}
    </button>
  );
}

function ListDetail({ id, onBack, onOpenCreator, onGoToSearch }: { id: string; onBack: () => void; onOpenCreator: (c: Creator) => void; onGoToSearch: () => void }) {
  const list = useList(id);
  const update = useUpdateList();
  const del = useDeleteList();
  const remove = useRemoveFromList();
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [campaignFor, setCampaignFor] = useState<DrawerCreator[] | null>(null);

  if (list.isPending) return <LoadingBlock lines={6} />;
  if (list.isError) return <ErrorState body={list.error instanceof Error ? list.error.message : undefined} onRetry={() => void list.refetch()} />;
  const l = list.data;
  const members = l.members.filter((m) => `${m.creator.displayName} ${m.creator.handle} ${m.creator.city ?? ""} ${m.note}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const allSelected = members.length > 0 && members.every((m) => selected.has(m.creator.id));
  const chosen = l.members.filter((m) => selected.has(m.creator.id));
  const blocked = blockedReasonFor(chosen.map((m) => m.creator.eligibility));
  const ers = l.members.map((m) => m.creator.engagementRate).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const medianEr = ers.length === 0 ? null : ers.length % 2 ? (ers[(ers.length - 1) / 2] as number) : ((ers[ers.length / 2 - 1] as number) + (ers[ers.length / 2] as number)) / 2;
  const auths = l.members.map((m) => m.creator.authenticityScore).filter((x): x is number => x !== null);
  const reach = l.members.reduce((n, m) => n + (m.creator.followers ?? 0), 0);
  const figures = [
    { label: "Combined reach", value: formatCount(reach), note: "Followers across members" },
    { label: "Median engagement", value: medianEr === null ? "—" : `${medianEr.toFixed(1)}%`, note: `${ers.length} of ${l.members.length} with a figure` },
    { label: "Authenticity", value: auths.length === 0 ? "—" : `${Math.round(auths.reduce((a, b) => a + b, 0) / auths.length)}`, note: auths.length === 0 ? "Not assessed yet" : `Average of ${auths.length} assessed` },
    { label: "Creators", value: String(l.count), note: `Updated ${relative(l.updatedAt)}` },
  ];

  async function onDelete() {
    if (!(await confirm({ title: `Delete ${l.name}?`, body: "The shortlist is removed for everyone on your team. The creators stay in MUSHIN.", confirmLabel: "Delete shortlist", cancelLabel: "Keep", destructive: true }))) return;
    del.mutate(id, { onSuccess: () => { toast.success(`Deleted ${l.name}`); onBack(); }, onError: (err) => toast.error("Couldn't delete the shortlist", err instanceof Error ? err.message : undefined) });
  }

  function onRemove(ids: string[]) {
    remove.mutate({ id, creatorIds: ids }, {
      onSuccess: (r) => { setSelected(new Set()); toast.success(`Removed ${r.removed} creator${r.removed === 1 ? "" : "s"} from ${l.name}`); },
      onError: (err) => toast.error("Couldn't remove creators", err instanceof Error ? err.message : undefined),
    });
  }

  return (
    <div className="space-y-6 pb-24">
      <nav className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500" aria-label="Breadcrumb">
        <button onClick={onBack} className="inline-flex items-center gap-1 rounded transition-colors hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"><ArrowLeft className="h-3.5 w-3.5" /> Back to Shortlists</button>
        <span className="text-slate-300">/</span>
        <span className="truncate text-slate-900">{l.name}</span>
      </nav>
      {editing ? (
        <ListForm
          initial={{ name: l.name, description: l.description }}
          submitLabel="Save changes"
          busy={update.isPending}
          onCancel={() => setEditing(false)}
          onSubmit={(v) => update.mutate({ id, patch: v }, { onSuccess: () => { setEditing(false); toast.success("Shortlist updated"); }, onError: (err) => toast.error("Couldn't rename the shortlist", err instanceof Error ? err.message : undefined) })}
        />
      ) : (
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 shadow-sm"><ListChecks className="h-5 w-5" /></span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[28px] font-bold leading-9 tracking-tight text-slate-900">{l.name}</h1>
                <FavoriteButton list={l} />
              </div>
              <p className="mt-0.5 text-sm text-slate-500">{l.description || "No description"} · <span className="font-semibold text-slate-900">{l.count}</span> creator{l.count === 1 ? "" : "s"} · updated {relative(l.updatedAt)}</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"><Pencil className="h-3.5 w-3.5" /> Rename</button>
            <button onClick={() => void onDelete()} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-medium text-rose-600 shadow-sm transition-colors hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-300"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
          </div>
        </div>
      )}

      {l.members.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {figures.map((t) => (
            <div key={t.label} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{t.value}</div>
              <div className="text-[11px] text-slate-500">{t.note}</div>
            </div>
          ))}
        </div>
      )}

      {l.members.length === 0 ? (
        <EmptyState icon={<Users className="h-5 w-5" />} title="No creators on this shortlist yet" body="Open a creator from Search and use Save to Shortlist to add them here." action={<button onClick={onGoToSearch} className="rounded-xl bg-[#0A0F24] px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/50">Search creators</button>} />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-2.5">
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this shortlist…" aria-label="Filter this shortlist" className="w-56 rounded-lg bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-300" />
            </div>
            <span className="text-[11px] text-slate-500">Showing <span className="font-semibold text-slate-900">{members.length}</span> of {l.members.length}</span>
          </div>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Shortlist members">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/70 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="w-10 px-4 py-2.5 text-center"><input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(members.map((m) => m.creator.id)))} className="h-4 w-4 accent-[#0A0F24]" /></th>
                  <th className="px-3 py-2.5">Creator</th>
                  <th className="px-3 py-2.5">Platform</th>
                  <th className="px-3 py-2.5 text-right">Followers</th>
                  <th className="px-3 py-2.5 text-right">Avg. ER</th>
                  <th className="px-3 py-2.5">Authenticity</th>
                  <th className="w-56 px-3 py-2.5">Note</th>
                  <th className="px-3 py-2.5">Added</th>
                  <th className="px-3 py-2.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const c = toCreator(m.creator);
                  const checked = selected.has(m.creator.id);
                  return (
                    <tr key={m.creator.id} className={`transition-colors ${checked ? "bg-cyan-50/60 hover:bg-cyan-50" : "hover:bg-slate-50"}`}>
                      <td className="px-4 py-2.5 text-center"><input type="checkbox" aria-label={`Select ${m.creator.displayName}`} checked={checked} onChange={() => setSelected((s) => { const n = new Set(s); if (checked) n.delete(m.creator.id); else n.add(m.creator.id); return n; })} className="h-4 w-4 accent-[#0A0F24]" /></td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => onOpenCreator(c)} className="flex items-center gap-2.5 rounded text-left focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                          <img src={c.avatar} alt="" onError={avatarFallback(m.creator.displayName)} className="h-9 w-9 rounded-full object-cover shadow-sm" />
                          <span>
                            <span className="block text-[13px] font-semibold text-slate-900">{m.creator.displayName}</span>
                            <span className="text-[11px] text-slate-500">@{m.creator.handle}{m.creator.city ? ` · ${m.creator.city}` : ""}</span>
                            {!m.creator.eligibility.eligible && (
                              <span className="mt-0.5 block text-[11px] text-amber-800" data-testid="member-ineligible">{ineligibleText(m.creator.eligibility)} · kept on this shortlist</span>
                            )}
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-2.5"><span className="rounded bg-slate-50 px-2 py-0.5 text-[11px] font-medium capitalize text-slate-700 shadow-sm">{m.creator.platform}</span></td>
                      <td className="px-3 py-2.5 text-right text-[13px] font-semibold tabular-nums text-slate-900">{formatCount(m.creator.followers)}</td>
                      <td className="px-3 py-2.5 text-right">{m.creator.engagementRate === null ? <span className="text-slate-500">—</span> : <span className="rounded bg-cyan-50 px-1.5 py-0.5 font-semibold tabular-nums text-cyan-800">{m.creator.engagementRate.toFixed(1)}%</span>}</td>
                      <td className="px-3 py-2.5 text-slate-600">{m.creator.authenticityScore === null ? "Not assessed" : `${m.creator.authenticityScore}/100`}</td>
                      <td className="px-3 py-2.5"><NoteCell listId={id} member={m} /></td>
                      <td className="px-3 py-2.5 text-slate-500">{relative(m.addedAt)}</td>
                      <td className="px-3 py-2.5 text-center"><button onClick={() => onRemove([m.creator.id])} disabled={remove.isPending} title="Remove from shortlist" className="rounded p-1 text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:opacity-50" aria-label={`Remove ${m.creator.displayName}`}><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} transition={{ duration: 0.22, ease: "easeOut" }} role="region" aria-label="Selected creators" className="fixed bottom-6 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-4 rounded-2xl bg-[#131b2e]/95 px-5 py-2.5 text-white shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-2.5">
              <span className="flex -space-x-2">
                {chosen.slice(0, 3).map((m) => <img key={m.creator.id} src={toCreator(m.creator).avatar} alt="" onError={avatarFallback(m.creator.displayName)} className="h-7 w-7 rounded-full object-cover ring-2 ring-[#131b2e]" />)}
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-semibold tabular-nums">{selected.size} selected</span>
                <span className="text-[10px] text-slate-400">Batch actions</span>
              </span>
            </div>
            <span className="h-6 w-px bg-white/15" />
            <button onClick={() => setCampaignFor(chosen.map((m) => ({ id: m.creator.id, name: m.creator.displayName, handle: m.creator.handle, avatar: toCreator(m.creator).avatar, city: m.creator.city })))} disabled={blocked !== null} title={blocked ?? undefined} className="inline-flex items-center gap-1.5 rounded-lg bg-[#57dffe] px-3 py-1.5 text-[13px] font-semibold text-[#001f26] shadow-md transition-colors hover:bg-[#acedff] focus:outline-none focus:ring-2 focus:ring-cyan-300 disabled:opacity-50">
              <Megaphone className="h-4 w-4" /> Add to Campaign
            </button>
            <button onClick={() => onRemove([...selected])} disabled={remove.isPending} className="inline-flex items-center gap-1 rounded-lg bg-rose-500/20 px-2.5 py-1.5 text-[13px] font-medium text-rose-200 transition-colors hover:bg-rose-500/30 focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:opacity-50">
              <UserMinus className="h-4 w-4" /> Remove
            </button>
            <button onClick={() => setSelected(new Set())} aria-label="Clear selection" className="rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/50"><X className="h-4 w-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>
      <CampaignDrawer open={campaignFor !== null} creators={campaignFor ?? []} onClose={() => { setCampaignFor(null); setSelected(new Set()); }} />
    </div>
  );
}
