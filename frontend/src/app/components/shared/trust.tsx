import { useState, type ReactNode } from "react";
import { Info, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { useCredits } from "../../lib/credits";
import { COPY } from "../../lib/copy";

/* Shared trust/credit primitives (spec §5, §10, §11, §12, §23). */

export function MetricTip({ text, label = "What is this?" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="rounded text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <Info className="h-3 w-3" strokeWidth={2} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-normal normal-case tracking-normal text-slate-600 shadow-lg"
          style={{ lineHeight: 1.5 }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function AiEstimatedLabel({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700 ${className}`}
      style={{ fontWeight: 500 }}
    >
      <Sparkles className="h-2.5 w-2.5" />
      {COPY.aiEstimated}
    </span>
  );
}

export function ScoreWithEvidence({
  label,
  value,
  evidence,
  definition,
  tone = "neutral",
}: {
  label: string;
  value?: number | null;
  evidence?: string[];
  definition?: string;
  tone?: "neutral" | "good" | "watch";
}) {
  const [open, setOpen] = useState(false);
  const toneCls =
    tone === "good" ? "text-emerald-700" : tone === "watch" ? "text-amber-700" : "text-slate-900";
  const missing = value == null;
  return (
    <div className="relative inline-flex flex-col">
      <div className="flex items-center gap-1 text-[11px] text-slate-500" style={{ fontWeight: 500 }}>
        {label}
        {definition && <MetricTip text={definition} />}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`tabular-nums ${toneCls}`} style={{ fontSize: 18, fontWeight: 600 }}>
          {missing ? "Not available" : value}
        </span>
        {!missing && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="rounded text-[11px] text-indigo-600 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Why this score?
          </button>
        )}
      </div>
      {open && (
        <div
          role="dialog"
          className="absolute left-0 top-full z-40 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-xl"
        >
          <div className="mb-1.5 flex items-center justify-between text-slate-900" style={{ fontWeight: 600 }}>
            {label}: contributing signals
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {evidence && evidence.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4">
              {evidence.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <p>Evidence for this score is not available yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

export type FreshnessState = "fresh" | "older" | "unavailable" | "refreshing" | "failed";

export function FreshnessLabel({
  state,
  daysAgo,
  onRefresh,
  refreshCost,
  className = "",
}: {
  state: FreshnessState;
  daysAgo?: number;
  onRefresh?: () => void;
  refreshCost?: number;
  className?: string;
}) {
  const text =
    state === "refreshing"
      ? "Refreshing creator data…"
      : state === "failed"
        ? "We could not refresh this creator. Try again."
        : state === "unavailable" || daysAgo == null
          ? "Update date unavailable."
          : daysAgo <= 0
            ? "Data updated today"
            : `Data updated ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`;
  return (
    <span className={`inline-flex items-center gap-2 text-xs text-slate-500 ${className}`}>
      {state === "refreshing" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            state === "fresh" ? "bg-emerald-500" : state === "failed" ? "bg-rose-500" : state === "older" ? "bg-amber-500" : "bg-slate-300"
          }`}
        />
      )}
      {text}
      {onRefresh && state !== "refreshing" && (
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1 rounded text-indigo-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <RotateCcw className="h-3 w-3" />
          Refresh data{refreshCost != null ? ` · ${refreshCost} credits` : ""}
        </button>
      )}
    </span>
  );
}

export function CreditConfirm({
  open,
  title,
  description,
  cost,
  confirmLabel,
  onConfirm,
  onCancel,
  onViewCredits,
  processing = false,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  cost: number;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onViewCredits?: () => void;
  processing?: boolean;
  children?: ReactNode;
}) {
  const balance = useCredits();
  if (!open) return null;
  const insufficient = cost > balance;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-label={title} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-slate-900" style={{ fontSize: 16, fontWeight: 600 }}>
          {title}
        </h3>
        {description && <p className="mt-1.5 text-sm text-slate-500" style={{ lineHeight: 1.55 }}>{description}</p>}
        {children}
        <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">Cost</span>
          <span className="tabular-nums text-slate-900" style={{ fontWeight: 600 }}>{cost} credits</span>
        </div>
        <div className="mt-1.5 text-right text-[11px] text-slate-400">
          Your balance: {new Intl.NumberFormat("en-PK").format(balance)} credits
        </div>
        {insufficient && (
          <p className="mt-3 text-sm text-rose-600" role="alert">
            You don't have enough credits.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-lg border border-slate-200 px-4 text-sm text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Cancel
          </button>
          {insufficient ? (
            <button
              type="button"
              onClick={onViewCredits}
              className="h-10 rounded-lg bg-slate-900 px-4 text-sm text-white hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              View Credits
            </button>
          ) : (
            <button
              type="button"
              disabled={processing}
              onClick={onConfirm}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm text-white hover:bg-indigo-700 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {processing && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirmLabel ?? `Confirm · ${cost} credits`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
