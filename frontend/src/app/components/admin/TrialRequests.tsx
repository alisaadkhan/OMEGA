import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trialApprovalResultSchema, trialFeedbackListSchema, trialRequestListSchema, trialRequestSchema, type TrialRequest } from "@mushin/contracts";
import type { AdminRole } from "../../admin/AdminAuthContext";
import { adminRequest } from "../../admin/adminApi";
import { formatTrialDate } from "../../api/trial";
import { useConfirm, useToast } from "../../lib/toast";

type Status = TrialRequest["status"];
const STATUS_LABEL: Record<Status, string> = { new: "New", contacted: "Contacted", approved: "Approved", rejected: "Rejected" };
const WINDOW_LABEL: Record<TrialRequest["callbackWindow"], string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", anytime: "Any time" };

/**
 * Founder-assisted trial queue (mandate v4 Phase 3). Everyone calls people back and records it; only Super Admins
 * approve or reject, and the API enforces that (with the hardware-key step-up) whatever this screen shows.
 */
export function TrialRequests({ role }: { role: AdminRole }) {
  const owner = role === "super_admin";
  const [status, setStatus] = useState<Status>("new");
  const [tab, setTab] = useState<"requests" | "feedback">("requests");
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const list = useQuery({ queryKey: ["admin", "trials", status], queryFn: () => adminRequest(`/admin/v1/trial-requests?status=${status}`, trialRequestListSchema), enabled: tab === "requests" });
  const feedback = useQuery({ queryKey: ["admin", "trial-feedback"], queryFn: () => adminRequest("/admin/v1/trial-feedback", trialFeedbackListSchema), enabled: owner && tab === "feedback" });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin", "trials"] });
  const contacted = useMutation({ mutationFn: (id: string) => adminRequest(`/admin/v1/trial-requests/${id}/contacted`, trialRequestSchema, { method: "POST" }), onSettled: refresh });
  const approve = useMutation({
    mutationFn: (a: { id: string; accountEmail: string; note?: string }) =>
      adminRequest(`/admin/v1/trial-requests/${a.id}/approve`, trialApprovalResultSchema, { method: "POST", body: { accountEmail: a.accountEmail, note: a.note } }),
    onSettled: refresh,
  });
  const reject = useMutation({ mutationFn: (a: { id: string; note: string }) => adminRequest(`/admin/v1/trial-requests/${a.id}/reject`, trialRequestSchema, { method: "POST", body: { note: a.note } }), onSettled: refresh });

  async function onApprove(r: TrialRequest) {
    const accountEmail = (emails[r.id] ?? r.email ?? "").trim();
    if (!accountEmail) return toast.error("Enter the email the person signed up with");
    const ok = await confirm({ title: `Start a 14-day trial for ${accountEmail}?`, body: "Their own workspace gets 2,500 trial credits for 14 days. Nothing is charged when it ends. A person can have one free trial.", confirmLabel: "Approve trial", cancelLabel: "Cancel" });
    if (!ok) return;
    approve.mutate(
      { id: r.id, accountEmail, note: notes[r.id]?.trim() || undefined },
      { onSuccess: (res) => toast.success("Trial started", `${formatTrialDate(res.trialStartedAt)} to ${formatTrialDate(res.trialEndsAt)}`), onError: (e) => toast.error("Couldn't approve", e instanceof Error ? e.message : undefined) },
    );
  }

  function downloadCsv() {
    const rows = feedback.data?.feedback ?? [];
    const head = ["createdAt", "workspaceName", "searchQuality", "contactAccuracy", "easeOfUse", "savedTime", "wouldPay", "preferredPlan", "missingFeatures", "comments"] as const;
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [head.join(","), ...rows.map((r) => head.map((h) => cell(r[h])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `mushin-trial-feedback-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-slate-900" style={{ fontSize: 16, fontWeight: 600 }}>Trial requests</h2>
        {owner && (
          <div className="flex gap-1">
            {(["requests", "feedback"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-md px-2.5 py-1 text-xs ${tab === t ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>{t === "requests" ? "Requests" : "Feedback"}</button>
            ))}
          </div>
        )}
      </div>

      {tab === "requests" && (
        <>
          <div className="flex gap-1">
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <button key={s} onClick={() => setStatus(s)} className={`rounded-md px-2.5 py-1 text-xs ${status === s ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>{STATUS_LABEL[s]}</button>
            ))}
          </div>
          {list.isError && <p className="text-xs text-red-600">{list.error instanceof Error ? list.error.message : "Couldn't load requests."}</p>}
          {list.data?.requests.length === 0 && <p className="text-xs text-slate-500">No requests here.</p>}
          {list.data?.requests.map((r) => (
            <div key={r.id} className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-900" style={{ fontWeight: 600 }}>{r.contactName} · {r.businessName}</span>
                <span className="text-slate-400">{formatTrialDate(r.createdAt)}</span>
                <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{STATUS_LABEL[r.status]}</span>
              </div>
              <div className="text-slate-600">
                {r.phone && <a href={`tel:${r.phone.replace(/[\s()-]/g, "")}`} className="mr-3 underline">{r.phone}</a>}
                {r.email && <a href={`mailto:${r.email}`} className="mr-3 underline">{r.email}</a>}
                Call: {WINDOW_LABEL[r.callbackWindow]}
              </div>
              {r.useCase && <p className="text-slate-600">“{r.useCase}”</p>}
              {r.decidedAt && <p className="text-slate-500">{STATUS_LABEL[r.status]} by {r.decidedBy} on {formatTrialDate(r.decidedAt)}{r.decisionNote ? `: ${r.decisionNote}` : ""}</p>}
              {(r.status === "new" || r.status === "contacted") && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {r.status === "new" && (
                    <button onClick={() => contacted.mutate(r.id, { onError: (e) => toast.error("Couldn't update", e instanceof Error ? e.message : undefined) })} className="rounded-md bg-white px-2.5 py-1 ring-1 ring-slate-200 hover:bg-slate-50">Mark as called</button>
                  )}
                  {owner && (
                    <>
                      <input aria-label="Account email" placeholder="Email they signed up with" value={emails[r.id] ?? r.email ?? ""} onChange={(e) => setEmails((p) => ({ ...p, [r.id]: e.target.value }))} className="min-w-52 flex-1 rounded-md border border-slate-200 px-2 py-1" />
                      <input aria-label="Note" placeholder="Note (required to reject)" value={notes[r.id] ?? ""} onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))} className="min-w-40 flex-1 rounded-md border border-slate-200 px-2 py-1" />
                      <button disabled={approve.isPending} onClick={() => void onApprove(r)} className="rounded-md bg-slate-900 px-2.5 py-1 text-white hover:bg-slate-800 disabled:opacity-50">Approve trial</button>
                      <button
                        disabled={reject.isPending || !notes[r.id]?.trim()}
                        onClick={() => reject.mutate({ id: r.id, note: notes[r.id]?.trim() ?? "" }, { onSuccess: () => toast.success("Request rejected"), onError: (e) => toast.error("Couldn't reject", e instanceof Error ? e.message : undefined) })}
                        className="rounded-md bg-white px-2.5 py-1 text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {owner && tab === "feedback" && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">Answers from trial workspaces, newest first. Only real customer answers are stored here.</p>
            <button onClick={downloadCsv} disabled={!feedback.data?.feedback.length} className="rounded-md bg-white px-2.5 py-1 text-xs ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">Download CSV</button>
          </div>
          {feedback.isError && <p className="text-xs text-red-600">{feedback.error instanceof Error ? feedback.error.message : "Couldn't load feedback."}</p>}
          {feedback.data?.feedback.length === 0 && <p className="text-xs text-slate-500">No feedback yet.</p>}
          {feedback.data?.feedback.map((f) => (
            <div key={f.id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
              <div className="flex justify-between"><span style={{ fontWeight: 600 }}>{f.workspaceName}</span><span className="text-slate-400">{formatTrialDate(f.createdAt)}</span></div>
              <p className="mt-1">Search {f.searchQuality ?? "–"}/5 · Contacts {f.contactAccuracy ?? "–"}/5 · Ease {f.easeOfUse ?? "–"}/5 · Saved time: {f.savedTime ?? "–"} · Would pay: {f.wouldPay ?? "–"} · Plan: {f.preferredPlan ?? "–"}</p>
              {f.missingFeatures && <p className="mt-1">Missing: {f.missingFeatures}</p>}
              {f.comments && <p className="mt-1">{f.comments}</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
