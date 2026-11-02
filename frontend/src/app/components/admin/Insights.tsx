import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { creatorViewStatsSchema, searchStatsSchema, staffProductReviewListSchema, supportPerformanceSchema, type CreatorViewStats } from "@mushin/contracts";
import type { AdminRole } from "../../admin/AdminAuthContext";
import { adminRequest } from "../../admin/adminApi";
import { useToast } from "../../lib/toast";
import { errText } from "./staff-ui";

type ReviewStatus = "new" | "reviewed" | "archived";
const REVIEW_LABEL: Record<ReviewStatus, string> = { new: "New", reviewed: "Reviewed", archived: "Archived" };
const date = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" });

/** Product reviews left in the customer app (Staff Admin and Super Admin; the API enforces it). No person is shown. */
export function ProductReviews() {
  const [status, setStatus] = useState<ReviewStatus | "">("new");
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["admin", "reviews", status], queryFn: () => adminRequest(`/admin/v1/feedback${status ? `?status=${status}` : ""}`, staffProductReviewListSchema) });
  const mark = useMutation({
    mutationFn: (a: { id: string; status: ReviewStatus }) => adminRequest(`/admin/v1/feedback/${a.id}`, z.null(), { method: "PATCH", body: { status: a.status } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["admin", "reviews"] }),
    onError: (e) => toast.error("Couldn't update the review", errText(e)),
  });
  return (
    <section aria-label="Reviews">
      <h1 className="text-slate-900" style={{ fontSize: 18, fontWeight: 600 }}>Reviews</h1>
      <p className="mt-1 text-xs text-slate-500">What customers wrote with "Leave a review". Nobody is emailed when one arrives.</p>
      <div className="mt-4 flex gap-1 text-xs">
        {(["new", "reviewed", "archived", ""] as const).map((s) => (
          <button key={s || "all"} onClick={() => setStatus(s)} aria-pressed={status === s} className={`rounded-md px-2.5 py-1 ${status === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>
            {s ? REVIEW_LABEL[s] : "All"}
          </button>
        ))}
      </div>
      {list.isError && <p className="mt-4 text-sm text-rose-700">{errText(list.error)}</p>}
      {list.data && list.data.reviews.length === 0 && <p className="mt-6 text-sm text-slate-500">No reviews here yet.</p>}
      <ul className="mt-4 space-y-2">
        {list.data?.reviews.map((r) => (
          <li key={r.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                <span className="text-amber-500" aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span> · {r.workspaceName}
                {r.page ? ` · ${r.page}` : ""} · {date(r.createdAt)}
              </span>
              <span>{REVIEW_LABEL[r.status]}{r.statusChangedBy ? ` by ${r.statusChangedBy}` : ""}</span>
            </div>
            {r.comment && <p className="mt-2 whitespace-pre-line text-sm text-slate-800">{r.comment}</p>}
            <div className="mt-2 flex gap-2 text-xs">
              {(["reviewed", "archived"] as const).filter((s) => s !== r.status).map((s) => (
                <button key={s} onClick={() => mark.mutate({ id: r.id, status: s })} className="rounded-md border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50">
                  Mark {REVIEW_LABEL[s].toLowerCase()}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ViewTable({ title, rows }: { title: string; rows: { creatorId: string; displayName: string; platform: string; views: number; uniqueViewers?: number }[] }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <h3 className="text-xs text-slate-700" style={{ fontWeight: 600 }}>{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">No creators yet.</p>
      ) : (
        <table className="mt-2 w-full text-xs">
          <thead className="text-left text-slate-500"><tr><th className="py-1">Creator</th><th>Platform</th><th className="text-right">Views</th>{rows[0]?.uniqueViewers !== undefined && <th className="text-right">People</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.creatorId} className="border-t border-slate-100"><td className="py-1 text-slate-800">{r.displayName}</td><td className="text-slate-600">{r.platform}</td><td className="text-right">{r.views}</td>{r.uniqueViewers !== undefined && <td className="text-right">{r.uniqueViewers}</td>}</tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Usage (Staff Admin and Super Admin): creator-profile views and catalogue searches from recorded events only; staff
 * performance for Super Admin. Counting starts when the events were first recorded; nothing earlier is estimated.
 */
export function UsageInsights({ role }: { role: AdminRole }) {
  const [days, setDays] = useState(30);
  const views = useQuery({ queryKey: ["admin", "usage", "views", days], queryFn: () => adminRequest(`/admin/v1/analytics/creator-views?days=${days}`, creatorViewStatsSchema) });
  const searches = useQuery({ queryKey: ["admin", "usage", "searches", days], queryFn: () => adminRequest(`/admin/v1/analytics/searches?days=${days}`, searchStatsSchema) });
  const perf = useQuery({ queryKey: ["admin", "usage", "perf", days], queryFn: () => adminRequest(`/admin/v1/support/performance?days=${days}`, supportPerformanceSchema), enabled: role === "super_admin" });
  const since = (iso: string | null | undefined) => (iso ? `Counting since ${date(iso)}.` : "Nothing recorded yet.");
  const v: CreatorViewStats | undefined = views.data;
  const s = searches.data;
  return (
    <section aria-label="Usage">
      <div className="flex items-center justify-between">
        <h1 className="text-slate-900" style={{ fontSize: 18, fontWeight: 600 }}>Usage</h1>
        <label className="text-xs text-slate-600">
          Last{" "}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-md border border-slate-200 px-1 py-0.5">
            {[7, 30, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
      </div>

      <h2 className="mt-5 text-sm text-slate-900" style={{ fontWeight: 600 }}>Creator profiles opened</h2>
      <p className="text-xs text-slate-500">A view is a customer opening a creator's profile; the same person reopening it within 30 minutes counts once. {since(v?.trackedSince)}</p>
      {views.isError && <p className="mt-2 text-sm text-rose-700">{errText(views.error)}</p>}
      {v && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            {(["youtube", "instagram", "tiktok"] as const).map((p) => {
              const b = v.byPlatform.find((x) => x.platform === p);
              return (
                <div key={p} className="rounded-lg border border-slate-200 p-2">
                  <div className="text-slate-500">{p}</div>
                  <div className="text-slate-900" style={{ fontWeight: 600 }}>{b?.views ?? 0} views</div>
                  <div className="text-slate-500">{b?.uniqueViewers ?? 0} people · {b?.creatorsViewed ?? 0} creators</div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <ViewTable title="Most viewed" rows={v.mostViewed} />
            <ViewTable title="Least viewed (creators customers can find)" rows={v.leastViewed} />
          </div>
        </>
      )}

      <h2 className="mt-6 text-sm text-slate-900" style={{ fontWeight: 600 }}>Catalogue searches</h2>
      <p className="text-xs text-slate-500">One search is counted once, however many pages are opened. {since(s?.trackedSince)}</p>
      {searches.isError && <p className="mt-2 text-sm text-rose-700">{errText(searches.error)}</p>}
      {s && (
        <p className="mt-2 text-sm text-slate-800">
          {s.searches} searches · {s.zeroResult} found nobody{s.zeroResultRate === null ? "" : ` (${Math.round(s.zeroResultRate * 100)}%)`} · {s.charged} charged
        </p>
      )}

      {role === "super_admin" && (
        <>
          <h2 className="mt-6 text-sm text-slate-900" style={{ fontWeight: 600 }}>Support performance</h2>
          <p className="text-xs text-slate-500">Medians over requests opened in the window. {perf.data?.historySince ? `History since ${date(perf.data.historySince)}.` : "No history yet."}</p>
          {perf.isError && <p className="mt-2 text-sm text-rose-700">{errText(perf.error)}</p>}
          {perf.data && (
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-slate-500"><tr><th className="py-1">Person</th><th className="text-right">Active</th><th className="text-right">Resolved</th><th className="text-right">First reply</th><th className="text-right">Resolution</th><th className="text-right">Awaiting reply</th><th className="text-right">Reopened</th></tr></thead>
              <tbody>
                {perf.data.people.map((p) => (
                  <tr key={p.staffId ?? "unassigned"} className="border-t border-slate-100">
                    <td className="py-1 text-slate-800">{p.name}</td><td className="text-right">{p.workload}</td><td className="text-right">{p.resolved}</td>
                    <td className="text-right">{p.firstResponseMinutes === null ? "-" : `${p.firstResponseMinutes} min`}</td>
                    <td className="text-right">{p.resolutionMinutes === null ? "-" : `${p.resolutionMinutes} min`}</td>
                    <td className="text-right">{p.pending}</td><td className="text-right">{p.reopened}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td className="pt-2 text-slate-500" colSpan={7}>Open backlog: {perf.data.backlog}</td></tr></tfoot>
            </table>
          )}
        </>
      )}
    </section>
  );
}
