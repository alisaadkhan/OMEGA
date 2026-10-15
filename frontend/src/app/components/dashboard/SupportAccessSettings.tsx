import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supportAccessListSchema, supportAccessSchema, type SupportAccess } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "./states";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
const LABEL: Record<SupportAccess["status"], string> = { requested: "Waiting for your answer", granted: "Access granted", declined: "Declined", ended: "Ended", expired: "Expired" };

/** Requests from MUSHIN support to view this workspace read-only (owner and admins decide). */
export function useSupportAccess(enabled: boolean) {
  const { status } = useAuth();
  return useQuery({ queryKey: ["support-access"], queryFn: () => apiRequest("/v1/support/access-requests", supportAccessListSchema), enabled: enabled && status === "signedIn", refetchInterval: 60_000 });
}

/**
 * Consented support access (settings): MUSHIN staff can see this workspace only after you grant it, read-only, for up
 * to 60 minutes, and you can end it at any time. They never see your credit balance, contacts you revealed or notes.
 */
export function SupportAccessSettings({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [minutes, setMinutes] = useState(30);
  const q = useSupportAccess(canManage);
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "grant" | "decline" | "end" }) => apiRequest(`/v1/support/access-requests/${id}/${action}`, supportAccessSchema, { method: "POST", body: action === "grant" ? { minutes } : {} }),
    onSuccess: (r) => { toast.success(r.status === "granted" ? `Access granted until ${when(r.expiresAt)}` : r.status === "ended" ? "Access ended" : "Request declined"); void qc.invalidateQueries({ queryKey: ["support-access"] }); },
    onError: (err) => toast.error("That didn't work", err instanceof Error ? err.message : undefined),
  });
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
      <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Support access</div>
      <p>MUSHIN support can look at this workspace only if you agree: read-only, for the time you choose (up to 60 minutes). They cannot change, buy, export or send anything, and they never see your credit balance, revealed contacts or notes. You can end access at any time.</p>
      {!canManage ? <p className="text-xs text-slate-500">Only the workspace owner or an admin can answer support access requests.</p> : q.isPending ? <LoadingBlock lines={2} /> : q.isError ? <ErrorState body={q.error instanceof Error ? q.error.message : undefined} onRetry={() => void q.refetch()} /> : q.data.requests.length === 0 ? <p className="text-xs text-slate-500">No requests from support.</p> : (
        <ul className="space-y-2">
          {q.data.requests.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-200 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-900" style={{ fontWeight: 600 }}>{r.staffName}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${r.status === "granted" ? "bg-violet-100 text-violet-800" : r.status === "requested" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600"}`}>{LABEL[r.status]}</span>
                <span className="ml-auto text-slate-500">asked {when(r.createdAt)}</span>
              </div>
              <p className="mt-1 text-slate-700">“{r.purpose}”</p>
              {r.status === "granted" && <p className="mt-1 text-slate-500">Access ends {when(r.expiresAt)}.</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {r.status === "requested" && (
                  <>
                    <label className="text-slate-600">For <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="ml-1 rounded-md border border-slate-200 px-1.5 py-1">{[15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></label>
                    <button disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, action: "grant" })} className="rounded-md bg-slate-900 px-2.5 py-1 text-white disabled:opacity-50" style={{ fontWeight: 600 }}>Grant read-only access</button>
                    <button disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, action: "decline" })} className="rounded-md border border-slate-200 px-2.5 py-1">Decline</button>
                  </>
                )}
                {r.status === "granted" && <button disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, action: "end" })} className="rounded-md border border-red-200 px-2.5 py-1 text-red-700">End access now</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A banner in the app while a request waits or access is active, so the workspace always knows. */
export function SupportAccessBanner({ canManage, onOpen }: { canManage: boolean; onOpen: () => void }) {
  const q = useSupportAccess(canManage);
  const live = q.data?.requests.find((r) => r.status === "granted");
  const waiting = q.data?.requests.filter((r) => r.status === "requested").length ?? 0;
  if (!live && waiting === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-2 px-4 py-2 text-xs ${live ? "bg-violet-700 text-white" : "bg-amber-50 text-amber-900"}`} role="status">
      {live ? <span><span style={{ fontWeight: 600 }}>{live.staffName}</span> from MUSHIN support can view this workspace (read-only) until {when(live.expiresAt)}.</span> : <span>MUSHIN support asked to view this workspace ({waiting} request{waiting > 1 ? "s" : ""}).</span>}
      <button onClick={onOpen} className={`ml-auto rounded-md px-2.5 py-1 ${live ? "bg-white/15 hover:bg-white/25" : "border border-amber-300 hover:bg-amber-100"}`} style={{ fontWeight: 600 }}>{live ? "Manage access" : "Review request"}</button>
    </div>
  );
}
