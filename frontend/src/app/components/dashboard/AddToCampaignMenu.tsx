import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useAddToCampaign, useCampaigns } from "../../api/campaigns";
import { useToast } from "../../lib/toast";
import { Spinner } from "./states";

/**
 * "Add to campaign" for one creator (shows which campaigns already include it) or a selection. Adding only: removing a
 * creator deletes their pipeline data, so that happens inside the campaign with a confirmation.
 */
/** `blockedReason`: the creator(s) may not be added (creator eligibility); shown disabled with the reason. */
export function AddToCampaignMenu({ creatorIds, label = "Add to campaign", onGoToCampaigns, blockedReason = null }: { creatorIds: string[]; label?: string; onGoToCampaigns?: () => void; blockedReason?: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const single = creatorIds.length === 1 ? (creatorIds[0] ?? null) : null;
  const campaigns = useCampaigns(single, open);
  const add = useAddToCampaign();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const addTo = (id: string, name: string) =>
    add.mutate({ id, creatorIds }, {
      onSuccess: (r) => toast.success(r.added > 0 ? `Added to ${name}` : `Already in ${name}`, r.added > 0 && r.alreadyInCampaign > 0 ? `${r.alreadyInCampaign} were already in it.` : undefined),
      onError: (err) => toast.error("Couldn't add to the campaign", err instanceof Error ? err.message : undefined),
    });

  if (blockedReason) {
    return (
      <button disabled title={blockedReason} aria-label={`${label}: ${blockedReason}`} className="inline-flex cursor-not-allowed items-center gap-1 rounded-md bg-slate-200 px-2.5 py-1 text-xs text-slate-500" style={{ fontWeight: 500 }}>
        <Plus className="h-3 w-3" strokeWidth={2} /> {label}
      </button>
    );
  }
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs text-white transition-colors hover:bg-slate-800" style={{ fontWeight: 500 }}>
        <Plus className="h-3 w-3" strokeWidth={2} /> {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg" role="dialog" aria-label="Add to campaign">
          <div className="px-1.5 pb-1.5 text-[11px] text-slate-500">{single ? "Add to a campaign in this workspace" : `Add ${creatorIds.length} creators to a campaign`}</div>
          {campaigns.isPending ? (
            <div className="flex justify-center py-3"><Spinner /></div>
          ) : campaigns.isError ? (
            <div className="px-1.5 py-2 text-xs text-red-700">Couldn't load campaigns. <button className="underline" onClick={() => void campaigns.refetch()}>Retry</button></div>
          ) : campaigns.data.campaigns.length === 0 ? (
            <div className="px-1.5 py-2 text-xs text-slate-500">
              No campaigns yet.{" "}
              {onGoToCampaigns && <button className="text-indigo-600 underline" onClick={onGoToCampaigns}>Create one</button>}
            </div>
          ) : (
            <ul className="max-h-56 overflow-y-auto">
              {campaigns.data.campaigns.map((c) => {
                const inIt = c.containsCreator === true;
                return (
                  <li key={c.id}>
                    <button disabled={add.isPending || inIt} onClick={() => addTo(c.id, c.name)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-default disabled:opacity-70">
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {inIt ? <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700"><Check className="h-3 w-3" /> In campaign</span> : <span className="text-[10px] text-slate-500">{c.creatorCount}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
