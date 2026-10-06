import type { ReactNode } from "react";
import {
  AlertTriangle,
  Clock,
  HelpCircle,
  Inbox,
  Loader2,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  BadgeCheck,
  Ban,
  UserCheck,
} from "lucide-react";

/**
 * Shared global-state + trust/freshness primitives.
 * Implements the MUSHIN spec §23 (global states), §8.3 (freshness),
 * §8.4 (audience source labels) and §8.5 (contact trust).
 * These replace the per-file EmptyState/Skeleton copies so every
 * screen speaks the same visual language.
 */

/* ------------------------------------------------------------------ */
/* Global states (§23)                                                 */
/* ------------------------------------------------------------------ */

export function LoadingBlock({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`animate-pulse space-y-3 ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 rounded-md bg-slate-100"
          style={{ width: `${90 - i * 12}%` }}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-6 py-12 text-center ${className}`}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 shadow-sm">
        {icon ?? <Inbox className="h-5 w-5" strokeWidth={1.75} />}
      </div>
      <div className="mt-4 text-slate-900" style={{ fontSize: 15, fontWeight: 600 }}>
        {title}
      </div>
      {body && (
        <p className="mt-1.5 max-w-sm text-sm text-slate-500" style={{ lineHeight: 1.55 }}>
          {body}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  body = "We could not complete this request. Please try again.",
  onRetry,
  className = "",
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-rose-100 bg-rose-50/40 px-6 py-12 text-center ${className}`}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-500 shadow-sm">
        <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="mt-4 text-slate-900" style={{ fontSize: 15, fontWeight: 600 }}>
        {title}
      </div>
      <p className="mt-1.5 max-w-sm text-sm text-slate-500" style={{ lineHeight: 1.55 }}>
        {body}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs text-white transition-colors hover:bg-slate-800"
          style={{ fontWeight: 500 }}
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} /> Retry
        </button>
      )}
    </div>
  );
}

/** Small inline "Unavailable" marker — spec §23: prefer this over a fake zero. */
export function Unavailable({ label = "Unavailable" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400" title="No reliable value available">
      <HelpCircle className="h-3 w-3" strokeWidth={2} />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Data freshness (§8.3, §22)                                          */
/* ------------------------------------------------------------------ */

export type Freshness = "current" | "aging" | "stale" | "unavailable";

const FRESHNESS: Record<Freshness, { label: string; cls: string; dot: string }> = {
  current: { label: "Current", cls: "border-emerald-100 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  aging: { label: "Aging", cls: "border-amber-100 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  stale: { label: "Stale", cls: "border-rose-100 bg-rose-50 text-rose-700", dot: "bg-rose-500" },
  unavailable: { label: "Unavailable", cls: "border-slate-200 bg-slate-50 text-slate-500", dot: "bg-slate-400" },
};

export function FreshnessBadge({ value, updated }: { value: Freshness; updated?: string }) {
  const f = FRESHNESS[value];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${f.cls}`}
      style={{ fontWeight: 500 }}
      title={updated ? `Last updated ${updated}` : undefined}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${f.dot}`} />
      {f.label}
      {updated && value !== "unavailable" && <span className="opacity-60">· {updated}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Audience source labels (§8.4)                                       */
/* ------------------------------------------------------------------ */

export type SourceKind = "verified" | "estimated" | "public" | "unavailable" | "stale";

const SOURCE: Record<SourceKind, { label: string; cls: string }> = {
  verified: { label: "Verified", cls: "border-emerald-100 bg-emerald-50 text-emerald-700" },
  estimated: { label: "Estimated", cls: "border-indigo-100 bg-indigo-50 text-indigo-700" },
  public: { label: "Public signal", cls: "border-sky-100 bg-sky-50 text-sky-700" },
  stale: { label: "Stale", cls: "border-rose-100 bg-rose-50 text-rose-700" },
  unavailable: { label: "Unavailable", cls: "border-slate-200 bg-slate-50 text-slate-500" },
};

export function SourceBadge({
  kind,
  confidence,
}: {
  kind: SourceKind;
  confidence?: "low" | "medium" | "high";
}) {
  const s = SOURCE[kind];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${s.cls}`}
      style={{ fontWeight: 600 }}
    >
      {s.label}
      {confidence && kind === "estimated" && <span className="opacity-70">· {confidence}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Contact trust (§8.5)                                                */
/* ------------------------------------------------------------------ */

export type ContactTrust =
  | "unverified"
  | "contactable"
  | "verified"
  | "stale"
  | "invalid"
  | "creator_confirmed";

const TRUST: Record<
  ContactTrust,
  { label: string; cls: string; Icon: typeof ShieldCheck; note: string }
> = {
  unverified: {
    label: "Unverified",
    cls: "border-slate-200 bg-slate-50 text-slate-600",
    Icon: ShieldQuestion,
    note: "Found from a public source but not checked enough.",
  },
  contactable: {
    label: "Contactable",
    cls: "border-sky-100 bg-sky-50 text-sky-700",
    Icon: ShieldCheck,
    note: "Technical checks passed and the address appears usable.",
  },
  verified: {
    label: "Verified via outreach",
    cls: "border-emerald-100 bg-emerald-50 text-emerald-700",
    Icon: BadgeCheck,
    note: "A successful MUSHIN outreach reached this contact.",
  },
  stale: {
    label: "Stale — update needed",
    cls: "border-amber-100 bg-amber-50 text-amber-700",
    Icon: Clock,
    note: "Too old or no recent evidence.",
  },
  invalid: {
    label: "Invalid — do not use",
    cls: "border-rose-100 bg-rose-50 text-rose-700",
    Icon: Ban,
    note: "Repeated bounce or a known invalid result.",
  },
  creator_confirmed: {
    label: "Creator confirmed",
    cls: "border-violet-100 bg-violet-50 text-violet-700",
    Icon: UserCheck,
    note: "The creator confirmed ownership of this contact.",
  },
};

export function ContactTrustBadge({ state }: { state: ContactTrust }) {
  const t = TRUST[state];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${t.cls}`}
      style={{ fontWeight: 500 }}
      title={t.note}
    >
      <t.Icon className="h-3 w-3" strokeWidth={2} />
      {t.label}
    </span>
  );
}

export function contactTrustNote(state: ContactTrust) {
  return TRUST[state].note;
}

/* ------------------------------------------------------------------ */
/* Inline spinner (for buttons)                                        */
/* ------------------------------------------------------------------ */

export function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} strokeWidth={2} />;
}

export { ShieldAlert };
