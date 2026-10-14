import { useEffect, useRef, useState } from "react";
import { Bookmark, Check, Plus } from "lucide-react";
import { useAddToList, useCreateList, useLists, useRemoveFromList } from "../../api/lists";
import { useToast } from "../../lib/toast";
import { Spinner } from "./states";

/**
 * "Save" creators to workspace lists. One creator: tick the lists it should be on (each tick is a server write).
 * Several creators (a search selection): pick a list to add them all to. `variant="icon"` loads lists only when opened,
 * so a page of result cards makes no requests until one is used.
 */
export function SaveToListMenu({ creatorIds, variant = "button", label = "Save" }: { creatorIds: string[]; variant?: "button" | "icon"; label?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const single = creatorIds.length === 1 ? (creatorIds[0] ?? null) : null;
  const lists = useLists(single, variant === "button" || open);
  const add = useAddToList();
  const remove = useRemoveFromList();
  const create = useCreateList();
  const toast = useToast();
  const busy = add.isPending || remove.isPending || create.isPending;
  const saved = single ? (lists.data?.lists ?? []).filter((l) => l.containsCreator).length : 0;
  const who = creatorIds.length === 1 ? "" : `${creatorIds.length} creators `;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const fail = (what: string) => (err: unknown) => toast.error(what, err instanceof Error ? err.message : undefined);
  const addTo = (id: string, listName: string) =>
    add.mutate(
      { id, creatorIds },
      {
        onSuccess: (r) => toast.success(r.added > 0 ? `Saved ${who}to ${listName}` : `Already on ${listName}`, r.alreadyOnList > 0 && r.added > 0 ? `${r.alreadyOnList} were already on it.` : undefined),
        onError: fail("Couldn't save to the list"),
      },
    );

  function pick(id: string, on: boolean, listName: string) {
    if (single && on) remove.mutate({ id, creatorIds: [single] }, { onSuccess: () => toast.info(`Removed from ${listName}`), onError: fail("Couldn't remove from the list") });
    else addTo(id, listName);
  }

  function createAndAdd() {
    const n = name.trim();
    if (!n) return;
    create.mutate({ name: n }, { onSuccess: (l) => { setName(""); addTo(l.id, l.name); }, onError: fail("Couldn't create the list") });
  }

  return (
    <div className="relative" ref={ref}>
      {variant === "icon" ? (
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title="Save to a list"
          aria-label="Save to a list"
          className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 transition-colors hover:bg-slate-50"
        >
          <Bookmark className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-50"
          style={{ fontWeight: 500 }}
        >
          <Bookmark className={`h-3 w-3 ${saved > 0 ? "fill-indigo-600 text-indigo-600" : ""}`} strokeWidth={2} /> {saved > 0 ? `Saved (${saved})` : label}
        </button>
      )}
      {open && (
        <div className="absolute bottom-auto right-0 top-full z-50 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg" role="dialog" aria-label="Save to lists">
          <div className="px-1.5 pb-1.5 text-[11px] text-slate-500">{single ? "Save to lists in this workspace" : `Add ${creatorIds.length} creators to a list`}</div>
          {lists.isPending ? (
            <div className="flex justify-center py-3"><Spinner /></div>
          ) : lists.isError ? (
            <div className="px-1.5 py-2 text-xs text-red-700">Couldn't load your lists. <button className="underline" onClick={() => void lists.refetch()}>Retry</button></div>
          ) : (
            <ul className="max-h-56 overflow-y-auto">
              {lists.data.lists.length === 0 && <li className="px-1.5 py-2 text-xs text-slate-500">No lists yet. Create the first one below.</li>}
              {lists.data.lists.map((l) => {
                const on = single !== null && l.containsCreator === true;
                return (
                  <li key={l.id}>
                    <button
                      disabled={busy}
                      onClick={() => pick(l.id, on, l.name)}
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      role={single ? "menuitemcheckbox" : "menuitem"}
                      aria-checked={single ? on : undefined}
                    >
                      {single && (
                        <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300"}`}>
                          {on && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">{l.name}</span>
                      <span className="text-[10px] text-slate-400">{l.count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <form
            className="mt-1.5 flex gap-1 border-t border-slate-100 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              createAndAdd();
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="New list name"
              aria-label="New list name"
              className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none"
            />
            <button type="submit" disabled={busy || !name.trim()} className="inline-flex items-center gap-0.5 rounded-md bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50">
              <Plus className="h-3 w-3" /> Add
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
