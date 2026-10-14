import { Activity, Bookmark, Megaphone, MessageSquareText, Radio, ShieldCheck } from "lucide-react";
import type { ActivityEvent } from "@mushin/contracts";
import { useActivityFeed } from "../../api/activity";
import { EmptyState, ErrorState, LoadingBlock } from "./states";

const ICON: Record<ActivityEvent["kind"], typeof Activity> = {
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
        <span className="text-slate-900" style={{ fontWeight: 600 }}>{e.actor?.name ?? "MUSHIN"}</span> {e.text}
      </div>
      <time dateTime={e.at} className="shrink-0 text-xs text-slate-500">{when(e.at)}</time>
    </li>
  );
}

/** Activity (canonical spec page 15): what your workspace actually did, from its own records. Nothing is generated. */
export function ActivityLog() {
  const feed = useActivityFeed();
  const events = feed.data?.pages.flatMap((p) => p.events) ?? [];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-slate-900" style={{ fontSize: 26, fontWeight: 700 }}>Activity log</h1>
        <p className="mt-1 text-sm text-slate-500">Lists, campaigns, outreach, Find New Creators runs and contact reveals in your workspace, newest first.</p>
      </div>
      {feed.isPending ? (
        <LoadingBlock lines={6} />
      ) : feed.isError ? (
        <ErrorState body={feed.error instanceof Error ? feed.error.message : undefined} onRetry={() => void feed.refetch()} />
      ) : events.length === 0 ? (
        <EmptyState icon={<Activity className="h-5 w-5" />} title="No recorded activity yet" body="Activity appears here as your team saves creators, runs campaigns and finds new creators." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
