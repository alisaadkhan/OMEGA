import { useState } from "react";
import { ArrowLeft, Download, FolderPlus, ListChecks, Pencil, Star, Trash2, Users } from "lucide-react";
import type { ListMember, ListSummary } from "@mushin/contracts";
import { useCreateList, useDeleteList, useList, useLists, useRemoveFromList, useSetListNote, useUpdateList } from "../../api/lists";
import { formatCount, initialsAvatar, toCreator } from "../../api/search-mapping";
import { relative } from "../../lib/time";
import { useConfirm, useToast } from "../../lib/toast";
import type { Creator } from "./CreatorProfilePanel";
import { EmptyState, ErrorState, LoadingBlock } from "./states";
import { AddToCampaignMenu } from "./AddToCampaignMenu";

/**
 * Lists and shortlists (canonical frontend spec page 09): workspace-private, every change saved on the server.
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
      className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
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

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-slate-900" style={{ fontSize: 26, fontWeight: 700 }}>Lists</h1>
          <p className="mt-1 text-sm text-slate-500">Shortlists of saved creators, private to your workspace.</p>
        </div>
        <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm text-white hover:bg-slate-800" style={{ fontWeight: 600 }}>
          <FolderPlus className="h-4 w-4" /> New list
        </button>
      </div>
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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lists.data.lists.map((l) => (
            // The list name is the card's button, stretched over the whole card; the favourite star sits above it, so no
            // control is nested inside another (WCAG nested-interactive).
            <div
              key={l.id}
              className="relative rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-indigo-400 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  onClick={() => onOpen(l.id)}
                  className="min-w-0 truncate text-left text-slate-900 after:absolute after:inset-0 after:rounded-xl after:content-[''] focus:outline-none"
                  style={{ fontSize: 15, fontWeight: 600 }}
                >
                  {l.name}
                </button>
                <span className="relative z-10"><FavoriteButton list={l} /></span>
              </div>
              <p className="mt-1 line-clamp-2 min-h-[2.5em] text-xs text-slate-500">{l.description || "No description"}</p>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="flex -space-x-2">
                    {l.preview.map((p) => (
                      <img key={p.id} src={p.avatarUrl ?? initialsAvatar(p.displayName)} alt="" className="h-6 w-6 rounded-full border-2 border-white object-cover" />
                    ))}
                  </span>
                  <Users className="h-3.5 w-3.5" /> {l.count} creator{l.count === 1 ? "" : "s"}
                </span>
                <span>Updated {relative(l.updatedAt)}</span>
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
        className="w-full rounded border border-indigo-300 px-1.5 py-0.5 text-xs focus:outline-none"
      />
    );
  }
  return (
    <button onClick={() => setDraft(member.note)} className="w-full truncate text-left text-xs text-slate-600 hover:text-slate-900" title="Edit note">
      {member.note || <span className="text-slate-500">Add note</span>}
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

  if (list.isPending) return <LoadingBlock lines={6} />;
  if (list.isError) return <ErrorState body={list.error instanceof Error ? list.error.message : undefined} onRetry={() => void list.refetch()} />;
  const l = list.data;
  const allSelected = l.members.length > 0 && selected.size === l.members.length;

  async function onDelete() {
    if (!(await confirm({ title: `Delete ${l.name}?`, body: "The list is removed for everyone in your workspace. The creators stay in MUSHIN.", confirmLabel: "Delete list", cancelLabel: "Keep", destructive: true }))) return;
    del.mutate(id, { onSuccess: () => { toast.success(`Deleted ${l.name}`); onBack(); }, onError: (err) => toast.error("Couldn't delete the list", err instanceof Error ? err.message : undefined) });
  }

  function onRemove(ids: string[]) {
    remove.mutate({ id, creatorIds: ids }, {
      onSuccess: (r) => { setSelected(new Set()); toast.info(`Removed ${r.removed} creator${r.removed === 1 ? "" : "s"} from ${l.name}`); },
      onError: (err) => toast.error("Couldn't remove creators", err instanceof Error ? err.message : undefined),
    });
  }

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" /> All lists</button>
      {editing ? (
        <ListForm
          initial={{ name: l.name, description: l.description }}
          submitLabel="Save changes"
          busy={update.isPending}
          onCancel={() => setEditing(false)}
          onSubmit={(v) => update.mutate({ id, patch: v }, { onSuccess: () => setEditing(false), onError: (err) => toast.error("Couldn't rename the list", err instanceof Error ? err.message : undefined) })}
        />
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-slate-900" style={{ fontSize: 24, fontWeight: 700 }}>{l.name}</h1>
              <FavoriteButton list={l} />
            </div>
            <p className="mt-1 text-sm text-slate-500">{l.description || "No description"} · {l.count} creator{l.count === 1 ? "" : "s"} · updated {relative(l.updatedAt)}</p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Rename</button>
            <button disabled title="CSV export is not available yet" className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500"><Download className="h-3.5 w-3.5" /> Export (not available yet)</button>
            <button onClick={() => void onDelete()} className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs text-red-700 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
          </div>
        </div>
      )}

      {l.members.length === 0 ? (
        <EmptyState icon={<Users className="h-5 w-5" />} title="No creators on this list yet" body="Open a creator from Search and use Save to add them here." action={<button onClick={onGoToSearch} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white" style={{ fontWeight: 600 }}>Search creators</button>} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {selected.size > 0 && (
            <div className="flex items-center justify-between border-b border-slate-200 bg-indigo-50/60 px-4 py-2 text-xs text-indigo-900">
              <span>{selected.size} selected</span>
              <span className="flex items-center gap-1.5">
                <AddToCampaignMenu creatorIds={[...selected]} label={`Add ${selected.size} to a campaign`} />
                <button onClick={() => onRemove([...selected])} disabled={remove.isPending} className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-red-700 hover:bg-red-50 disabled:opacity-50">Remove from list</button>
              </span>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(l.members.map((m) => m.creator.id)))} /></th>
                  <th className="px-3 py-2">Creator</th>
                  <th className="px-3 py-2">Platform</th>
                  <th className="px-3 py-2 text-right">Followers</th>
                  <th className="px-3 py-2 text-right">Engagement</th>
                  <th className="px-3 py-2">Audience signals</th>
                  <th className="px-3 py-2">City</th>
                  <th className="w-56 px-3 py-2">Note</th>
                  <th className="px-3 py-2">Added</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {l.members.map((m) => {
                  const c = toCreator(m.creator);
                  const checked = selected.has(m.creator.id);
                  return (
                    <tr key={m.creator.id} className={checked ? "bg-indigo-50/40" : "hover:bg-slate-50/60"}>
                      <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${m.creator.displayName}`} checked={checked} onChange={() => setSelected((s) => { const n = new Set(s); if (checked) n.delete(m.creator.id); else n.add(m.creator.id); return n; })} /></td>
                      <td className="px-3 py-2">
                        <button onClick={() => onOpenCreator(c)} className="flex items-center gap-2 text-left">
                          <img src={c.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
                          <span><span className="block text-slate-900" style={{ fontWeight: 600 }}>{m.creator.displayName}</span><span className="text-slate-500">@{m.creator.handle}</span></span>
                        </button>
                      </td>
                      <td className="px-3 py-2 capitalize text-slate-600">{m.creator.platform}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatCount(m.creator.followers)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{m.creator.engagementRate === null ? "Unknown" : `${m.creator.engagementRate.toFixed(1)}%`}</td>
                      <td className="px-3 py-2 text-slate-600">{m.creator.authenticityScore === null ? "Not assessed" : `${m.creator.authenticityScore}/100`}</td>
                      <td className="px-3 py-2 text-slate-600">{m.creator.city ?? "Unknown"}</td>
                      <td className="px-3 py-2"><NoteCell listId={id} member={m} /></td>
                      <td className="px-3 py-2 text-slate-500">{relative(m.addedAt)}</td>
                      <td className="px-3 py-2 text-right"><button onClick={() => onRemove([m.creator.id])} disabled={remove.isPending} className="text-slate-500 hover:text-red-600" aria-label={`Remove ${m.creator.displayName}`}><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
