import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CheckCheck, CreditCard, LifeBuoy, MailCheck, RefreshCw, Search } from "lucide-react";
import { markNotificationsReadResultSchema, notificationListSchema, type Notification } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../lib/toast";
import type { DashView } from "./Sidebar";
import { Spinner } from "./states";

/**
 * The bell (owner, 23 Nov): notifications that need the person's attention, never a log of their own actions. Support
 * replies and resolved requests, low credits, trial and payment problems, finished live searches (0100). Each is also
 * emailed unless account emails are off. Read state lives on the server, so it follows the person across devices.
 */
const VIEWS: readonly string[] = ["overview", "search", "lists", "campaigns", "billing", "settings", "support"];
const iconOf = (kind: string) => (kind.startsWith("ticket_") ? LifeBuoy : kind.startsWith("live_search") ? Search : CreditCard);
const toneOf = (kind: string) =>
  kind === "payment_failed" || kind === "credits_very_low" || kind === "live_search_failed" || kind === "trial_expired"
    ? "bg-rose-50 text-rose-600"
    : kind.startsWith("ticket_") ? "bg-cyan-50 text-[#00687a]" : kind === "live_search_done" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-700";
const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export function NotificationCenter({ onOpenView }: { onOpenView?: (v: DashView) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const ref = useRef<HTMLDivElement>(null);
  const { status } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => apiRequest("/v1/notifications", notificationListSchema), enabled: status === "signedIn", refetchInterval: 60_000 });
  const read = useMutation({
    mutationFn: (ids?: string[]) => apiRequest("/v1/notifications/read", markNotificationsReadResultSchema, { method: "POST", body: ids ? { ids } : {} }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const items = q.data?.notifications ?? [];
  const unread = q.data?.unread ?? 0;
  const shown = tab === "unread" ? items.filter((n) => !n.read) : items;

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

  const openOne = (n: Notification) => {
    if (!n.read) read.mutate([n.id]);
    if (n.view && VIEWS.includes(n.view) && onOpenView) {
      onOpenView(n.view as DashView);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-700 transition-all hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white tabular-nums">{unread > 99 ? "99+" : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-full z-40 mt-2 w-[400px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200/70"
            role="dialog"
            aria-label="Notifications"
          >
            <div className="space-y-2.5 border-b border-slate-100 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold tracking-tight text-slate-900">Notifications</span>
                <button onClick={() => read.mutate(undefined, { onSuccess: () => toast.success("All notifications marked as read") })} disabled={unread === 0 || read.isPending} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-[#00687a] transition-colors hover:bg-cyan-50 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:text-slate-400 disabled:hover:bg-transparent">
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all as read
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                {(["all", "unread"] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className="tab !py-1 !text-[11.5px]">
                    {t === "all" ? "All" : `Unread${unread ? ` (${unread})` : ""}`}
                  </button>
                ))}
                <button onClick={() => void q.refetch()} title="Refresh" aria-label="Refresh notifications" className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                  <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {q.isPending ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : q.isError ? (
              <div className="p-4">
                <div role="alert" className="mb-3 flex items-start gap-3 rounded-xl bg-rose-50 p-3 text-rose-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <div>
                    <div className="text-[13px] font-semibold">Couldn&apos;t load notifications</div>
                    <p className="mt-0.5 text-xs text-rose-700/80">Check your connection, then try again.</p>
                  </div>
                </div>
                <button onClick={() => void q.refetch()} className="btn btn-dark btn-sm"><RefreshCw className="h-3.5 w-3.5" /> Try again</button>
              </div>
            ) : shown.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700"><MailCheck className="h-7 w-7" /></span>
                <div className="text-[15px] font-semibold text-slate-900">You&apos;re all caught up</div>
                <p className="mt-1 max-w-[280px] text-xs text-slate-600">
                  {items.length === 0 ? "Replies from support, finished live searches, low credits and billing notices appear here." : "No unread notifications."}
                </p>
              </div>
            ) : (
              <ul className="max-h-[440px] divide-y divide-slate-100 overflow-y-auto">
                {shown.map((n) => {
                  const Icon = iconOf(n.kind);
                  return (
                    <li key={n.id}>
                      <button type="button" onClick={() => openOne(n)} className={`flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors focus:outline-none focus-visible:bg-cyan-50 ${n.read ? "bg-white hover:bg-slate-50" : "bg-cyan-50/40 hover:bg-cyan-50/80"}`}>
                        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${toneOf(n.kind)}`}><Icon className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <span className={`text-[13px] leading-snug text-slate-900 ${n.read ? "font-medium" : "font-bold"}`}>{n.title}</span>
                            {!n.read && <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#06B6D4]" />}
                          </span>
                          {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-slate-600">{n.body}</span>}
                          <span className="mt-1 block text-[11px] text-slate-400">{ago(n.createdAt)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
