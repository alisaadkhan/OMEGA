import {
  LayoutDashboard,
  Search,
  ListChecks,
  FolderKanban,
  CreditCard,
  ChevronLeft,
  BarChart3,
  Settings,
  LifeBuoy,
  LogOut,
  History,
  Inbox as InboxIcon,
  Star,
} from "lucide-react";
import { OPEN_REVIEW_EVENT } from "./LeaveReview";
import { Logo } from "../landing/Logo";
import { useAuth } from "../../auth/AuthContext";

/**
 * Primary navigation (MUSHIN design system, 2026-10-27): the working pages, then the workspace pages, then the person
 * signed in. Settings and Support are here as in the design and stay in the profile menu too. Labels match the page
 * headings: "Search & Discovery" and "Shortlists" (owner decision 2026-10-27); routes and view ids are unchanged.
 */

export type DashView =
  | "overview"
  | "search"
  | "lists"
  | "campaigns"
  | "analytics"
  | "billing"
  | "settings"
  | "support"
  | "activity"
  | "inbox";

export const DASH_VIEWS: readonly DashView[] = ["overview", "search", "lists", "campaigns", "analytics", "billing", "settings", "support", "activity", "inbox"];

type NavItem = { id: DashView; label: string; icon: any };
type NavGroup = { label: string | null; items: NavItem[] };

const groups: NavGroup[] = [
  {
    label: null,
    items: [
      { id: "overview", label: "Dashboard", icon: LayoutDashboard },
      { id: "search", label: "Search & Discovery", icon: Search },
      { id: "lists", label: "Shortlists", icon: ListChecks },
      { id: "campaigns", label: "Campaigns", icon: FolderKanban },
      { id: "analytics", label: "Analytics", icon: BarChart3 },
      { id: "inbox", label: "Inbox", icon: InboxIcon },
      { id: "activity", label: "Activity log", icon: History },
    ],
  },
  {
    label: "Account",
    items: [
      { id: "billing", label: "Credits & billing", icon: CreditCard },
      { id: "settings", label: "Settings", icon: Settings },
      { id: "support", label: "Support", icon: LifeBuoy },
    ],
  },
];

type Props = { view: DashView; setView: (v: DashView) => void; onExit: () => void };

export function Sidebar({ view, setView, onExit }: Props) {
  const { user, logout } = useAuth();
  return (
    <aside className="flex w-60 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-16 items-center border-b border-slate-200 px-5">
        <Logo />
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((g, gi) => (
          <div key={g.label ?? gi} className={gi > 0 ? "mt-6" : ""}>
            {g.label && <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">{g.label}</div>}
            <div className="space-y-0.5">
              {g.items.map((item) => {
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setView(item.id)}
                    aria-current={active ? "page" : undefined}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <item.icon aria-hidden className={`h-4 w-4 ${active ? "text-white" : "text-slate-500"}`} strokeWidth={1.75} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_REVIEW_EVENT))}
          className="mt-6 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Star aria-hidden className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
          Leave a review
        </button>
      </nav>
      <div className="border-t border-slate-200 p-3">
        {user && (
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span aria-hidden className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
              {user.initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-slate-900">{user.name}</div>
              <div className="truncate text-xs text-slate-500">{user.email}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                void logout();
                onExit();
              }}
              aria-label="Sign out"
              title="Sign out"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <LogOut aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        )}
        <button
          onClick={onExit}
          className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <ChevronLeft aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          Back to site
        </button>
      </div>
    </aside>
  );
}
