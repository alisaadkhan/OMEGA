import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Flag, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { CREATOR_REVIEW_REASON_LABEL, CREATOR_REVIEW_REASONS, creatorReviewResponseSchema, type CreatorReviewReason } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { useToast } from "../../lib/toast";

type Props = {
  creatorId: string;
  creatorName: string;
  platform: "instagram" | "tiktok" | "youtube" | null;
  sourceMode: "db_search" | "live_discovery";
  /** Card: icon only. Profile: icon and the word "Review". */
  compact?: boolean;
};

/**
 * Review / flag a creator (owner directive 2026-11-15 §3): confirm the profile is right, or report what is wrong. A
 * report reaches the staff Catalogue review; a confirmation is counted there. Small and out of the way on purpose.
 */
export function ReviewCreatorButton({ creatorId, creatorName, platform, sourceMode, compact = false }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"choose" | "issue">("choose");
  const [reason, setReason] = useState<CreatorReviewReason | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setOpen(false);
        return;
      }
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const reset = () => {
    setStep("choose");
    setReason(null);
    setNote("");
  };
  const send = async (verdict: "valid" | "invalid") => {
    setSending(true);
    try {
      await apiRequest(`/v1/creators/${creatorId}/reviews`, creatorReviewResponseSchema, {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: { verdict, reason: verdict === "invalid" ? reason : null, note: verdict === "invalid" && note.trim() ? note.trim() : null, platform, sourceMode },
      });
      toast.success(verdict === "valid" ? "Thanks for confirming" : "Thanks, our team will check this profile", verdict === "valid" ? `${creatorName} marked as a valid creator.` : undefined);
      setOpen(false);
      reset();
    } catch (err) {
      toast.error("Your review was not sent", err instanceof Error ? err.message : undefined);
    } finally {
      setSending(false);
    }
  };

  // Shown in a portal: cards clip their overflow. Above the button, or below it near the top of the window.
  const toggle = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (r) {
      const left = Math.min(Math.max(8, r.right - 288), window.innerWidth - 296);
      setPlace(r.top > 280 ? { left, top: r.top - 8, transform: "translateY(-100%)" } : { left, top: r.bottom + 8 });
    }
    setOpen((v) => !v);
    reset();
  };

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        title="Review or flag this profile"
        aria-label={`Review or flag ${creatorName}`}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-xl border border-slate-200/70 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/50 ${compact ? "p-2.5" : "px-3 py-2 text-xs font-medium text-slate-600"}`}
      >
        <Flag aria-hidden className="h-4 w-4" />
        {!compact && "Review"}
      </button>
      {open && createPortal(
        <div ref={panel} role="dialog" aria-label={`Review ${creatorName}`} style={{ position: "fixed", ...place }} className="z-[60] w-72 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-lg" onClick={(e) => e.stopPropagation()}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-800">{step === "choose" ? "Is this profile right?" : "What is wrong?"}</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-0.5 text-slate-400 hover:text-slate-700">
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          </div>
          {step === "choose" ? (
            <div className="flex gap-2">
              <button type="button" disabled={sending} onClick={() => void send("valid")} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
                <ThumbsUp aria-hidden className="h-3.5 w-3.5" /> Valid creator
              </button>
              <button type="button" disabled={sending} onClick={() => setStep("issue")} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50">
                <ThumbsDown aria-hidden className="h-3.5 w-3.5" /> Report an issue
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (reason) void send("invalid");
              }}
              className="space-y-2"
            >
              <fieldset className="space-y-1">
                <legend className="sr-only">Reason</legend>
                {CREATOR_REVIEW_REASONS.map((r) => (
                  <label key={r} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                    <input type="radio" name={`reason-${creatorId}`} value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-[#06B6D4]" />
                    {CREATOR_REVIEW_REASON_LABEL[r]}
                  </label>
                ))}
              </fieldset>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="Anything our team should know (optional)" aria-label="Note for the review team" className="w-full resize-none rounded-md border border-slate-200 p-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/40" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setStep("choose")} className="rounded-md px-2 py-1 text-xs text-slate-500 hover:text-slate-800">Back</button>
                <button type="submit" disabled={!reason || sending} className="rounded-md bg-[#0A0F24] px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
                  Send report
                </button>
              </div>
            </form>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
