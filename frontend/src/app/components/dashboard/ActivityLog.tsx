import { useState } from "react";
import { Activity, Bookmark, Gift, Megaphone, MessageSquareText, Radio, ShieldCheck } from "lucide-react";
import type { ActivityEvent } from "@mushin/contracts";
import { useActivityFeed } from "../../api/activity";
import { EmptyState, ErrorState, LoadingBlock } from "./states";

const ICON: Record<ActivityEvent["kind"], typeof Activity> = {
  complimentary_plan: Gift,
  list_created: Bookmark,
  creator_saved: Bookmark,
  campaign_created: Megaphone,
  creator_added_to_campaign: Megaphone,
  outreach_logged: MessageSquareText,
  live_run_finished: Radio,
  contact_revealed: ShieldCheck,
};

export const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function ActivityRow({ e }: { e: ActivityEvent }) {
  const Icon = ICON[e.kind];
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600"><Icon className="h-3.5 w-3.5" /></span>
      <div className="min-w-0 flex-1 text-sm text-slate-700">
        {e.kind === "complimentary_plan" ? (
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

/** Activity (canonical spec page 15): what your workspace actually did, from its own records. Nothing is generated. */
/** The filter choices, in the words of the feed (FRONTEND_REQUIREMENTS ACT-01). */
const KIND_FILTERS: { value: ActivityEvent["kind"] | ""; label: string }[] = [
  { value: "", label: "All activity" },
  { value: "list_created", label: "Lists created" },
  { value: "creator_saved", label: "Creators saved to lists" },
  { value: "campaign_created", label: "Campaigns created" },
  { value: "creator_added_to_campaign", label: "Creators added to campaigns" },
  { value: "outreach_logged", label: "Outreach logged" },
  { value: "live_run_finished", label: "Find New Creators runs" },
  { value: "contact_revealed", label: "Contacts revealed" },
];

export function ActivityLog() {
  const [kind, setKind] = useState<ActivityEvent["kind"] | "">("");
  const feed = useActivityFeed(kind || null);
  const events = feed.data?.pages.flatMap((p) => p.events) ?? [];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[32px] font-semibold leading-10 tracking-[-0.025em] text-slate-900">Activity log</h1>
        <p className="mt-1 text-sm text-slate-500">Lists, campaigns, outreach, Find New Creators runs and contact reveals in your workspace, newest first.</p>
        <label className="mt-3 inline-flex items-center gap-2 text-xs text-slate-600">
          Show
          <select value={kind} onChange={(e) => setKind(e.target.value as ActivityEvent["kind"] | "")} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800">
            {KIND_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
      </div>
      {feed.isPending ? (
        <LoadingBlock lines={6} />
      ) : feed.isError ? (
        <ErrorState body={feed.error instanceof Error ? feed.error.message : undefined} onRetry={() => void feed.refetch()} />
      ) : events.length === 0 ? (
        kind ? (
          <EmptyState icon={<Activity className="h-5 w-5" />} title="Nothing of this kind yet" body="Choose All activity to see everything your workspace has done." />
        ) : (
          <EmptyState icon={<Activity className="h-5 w-5" />} title="No recorded activity yet" body="Activity appears here as your team saves creators, runs campaigns and finds new creators." />
        )
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
          <ol className="divide-y divide-slate-100">{events.map((e) => <ActivityRow key={e.id} e={e} />)}</ol>
          {feed.hasNextPage && (
            <div className="border-t border-slate-100 p-3 text-center">
              <button onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {feed.isFetchingNextPage ? "Loading…" : "Load older activity"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
