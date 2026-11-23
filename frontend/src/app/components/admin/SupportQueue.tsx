import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { approvalSchema, staffTicketDetailSchema, staffTicketListSchema } from "@mushin/contracts";
import type { AdminRole } from "../../admin/AdminAuthContext";
import { adminRequest } from "../../admin/adminApi";
import { useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { TicketAttachments } from "../dashboard/TicketAttachments";
import { Header } from "./OpsViews";
import { errText, needsKey, useStepUp } from "./staff-ui";

const STATUS = { open: "Open", in_progress: "In progress", waiting_on_customer: "Waiting on customer", resolved: "Resolved", closed: "Closed" } as const;
type Status = keyof typeof STATUS;
const TONE: Record<Status, string> = { open: "bg-cyan-50 text-cyan-800", in_progress: "bg-indigo-50 text-indigo-700", waiting_on_customer: "bg-amber-50 text-amber-800", resolved: "bg-emerald-50 text-emerald-700", closed: "bg-slate-100 text-slate-600" };
const PRIORITY = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" } as const;
type Priority = keyof typeof PRIORITY;
const PRIORITY_STYLE: Record<Priority, string> = { urgent: "bg-rose-50 text-rose-700 ring-rose-200", high: "bg-amber-50 text-amber-800 ring-amber-200", medium: "bg-slate-100 text-slate-600 ring-slate-200", low: "bg-white text-slate-500 ring-slate-200" };

/** Support queue (canonical spec page 20): tickets across workspaces; viewing and replying are audited by the API. */
export function SupportQueue({ me, canAssignOthers, role }: { me: string; canAssignOthers: boolean; role: AdminRole }) {
  const [status, setStatus] = useState<Status | "">("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority | "">("");
  const list = useQuery({ queryKey: ["admin", "tickets", status], queryFn: () => adminRequest(`/admin/v1/support/tickets${status ? `?status=${status}` : ""}`, staffTicketListSchema) });
  return (
    <div>
      <Header title="Tickets" sub="Customer requests, urgent first, then most recent. Replies are signed with your staff name." />
      <div className="mb-3 flex gap-1 text-xs" role="group" aria-label="Filter tickets">
        {(["open", "in_progress", "waiting_on_customer", "resolved", "closed", ""] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s} className={`tab ${status === s ? "tab-on" : ""}`}>{s ? STATUS[s] : "All"}</button>
        ))}
        <label className="ml-auto flex items-center gap-1 text-slate-600">Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority | "")} aria-label="Filter by priority" className="rounded-md border border-slate-200 px-1.5 py-1 text-xs">
            <option value="">All</option>
            {Object.entries(PRIORITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-4 lg:grid-cols-[24rem_1fr]">
        <div>
          {list.isPending ? <LoadingBlock lines={4} /> : list.isError ? <ErrorState body={list.error instanceof Error ? list.error.message : undefined} onRetry={() => void list.refetch()} /> : list.data.tickets.length === 0 ? <p className="text-sm text-slate-500">No tickets.</p> : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
              {list.data.tickets.filter((t) => !priority || t.priority === priority).map((t) => (
                <li key={t.id}>
                  <button onClick={() => setOpenId(t.id)} aria-current={openId === t.id} className={`block w-full px-4 py-3 text-left text-xs ${openId === t.id ? "bg-indigo-50/60" : "hover:bg-slate-50"}`}>
                    <div className="flex justify-between gap-2"><span className="truncate text-sm text-slate-900" style={{ fontWeight: 600 }}>{t.subject}</span><span className="flex shrink-0 items-center gap-1.5">{t.priority !== "medium" && <span className={`rounded px-1.5 py-0.5 text-[10px] ring-1 ${PRIORITY_STYLE[t.priority]}`} style={{ fontWeight: 600 }}>{PRIORITY[t.priority]}</span>}<span className="text-slate-500">{STATUS[t.status]}</span></span></div>
                    <div className="mt-0.5 text-slate-500">{t.workspaceName} · {t.category} · {t.messages} messages · {t.lastAuthor === "customer" ? "awaiting staff" : "staff replied"}{t.assignedStaffName ? ` · ${t.assignedStaffId === me ? "yours" : t.assignedStaffName}` : " · unassigned"}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {openId && <TicketPanel id={openId} me={me} canAssignOthers={canAssignOthers} role={role} />}
      </div>
    </div>
  );
}

function TicketPanel({ id, me, canAssignOthers, role }: { id: string; me: string; canAssignOthers: boolean; role: AdminRole }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin", "ticket", id], queryFn: () => adminRequest(`/admin/v1/support/tickets/${id}`, staffTicketDetailSchema), refetchInterval: 10_000 });
  const update = useMutation({
    mutationFn: (body: { body?: string; status?: Status }) => adminRequest(`/admin/v1/support/tickets/${id}`, staffTicketDetailSchema, { method: "PATCH", body }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["admin"] }),
  });
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const end = useRef<HTMLLIElement>(null);
  const count = q.data?.messages.length ?? 0;
  useEffect(() => end.current?.scrollIntoView({ block: "end", behavior: "smooth" }), [count]);
  /** One click: a reply (optional) and the status it leaves the request in. The customer is notified and emailed (0100). */
  const act = (status: Status, done: string, body?: string) =>
    update.mutate({ ...(body ? { body } : {}), status }, { onSuccess: () => { if (body) setText(""); toast.success(done); }, onError: (err) => toast.error("Couldn't update the request", err instanceof Error ? err.message : undefined) });
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
  const setPriority = async (priority: Priority) => {
    try {
      await adminRequest(`/admin/v1/support/tickets/${id}/priority`, staffTicketDetailSchema, { method: "PUT", body: { priority } });
      toast.success(`Priority set to ${PRIORITY[priority].toLowerCase()}`);
      void qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (err) {
      toast.error("Couldn't change the priority", errText(err));
    }
  };
  const addNote = useMutation({
    mutationFn: () => adminRequest(`/admin/v1/support/tickets/${id}/notes`, staffTicketDetailSchema, { method: "POST", body: { body: note.trim() } }),
    onSuccess: () => { setNote(""); void qc.invalidateQueries({ queryKey: ["admin", "ticket", id] }); toast.success("Internal note added"); },
    onError: (err) => toast.error("Couldn't add the note", errText(err)),
  });
  const [credits, setCredits] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [granting, setGranting] = useState(false);
  const amount = Number(credits);
  const creditOk = Number.isInteger(amount) && amount >= 1 && amount <= 100_000 && creditReason.trim().length >= 12;
  /**
   * Credits for this ticket's customer (owner directive 2026-11-03): a Super Admin's grant is approved in the same click
   * (0071); an Admin's goes to Approvals for a second person. Either way an internal note records it on the ticket.
   */
  const grantCredits = async (workspaceId: string) => {
    const withKey = async <T,>(run: () => Promise<T>): Promise<T> => {
      try {
        return await run();
      } catch (err) {
        if (needsKey(err) && (await step.confirm())) return run();
        throw err;
      }
    };
    setGranting(true);
    try {
      const reason = creditReason.trim();
      const req = await withKey(() => adminRequest("/admin/v1/approvals", approvalSchema, { method: "POST", body: { action: "credits.grant", payload: { workspaceId, amount, expiresInDays: 90 }, reason } }));
      const done = role === "super_admin" ? await withKey(() => adminRequest(`/admin/v1/approvals/${req.id}/decision`, approvalSchema, { method: "POST", body: { decision: "approve", note: `Support ticket ${id}` } })) : req;
      const added = done.status === "executed";
      await adminRequest(`/admin/v1/support/tickets/${id}/notes`, staffTicketDetailSchema, { method: "POST", body: { body: added ? `Added ${amount} credits (valid 90 days): ${reason}` : `Requested ${amount} credits for approval: ${reason}` } });
      if (added) toast.success(`Added ${amount} credits`, "They are available to the customer now and expire in 90 days.");
      else if (done.status === "failed") toast.error("Couldn't add the credits", typeof done.result?.["error"] === "string" ? done.result["error"] : undefined);
      else toast.info("Sent for approval", "Another admin approves it on the Approvals page.");
      setCredits("");
      setCreditReason("");
      void qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (err) {
      toast.error("Couldn't add the credits", errText(err));
    } finally {
      setGranting(false);
    }
  };
  if (q.isPending) return <LoadingBlock lines={5} />;
  if (q.isError) return <ErrorState body={q.error instanceof Error ? q.error.message : undefined} onRetry={() => void q.refetch()} />;
  const t = q.data;
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white" aria-label={t.subject}>
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[15px] font-bold text-slate-900">{t.subject}</h3>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${TONE[t.status]}`}>{STATUS[t.status]}</span>
            </div>
            <div className="text-[11.5px] text-slate-500">{t.workspaceName} · {t.category}</div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {t.status === "resolved" || t.status === "closed" ? (
              <button type="button" onClick={() => act("open", "Request reopened")} disabled={update.isPending} className="btn btn-soft btn-sm">Reopen</button>
            ) : (
              <button type="button" onClick={() => act("resolved", "Marked resolved; the customer was told")} disabled={update.isPending} className="btn btn-success btn-sm">Resolve</button>
            )}
            {t.status !== "closed" && <button type="button" onClick={() => act("closed", "Request closed; the customer was told")} disabled={update.isPending} className="btn btn-outline btn-sm">Close</button>}
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
          <label>Priority <select value={t.priority} onChange={(e) => void setPriority(e.target.value as Priority)} className="ml-1 rounded-md border border-slate-200 px-1.5 py-0.5">{Object.entries(PRIORITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <span>Assigned: {t.assignedStaffName ?? "nobody"}</span>
          {t.assignedStaffId !== me && <button onClick={() => void assign(me).catch((err: unknown) => toast.error("Couldn't take the ticket", errText(err)))} className="btn btn-outline btn-sm">Take it</button>}
          {canAssignOthers && staff.data && (
            <label>Assign to <select value={t.assignedStaffId ?? ""} onChange={(e) => void assign(e.target.value || null).catch((err: unknown) => toast.error("Couldn't assign the ticket", errText(err)))} className="ml-1 rounded-md border border-slate-200 px-1.5 py-0.5"><option value="">Nobody</option>{staff.data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          )}
        </div>
      </div>
      <ol className="max-h-[520px] space-y-4 overflow-y-auto bg-slate-50/60 p-4" aria-live="polite">
        {t.messages.map((m) =>
          m.authorKind === "internal" ? (
            <li key={m.id} className="mx-auto max-w-[90%] rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">
              <div className="mb-0.5 text-[10.5px] font-bold text-amber-800">Internal note · only staff see this · {m.authorName} · {new Date(m.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ) : (
            <li key={m.id} className={`flex items-end gap-2.5 ${m.authorKind === "staff" ? "flex-row-reverse" : ""}`}>
              <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${m.authorKind === "staff" ? "bg-[#131b2e] text-[#4cd7f6]" : "bg-cyan-100 text-[#00687a]"}`}>{(m.authorName.trim()[0] ?? "?").toUpperCase()}</span>
              <div className={`flex max-w-[78%] flex-col gap-1 ${m.authorKind === "staff" ? "items-end" : "items-start"}`}>
                <div className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm ${m.authorKind === "staff" ? "rounded-br-sm bg-[#131b2e] text-white" : "rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200/70"}`}>{m.body}</div>
                <span className="px-1 text-[10.5px] text-slate-500">{m.authorName} · {new Date(m.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
            </li>
          ),
        )}
        <li ref={end} aria-hidden className="h-px" />
      </ol>
      <div className="border-t border-slate-100 p-3">
        <TicketAttachments base={`/admin/v1/support/tickets/${id}/attachments`} request={adminRequest} canUpload queryKey={["admin", "ticket-attachments", id]} />
      </div>
      {canAssignOthers && (
        <form
          className="flex flex-wrap items-center gap-2 border-t border-slate-100 p-3 text-xs"
          aria-label="Credits for this customer"
          onSubmit={(e) => {
            e.preventDefault();
            if (creditOk && !granting) void grantCredits(t.workspaceId);
          }}
        >
          <span className="text-slate-700" style={{ fontWeight: 600 }}>Credits</span>
          <input value={credits} onChange={(e) => setCredits(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} inputMode="numeric" aria-label="Credits to add" placeholder="Amount" className="w-24 rounded-md border border-slate-200 px-2 py-1.5" />
          <input value={creditReason} onChange={(e) => setCreditReason(e.target.value)} maxLength={1000} aria-label="Reason for the credits" placeholder="Reason, e.g. refund for a failed search (12+ characters)" className="min-w-[220px] flex-1 rounded-md border border-slate-200 px-2 py-1.5" />
          <button type="submit" disabled={!creditOk || granting} className="btn btn-primary btn-sm" style={{ fontWeight: 600 }}>
            {granting ? "Working…" : role === "super_admin" ? "Add credits" : "Request credits"}
          </button>
        </form>
      )}
      <form className="flex gap-2 border-t border-slate-100 p-3" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} aria-label="Internal note" placeholder="Internal note for staff (the customer never sees it)" className="flex-1 rounded-md border border-dashed border-amber-300 bg-amber-50/40 px-2.5 py-1.5 text-xs" />
        <button type="submit" disabled={!note.trim() || addNote.isPending} className="btn btn-warn btn-sm">Add note</button>
      </form>
      <form className="border-t border-slate-100 p-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) act("waiting_on_customer", "Reply sent; the customer was notified", text.trim()); }}>
        <div className="rounded-2xl bg-slate-100 p-2.5 transition-shadow focus-within:bg-white focus-within:shadow-md focus-within:ring-2 focus-within:ring-cyan-400/40">
          <textarea
            rows={3}
            maxLength={5000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) { e.preventDefault(); act("waiting_on_customer", "Reply sent; the customer was notified", text.trim()); } }}
            aria-label="Reply to the customer"
            placeholder="Reply to the customer… (Ctrl + Enter to send)"
            className="w-full resize-y bg-transparent px-1.5 py-1 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <div className="mt-1.5 flex flex-wrap items-center justify-end gap-2">
            <button type="button" disabled={!text.trim() || update.isPending} onClick={() => act("resolved", "Reply sent and request resolved", text.trim())} className="btn btn-success btn-sm">Send and resolve</button>
            <button type="submit" disabled={!text.trim() || update.isPending} className="btn btn-primary btn-sm">{update.isPending ? "Sending…" : "Send reply"}</button>
          </div>
        </div>
      </form>
    </section>
  );
}
