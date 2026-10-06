import { useState } from "react";
import { motion } from "motion/react";
import { Plus, Send } from "lucide-react";

type Status = "open" | "in_progress" | "resolved";
type Ticket = {
  id: string;
  subject: string;
  preview: string;
  status: Status;
  updated: string;
  author: string;
};

const tickets: Ticket[] = [
  { id: "T-2041", subject: "Webhook retries failing on burst load", preview: "We're seeing 429s spike around 14:00 UTC…", status: "in_progress", updated: "2m ago", author: "Alex Chen" },
  { id: "T-2039", subject: "SSO group sync delay", preview: "New SCIM-provisioned members aren't…", status: "open", updated: "1h ago", author: "Priya R." },
  { id: "T-2031", subject: "Export to S3 — region request", preview: "Can we route exports through eu-west-2?", status: "open", updated: "3h ago", author: "Daniel P." },
  { id: "T-2018", subject: "Invoice consolidation", preview: "Resolved — invoices now grouped at org level.", status: "resolved", updated: "Yesterday", author: "Marcus L." },
  { id: "T-2007", subject: "Access token rotation policy", preview: "Resolved — rotation cadence documented.", status: "resolved", updated: "2d ago", author: "Ahmed Raza Khan" },
];

const statusStyle: Record<Status, string> = {
  open: "bg-indigo-50 text-indigo-700",
  in_progress: "bg-amber-50 text-amber-700",
  resolved: "bg-emerald-50 text-emerald-700",
};

const statusLabel: Record<Status, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
};

const thread = [
  { who: "Alex Chen", role: "You", time: "Today · 14:02", body: "We're seeing 429s spike around 14:00 UTC on the webhook delivery endpoint. Retries don't appear to be honoring the Retry-After header." },
  { who: "Mira Solis", role: "Mushin Support", time: "Today · 14:18", body: "Thanks for the report — we've reproduced the behavior and identified a regression in the retry scheduler. A patch is rolling out to your region within the hour." },
  { who: "Alex Chen", role: "You", time: "Today · 14:21", body: "Appreciate the quick turnaround. Will monitor and confirm." },
];

export function Support() {
  const [selected, setSelected] = useState<Ticket>(tickets[0]);
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="tracking-tight text-slate-900" style={{ fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
            Support
          </h1>
          <p className="mt-1 text-sm text-slate-500">All your tickets, in one place. Average response: 18 min.</p>
        </div>
        <button className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm text-white transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-md">
          <Plus className="h-3.5 w-3.5" />
          New ticket
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-xs uppercase tracking-wider text-slate-500">
            All tickets · {tickets.length}
          </div>
          <ul className="divide-y divide-slate-100">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setSelected(t)}
                  className={`w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                    selected.id === t.id ? "bg-slate-50" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{t.id}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${statusStyle[t.status]}`}>
                      {statusLabel[t.status]}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-sm text-slate-900" style={{ fontWeight: 500 }}>
                    {t.subject}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{t.preview}</div>
                  <div className="mt-1.5 text-[11px] text-slate-400">
                    {t.author} · {t.updated}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <motion.div
          key={selected.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <div>
              <div className="text-xs text-slate-500">{selected.id}</div>
              <div className="mt-0.5 text-slate-900" style={{ fontWeight: 600 }}>{selected.subject}</div>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs ${statusStyle[selected.status]}`}>
              {statusLabel[selected.status]}
            </span>
          </div>
          <div className="flex-1 space-y-5 px-6 py-6">
            {thread.map((m, i) => (
              <div key={i} className="flex gap-3">
                <div
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs text-white ${
                    m.role === "You" ? "bg-slate-900" : "bg-gradient-to-br from-indigo-500 to-emerald-500"
                  }`}
                  style={{ fontWeight: 600 }}
                >
                  {m.who.split(" ").map((s) => s[0]).join("")}
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{m.who}</span>
                    <span className="text-xs text-slate-400">{m.time}</span>
                  </div>
                  <div className="mt-1 rounded-lg bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800" style={{ lineHeight: 1.6 }}>
                    {m.body}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-100 p-4">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 transition-all focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-100">
              <input
                placeholder="Reply to thread…"
                className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
              <button className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-xs text-white hover:bg-slate-800">
                <Send className="h-3 w-3" />
                Send
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
