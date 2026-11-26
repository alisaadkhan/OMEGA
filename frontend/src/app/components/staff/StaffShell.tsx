import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LogOut, Menu, Search, X } from "lucide-react";
import type { AdminUser } from "../../admin/AdminAuthContext";
import { StepUpProvider } from "../admin/staff-ui";
import { LogoMark } from "../landing/Logo";
import { NAV, useNavBadges, type StaffView } from "./nav";
import { NotificationBell } from "./NotificationBell";

/** Display labels only (owner, 25 Nov: the top role reads "CEO"); the server role stays super_admin. */
const ROLE_LABEL = { super_admin: "CEO", admin: "Admin", support: "Support" } as const;

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
            <nav aria-label="Staff portal" className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-2.5 py-3 [scrollbar-color:#334155_transparent] [scrollbar-width:thin]">
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
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setMenu(true)} aria-label="Open menu" className="rounded-lg p-2 text-[#131b2e] hover:bg-slate-100 lg:hidden">{menu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
            </div>
            <div className="flex items-center gap-2.5 sm:gap-3">
              <NotificationBell onOverview={() => go("overview")} />
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
