import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, Bell, CheckCheck, MailCheck, RefreshCw } from "lucide-react";
import { useRecentActivity } from "../../api/activity";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../lib/toast";
import { ActivityRow } from "./ActivityLog";
import { Spinner } from "./states";

/**
 * The bell: recent account activity from the server (canonical spec page 15). Unread = newer than the last "mark as
 * read" in this browser, and not your own action (a finished Find New Creators run always counts). The marker is a
 * per-viewer convenience: losing it only re-highlights old items.
 */
export function NotificationCenter({ onSeeAll }: { onSeeAll?: () => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const ref = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const toast = useToast();
  const key = `mushin.activitySeen.${user?.id ?? "anon"}`;
  const [seen, setSeenState] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const recent = useRecentActivity(15);
  const events = recent.data?.events ?? [];
  const isUnread = (e: (typeof events)[number]) => e.at > seen && (e.actor?.id !== user?.id || e.kind === "live_run_finished");
  const unread = events.filter(isUnread).length;
  const shown = tab === "unread" ? events.filter(isUnread) : events;

  const setSeen = (v: string) => {
    setSeenState(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* storage unavailable: the marker only lasts this session */
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function markAllRead() {
    if (!events[0] || unread === 0) return;
    const before = seen;
    setSeen(events[0].at);
    toast.toast({ level: "success", title: "All notifications marked as read.", action: { label: "Undo", onClick: () => setSeen(before) } });
  }

  async function refresh() {
    const r = await recent.refetch();
    if (r.isError) toast.error("Couldn't refresh notifications", "Check your connection and try again.");
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-700 transition-all hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">{unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-full z-40 mt-2 w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200/70"
            role="dialog"
            aria-label="Notifications"
          >
            <div className="space-y-2 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold tracking-tight text-slate-900">Notifications</span>
                  <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${unread > 0 ? "bg-cyan-100 text-cyan-800" : "bg-slate-100 text-slate-600"}`}>{unread} New</span>
                </div>
                <button onClick={markAllRead} disabled={unread === 0} className="group inline-flex items-center gap-1 rounded text-[11px] font-medium text-slate-600 transition-colors hover:text-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50">
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all as read
                </button>
              </div>
              <div className="flex items-center gap-1">
                {(["all", "unread"] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400/40 ${tab === t ? "bg-[#0A0F24] text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
                    {t === "all" ? `All (${events.length})` : `Unread (${unread})`}
                  </button>
                ))}
                <button onClick={() => void refresh()} title="Refresh" aria-label="Refresh notifications" className="ml-auto flex h-6 w-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                  <RefreshCw className={`h-3.5 w-3.5 ${recent.isFetching ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {recent.isPending ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : recent.isError ? (
              <div className="p-4">
                <div role="alert" className="mb-3 flex items-start gap-3 rounded-xl bg-rose-50 p-3 text-rose-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <div>
                    <div className="text-[13px] font-semibold">Couldn&apos;t load notifications</div>
                    <p className="mt-0.5 text-xs text-rose-700/80">Check your connection, then try again.</p>
                  </div>
                </div>
                <button onClick={() => void refresh()} className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#0A0F24] px-3 text-xs font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/50">
                  <RefreshCw className="h-3.5 w-3.5" /> Retry
                </button>
              </div>
            ) : shown.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700 shadow-sm">
                  <MailCheck className="h-7 w-7" />
                </span>
                <div className="text-[15px] font-semibold text-slate-900">You&apos;re all caught up</div>
                <p className="mt-1 max-w-[280px] text-xs text-slate-600">
                  {events.length === 0 ? "Nothing has happened in your account yet. Shortlists, campaigns and finished searches will appear here." : "No unread notifications. We'll show new activity here."}
                </p>
                {tab === "unread" && events.length > 0 && (
                  <button onClick={() => setTab("all")} className="mt-4 inline-flex h-8 items-center rounded-lg bg-slate-100 px-3 text-xs font-medium text-slate-800 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                    View past notifications
                  </button>
                )}
              </div>
            ) : (
              <div className="max-h-[440px] overflow-y-auto">
                {shown.map((e) => (
                  <ul key={e.id} className={`relative pl-3 transition-colors ${isUnread(e) ? "bg-slate-50 hover:bg-slate-100" : "bg-white hover:bg-slate-50"}`}>
                    {isUnread(e) && <span aria-hidden className="absolute left-2 top-5 h-2 w-2 rounded-full bg-[#06B6D4] ring-4 ring-cyan-100" />}
                    <ActivityRow e={e} />
                  </ul>
                ))}
              </div>
            )}

            {onSeeAll && (
              <div className="flex items-center justify-end bg-slate-50 px-3 py-2">
                <button onClick={() => { setOpen(false); onSeeAll(); }} className="inline-flex items-center gap-0.5 rounded text-[11px] font-semibold text-cyan-800 transition-colors hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                  View all in Activity Log <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
