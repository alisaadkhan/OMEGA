import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Staff portal building blocks (owner design, 22 Nov): light #F8FAFC canvas, white rounded-2xl cards with 1px slate
 * borders, cyan accents, tabular numbers. Every page in the portal uses these so the look stays one system.
 */
export const fmtNum = (n: number) => n.toLocaleString("en-US");
export const fmtWhen = (iso: string | null | undefined) =>
  iso ? `${new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" })} PKT` : "—";
export const fmtAgo = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
};
export const initials = (name: string) =>
  name.trim().split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
export const errText = (e: unknown) => (e instanceof Error ? e.message : undefined);

export function PageHeader({ eyebrow, title, sub, actions }: { eyebrow?: string; title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        {eyebrow && <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-cyan-700">{eyebrow}</div>}
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-slate-900">{title}</h1>
        {sub && <p className="mt-1 text-[13px] text-slate-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label} className={`rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${className}`}>
      {children}
    </section>
  );
}

export function CardTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-[14.5px] font-bold text-slate-900">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

const TONES = {
  slate: "bg-slate-100 text-slate-700 border-slate-200",
  cyan: "bg-cyan-50 text-cyan-800 border-cyan-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "slate", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${TONES[tone]}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Kpi({ label, value, hint, tone = "slate", icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
        {icon && <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${TONES[tone]}`}>{icon}</span>}
      </div>
      <div className="mt-2 text-[26px] font-extrabold leading-none tracking-tight text-slate-900 tabular-nums">{value}</div>
      {hint && <div className="mt-2 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Pills<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${value === o.id ? "bg-[#0A0F24] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DataTable({ head, children, minWidth }: { head: ReactNode[]; children: ReactNode; minWidth?: number }) {
  return (
    // Focusable so keyboard users can scroll a wide table at phone width (axe scrollable-region-focusable).
    <div tabIndex={0} role="region" aria-label="Table" className="overflow-x-auto rounded-2xl border border-slate-200/90 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40">
      <table className="w-full border-collapse text-left text-[12.5px]" style={minWidth ? { minWidth } : undefined}>
        <thead>
          <tr className="border-b border-slate-200/80 bg-slate-50/90 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {head.map((h, i) => (
              <th key={i} className="px-4 py-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-10 text-center">
      <p className="text-sm font-bold text-slate-800">{title}</p>
      {body && <p className="mt-1 text-xs text-slate-500">{body}</p>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      maxLength={120}
      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-[12.5px] text-slate-800 placeholder:text-slate-400 focus:border-cyan-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-600/15"
    />
  );
}

/** Right-hand slide-over panel with the dark header of the owner's "audit drilldown" design. */
export function Drawer({ eyebrow, title, sub, onClose, children }: { eyebrow: string; title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" onClick={onClose} role="presentation">
      <aside
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="flex h-full w-full max-w-[520px] flex-col overflow-hidden bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 bg-[#0A0F24] p-5 text-white">
          <div className="min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-cyan-300">{eyebrow}</div>
            <h2 className="mt-1 truncate text-base font-bold">{title}</h2>
            {sub && <p className="mt-0.5 text-[11.5px] text-slate-300">{sub}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-white/10 p-1.5 hover:bg-white/20">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5 text-[12.5px]">{children}</div>
      </aside>
    </div>
  );
}
