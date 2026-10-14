import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { staffTicketDetailSchema, staffTicketListSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { Header } from "./OpsViews";

const STATUS = { open: "Open", waiting_on_customer: "Waiting on customer", resolved: "Resolved", closed: "Closed" } as const;
type Status = keyof typeof STATUS;

/** Support queue (canonical spec page 20): tickets across workspaces; viewing and replying are audited by the API. */
export function SupportQueue() {
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
                    <div className="mt-0.5 text-slate-500">{t.workspaceName} · {t.category} · {t.messages} messages · {t.lastAuthor === "customer" ? "awaiting staff" : "staff replied"}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {openId && <TicketPanel id={openId} />}
      </div>
    </div>
  );
}

function TicketPanel({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin", "ticket", id], queryFn: () => adminRequest(`/admin/v1/support/tickets/${id}`, staffTicketDetailSchema) });
  const update = useMutation({
    mutationFn: (body: { body?: string; status?: Status }) => adminRequest(`/admin/v1/support/tickets/${id}`, staffTicketDetailSchema, { method: "PATCH", body }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["admin"] }),
  });
  const [text, setText] = useState("");
  const [next, setNext] = useState<Status>("waiting_on_customer");
  if (q.isPending) return <LoadingBlock lines={5} />;
  if (q.isError) return <ErrorState body={q.error instanceof Error ? q.error.message : undefined} onRetry={() => void q.refetch()} />;
  const t = q.data;
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label={t.subject}>
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>{t.subject}</div>
        <div className="text-[11px] text-slate-500">{t.workspaceName} · {t.category} · {STATUS[t.status]}</div>
      </div>
      <ol className="space-y-3 p-4">
        {t.messages.map((m) => (
          <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.authorKind === "staff" ? "ml-auto bg-indigo-50" : "bg-slate-100"}`}>
            <div className="text-[11px] text-slate-500"><span style={{ fontWeight: 600 }}>{m.authorName}</span> · {new Date(m.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div>
            <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
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
