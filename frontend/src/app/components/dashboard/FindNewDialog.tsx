import { useState } from "react";
import type { LiveRunSize, LiveSearch } from "@mushin/contracts";
import { useBillingPlans, useBillingSummary } from "../../api/billing";
import { useStartJob } from "../../api/discovery";
import { liveMaxCost, liveSummary } from "../../api/discovery-mapping";
import { useToast } from "../../lib/toast";

const SIZES: LiveRunSize[] = [5, 10, 20];

/** SRS §4.2.2, REQ-02.06: Find New Creators shows its maximum cost and starts only on confirmation. */
export function FindNewDialog({ open, onOpenChange, search, onStarted }: { open: boolean; onOpenChange: (o: boolean) => void; search: LiveSearch; onStarted: (jobId: string) => void }) {
  const [size, setSize] = useState<LiveRunSize>(10);
  const billing = useBillingSummary();
  const plans = useBillingPlans();
  const start = useStartJob();
  const toast = useToast();
  if (!open) return null;
  const costs = plans.data?.actionCosts;
  const platform = search.filters.platform;
  const max = costs ? liveMaxCost(costs, platform, size) : null;
  const perCreator = platform === "instagram" || platform === "youtube" ? "10 each" : "10 each for Instagram/YouTube, 30 for TikTok";
  const available = billing.data?.balance.available ?? 0;

  function confirm() {
    if (max === null) return;
    start.mutate(
      { kind: "live", search, maxNew: size, confirmedCost: max },
      {
        onSuccess: (r) => {
          if (r.status === "started") onStarted(r.job.id);
          toast.info("Finding new creators…", "Results appear here as they are found. Follow progress from the Jobs button.");
          onOpenChange(false);
        },
        onError: (err) => toast.error("Couldn't start Find New Creators", err instanceof Error ? err.message : undefined),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-4" onClick={() => onOpenChange(false)}>
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-slate-900" style={{ fontSize: 15, fontWeight: 600 }}>Find new creators</div>
        <p className="mt-1 text-xs text-slate-500">MUSHIN searches Google for “{liveSummary(search)}”, fetches the profiles it doesn’t know yet and assesses them. Creators MUSHIN already knows are free.</p>
        <div className="mt-4 text-xs text-slate-700" style={{ fontWeight: 600 }}>How many new creators?</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {SIZES.map((s) => (
            <button key={s} onClick={() => setSize(s)} className={`rounded-md border px-3 py-2 text-xs ${size === s ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} style={{ fontWeight: 600 }}>
              Up to {s}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-1 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-600">
          <div className="flex justify-between"><span>Search</span><span>{costs?.find_new ?? "—"} credits</span></div>
          <div className="flex justify-between"><span>Up to {size} new creators ({perCreator})</span><span>up to {max === null || !costs ? "—" : max - costs.find_new} credits</span></div>
          <div className="flex justify-between"><span>Creators MUSHIN already knows</span><span>free</span></div>
          <div className="flex justify-between border-t border-slate-200 pt-1 text-slate-900" style={{ fontWeight: 600 }}><span>At most</span><span>{max ?? "—"} credits</span></div>
          <p className="pt-1 text-[11px] text-slate-500">You’re charged only for creators actually added; the rest comes back when the search finishes. If nothing is found, nothing is charged.</p>
        </div>
        {max !== null && available < max && <p className="mt-2 text-xs text-red-600">You have {available} credits. Choose a smaller number or top up.</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => onOpenChange(false)} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>Cancel</button>
          <button onClick={confirm} disabled={max === null || available < max || start.isPending} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800 disabled:opacity-50" style={{ fontWeight: 500 }}>
            {start.isPending ? "Starting…" : `Find up to ${size} · at most ${max ?? "—"} credits`}
          </button>
        </div>
      </div>
    </div>
  );
}
