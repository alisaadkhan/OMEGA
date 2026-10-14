import { useState } from "react";
import { ChevronDown, ChevronUp, HelpCircle } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { Unavailable } from "../dashboard/states";

interface ScoreWithEvidenceProps {
  /** 0–100. Omit or pass undefined for unavailable state. */
  value?: number;
  label: string;
  /** One sentence describing what this score means. */
  definition?: string;
  /** Evidence items explaining why the score is what it is. */
  evidence?: string[];
  className?: string;
}

function scoreColor(v: number): string {
  if (v >= 70) return "text-emerald-700";
  if (v >= 40) return "text-amber-700";
  return "text-rose-700";
}

function scoreBg(v: number): string {
  if (v >= 70) return "bg-emerald-50 border-emerald-200";
  if (v >= 40) return "bg-amber-50 border-amber-200";
  return "bg-rose-50 border-rose-200";
}

/**
 * Displays a numeric score (0–100) with an inline "Why this score?" popover
 * showing evidence items. Shows an Unavailable state when value is absent.
 * Spec §9: every score must expose its evidence.
 */
export function ScoreWithEvidence({
  value,
  label,
  definition,
  evidence = [],
  className = "",
}: ScoreWithEvidenceProps) {
  const [open, setOpen] = useState(false);

  if (value === undefined || value === null) {
    return (
      <span className={className}>
        <Unavailable label={label} />
      </span>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-opacity hover:opacity-80 ${scoreBg(value)} ${className}`}
          style={{ fontWeight: 600 }}
          aria-label={`${label}: ${value}. Click for evidence.`}
        >
          <span className={scoreColor(value)}>{value}</span>
          <span className="text-slate-500" style={{ fontWeight: 400 }}>{label}</span>
          <HelpCircle className="h-3 w-3 text-slate-500" strokeWidth={2} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-64 rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
          sideOffset={6}
          align="start"
        >
          <div className="text-xs text-slate-900" style={{ fontWeight: 600 }}>
            Why this score?
          </div>
          {definition && (
            <p className="mt-1 text-[11px] text-slate-500" style={{ lineHeight: 1.5 }}>
              {definition}
            </p>
          )}
          {evidence.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {evidence.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] text-slate-700">
                  <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400" />
                  {item}
                </li>
              ))}
            </ul>
          )}
          {evidence.length === 0 && (
            <p className="mt-2 text-[11px] text-slate-500">No specific evidence recorded for this profile.</p>
          )}
          <Popover.Arrow className="fill-slate-200" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
