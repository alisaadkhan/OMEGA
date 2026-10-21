import { useState } from "react";
import { ChevronDown, Quote } from "lucide-react";
import { groupEvidence, SOURCE_LABEL, STATUS_LABEL, unknownReason, type EvidenceItem } from "../../api/evidence-mapping";

const TONE = { good: "border-emerald-100 bg-emerald-50 text-emerald-700", muted: "border-slate-200 bg-slate-50 text-slate-600", warn: "border-amber-100 bg-amber-50 text-amber-800" } as const;

/** "Where these details come from": the evidence behind city, country, niches and languages (CR-01). */
export function AttributeEvidence({ items }: { items: readonly EvidenceItem[] }) {
  const [open, setOpen] = useState(false);
  const groups = groupEvidence(items);
  if (groups.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between text-left">
        <span>
          <span className="block text-slate-900" style={{ fontSize: 13, fontWeight: 600 }}>Where these details come from</span>
          <span className="block text-[11px] text-slate-500">City, country and niches are shown only when the creator's own words support them.</span>
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {groups.map((g) => {
            const reason = unknownReason(g);
            return (
              <div key={g.attribute}>
                <div className="text-[11px] uppercase tracking-wider text-slate-500" style={{ fontWeight: 600 }}>{g.label}</div>
                {reason && <p className="mt-1 text-xs text-slate-600">{reason}</p>}
                <ul className="mt-1.5 space-y-1.5">
                  {g.rows.map((r, i) => {
                    const s = STATUS_LABEL[r.status];
                    return (
                      <li key={`${r.value}-${r.source}-${i}`} className="text-xs text-slate-700">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span style={{ fontWeight: 600 }}>{r.display}</span>
                          <span className={`rounded-full border px-1.5 py-px text-[10px] ${TONE[s.tone]}`}>{s.label}</span>
                          <span className="text-[11px] text-slate-500">{SOURCE_LABEL[r.source]}</span>
                        </div>
                        {r.quote && (
                          <p className="mt-0.5 flex gap-1 text-[11px] text-slate-500">
                            <Quote className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden="true" />
                            <span className="break-words">{r.quote}</span>
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
