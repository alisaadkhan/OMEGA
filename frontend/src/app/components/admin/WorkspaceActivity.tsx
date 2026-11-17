import { useInfiniteQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { activityFeedSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { ActivityRow } from "../dashboard/ActivityRow";
import { ErrorState, LoadingBlock } from "../dashboard/states";

const PAGE = 30;

/**
 * One customer's activity history for admins (owner, 17 Nov: the Activity Log is admin-only): what was done, when, by
 * whom and on which list, campaign or creator, newest first. Opening it is recorded in the staff audit log; support
 * staff are refused by the API.
 */
export function WorkspaceActivity({ workspace, onClose }: { workspace: { id: string; name: string }; onClose: () => void }) {
  const feed = useInfiniteQuery({
    queryKey: ["admin", "workspace-activity", workspace.id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => adminRequest(`/admin/v1/ops/workspaces/${workspace.id}/activity?limit=${PAGE}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`, activityFeedSchema),
    getNextPageParam: (last) => (last.events.length === PAGE ? (last.events[last.events.length - 1]?.cursor ?? null) : null),
  });
  const events = feed.data?.pages.flatMap((p) => p.events) ?? [];
  return (
    <section aria-label={`Activity of ${workspace.name}`} className="mt-4 rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
        <div>
          <div className="text-sm" style={{ fontWeight: 600 }}>Activity · {workspace.name}</div>
          <div className="text-[11px] text-slate-500">Newest first. Viewing this is recorded in the audit log.</div>
        </div>
        <button onClick={onClose} aria-label="Close activity" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
      </div>
      {feed.isPending ? <div className="p-4"><LoadingBlock lines={4} /></div> : feed.isError ? <div className="p-4"><ErrorState body={feed.error instanceof Error ? feed.error.message : undefined} onRetry={() => void feed.refetch()} /></div> : events.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">No activity recorded for this workspace.</p>
      ) : (
        <>
          <ol className="divide-y divide-slate-100">{events.map((e) => <ActivityRow key={e.id} e={e} />)}</ol>
          {feed.hasNextPage && (
            <div className="border-t border-slate-100 p-3 text-center">
              <button onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {feed.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
