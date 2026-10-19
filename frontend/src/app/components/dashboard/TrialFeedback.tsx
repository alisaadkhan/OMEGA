import { useState } from "react";
import type { PlanId, TrialFeedbackCreate } from "@mushin/contracts";
import { useSendTrialFeedback } from "../../api/trial";

const RATINGS = [
  ["searchQuality", "How relevant were the creators Search found?"],
  ["contactAccuracy", "How accurate were creator details and contact information?"],
  ["easeOfUse", "How easy was MUSHIN to set up and use?"],
] as const;

/**
 * Trial feedback (mandate v4 §3.4). Every question is optional and neutral: low scores and "no" answers are as useful as
 * high ones. Stored for this workspace only; MUSHIN's owners read it.
 */
export function TrialFeedback() {
  const send = useSendTrialFeedback();
  const [v, setV] = useState<TrialFeedbackCreate>({});
  const [done, setDone] = useState(false);
  const set = <K extends keyof TrialFeedbackCreate>(k: K, val: TrialFeedbackCreate[K] | undefined) => setV((p) => ({ ...p, [k]: val }));
  const answered = Object.values(v).some((x) => x !== undefined && x !== "");
  const choice = "rounded-md border px-2.5 py-1 text-xs";
  const on = (active: boolean) => `${choice} ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`;

  if (done) {
    return <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" role="status">Thank you. Your feedback was sent to the MUSHIN team.</section>;
  }
  return (
    <section aria-labelledby="tf-title" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 id="tf-title" className="text-slate-900" style={{ fontSize: 15, fontWeight: 600 }}>Tell us how the trial went</h2>
      <p className="mt-1 text-xs text-slate-500">Answer any questions you like; critical answers help most. 1 = poor, 5 = excellent.</p>
      <form
        className="mt-3 space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate({ ...v, missingFeatures: v.missingFeatures?.trim() || undefined, comments: v.comments?.trim() || undefined }, { onSuccess: () => setDone(true) });
        }}
      >
        {RATINGS.map(([k, q]) => (
          <fieldset key={k}>
            <legend className="text-xs text-slate-700">{q}</legend>
            <div className="mt-1 flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" aria-pressed={v[k] === n} onClick={() => set(k, v[k] === n ? undefined : n)} className={on(v[k] === n)}>{n}</button>
              ))}
            </div>
          </fieldset>
        ))}
        <fieldset>
          <legend className="text-xs text-slate-700">Did MUSHIN save you time or money?</legend>
          <div className="mt-1 flex gap-1.5">
            {([["yes", "Yes"], ["no", "No"], ["not_sure", "Not sure"]] as const).map(([val, t]) => (
              <button key={val} type="button" aria-pressed={v.savedTime === val} onClick={() => set("savedTime", v.savedTime === val ? undefined : val)} className={on(v.savedTime === val)}>{t}</button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-xs text-slate-700">Would you pay for MUSHIN?</legend>
          <div className="mt-1 flex gap-1.5">
            {([["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"]] as const).map(([val, t]) => (
              <button key={val} type="button" aria-pressed={v.wouldPay === val} onClick={() => set("wouldPay", v.wouldPay === val ? undefined : val)} className={on(v.wouldPay === val)}>{t}</button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="tf-plan" className="text-xs text-slate-700">If so, which plan would suit you?</label>
          <select id="tf-plan" value={v.preferredPlan ?? ""} onChange={(e) => set("preferredPlan", (e.target.value || undefined) as PlanId | undefined)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
            <option value="">No answer</option>
            <option value="explorer">Starter</option>
            <option value="growth">Growth</option>
            <option value="scale">Scale</option>
          </select>
        </div>
        <div>
          <label htmlFor="tf-missing" className="text-xs text-slate-700">What was missing?</label>
          <textarea id="tf-missing" rows={2} maxLength={2000} value={v.missingFeatures ?? ""} onChange={(e) => set("missingFeatures", e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="tf-comments" className="text-xs text-slate-700">Anything else?</label>
          <textarea id="tf-comments" rows={3} maxLength={4000} value={v.comments ?? ""} onChange={(e) => set("comments", e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
        </div>
        {send.isError && <p className="text-xs text-red-600" role="alert">{send.error instanceof Error ? send.error.message : "Could not send. Please try again."}</p>}
        <button type="submit" disabled={!answered || send.isPending} className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50" style={{ fontWeight: 500 }}>
          {send.isPending ? "Sending…" : "Send feedback"}
        </button>
      </form>
    </section>
  );
}
