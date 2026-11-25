import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { staffRemovalListSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { useConfirm, useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { Empty, PageHeader } from "../staff/kit";

type Status = "received" | "processed" | "rejected";

/** Spec §6–7: staff approve (erase) or reject removal requests; every action is audit-logged by the API. */
export function RemovalRequests() {
  const [status, setStatus] = useState<Status>("received");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const list = useQuery({ queryKey: ["admin", "removals", status], queryFn: () => adminRequest(`/admin/v1/removal-requests?status=${status}`, staffRemovalListSchema) });
  const act = useMutation({
    mutationFn: (a: { id: string; kind: "approve" | "reject"; note?: string }) =>
      adminRequest(`/admin/v1/removal-requests/${a.id}/${a.kind}`, z.object({ status: z.string() }), { method: "POST", body: a.kind === "reject" ? { note: a.note } : undefined }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["admin", "removals"] }),
  });

  async function approve(id: string, name: string) {
    const ok = await confirm({ title: `Erase ${name}?`, body: "Their contacts, profiles, history, archived data and photo are deleted, and their links can never be added again. This cannot be undone.", confirmLabel: "Approve and erase", cancelLabel: "Cancel", destructive: true });
    if (!ok) return;
    act.mutate({ id, kind: "approve" }, { onSuccess: () => toast.success("Approved. The creator is being erased."), onError: (e) => toast.error("Couldn't approve", e instanceof Error ? e.message : undefined) });
  }

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Creators" title="Data Removals" sub="Creators asking to be removed. Approving erases them for good and blocks their links; every decision is in the audit log." actions={
        <div className="flex gap-1">
          {(["received", "processed", "rejected"] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={`tab ${status === s ? "tab-on" : ""}`}>
              {s === "received" ? "Pending" : s === "processed" ? "Approved" : "Rejected"}
            </button>
          ))}
        </div>
      } />
      {list.isPending && <LoadingBlock lines={4} />}
      {list.isError && <ErrorState body={list.error instanceof Error ? list.error.message : undefined} onRetry={() => void list.refetch()} />}
      {list.data?.requests.length === 0 && <Empty title={status === "received" ? "No removal requests waiting" : "Nothing here yet"} body="New requests from the public removal form appear here." />}
      {list.data?.requests.map((r) => (
        <div key={r.id} className="rounded-2xl border border-slate-200/90 bg-white p-5 text-xs shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-bold text-slate-900">{r.creator ? `${r.creator.displayName} (@${r.creator.handle}, ${r.creator.platform})` : "No matching creator in MUSHIN"}</span>
            <span className="text-slate-400">{new Date(r.createdAt).toLocaleString()}</span>
            {r.emailMasked && <span className="ml-auto text-slate-500">{r.emailMasked}</span>}
          </div>
          <ul className="mt-2 space-y-0.5 text-slate-600">{r.urls.map((u) => <li key={u} className="break-all">{u}</li>)}</ul>
          {r.reason && <p className="mt-2 text-slate-600">“{r.reason}”</p>}
          {r.staffNote && <p className="mt-2 text-slate-500">Note: {r.staffNote}</p>}
          {r.status === "received" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={() => void approve(r.id, r.creator?.displayName ?? "this request's links")} disabled={act.isPending} className="btn btn-danger btn-sm">Approve and erase</button>
              <input value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} placeholder="Reason for rejecting" className="min-w-[220px] flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-200" />
              <button
                onClick={() => act.mutate({ id: r.id, kind: "reject", note: notes[r.id] ?? "" }, { onSuccess: () => toast.info("Rejected. The creator is visible again."), onError: (e) => toast.error("Couldn't reject", e instanceof Error ? e.message : undefined) })}
                disabled={act.isPending || (notes[r.id] ?? "").trim().length < 3}
                className="btn btn-outline btn-sm"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
