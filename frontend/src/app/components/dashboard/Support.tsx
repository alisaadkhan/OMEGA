import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, Plus } from "lucide-react";
import { createTicketSchema, ticketDetailSchema, ticketListSchema, ticketSummarySchema, type CreateTicket, type TicketSummary } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { relative } from "../../lib/time";
import { useToast } from "../../lib/toast";
import { EmptyState, ErrorState, LoadingBlock } from "./states";
import { TrialFeedback } from "./TrialFeedback";

const CATEGORY = { search: "Search", discovery: "Find New Creators", billing: "Billing & credits", account: "Account", data_removal: "Data removal", other: "Other" } as const;
export const TICKET_STATUS = { open: "Open", in_progress: "In progress", waiting_on_customer: "Waiting for you", resolved: "Resolved", closed: "Closed" } as const;
const TONE = { open: "bg-sky-50 text-sky-700", in_progress: "bg-indigo-50 text-indigo-700", waiting_on_customer: "bg-amber-50 text-amber-800", resolved: "bg-emerald-50 text-emerald-700", closed: "bg-slate-100 text-slate-600" } as const;

function useTicketMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => void qc.invalidateQueries({ queryKey: ["support"] }) });
}

/** Support requests (canonical spec page 15): your workspace's conversations with MUSHIN support, stored on the server. */
export function Support() {
  const { status } = useAuth();
  const list = useQuery({ queryKey: ["support", "list"], queryFn: () => apiRequest("/v1/support/tickets", ticketListSchema), enabled: status === "signedIn" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-semibold leading-10 tracking-[-0.025em] text-slate-900">Support</h1>
          <p className="mt-1 text-sm text-slate-500">Ask MUSHIN support about search, Find New Creators, billing or your account. Replies appear here.</p>
        </div>
        <button onClick={() => { setCreating(true); setOpenId(null); }} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm text-white hover:bg-slate-800" style={{ fontWeight: 600 }}>
          <Plus className="h-4 w-4" /> New request
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div>
          {list.isPending ? <LoadingBlock lines={4} /> : list.isError ? <ErrorState body={list.error instanceof Error ? list.error.message : undefined} onRetry={() => void list.refetch()} /> : list.data.tickets.length === 0 ? (
            <EmptyState icon={<LifeBuoy className="h-5 w-5" />} title="No support requests" body="Start one with New request." />
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
              {list.data.tickets.map((t) => <TicketRow key={t.id} t={t} active={t.id === openId} onOpen={() => { setOpenId(t.id); setCreating(false); }} />)}
            </ul>
          )}
        </div>
        <div>{creating ? <NewTicket onCreated={(id) => { setCreating(false); setOpenId(id); }} onCancel={() => setCreating(false)} /> : openId ? <TicketThread id={openId} /> : null}</div>
      </div>
      <TrialFeedback />
    </div>
  );
}

function TicketRow({ t, active, onOpen }: { t: TicketSummary; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button onClick={onOpen} aria-current={active} className={`block w-full px-4 py-3 text-left ${active ? "bg-indigo-50/60" : "hover:bg-slate-50"}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-slate-900" style={{ fontWeight: 600 }}>{t.subject}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${TONE[t.status]}`} style={{ fontWeight: 600 }}>{TICKET_STATUS[t.status]}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-slate-500">{CATEGORY[t.category]} · {t.messages} message{t.messages === 1 ? "" : "s"} · {t.lastAuthor === "staff" ? "Support replied" : "You wrote"} {relative(t.lastMessageAt)}</div>
      </button>
    </li>
  );
}

function NewTicket({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [v, setV] = useState<CreateTicket>({ subject: "", category: "discovery", body: "" });
  const create = useTicketMutation((body: CreateTicket) => apiRequest("/v1/support/tickets", ticketDetailSchema, { method: "POST", body }));
  const toast = useToast();
  const valid = createTicketSchema.safeParse(v).success;
  const field = "mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none";
  return (
    <form className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4" onSubmit={(e) => { e.preventDefault(); create.mutate(v, { onSuccess: (t) => { toast.success("Request sent", "We'll reply here."); onCreated(t.id); }, onError: (err) => toast.error("Couldn't send the request", err instanceof Error ? err.message : undefined) }); }}>
      <label className="block text-xs text-slate-600" style={{ fontWeight: 600 }}>Subject<input autoFocus maxLength={160} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} className={field} /></label>
      <label className="block text-xs text-slate-600" style={{ fontWeight: 600 }}>Topic
        <select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as CreateTicket["category"] })} className={field}>
          {Object.entries(CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label className="block text-xs text-slate-600" style={{ fontWeight: 600 }}>What happened?<textarea rows={6} maxLength={5000} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} className={field} /></label>
      <p className="text-[11px] text-slate-500">Don't include passwords or payment card details. Support staff see your workspace name and this conversation.</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100">Cancel</button>
        <button type="submit" disabled={!valid || create.isPending} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50" style={{ fontWeight: 600 }}>{create.isPending ? "Sending…" : "Send request"}</button>
      </div>
    </form>
  );
}

function TicketThread({ id }: { id: string }) {
  const { status } = useAuth();
  const q = useQuery({ queryKey: ["support", "detail", id], queryFn: () => apiRequest(`/v1/support/tickets/${id}`, ticketDetailSchema), enabled: status === "signedIn" });
  const reply = useTicketMutation((body: string) => apiRequest(`/v1/support/tickets/${id}/messages`, ticketDetailSchema, { method: "POST", body: { body } }));
  const setStatus = useTicketMutation((s: "open" | "closed") => apiRequest(`/v1/support/tickets/${id}`, ticketSummarySchema, { method: "PATCH", body: { status: s } }));
  const toast = useToast();
  const [text, setText] = useState("");
  if (q.isPending) return <LoadingBlock lines={5} />;
  if (q.isError) return <ErrorState body={q.error instanceof Error ? q.error.message : undefined} onRetry={() => void q.refetch()} />;
  const t = q.data;
  const closed = t.status === "closed";
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white" aria-label={t.subject}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>{t.subject}</div>
          <div className="text-[11px] text-slate-500">{CATEGORY[t.category]} · opened {relative(t.createdAt)} · <span className={`rounded-full px-1.5 py-0.5 ${TONE[t.status]}`}>{TICKET_STATUS[t.status]}</span></div>
        </div>
        <button onClick={() => setStatus.mutate(closed ? "open" : "closed", { onError: (err) => toast.error("Couldn't update the request", err instanceof Error ? err.message : undefined) })} disabled={setStatus.isPending} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
          {closed ? "Reopen" : "Close request"}
        </button>
      </div>
      <ol className="space-y-3 p-4">
        {t.thread.map((m) => (
          <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.authorKind === "staff" ? "bg-indigo-50 text-slate-800" : "ml-auto bg-slate-100 text-slate-800"}`}>
            <div className="text-[11px] text-slate-500"><span style={{ fontWeight: 600 }}>{m.authorName}</span> · {new Date(m.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div>
            <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      {closed ? (
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">This request is closed. Reopen it to reply.</p>
      ) : (
        <form className="flex gap-2 border-t border-slate-100 p-3" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; reply.mutate(text.trim(), { onSuccess: () => setText(""), onError: (err) => toast.error("Couldn't send the reply", err instanceof Error ? err.message : undefined) }); }}>
          <textarea rows={2} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} aria-label="Reply" placeholder="Write a reply…" className="flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
          <button type="submit" disabled={!text.trim() || reply.isPending} className="self-end rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50" style={{ fontWeight: 600 }}>Send</button>
        </form>
      )}
    </section>
  );
}
