import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { staffTicketDetailSchema, staffTicketListSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { Header } from "./OpsViews";
import { errText, needsKey, useStepUp } from "./staff-ui";

const STATUS = { open: "Open", waiting_on_customer: "Waiting on customer", resolved: "Resolved", closed: "Closed" } as const;
type Status = keyof typeof STATUS;

/** Support queue (canonical spec page 20): tickets across workspaces; viewing and replying are audited by the API. */
export function SupportQueue({ me, canAssignOthers }: { me: string; canAssignOthers: boolean }) {
  const [status, setStatus] = useState<Status | "">("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["admin", "tickets", status], queryFn: () => adminRequest(`/admin/v1/support/tickets${status ? `?status=${status}` : ""}`, staffTicketListSchema) });
  return (
    <div>
      <Header title="Support queue" sub="Customer requests, most recent first. Replies are signed with your staff name." />
      <div className="mb-3 flex gap-1 text-xs" role="group" aria-label="Filter tickets">
        {(["open", "waiting_on_customer", "resolved", "closed", ""] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s} className={`rounded-md px-2.5 py-1 ${status === s ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-700"}`}>{s ? STATUS[s] : "All"}</button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[24rem_1fr]">
        <div>
          {list.isPending ? <LoadingBlock lines={4} /> : list.isError ? <ErrorState body={list.error instanceof Error ? list.error.message : undefined} onRetry={() => void list.refetch()} /> : list.data.tickets.length === 0 ? <p className="text-sm text-slate-500">No tickets.</p> : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {list.data.tickets.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setOpenId(t.id)} aria-current={openId === t.id} className={`block w-full px-4 py-3 text-left text-xs ${openId === t.id ? "bg-indigo-50/60" : "hover:bg-slate-50"}`}>
                    <div className="flex justify-between gap-2"><span className="truncate text-sm text-slate-900" style={{ fontWeight: 600 }}>{t.subject}</span><span className="shrink-0 text-slate-500">{STATUS[t.status]}</span></div>
                    <div className="mt-0.5 text-slate-500">{t.workspaceName} · {t.category} · {t.messages} messages · {t.lastAuthor === "customer" ? "awaiting staff" : "staff replied"}{t.assignedStaffName ? ` · ${t.assignedStaffId === me ? "yours" : t.assignedStaffName}` : " · unassigned"}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {openId && <TicketPanel id={openId} me={me} canAssignOthers={canAssignOthers} />}
      </div>
    </div>
  );
}

function TicketPanel({ id, me, canAssignOthers }: { id: string; me: string; canAssignOthers: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin", "ticket", id], queryFn: () => adminRequest(`/admin/v1/support/tickets/${id}`, staffTicketDetailSchema) });
  const update = useMutation({
    mutationFn: (body: { body?: string; status?: Status }) => adminRequest(`/admin/v1/support/tickets/${id}`, staffTicketDetailSchema, { method: "PATCH", body }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["admin"] }),
  });
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [next, setNext] = useState<Status>("waiting_on_customer");
  const step = useStepUp();
  const staff = useQuery({ queryKey: ["admin", "assignable"], queryFn: () => adminRequest("/admin/v1/staff/assignable", z.object({ staff: z.array(z.object({ id: z.uuid(), name: z.string() })) })), enabled: canAssignOthers });
  const assign = async (assigneeId: string | null) => {
    const run = () => adminRequest(`/admin/v1/support/tickets/${id}/assignee`, staffTicketDetailSchema, { method: "PUT", body: { assigneeId } });
    try {
      await run();
    } catch (err) {
      if (needsKey(err) && (await step.confirm())) await run();
      else throw err;
    }
    void qc.invalidateQueries({ queryKey: ["admin"] });
  };
  const addNote = useMutation({
    mutationFn: () => adminRequest(`/admin/v1/support/tickets/${id}/notes`, staffTicketDetailSchema, { method: "POST", body: { body: note.trim() } }),
    onSuccess: () => { setNote(""); void qc.invalidateQueries({ queryKey: ["admin", "ticket", id] }); toast.success("Internal note added"); },
    onError: (err) => toast.error("Couldn't add the note", errText(err)),
  });
  if (q.isPending) return <LoadingBlock lines={5} />;
  if (q.isError) return <ErrorState body={q.error instanceof Error ? q.error.message : undefined} onRetry={() => void q.refetch()} />;
  const t = q.data;
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label={t.subject}>
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>{t.subject}</div>
        <div className="text-[11px] text-slate-500">{t.workspaceName} · {t.category} · {STATUS[t.status]}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
          <span>Assigned: {t.assignedStaffName ?? "nobody"}</span>
          {t.assignedStaffId !== me && <button onClick={() => void assign(me).catch((err: unknown) => toast.error("Couldn't take the ticket", errText(err)))} className="rounded-md border border-slate-200 px-2 py-0.5 hover:bg-slate-50">Take it</button>}
          {canAssignOthers && staff.data && (
            <label>Assign to <select value={t.assignedStaffId ?? ""} onChange={(e) => void assign(e.target.value || null).catch((err: unknown) => toast.error("Couldn't assign the ticket", errText(err)))} className="ml-1 rounded-md border border-slate-200 px-1.5 py-0.5"><option value="">Nobody</option>{staff.data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          )}
        </div>
      </div>
      <ol className="space-y-3 p-4">
        {t.messages.map((m) => (
          <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.authorKind === "internal" ? "ml-auto border border-dashed border-amber-300 bg-amber-50" : m.authorKind === "staff" ? "ml-auto bg-indigo-50" : "bg-slate-100"}`}>
            <div className="text-[11px] text-slate-500">{m.authorKind === "internal" && <span className="mr-1 text-amber-800" style={{ fontWeight: 600 }}>Internal note · not visible to the customer ·</span>}<span style={{ fontWeight: 600 }}>{m.authorName}</span> · {new Date(m.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div>
            <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      <form className="flex gap-2 border-t border-slate-100 p-3" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} aria-label="Internal note" placeholder="Internal note for staff (the customer never sees it)" className="flex-1 rounded-md border border-dashed border-amber-300 bg-amber-50/40 px-2.5 py-1.5 text-xs" />
        <button type="submit" disabled={!note.trim() || addNote.isPending} className="rounded-md border border-amber-300 px-3 py-1.5 text-xs text-amber-900 disabled:opacity-50">Add note</button>
      </form>
      <form
        className="space-y-2 border-t border-slate-100 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ ...(text.trim() ? { body: text.trim() } : {}), status: next }, { onSuccess: () => { setText(""); toast.success("Ticket updated"); }, onError: (err) => toast.error("Couldn't update the ticket", err instanceof Error ? err.message : undefined) });
        }}
      >
        <textarea rows={3} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} aria-label="Reply" placeholder="Reply to the customer (optional when only changing status)" className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm" />
        <div className="flex items-center justify-end gap-2 text-xs">
          <label className="text-slate-600">Set status <select value={next} onChange={(e) => setNext(e.target.value as Status)} className="ml-1 rounded-md border border-slate-200 px-1.5 py-1 text-xs">{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <button type="submit" disabled={update.isPending} className="rounded-md bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50" style={{ fontWeight: 600 }}>{text.trim() ? "Send reply" : "Update status"}</button>
        </div>
      </form>
    </section>
  );
}
