import { Bookmark, ChevronDown, Eye, EyeOff, GitCompare, Plus, RefreshCw, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

const item =
  "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:cursor-not-allowed disabled:opacity-50";
const quiet = `${item} text-slate-700 hover:bg-slate-100`;

/**
 * Every action on a creator in one side panel (owner, 17 Nov): add to a shortlist or campaign, unlock contacts, compare,
 * refresh, reassess, report a problem, open the details. Shown beside the profile on wide screens and below it on small
 * ones. Each button keeps the behaviour it had in the profile; nothing here decides anything on its own.
 */
export function CreatorActions(p: {
  blocked: string | null;
  onShortlist: () => void;
  onCampaign: () => void;
  onCompare?: (() => void) | undefined;
  unlock: { show: boolean; cost: number; busy: boolean; revealed: boolean; onClick: () => void };
  forget: { show: boolean; busy: boolean; onClick: () => void };
  refresh: { show: boolean; cost: number; busy: boolean; disabled: boolean; title: string; onClick: () => void };
  reassess: { show: boolean; busy: boolean; done: boolean; onClick: () => void };
  details: { show: boolean; open: boolean; onToggle: () => void };
  review: ReactNode;
}) {
  return (
    <aside aria-label="Creator actions" className="flex shrink-0 flex-col gap-1 border-t border-slate-100 bg-slate-50/60 p-3 md:w-60 md:border-l md:border-t-0 md:pt-12">
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Actions</p>
      <button onClick={p.onCampaign} disabled={p.blocked !== null} title={p.blocked ?? undefined} className={`${item} bg-[#0A0F24] text-white hover:bg-slate-800`}>
        <Plus aria-hidden className="h-3.5 w-3.5 text-cyan-300" /> Add to Campaign
      </button>
      <button onClick={p.onShortlist} disabled={p.blocked !== null} title={p.blocked ?? undefined} className={quiet}>
        <Bookmark aria-hidden className="h-3.5 w-3.5" /> Save to Shortlist
      </button>
      {p.unlock.show && (
        <button onClick={p.unlock.onClick} disabled={p.unlock.busy || p.unlock.revealed} aria-label={p.unlock.revealed ? "Contacts unlocked" : `Reveal contact details for ${p.unlock.cost} credits`} className={quiet}>
          <Eye aria-hidden className="h-3.5 w-3.5" /> {p.unlock.revealed ? "Contacts unlocked" : p.unlock.busy ? "Unlocking…" : `Unlock contact · ${p.unlock.cost} cr`}
        </button>
      )}
      {p.onCompare && (
        <button onClick={p.onCompare} className={quiet}>
          <GitCompare aria-hidden className="h-3.5 w-3.5" /> Compare
        </button>
      )}
      <div className="my-1 border-t border-slate-200/70" />
      {p.refresh.show && (
        <button onClick={p.refresh.onClick} disabled={p.refresh.disabled} title={p.refresh.title} className={quiet}>
          <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${p.refresh.busy ? "animate-spin" : ""}`} /> {p.refresh.busy ? "Refreshing…" : `Refresh profile · ${p.refresh.cost} cr`}
        </button>
      )}
      {p.reassess.show && (
        <button onClick={p.reassess.onClick} disabled={p.reassess.busy || p.reassess.done} title="Re-check location, account type, metrics and niche from stored data. No credits." className={quiet}>
          <RotateCcw aria-hidden className="h-3.5 w-3.5" /> {p.reassess.busy ? "Starting…" : p.reassess.done ? "Reassessment queued" : "Reassess (free)"}
        </button>
      )}
      {p.details.show && (
        <button onClick={p.details.onToggle} aria-expanded={p.details.open} className={quiet}>
          <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${p.details.open ? "rotate-180" : ""}`} /> {p.details.open ? "Hide details" : "View details"}
        </button>
      )}
      {p.forget.show && (
        <button onClick={p.forget.onClick} disabled={p.forget.busy} className={`${item} text-rose-700 hover:bg-rose-50`}>
          <EyeOff aria-hidden className="h-3.5 w-3.5" /> Hide revealed contacts
        </button>
      )}
      <div className="mt-1">{p.review}</div>
    </aside>
  );
}
