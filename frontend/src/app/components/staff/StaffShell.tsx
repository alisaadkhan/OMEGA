import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, KeyRound, LogOut, Menu, Search, ShieldCheck, X } from "lucide-react";
import { staffAlertsSchema } from "@mushin/contracts";
import type { AdminUser } from "../../admin/AdminAuthContext";
import { adminRequest } from "../../admin/adminApi";
import { StepUpProvider, useStepUp } from "../admin/staff-ui";
import { LogoMark } from "../landing/Logo";
import { NAV, useNavBadges, type StaffView } from "./nav";

const ROLE_LABEL = { super_admin: "Super Admin", admin: "Admin", support: "Support" } as const;

/** Security-key state for privileged actions: confirmed for 5 minutes, or one click to confirm. Support never needs it. */
function KeyPill() {
  const s = useStepUp();
  if (!s.required) return <span className="hidden items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600 xl:inline-flex">Signed in with authenticator code</span>;
  if (s.confirmed)
    return (
      <span className="hidden items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-[11px] font-bold text-cyan-800 sm:inline-flex">
        <ShieldCheck className="h-3.5 w-3.5" /> Security key confirmed
      </span>
    );
  return (
    <button type="button" onClick={() => void s.confirm()} disabled={s.busy || !s.hasKey} title={s.hasKey ? undefined : "Register a security key in Settings first"} className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-60">
      <KeyRound className="h-3.5 w-3.5" /> {s.busy ? "Waiting for key…" : s.hasKey ? "Confirm security key" : "Security key needed"}
    </button>
  );
}

/** The bell lists the alert thresholds crossed right now (the staff alerts endpoint); nothing else is invented. */
function AlertBell({ onOpen }: { onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["admin", "alerts"], queryFn: () => adminRequest("/admin/v1/ops/alerts", staffAlertsSchema), refetchInterval: 60_000 });
  const alerts = q.data?.alerts ?? [];
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label={`Alerts${alerts.length ? ` (${alerts.length})` : ""}`} aria-expanded={open} className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 hover:border-cyan-300 hover:bg-cyan-50/70 hover:text-cyan-700">
        <Bell className="h-4 w-4" />
        {alerts.length > 0 && <span className="absolute -right-1 -top-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[#06B6D4] px-1 text-[10.5px] font-extrabold text-[#0A0F24] ring-2 ring-white tabular-nums">{alerts.length}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2.5 w-[340px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_40px_-12px_rgba(10,15,36,0.18)]">
          <div className="flex items-center justify-between bg-[#0A0F24] px-4 py-3.5 text-white">
            <span className="text-sm font-bold">Alerts</span>
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/20 px-2 py-0.5 text-[10.5px] font-bold text-cyan-300">{alerts.length} active</span>
          </div>
          <ul className="max-h-[340px] divide-y divide-slate-100 overflow-y-auto">
            {q.isPending ? <li className="px-4 py-6 text-center text-xs text-slate-500">Loading…</li> : alerts.length === 0 ? (
              <li className="px-4 py-8 text-center"><p className="text-xs font-bold text-slate-800">No alert threshold is crossed</p><p className="mt-0.5 text-[11.5px] text-slate-500">This covers only what the console measures.</p></li>
            ) : alerts.map((a) => (
              <li key={a.key} className="flex items-start gap-3 px-4 py-3.5">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.severity === "critical" ? "bg-rose-500" : "bg-amber-500"}`} />
                <div><div className="text-xs font-bold text-slate-900">{a.severity === "critical" ? "Critical" : "Warning"}</div><p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-600">{a.message}</p></div>
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
            <button type="button" onClick={() => { setOpen(false); onOpen(); }} className="w-full rounded-2xl bg-[#0A0F24] px-3 py-2 text-xs font-bold text-white hover:bg-[#161F42]">Open the overview</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** ⌘K / Ctrl+K: jump to any section the signed-in role can open. */
function CommandPalette({ items, onGo, onClose }: { items: { id: StaffView; label: string }[]; onGo: (v: StaffView) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const shown = items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-24" onClick={onClose} role="presentation">
      <div role="dialog" aria-label="Go to a section" onClick={(e) => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-200 p-4">
          <Search className="h-5 w-5 text-slate-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter" && shown[0]) onGo(shown[0].id); }} placeholder="Go to a section…" aria-label="Section" className="w-full bg-transparent text-sm text-slate-900 focus:outline-none" />
          <kbd className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600">ESC</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2 text-[13px]">
          {shown.map((i) => (
            <li key={i.id}><button type="button" onClick={() => onGo(i.id)} className="w-full rounded-xl p-3 text-left font-medium text-slate-800 hover:bg-slate-50">{i.label}</button></li>
          ))}
          {shown.length === 0 && <li className="p-3 text-slate-500">No section matches.</li>}
        </ul>
      </div>
    </div>
  );
}

export function StaffShell({ admin, view, onView, onSignOut, children }: { admin: AdminUser; view: StaffView; onView: (v: StaffView) => void; onSignOut: () => void; children: ReactNode }) {
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const badges = useNavBadges(admin.role);
  const groups = useMemo(() => NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(admin.role)) })).filter((g) => g.items.length > 0), [admin.role]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const go = (v: StaffView) => { onView(v); setMenu(false); setPalette(false); };

  return (
    <StepUpProvider>
      <div className="flex min-h-screen bg-[#F8FAFC] text-slate-900 antialiased">
        {menu && <div className="fixed inset-0 z-40 bg-slate-950/60 lg:hidden" onClick={() => setMenu(false)} role="presentation" />}
        <aside className={`fixed bottom-0 left-0 top-0 z-50 flex w-[260px] flex-col justify-between border-r border-slate-800/80 bg-[#0A0F24] text-slate-300 transition-transform duration-200 lg:translate-x-0 ${menu ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800/90 bg-[#070b14] px-4">
              <div className="flex items-center gap-2.5">
                <LogoMark size={28} />
                <span className="text-sm font-extrabold tracking-wider text-white">MUSHIN</span>
              </div>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-cyan-300">{ROLE_LABEL[admin.role]}</span>
            </div>
            <nav aria-label="Staff portal" className="flex-1 space-y-4 overflow-y-auto px-2.5 py-3">
              {groups.map((g) => (
                <div key={g.group}>
                  <div className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{g.group}</div>
                  <div className="space-y-0.5">
                    {g.items.map((i) => {
                      const active = view === i.id;
                      const n = i.badge ? badges[i.badge] : undefined;
                      return (
                        <button key={i.id} type="button" onClick={() => go(i.id)} aria-label={i.label} title={n ? `${i.label}: ${n} waiting` : undefined} aria-current={active ? "page" : undefined} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors ${active ? "bg-[#e6e8ea] font-bold text-[#131b2e]" : "font-medium text-slate-300 hover:bg-slate-800/50 hover:text-white"}`}>
                          <span className="flex items-center gap-2.5"><i.icon className={`h-4 w-4 ${active ? "text-[#131b2e]" : ""}`} strokeWidth={2} />{i.label}</span>
                          {n ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${active ? "bg-[#131b2e] text-white" : i.badge === "reports" || i.badge === "removals" ? "bg-rose-500/25 text-rose-300" : "bg-cyan-500/20 text-cyan-300"}`}>{n}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </div>
          <div className="m-2.5 flex shrink-0 items-center justify-between rounded-xl border border-slate-800 bg-[#0b1c30] p-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="relative shrink-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-xs font-bold text-white">{admin.name.trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()}</div>
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0b1c30]" />
              </div>
              <div className="min-w-0"><div className="truncate text-xs font-semibold text-white">{admin.name}</div><div className="truncate text-[10.5px] text-slate-300">{admin.email}</div></div>
            </div>
            <button type="button" onClick={onSignOut} title="Sign out" aria-label="Sign out" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-300"><LogOut className="h-4 w-4" /></button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col lg:pl-[260px]">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-md sm:px-6">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setMenu(true)} aria-label="Open menu" className="rounded-lg p-2 text-[#131b2e] hover:bg-slate-100 lg:hidden">{menu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
              <button type="button" onClick={() => setPalette(true)} className="flex w-44 items-center justify-between gap-2.5 rounded-xl bg-slate-100 px-3.5 py-2 text-[12.5px] text-slate-600 hover:bg-slate-200/70 hover:text-slate-800 sm:w-64">
                <span className="flex items-center gap-2"><Search className="h-4 w-4 text-slate-500" />Search console…</span>
                <kbd className="rounded bg-slate-200/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">⌘K</kbd>
              </button>
            </div>
            <div className="flex items-center gap-2.5 sm:gap-3">
              <KeyPill />
              <AlertBell onOpen={() => go("overview")} />
              <div className="hidden items-center gap-2.5 border-l border-slate-200 pl-3 sm:flex">
                <div className="text-right leading-tight"><div className="text-xs font-bold text-slate-900">{admin.name}</div><div className="text-[10.5px] font-medium text-slate-500">{ROLE_LABEL[admin.role]}</div></div>
              </div>
            </div>
          </header>
          <main tabIndex={-1} aria-label="Console section" className="mx-auto w-full max-w-[1520px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
        {palette && <CommandPalette items={groups.flatMap((g) => g.items)} onGo={go} onClose={() => setPalette(false)} />}
      </div>
    </StepUpProvider>
  );
}
