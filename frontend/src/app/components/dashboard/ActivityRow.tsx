import { Activity, Bookmark, CalendarClock, Gift, Megaphone, MessageSquareText, Radio, ShieldCheck } from "lucide-react";
import type { ActivityEvent } from "@mushin/contracts";

/** One activity line (customer bell and dashboard, staff activity history). */
const ICON: Record<ActivityEvent["kind"], typeof Activity> = {
  complimentary_plan: Gift,
  list_created: Bookmark,
  creator_saved: Bookmark,
  campaign_created: Megaphone,
  creator_added_to_campaign: Megaphone,
  outreach_logged: MessageSquareText,
  live_run_finished: Radio,
  contact_revealed: ShieldCheck,
  post_due: CalendarClock,
};

export const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function ActivityRow({ e }: { e: ActivityEvent }) {
  const Icon = ICON[e.kind];
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600"><Icon className="h-3.5 w-3.5" /></span>
      <div className="min-w-0 flex-1 text-sm text-slate-700">
        {e.kind === "complimentary_plan" || e.kind === "post_due" ? (
          <span className="text-slate-900">{e.text}</span>
        ) : (
          <>
            <span className="text-slate-900" style={{ fontWeight: 600 }}>{e.actor?.name ?? "MUSHIN"}</span> {e.text}
          </>
        )}
      </div>
      <time dateTime={e.at} className="shrink-0 text-xs text-slate-500">{when(e.at)}</time>
    </li>
  );
}

