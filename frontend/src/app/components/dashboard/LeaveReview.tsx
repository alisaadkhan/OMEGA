import { useState } from "react";
import { Star } from "lucide-react";
import { useLeaveReview } from "../../api/feedback";
import { useToast } from "../../lib/toast";

/**
 * "Leave a review" at the bottom of the customer app (plan Phase 12): a rating and an optional comment for the MUSHIN
 * team. It goes to the staff Reviews page; nobody is emailed and it is never published.
 */
export function LeaveReview({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const send = useLeaveReview();
  const toast = useToast();

  function submit() {
    if (rating < 1) return toast.error("Choose a rating from 1 to 5");
    send.mutate(
      { rating, ...(comment.trim() ? { comment: comment.trim() } : {}), page },
      {
        onSuccess: () => {
          toast.success("Thanks for your review", "The MUSHIN team reads every one.");
          setOpen(false);
          setRating(0);
          setComment("");
        },
        onError: (e) => toast.error("Couldn't send your review", e instanceof Error ? e.message : undefined),
      },
    );
  }

  if (!open)
    return (
      <div className="mt-10 border-t border-slate-200 pt-4 text-center">
        <button onClick={() => setOpen(true)} className="text-xs text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline" style={{ fontWeight: 500 }}>
          Leave a review
        </button>
      </div>
    );

  return (
    <section aria-label="Leave a review" className="mx-auto mt-10 max-w-md rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm text-slate-900" style={{ fontWeight: 600 }}>How is MUSHIN working for you?</h2>
      <div role="radiogroup" aria-label="Rating" className="mt-3 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={rating === n} aria-label={`${n} out of 5`} onClick={() => setRating(n)} className="rounded p-1 hover:bg-slate-50">
            <Star className={`h-5 w-5 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} strokeWidth={1.75} />
          </button>
        ))}
      </div>
      <label className="mt-3 block text-xs text-slate-600">
        Anything to add? (optional)
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-900 focus:border-indigo-300 focus:outline-none" />
      </label>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
        <button onClick={submit} disabled={send.isPending} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-60" style={{ fontWeight: 600 }}>
          Send review
        </button>
      </div>
    </section>
  );
}
