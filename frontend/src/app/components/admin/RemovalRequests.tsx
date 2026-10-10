import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { staffRemovalListSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { useConfirm, useToast } from "../../lib/toast";

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
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-slate-900" style={{ fontSize: 16, fontWeight: 600 }}>Removal requests</h2>
        <div className="flex gap-1">
          {(["received", "processed", "rejected"] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={`rounded-md px-2.5 py-1 text-xs ${status === s ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
              {s === "received" ? "Pending" : s === "processed" ? "Approved" : "Rejected"}
            </button>
          ))}
        </div>
      </div>
      {list.isError && <p className="text-xs text-red-600">{list.error instanceof Error ? list.error.message : "Couldn't load requests."}</p>}
      {list.data?.requests.length === 0 && <p className="text-xs text-slate-500">No requests here.</p>}
      {list.data?.requests.map((r) => (
        <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-4 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-900" style={{ fontWeight: 600 }}>{r.creator ? `${r.creator.displayName} (@${r.creator.handle}, ${r.creator.platform})` : "No matching creator in MUSHIN"}</span>
            <span className="text-slate-400">{new Date(r.createdAt).toLocaleString()}</span>
            {r.emailMasked && <span className="ml-auto text-slate-500">{r.emailMasked}</span>}
          </div>
          <ul className="mt-2 space-y-0.5 text-slate-600">{r.urls.map((u) => <li key={u} className="break-all">{u}</li>)}</ul>
          {r.reason && <p className="mt-2 text-slate-600">“{r.reason}”</p>}
          {r.staffNote && <p className="mt-2 text-slate-500">Note: {r.staffNote}</p>}
          {r.status === "received" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={() => void approve(r.id, r.creator?.displayName ?? "this request's links")} disabled={act.isPending} className="rounded-md bg-red-600 px-3 py-1.5 text-white hover:bg-red-700 disabled:opacity-50">Approve and erase</button>
              <input value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} placeholder="Reason for rejecting" className="min-w-[220px] flex-1 rounded-md border border-slate-200 px-2 py-1.5" />
              <button
                onClick={() => act.mutate({ id: r.id, kind: "reject", note: notes[r.id] ?? "" }, { onSuccess: () => toast.info("Rejected. The creator is visible again."), onError: (e) => toast.error("Couldn't reject", e instanceof Error ? e.message : undefined) })}
                disabled={act.isPending || (notes[r.id] ?? "").trim().length < 3}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
