import { RefreshCw, AlertTriangle, Clock, HelpCircle, Loader2 } from "lucide-react";
import type { Freshness } from "../dashboard/states";

export type FreshnessState = Freshness | "refreshing" | "failed";

interface FreshnessLabelProps {
  state: FreshnessState;
  /** ISO date string or human-readable "N days ago" */
  updated?: string;
  /** Days since last update — used to auto-compute state if state is omitted */
  daysSince?: number;
  onRefresh?: () => void;
  refreshCost?: number;
  className?: string;
}

const CONFIG: Record<FreshnessState, { label: string; cls: string; icon: any }> = {
  current:     { label: "Current",    cls: "border-emerald-100 bg-emerald-50 text-emerald-700",  icon: null },
  aging:       { label: "Aging",      cls: "border-amber-100  bg-amber-50  text-amber-700",      icon: AlertTriangle },
  stale:       { label: "Stale",      cls: "border-rose-100   bg-rose-50   text-rose-700",       icon: AlertTriangle },
  unavailable: { label: "No data",    cls: "border-slate-200  bg-slate-50  text-slate-500",      icon: HelpCircle },
  refreshing:  { label: "Refreshing", cls: "border-indigo-100 bg-indigo-50 text-indigo-700",     icon: Loader2 },
  failed:      { label: "Refresh failed", cls: "border-rose-100 bg-rose-50 text-rose-700",      icon: AlertTriangle },
};

/**
 * Extended freshness label (superset of states.tsx FreshnessBadge).
 * Adds refreshing, failed, and optional inline refresh action with cost.
 * Spec §8.3: every creator profile must show a data freshness state.
 */
export function FreshnessLabel({
  state,
  updated,
  onRefresh,
  refreshCost,
  className = "",
}: FreshnessLabelProps) {
  const c = CONFIG[state];
  const Icon = c.icon;
  const spinning = state === "refreshing";

  const updatedText = updated
    ? `Data updated ${updated}`
    : state === "unavailable"
    ? "No update timestamp available"
    : undefined;

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${c.cls}`}
        style={{ fontWeight: 500 }}
        title={updatedText}
      >
        {Icon && (
          <Icon
            className={`h-2.5 w-2.5 ${spinning ? "animate-spin" : ""}`}
            strokeWidth={2}
          />
        )}
        {!Icon && <span className={`h-1.5 w-1.5 rounded-full ${dotClass(state)}`} />}
        {c.label}
        {updatedText && !Icon && (
          <span className="ml-0.5 text-[9px] opacity-70">{updatedText}</span>
        )}
      </span>

      {onRefresh && state !== "refreshing" && (
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 transition-colors hover:bg-slate-50"
          style={{ fontWeight: 500 }}
          title={refreshCost ? `Refresh · ${refreshCost} credits` : "Refresh creator data"}
        >
          <RefreshCw className="h-2.5 w-2.5" strokeWidth={2} />
          {refreshCost ? `Refresh · ${refreshCost} cr` : "Refresh"}
        </button>
      )}
    </span>
  );
}

function dotClass(state: FreshnessState): string {
  switch (state) {
    case "current": return "bg-emerald-500";
    case "aging": return "bg-amber-500";
    case "stale": return "bg-rose-500";
    default: return "bg-slate-400";
  }
}
