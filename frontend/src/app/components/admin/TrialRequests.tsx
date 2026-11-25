import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trialApprovalResultSchema, trialFeedbackListSchema, trialRequestListSchema, trialRequestSchema, type TrialRequest } from "@mushin/contracts";
import type { AdminRole } from "../../admin/AdminAuthContext";
import { adminRequest } from "../../admin/adminApi";
import { formatTrialDate } from "../../api/trial";
import { useConfirm, useToast } from "../../lib/toast";
import { csvCell } from "../../lib/csv";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { Empty, PageHeader } from "../staff/kit";

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
    const ok = await confirm({ title: `Start a 14-day trial for ${accountEmail}?`, body: "Their own account gets 2,500 trial credits for 14 days. Nothing is charged when it ends. A person can have one free trial.", confirmLabel: "Approve trial", cancelLabel: "Cancel" });
    if (!ok) return;
    approve.mutate(
      { id: r.id, accountEmail, note: notes[r.id]?.trim() || undefined },
      { onSuccess: (res) => toast.success("Trial started", `${formatTrialDate(res.trialStartedAt)} to ${formatTrialDate(res.trialEndsAt)}`), onError: (e) => toast.error("Couldn't approve", e instanceof Error ? e.message : undefined) },
    );
  }

  function downloadCsv() {
    const rows = feedback.data?.feedback ?? [];
    const head = ["createdAt", "workspaceName", "searchQuality", "contactAccuracy", "easeOfUse", "savedTime", "wouldPay", "preferredPlan", "missingFeatures", "comments"] as const;
    // Feedback is customer-written: a cell starting with = or + must not run as a formula in staff's spreadsheet.
    const csv = [head.join(","), ...rows.map((r) => head.map((h) => csvCell(r[h])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `mushin-trial-feedback-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Growth" title="Trials & Stats" sub="Call-back requests from the landing page, trial decisions and what trial accounts told us." actions={owner && (
          <div className="flex gap-1">
            {(["requests", "feedback"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`tab ${tab === t ? "tab-on" : ""}`}>{t === "requests" ? "Requests" : "Feedback"}</button>
            ))}
          </div>
        )} />

      {tab === "requests" && (
        <>
          <div className="flex gap-1">
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <button key={s} onClick={() => setStatus(s)} className={`tab ${status === s ? "tab-on" : ""}`}>{STATUS_LABEL[s]}</button>
            ))}
          </div>
          {list.isPending && <LoadingBlock lines={4} />}
          {list.isError && <ErrorState body={list.error instanceof Error ? list.error.message : undefined} onRetry={() => void list.refetch()} />}
          {list.data?.requests.length === 0 && <Empty title={`No ${STATUS_LABEL[status].toLowerCase()} requests`} body="Requests from Apply for Early Access appear here." />}
          {list.data?.requests.map((r) => (
            <div key={r.id} className="space-y-2 rounded-2xl border border-slate-200/90 bg-white p-5 text-xs shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-bold text-slate-900">{r.contactName} · {r.businessName}</span>
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
                    <button onClick={() => contacted.mutate(r.id, { onError: (e) => toast.error("Couldn't update", e instanceof Error ? e.message : undefined) })} className="btn btn-outline btn-sm">Mark as called</button>
                  )}
                  {owner && (
                    <>
                      <input aria-label="Account email" placeholder="Email they signed up with" value={emails[r.id] ?? r.email ?? ""} onChange={(e) => setEmails((p) => ({ ...p, [r.id]: e.target.value }))} className="min-w-52 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-200" />
                      <input aria-label="Note" placeholder="Note (required to reject)" value={notes[r.id] ?? ""} onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))} className="min-w-40 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-200" />
                      <button disabled={approve.isPending} onClick={() => void onApprove(r)} className="btn btn-success btn-sm">Approve trial</button>
                      <button
                        disabled={reject.isPending || !notes[r.id]?.trim()}
                        onClick={() => reject.mutate({ id: r.id, note: notes[r.id]?.trim() ?? "" }, { onSuccess: () => toast.success("Request rejected"), onError: (e) => toast.error("Couldn't reject", e instanceof Error ? e.message : undefined) })}
                        className="btn btn-danger-outline btn-sm"
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
            <p className="text-xs text-slate-500">Answers from trial accounts, newest first. Only real customer answers are stored here.</p>
            <button onClick={downloadCsv} disabled={!feedback.data?.feedback.length} className="btn btn-outline btn-sm">Download CSV</button>
          </div>
          {feedback.isPending && <LoadingBlock lines={4} />}
          {feedback.isError && <ErrorState body={feedback.error instanceof Error ? feedback.error.message : undefined} onRetry={() => void feedback.refetch()} />}
          {feedback.data?.feedback.length === 0 && <Empty title="No feedback yet" body="Answers from trial accounts appear here." />}
          {feedback.data?.feedback.map((f) => (
            <div key={f.id} className="rounded-2xl border border-slate-200/90 bg-white p-5 text-xs shadow-[0_1px_2px_rgba(15,23,42,0.03)] text-slate-700">
              <div className="flex justify-between"><span className="text-[13px] font-bold text-slate-900">{f.workspaceName}</span><span className="text-slate-400">{formatTrialDate(f.createdAt)}</span></div>
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
