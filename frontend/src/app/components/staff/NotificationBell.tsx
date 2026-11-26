import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, ClipboardList, CreditCard, Flag, LifeBuoy, ShieldAlert, UserPlus } from "lucide-react";
import { staffAlertsSchema, staffNotificationListSchema, type StaffNotification } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { fmtAgo } from "./kit";

const ICON: Record<StaffNotification["kind"], { icon: typeof Bell; tone: string }> = {
  new_user: { icon: UserPlus, tone: "bg-cyan-100 text-cyan-800" },
  subscription: { icon: CreditCard, tone: "bg-emerald-100 text-emerald-800" },
  trial_request: { icon: ClipboardList, tone: "bg-violet-100 text-violet-800" },
  ticket: { icon: LifeBuoy, tone: "bg-indigo-100 text-indigo-800" },
  profile_report: { icon: Flag, tone: "bg-rose-100 text-rose-800" },
  creator_review: { icon: ShieldAlert, tone: "bg-amber-100 text-amber-900" },
};

/**
 * The console bell (owner, 25 Nov): new users, subscriptions, trial forms, tickets, profile reports and creators that
 * need review, plus any alert threshold crossed right now. Clicking one opens its page and marks it read.
 */
export function NotificationBell({ onOverview }: { onOverview: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useQuery({ queryKey: ["admin", "staff-notifications"], queryFn: () => adminRequest("/admin/v1/notifications", staffNotificationListSchema), refetchInterval: 30_000 });
  const alerts = useQuery({ queryKey: ["admin", "alerts"], queryFn: () => adminRequest("/admin/v1/ops/alerts", staffAlertsSchema), refetchInterval: 60_000 });
  const read = useMutation({
    mutationFn: (ids?: string[]) => adminRequest("/admin/v1/notifications/read", null, { method: "POST", body: ids ? { ids } : {} }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["admin", "staff-notifications"] }),
  });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const items = list.data?.notifications ?? [];
  const active = alerts.data?.alerts ?? [];
  const count = (list.data?.unread ?? 0) + active.length;
  const openOne = (n: StaffNotification) => {
    if (!n.read) read.mutate([n.id]);
    setOpen(false);
    if (n.link) window.location.hash = n.link;
  };
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label={`Notifications${count ? ` (${count} new)` : ""}`} aria-expanded={open} className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 hover:border-cyan-300 hover:bg-cyan-50/70 hover:text-cyan-700">
        <Bell className="h-4 w-4" />
        {count > 0 && <span className="absolute -right-1 -top-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[#06B6D4] px-1 text-[10.5px] font-extrabold text-[#0A0F24] ring-2 ring-white tabular-nums">{count > 99 ? "99+" : count}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2.5 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_40px_-12px_rgba(10,15,36,0.18)]">
          <div className="flex items-center justify-between bg-[#0A0F24] px-4 py-3.5 text-white">
            <span className="text-sm font-bold">Notifications</span>
            {(list.data?.unread ?? 0) > 0 && <button type="button" onClick={() => read.mutate(undefined)} className="rounded-full border border-cyan-500/40 bg-cyan-500/20 px-2.5 py-0.5 text-[11px] font-bold text-cyan-200 hover:bg-cyan-500/30">Mark all read</button>}
          </div>
          {active.length > 0 && (
            <button type="button" onClick={() => { setOpen(false); onOverview(); }} className="flex w-full items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-left hover:bg-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <span><span className="block text-xs font-bold text-amber-900">{active.length} alert{active.length === 1 ? "" : "s"} right now</span><span className="block text-[11.5px] text-amber-900">{active[0]?.message}</span></span>
            </button>
          )}
          <ul className="max-h-[380px] divide-y divide-slate-100 overflow-y-auto">
            {list.isPending ? <li className="px-4 py-6 text-center text-xs text-slate-500">Loading…</li> : items.length === 0 ? (
              <li className="px-4 py-8 text-center"><p className="text-xs font-bold text-slate-800">Nothing new</p><p className="mt-0.5 text-[11.5px] text-slate-500">New users, subscriptions, trial forms, tickets and reports appear here.</p></li>
            ) : items.map((n) => {
              const I = ICON[n.kind];
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => openOne(n)} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${n.read ? "" : "bg-cyan-50/40"}`}>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${I.tone}`}><I.icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2"><span className={`truncate text-xs ${n.read ? "font-semibold text-slate-700" : "font-bold text-slate-900"}`}>{n.title}</span><span className="shrink-0 text-[10.5px] text-slate-500">{fmtAgo(n.createdAt)}</span></span>
                      {n.body && <span className="mt-0.5 block truncate text-[11.5px] text-slate-600">{n.body}</span>}
                    </span>
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan-500" aria-label="New" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Unread notifications per console page, for the sidebar (owner, 26 Nov: "that page should be highlighted with the
 * number"). Being on a page reads its notifications, so its highlight clears once you have seen it.
 */
export function usePageNotifications(view: string): Record<string, number> {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["admin", "staff-notifications"], queryFn: () => adminRequest("/admin/v1/notifications", staffNotificationListSchema), refetchInterval: 30_000 });
  const here = list.data?.byPage[view] ?? 0;
  useEffect(() => {
    if (!here) return;
    void adminRequest("/admin/v1/notifications/read", null, { method: "POST", body: { page: view } })
      .then(() => qc.invalidateQueries({ queryKey: ["admin", "staff-notifications"] }))
      .catch(() => undefined);
  }, [view, here, qc]);
  return list.data?.byPage ?? {};
}

/** Settings: email me about these (each staff member's own choice; the bell always shows them). */
export function NotificationEmailToggle() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["admin", "staff-notifications"], queryFn: () => adminRequest("/admin/v1/notifications", staffNotificationListSchema) });
  const set = useMutation({
    mutationFn: (on: boolean) => adminRequest("/admin/v1/notifications/email", null, { method: "PUT", body: { on } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["admin", "staff-notifications"] }),
  });
  const on = list.data?.emailOn ?? true;
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200/90 bg-white p-5">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Email notifications</h3>
        <p className="mt-0.5 text-xs text-slate-600">Email me about new users, subscriptions, trial forms, tickets, profile reports and creators that need review. The bell shows them either way.</p>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label="Email notifications" disabled={list.isPending || set.isPending} onClick={() => set.mutate(!on)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-cyan-600" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}
