import { motion } from "motion/react";
import { Bookmark, CreditCard, LayoutDashboard, LifeBuoy, LogOut, Megaphone, Search, Settings, Star } from "lucide-react";
import { useBillingSummary } from "../../api/billing";
import { useAuth } from "../../auth/AuthContext";
import { OPEN_REVIEW_EVENT } from "./LeaveReview";
import { useNotifications } from "../../api/notifications";

/**
 * Primary navigation (owner design 2026-11-16): dark navy panel with Discover, Account and Insights groups, an animated
 * active pill, and the current plan at the foot. Every account action lives here too (owner, 17 Nov: "remove every button
 * from profile and move it to side bar"): Leave a review and Sign out (Back to website removed 18 Nov). View ids are unchanged; the Inbox page was removed (owner, 22 Nov).
 */
export type DashView = "overview" | "search" | "lists" | "campaigns" | "billing" | "settings" | "support";

export const DASH_VIEWS: readonly DashView[] = ["overview", "search", "lists", "campaigns", "billing", "settings", "support"];

const GROUPS: { title: string; items: { id: DashView; label: string; icon: typeof Search; tour?: string }[] }[] = [
  {
    title: "Discover",
    items: [
      { id: "overview", label: "Dashboard", icon: LayoutDashboard },
      { id: "search", label: "Search", icon: Search },
      { id: "lists", label: "Shortlists", icon: Bookmark, tour: "shortlists" },
      { id: "campaigns", label: "Campaigns", icon: Megaphone, tour: "campaigns" },
    ],
  },
  { title: "Account", items: [{ id: "billing", label: "Credits & Billing", icon: CreditCard }, { id: "settings", label: "Settings", icon: Settings }] },
  { title: "Help", items: [{ id: "support", label: "Support", icon: LifeBuoy }] },
];

type Props = { view: DashView; setView: (v: DashView) => void; onExit?: () => void };

export function Sidebar({ view, setView, onExit }: Props) {
  const plan = useBillingSummary().data;
  // Pages with unread notifications are highlighted with their count (owner, 26 Nov); opening one clears it.
  const unread = useNotifications().data?.unreadByView ?? {};
  const { logout } = useAuth();
  const foot = "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-steel transition-colors hover:bg-ink hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60";
  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col justify-between bg-shell text-white shadow-[0_1px_8px_rgba(0,0,0,0.08)]">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-6 pb-6 pt-6">
          <a href="#/dashboard" onClick={(e) => { e.preventDefault(); setView("overview"); }} className="flex items-center gap-2">
            <img src="/mushin-logo-64.png" width={32} height={32} alt="" className="h-8 w-8 shrink-0 object-contain" draggable={false} />
            <span className="text-lg font-bold tracking-tight">MUSHIN</span>
          </a>
        </div>
        <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4 [scrollbar-color:#334155_transparent] [scrollbar-width:thin]">
          {GROUPS.map((g) => (
            <div key={g.title} className="flex flex-col gap-1">
              <span className="px-3 text-[10px] font-semibold uppercase tracking-wider text-steel-2">{g.title}</span>
              {g.items.map((it) => {
                const active = view === it.id;
                const count = active ? 0 : (unread[it.id] ?? 0);
                return (
                  <button
                    key={it.id}
                    data-tour={it.tour}
                    onClick={() => setView(it.id)}
                    aria-current={active ? "page" : undefined}
                    aria-describedby={count > 0 ? `nav-new-${it.id}` : undefined}
                    className={`relative flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 ${active ? "font-semibold text-cyan-soft" : count > 0 ? "bg-cyan-500/10 font-semibold text-white ring-1 ring-cyan-400/30 hover:bg-ink" : "text-mist hover:bg-ink hover:text-white"}`}
                  >
                    {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-ink ring-1 ring-white/5" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                    <it.icon aria-hidden className="relative h-[18px] w-[18px]" strokeWidth={1.75} />
                    <span className="relative">{it.label}</span>
                    {count > 0 && (
                      <span aria-hidden="true" id={`nav-new-${it.id}`} data-testid={`nav-badge-${it.id}`} className="relative ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan-400 px-1.5 text-[10.5px] font-extrabold tabular-nums text-[#0A0F24]">
                        {count > 99 ? "99+" : count}
                        <span className="sr-only"> new {count === 1 ? "notification" : "notifications"}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
      <div className="m-3 flex flex-col gap-2">
        {plan && (
          <button onClick={() => setView("billing")} className="flex items-center justify-between rounded-xl bg-ink p-3 text-left transition-colors hover:bg-[#1a2440]">
            <span className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-steel">Current plan</span>
              <span className="text-[13px] font-medium">{plan.plan?.name ?? (plan.status === "trialing" ? "Free trial" : "No plan")}</span>
            </span>
            <span className="h-2 w-2 rounded-full bg-cyan-soft shadow-[0_0_8px_#57dffe]" />
          </button>
        )}
        <button onClick={() => window.dispatchEvent(new Event(OPEN_REVIEW_EVENT))} className={foot}>
          <Star className="h-4 w-4" /> Leave a review
        </button>
        <button onClick={() => { void logout(); onExit?.(); }} className={foot}>
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}
