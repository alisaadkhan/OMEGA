import { AlertTriangle, Sparkles } from "lucide-react";
import type { LostAccessItem } from "@mushin/contracts";
import { useBillingSummary } from "../../api/billing";

const LOST_LABEL: Record<LostAccessItem, string> = {
  search_existing: "searching existing creators",
  find_new: "finding new creators",
  reveal_contact: "revealing contact details",
  refresh_data: "refreshing creator data",
  monthly_credits: "monthly credits",
  outreach: "outreach emails",
  audience_details: "audience details",
  export: "data export",
};

/** SRS REQ-08.04 / §4.8.2: a clear upgrade prompt, and exactly what was lost when no plan is active. */
export function BillingStatusBanner({ onChoosePlan }: { onChoosePlan: () => void }) {
  const { data } = useBillingSummary();
  if (!data) return null;

  if (data.status === "trialing" && data.trialDaysLeft !== null) {
    return (
      <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-900">
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-500" strokeWidth={2} />
          Free trial: {data.trialDaysLeft} {data.trialDaysLeft === 1 ? "day" : "days"} left · {data.balance.available} credits
        </span>
        <button onClick={onChoosePlan} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700" style={{ fontWeight: 600 }}>
          Choose a plan
        </button>
      </div>
    );
  }

  if (data.lostAccess.length > 0) {
    const ended = data.status === "canceled" ? "Your subscription has ended." : "Your free trial has ended.";
    return (
      <div role="alert" className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span className="inline-flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" strokeWidth={2} />
          <span>
            <span style={{ fontWeight: 600 }}>{ended}</span> You no longer have access to {data.lostAccess.map((k) => LOST_LABEL[k]).join(", ")}.
            Searching existing creators and your lists still work.
          </span>
        </span>
        <button onClick={onChoosePlan} className="flex-shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 600 }}>
          Choose a plan
        </button>
      </div>
    );
  }
  return null;
}
