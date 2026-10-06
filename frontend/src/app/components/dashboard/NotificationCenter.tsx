import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Info,
  Sparkles,
  Users,
  CreditCard,
  Search,
  X,
} from "lucide-react";

/** Volume 4C · Notifications — center with priority levels, read/unread, batching. */

type Priority = "info" | "success" | "warning" | "critical";

type Notification = {
  id: string;
  priority: Priority;
  icon: any;
  title: string;
  body: string;
  time: string;
  read: boolean;
  category: "campaigns" | "credits" | "team" | "system";
};

const seed: Notification[] = [
  { id: "n1", priority: "success", icon: CheckCircle2, title: "Campaign 'Eid Sale 2026' went live", body: "24 creators activated across Instagram and TikTok.", time: "2m", read: false, category: "campaigns" },
  { id: "n2", priority: "warning", icon: AlertTriangle, title: "Bot score >40 flagged on @glamlhr.studio", body: "Consider excluding this creator from Bridal Lahore Q3.", time: "18m", read: false, category: "campaigns" },
  { id: "n3", priority: "critical", icon: AlertTriangle, title: "Low credits — 12% remaining", body: "You're near your monthly cap. Top up to keep enrichments running.", time: "1h", read: false, category: "credits" },
  { id: "n4", priority: "info", icon: Users, title: "Bilal Hussain joined MUSHIN Karachi", body: "Assigned role: Analyst.", time: "3h", read: true, category: "team" },
  { id: "n5", priority: "success", icon: CreditCard, title: "JazzCash payment received · Rs. 24,500", body: "Growth plan renewed for July.", time: "Yesterday", read: true, category: "credits" },
  { id: "n6", priority: "info", icon: Search, title: "Weekly digest ready", body: "1,284 searches · 8,421 enrichments this week.", time: "2d", read: true, category: "system" },
];

const priorityColor: Record<Priority, { dot: string; icon: string; bg: string }> = {
  info: { dot: "bg-indigo-500", icon: "text-indigo-600", bg: "bg-indigo-50" },
  success: { dot: "bg-emerald-500", icon: "text-emerald-600", bg: "bg-emerald-50" },
  warning: { dot: "bg-amber-500", icon: "text-amber-600", bg: "bg-amber-50" },
  critical: { dot: "bg-red-500", icon: "text-red-600", bg: "bg-red-50" },
};

type Filter = "all" | "unread" | "campaigns" | "credits" | "team" | "system";

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(seed);
  const [filter, setFilter] = useState<Filter>("all");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const unread = items.filter((i) => !i.read).length;
  const filtered = items.filter((i) => {
    if (filter === "all") return true;
    if (filter === "unread") return !i.read;
    return i.category === filter;
  });

  const markAllRead = () => setItems((prev) => prev.map((i) => ({ ...i, read: true })));
  const toggleRead = (id: string) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: !i.read } : i)));

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-all hover:-translate-y-px hover:shadow-sm"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} />
        {unread > 0 && (
          <motion.span
            layoutId="notif-dot"
            className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] text-white ring-2 ring-white"
            style={{ fontWeight: 600 }}
          >
            {unread > 9 ? "9+" : unread}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-11 z-50 w-96 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <div className="text-slate-900" style={{ fontSize: 13, fontWeight: 600 }}>
                  Notifications
                </div>
                <div className="text-[11px] text-slate-500">
                  {unread === 0 ? "You're all caught up" : `${unread} unread`}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={markAllRead}
                  className="rounded-md px-2 py-1 text-[11px] text-indigo-600 transition-colors hover:bg-indigo-50"
                  style={{ fontWeight: 500 }}
                >
                  Mark all read
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-100 px-2 py-2">
              {(["all", "unread", "campaigns", "credits", "team", "system"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-2.5 py-1 text-[11px] capitalize transition-colors ${
                    filter === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                  style={{ fontWeight: 500 }}
                >
                  {f}
                </button>
              ))}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                  <Sparkles className="h-5 w-5 text-slate-400" strokeWidth={1.75} />
                  <div className="mt-2 text-xs text-slate-900" style={{ fontWeight: 600 }}>
                    Nothing to catch up on
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">New activity will show up here.</p>
                </div>
              ) : (
                filtered.map((n) => {
                  const c = priorityColor[n.priority];
                  return (
                    <motion.button
                      key={n.id}
                      layout
                      onClick={() => toggleRead(n.id)}
                      className={`group flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-slate-50/60 ${
                        n.read ? "" : "bg-indigo-50/20"
                      }`}
                    >
                      <span className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${c.bg}`}>
                        <n.icon className={`h-3.5 w-3.5 ${c.icon}`} strokeWidth={2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {!n.read && <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${c.dot}`} />}
                          <div className="truncate text-slate-900" style={{ fontSize: 12, fontWeight: n.read ? 500 : 600 }}>
                            {n.title}
                          </div>
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-600">{n.body}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-400">
                          {n.time} ago
                        </div>
                      </div>
                    </motion.button>
                  );
                })
              )}
            </div>

            <div className="border-t border-slate-100 px-4 py-2 text-center">
              <button className="text-[11px] text-indigo-600 transition-colors hover:text-indigo-700" style={{ fontWeight: 500 }}>
                Open notification settings
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
