import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LifeBuoy, Plus, Search, Send } from "lucide-react";
import { ticketDetailSchema, ticketListSchema, ticketSummarySchema, type CreateTicket, type TicketSummary } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { relative } from "../../lib/time";
import { useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "./states";
import { TicketAttachments } from "./TicketAttachments";
import { TrialFeedback } from "./TrialFeedback";
import { Alert, Segmented, Stagger, StaggerItem } from "../../ui/kit";

// Categories of the master directive §6.1 (0083); "search" is shown for earlier requests only.
const CATEGORY = { billing: "Billing & Credits", creator_data: "Creator Data Issue", discovery: "Live Discovery Issue", account: "Account", feature_request: "Feature Request", data_removal: "Data removal", other: "Other", search: "Search" } as const;
const NEW_CATEGORIES = ["billing", "creator_data", "discovery", "account", "feature_request", "data_removal", "other"] as const;
export const TICKET_STATUS = { open: "Open", in_progress: "In progress", waiting_on_customer: "Waiting for you", resolved: "Resolved", closed: "Closed" } as const;
const TONE = { open: "bg-cyan-50 text-cyan-800", in_progress: "bg-indigo-50 text-indigo-700", waiting_on_customer: "bg-amber-50 text-amber-800", resolved: "bg-emerald-50 text-emerald-700", closed: "bg-slate-100 text-slate-600" } as const;
const DONE = new Set(["resolved", "closed"]);

function useTicketMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => void qc.invalidateQueries({ queryKey: ["support"] }) });
}

/** Support requests (canonical spec page 15): your account's conversations with MUSHIN support, stored on the server. */
export function Support() {
  const { status } = useAuth();
  const list = useQuery({ queryKey: ["support", "list"], queryFn: () => apiRequest("/v1/support/tickets", ticketListSchema), enabled: status === "signedIn" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"all" | "open" | "resolved">("all");
  const [find, setFind] = useState("");
  const tickets = (list.data?.tickets ?? []).filter(
    (t) => (tab === "all" || (tab === "resolved" ? DONE.has(t.status) : !DONE.has(t.status))) && t.subject.toLowerCase().includes(find.trim().toLowerCase()),
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-[32px] font-bold leading-10 tracking-[-0.025em] text-slate-900">Support</h1>
          <p className="mt-1 text-sm text-slate-500">Direct communication line with the MUSHIN support team. Replies appear here.</p>
        </div>
        <button onClick={() => { setCreating(true); setOpenId(null); }} className="inline-flex items-center gap-2 self-start rounded-xl bg-[#57dffe] px-4 py-2.5 text-sm font-semibold text-[#001f26] shadow-sm transition-all hover:bg-[#4cd7f6] focus:outline-none focus:ring-2 focus:ring-cyan-400/60 active:scale-95">
          <Plus className="h-4 w-4" /> New Ticket
        </button>
      </div>
      <div className="flex min-h-[560px] flex-col overflow-hidden rounded-2xl bg-white shadow-sm md:flex-row">
        <section className="flex w-full flex-shrink-0 flex-col md:w-[360px]" aria-label="Your requests">
          <div className="space-y-3 p-4">
            <Segmented<"all" | "open" | "resolved"> dark value={tab} onChange={setTab} className="flex w-full [&>button]:flex-1" options={[{ id: "all", label: "All" }, { id: "open", label: "Open" }, { id: "resolved", label: "Resolved" }]} />
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search requests…" aria-label="Search requests" className="w-full rounded-xl bg-slate-100 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-300" />
            </div>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-2">
            {list.isPending ? (
              <LoadingBlock lines={4} />
            ) : list.isError ? (
              <ErrorState body={list.error instanceof Error ? list.error.message : undefined} onRetry={() => void list.refetch()} />
            ) : tickets.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-10 text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700"><LifeBuoy className="h-6 w-6" /></span>
                <div className="text-sm font-semibold text-slate-900">{(list.data?.tickets.length ?? 0) === 0 ? "No support requests" : "Nothing in this view"}</div>
                <p className="mt-1 text-xs text-slate-500">{(list.data?.tickets.length ?? 0) === 0 ? "Start one with New request." : "Try another filter."}</p>
              </div>
            ) : (
              <Stagger className="space-y-1" gap={0.04}>{tickets.map((t) => <StaggerItem key={t.id}><TicketRow key={t.id} t={t} active={t.id === openId} onOpen={() => { setOpenId(t.id); setCreating(false); }} /></StaggerItem>)}</Stagger>
            )}
          </div>
        </section>
        <div className="flex flex-1 flex-col bg-slate-50/50">
          <AnimatePresence mode="wait">
            {creating ? (
              <motion.div key="new" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }} className="p-6">
                <NewTicket onCreated={(id) => { setCreating(false); setOpenId(id); }} onCancel={() => setCreating(false)} />
              </motion.div>
            ) : openId ? (
              <motion.div key={openId} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }} className="flex flex-1 flex-col">
                <TicketThread id={openId} />
              </motion.div>
            ) : (
              <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-1 items-center justify-center p-10 text-center text-sm text-slate-500">
                Open a request to read the conversation, or start a new one.
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <TrialFeedback />
    </div>
  );
}

function TicketRow({ t, active, onOpen }: { t: TicketSummary; active: boolean; onOpen: () => void }) {
  const done = DONE.has(t.status);
  return (
    <div>
      <button onClick={onOpen} aria-current={active} className={`block w-full rounded-xl p-3.5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400/40 ${active ? "bg-slate-100" : "hover:bg-slate-50"}`}>
        <div className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${done ? "bg-slate-300" : "bg-[#57dffe]"}`} />
            <span className={`truncate text-[15px] font-semibold ${done ? "text-slate-500" : "text-slate-900"}`}>{t.subject}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-slate-500">
            {t.unread && <span data-testid="ticket-unread" className="rounded-full bg-cyan-600 px-1.5 py-0.5 font-semibold text-white">New reply</span>}
            {relative(t.lastMessageAt)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2 pl-4 text-[10px] text-slate-500">
          <span>{CATEGORY[t.category]}</span>
          <span>•</span>
          <span className={`rounded-full px-2 py-0.5 font-semibold ${TONE[t.status]}`}>{TICKET_STATUS[t.status]}</span>
          <span>•</span>
          <span>{t.lastAuthor === "staff" ? "Support replied" : "You wrote"}</span>
        </div>
      </button>
    </div>
  );
}

function NewTicket({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [v, setV] = useState<CreateTicket>({ subject: "", category: "creator_data", body: "" });
  const [touched, setTouched] = useState(false);
  const create = useTicketMutation((body: CreateTicket) => apiRequest("/v1/support/tickets", ticketDetailSchema, { method: "POST", body }));
  const toast = useToast();
  const missing = { subject: touched && !v.subject.trim(), body: touched && !v.body.trim() };
  const field = (bad: boolean) => `mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${bad ? "border-rose-500 focus:ring-rose-200" : "border-slate-200 focus:ring-cyan-200"}`;
  return (
    <form
      noValidate
      className="space-y-4 rounded-2xl bg-white p-5 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!v.subject.trim() || !v.body.trim()) return;
        create.mutate(v, { onSuccess: (t) => { toast.success("Request sent", "We'll reply here."); onCreated(t.id); }, onError: (err) => toast.error("Couldn't send the request", err instanceof Error ? err.message : undefined) });
      }}
    >
      <h2 className="text-lg font-semibold text-slate-900">New request</h2>
      <label className="block text-xs font-semibold text-slate-700">Subject
        <input autoFocus maxLength={160} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} aria-invalid={missing.subject || undefined} className={field(missing.subject)} />
        {missing.subject && <span className="mt-1 block text-[11px] font-normal text-rose-600 animate-in fade-in slide-in-from-top-1 duration-200">Add a short subject.</span>}
      </label>
      <label className="block text-xs font-semibold text-slate-700">Topic
        <select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as CreateTicket["category"] })} className={field(false)}>
          {NEW_CATEGORIES.map((k) => <option key={k} value={k}>{CATEGORY[k]}</option>)}
        </select>
      </label>
      <label className="block text-xs font-semibold text-slate-700">What happened?
        <textarea rows={6} maxLength={5000} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} aria-invalid={missing.body || undefined} className={field(missing.body)} />
        {missing.body && <span className="mt-1 block text-[11px] font-normal text-rose-600 animate-in fade-in slide-in-from-top-1 duration-200">Tell us what happened.</span>}
      </label>
      <Alert tone="error">{create.isError ? (create.error instanceof Error ? create.error.message : "Couldn't send the request.") : null}</Alert>
      <p className="text-[11px] text-slate-500">Don&apos;t include passwords or payment card details. Support staff see your account name and this conversation.</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">Cancel</button>
        <button type="submit" disabled={create.isPending} className="rounded-xl bg-[#0A0F24] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/50 disabled:opacity-50">{create.isPending ? "Sending…" : "Send request"}</button>
      </div>
    </form>
  );
}

/**
 * One support request as a conversation (owner, 23 Nov): new replies appear on their own while it is open, the newest
 * message stays in view, and the customer marks it solved or ends it. Support's replies and resolutions also reach the
 * bell and the inbox (0100).
 */
function TicketThread({ id }: { id: string }) {
  const { status } = useAuth();
  const q = useQuery({
    queryKey: ["support", "detail", id],
    queryFn: () => apiRequest(`/v1/support/tickets/${id}`, ticketDetailSchema),
    enabled: status === "signedIn",
    refetchInterval: (query) => (query.state.data && DONE.has(query.state.data.status) ? false : 10_000),
  });
  const reply = useTicketMutation((body: string) => apiRequest(`/v1/support/tickets/${id}/messages`, ticketDetailSchema, { method: "POST", body: { body } }));
  const setStatus = useTicketMutation((s: "open" | "resolved" | "closed") => apiRequest(`/v1/support/tickets/${id}`, ticketSummarySchema, { method: "PATCH", body: { status: s } }));
  const toast = useToast();
  const [text, setText] = useState("");
  const end = useRef<HTMLLIElement>(null);
  const count = q.data?.thread.length ?? 0;
  useEffect(() => end.current?.scrollIntoView({ block: "end", behavior: "smooth" }), [count]);
  if (q.isPending) return <div className="p-6"><LoadingBlock lines={5} /></div>;
  if (q.isError) return <div className="p-6"><ErrorState body={q.error instanceof Error ? q.error.message : undefined} onRetry={() => void q.refetch()} /></div>;
  const t = q.data;
  const closed = t.status === "closed";
  const resolved = t.status === "resolved";
  const change = (s: "open" | "resolved" | "closed", done: string) =>
    setStatus.mutate(s, { onSuccess: () => toast.success(done), onError: (err) => toast.error("Couldn't update the request", err instanceof Error ? err.message : undefined) });
  const send = () => {
    if (!text.trim() || reply.isPending) return;
    reply.mutate(text.trim(), { onSuccess: () => setText(""), onError: (err) => toast.error("Couldn't send the reply", err instanceof Error ? err.message : undefined) });
  };
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t.subject}>
      <header className="flex flex-wrap items-center justify-between gap-3 bg-white px-6 py-4 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="truncate text-lg font-semibold text-slate-900">{t.subject}</h2>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE[t.status]}`}>{TICKET_STATUS[t.status]}</span>
          </div>
          <p className="text-xs text-slate-500">{CATEGORY[t.category]} · opened {relative(t.createdAt)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {closed || resolved ? (
            <button onClick={() => change("open", "Request reopened")} disabled={setStatus.isPending} className="btn btn-soft">Reopen</button>
          ) : (
            <button onClick={() => change("resolved", "Marked as solved")} disabled={setStatus.isPending} className="btn btn-success"><CheckCircle2 className="h-3.5 w-3.5" /> Mark as solved</button>
          )}
          {!closed && <button onClick={() => change("closed", "Request ended")} disabled={setStatus.isPending} className="btn btn-outline">End request</button>}
        </div>
      </header>
      {resolved && (
        <div role="status" className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-6 py-2.5 text-[12.5px] text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> This request is solved. Reply below if anything is still wrong and it opens again.
        </div>
      )}
      <ol className="flex-1 space-y-4 overflow-y-auto bg-slate-50/60 p-6" aria-live="polite">
        {t.thread.map((m) => {
          const staff = m.authorKind === "staff";
          return (
            <motion.li key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className={`flex items-end gap-2.5 ${staff ? "" : "flex-row-reverse"}`}>
              <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${staff ? "bg-[#131b2e] text-[#4cd7f6]" : "bg-cyan-100 text-[#00687a]"}`}>
                {staff ? "M" : (m.authorName.trim()[0] ?? "Y").toUpperCase()}
              </span>
              <div className={`flex max-w-lg flex-col gap-1 ${staff ? "items-start" : "items-end"}`}>
                <div className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[13px] leading-relaxed shadow-sm ${staff ? "rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200/70" : "rounded-br-sm bg-[#131b2e] text-white"}`}>{m.body}</div>
                <span className="px-1 text-[10.5px] text-slate-500">{staff ? "MUSHIN support" : m.authorName} · {new Date(m.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
            </motion.li>
          );
        })}
        <li ref={end} aria-hidden className="h-px" />
      </ol>
      <div className="bg-white px-6 pt-3">
        <TicketAttachments base={`/v1/support/tickets/${id}/attachments`} request={apiRequest} canUpload={!closed} queryKey={["support", "attachments", id]} />
      </div>
      {closed ? (
        <p className="bg-white px-6 py-4 text-xs text-slate-500">This request has ended. Reopen it to write again.</p>
      ) : (
        <form className="bg-white p-4" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <div className="mb-2"><Alert tone="error">{reply.isError ? (reply.error instanceof Error ? reply.error.message : "Couldn't send the reply.") : null}</Alert></div>
          <div className="flex items-end gap-2 rounded-2xl bg-slate-100 p-2.5 transition-shadow focus-within:bg-white focus-within:shadow-md focus-within:ring-2 focus-within:ring-cyan-400/40">
            <textarea
              rows={2}
              maxLength={5000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
              aria-label="Reply"
              placeholder="Write a reply… (Ctrl + Enter to send)"
              className="max-h-40 min-h-[44px] w-full resize-y bg-transparent px-1.5 py-1 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            <button type="submit" disabled={!text.trim() || reply.isPending} className="btn btn-primary shrink-0">
              {reply.isPending ? "Sending…" : "Send"} <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
