import { motion } from "motion/react";
import { Bookmark, CreditCard, History, Inbox as InboxIcon, LayoutDashboard, LifeBuoy, LogOut, Megaphone, Radar, Search, Settings, Star, ArrowLeft } from "lucide-react";
import { useBillingSummary } from "../../api/billing";
import { useAuth } from "../../auth/AuthContext";
import { OPEN_REVIEW_EVENT } from "./LeaveReview";

/**
 * Primary navigation (owner design 2026-11-16): dark navy panel with Discover, Account and Insights groups, an animated
 * active pill, and the current plan at the foot. Every account action lives here too (owner, 17 Nov: "remove every button
 * from profile and move it to side bar"): Leave a review, Back to website and Sign out. View ids are unchanged.
 */
export type DashView = "overview" | "search" | "lists" | "campaigns" | "billing" | "settings" | "support" | "activity" | "inbox";

export const DASH_VIEWS: readonly DashView[] = ["overview", "search", "lists", "campaigns", "billing", "settings", "support", "activity", "inbox"];

const GROUPS: { title: string; items: { id: DashView; label: string; icon: typeof Search; tour?: string }[] }[] = [
  {
    title: "Discover",
    items: [
      { id: "overview", label: "Dashboard", icon: LayoutDashboard },
      { id: "search", label: "Search", icon: Search },
      { id: "lists", label: "Shortlists", icon: Bookmark, tour: "shortlists" },
      { id: "campaigns", label: "Campaigns", icon: Megaphone, tour: "campaigns" },
      { id: "inbox", label: "Inbox", icon: InboxIcon },
    ],
  },
  { title: "Account", items: [{ id: "billing", label: "Credits & Billing", icon: CreditCard }, { id: "settings", label: "Settings", icon: Settings }] },
  { title: "Insights", items: [{ id: "activity", label: "Activity Log", icon: History }, { id: "support", label: "Support", icon: LifeBuoy }] },
];

type Props = { view: DashView; setView: (v: DashView) => void; onExit?: () => void };

export function Sidebar({ view, setView, onExit }: Props) {
  const plan = useBillingSummary().data;
  const { logout } = useAuth();
  const foot = "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-steel transition-colors hover:bg-ink hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60";
  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col justify-between bg-shell text-white shadow-[0_1px_8px_rgba(0,0,0,0.08)]">
      <div className="flex min-h-0 flex-col">
        <div className="px-6 pb-6 pt-6">
          <a href="#/dashboard" onClick={(e) => { e.preventDefault(); setView("overview"); }} className="flex items-center gap-2">
            <motion.span whileHover={{ rotate: 90 }} transition={{ type: "spring", stiffness: 300 }} className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal text-white shadow-[0_0_8px_rgba(6,182,212,0.35)]">
              <Radar className="h-5 w-5" />
            </motion.span>
            <span className="flex flex-col leading-none">
              <span className="text-lg font-bold tracking-tight">MUSHIN</span>
              <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-soft">Creator Intelligence</span>
            </span>
          </a>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-4 overflow-y-auto px-4">
          {GROUPS.map((g) => (
            <div key={g.title} className="flex flex-col gap-1">
              <span className="px-3 text-[10px] font-semibold uppercase tracking-wider text-steel-2">{g.title}</span>
              {g.items.map((it) => {
                const active = view === it.id;
                return (
                  <button
                    key={it.id}
                    data-tour={it.tour}
                    onClick={() => setView(it.id)}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 ${active ? "font-semibold text-cyan-soft" : "text-mist hover:bg-ink hover:text-white"}`}
                  >
                    {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-ink ring-1 ring-white/5" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                    <it.icon aria-hidden className="relative h-[18px] w-[18px]" strokeWidth={1.75} />
                    <span className="relative">{it.label}</span>
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
        {onExit && (
          <button onClick={onExit} className={foot}>
            <ArrowLeft className="h-4 w-4" /> Back to website
          </button>
        )}
        <button onClick={() => { void logout(); onExit?.(); }} className={foot}>
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}
