import {
  LayoutDashboard,
  Search,
  ListChecks,
  FolderKanban,
  CreditCard,
  ChevronLeft,
  BarChart3,
} from "lucide-react";
import { Logo } from "../landing/Logo";

/**
 * Primary navigation — kept intentionally small (simplicity rule).
 * Analytics, Activity, Settings and Support live in the profile menu (Topbar).
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
  // Rendered by Dashboard but not in the sidebar yet; outreach (a later sub-project) links to it.
  | "inbox";

type NavItem = { id: DashView; label: string; icon: any };
type NavGroup = { label: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { id: "overview", label: "Dashboard", icon: LayoutDashboard },
      { id: "search", label: "Search", icon: Search },
      { id: "lists", label: "Lists", icon: ListChecks },
      { id: "campaigns", label: "Campaigns", icon: FolderKanban },
      { id: "analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Account",
    items: [
      { id: "billing", label: "Credits & billing", icon: CreditCard },
    ],
  },
];

type Props = { view: DashView; setView: (v: DashView) => void; onExit: () => void };

export function Sidebar({ view, setView, onExit }: Props) {
  return (
    <aside className="flex w-60 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-16 items-center border-b border-slate-200 px-5">
        <Logo />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-5">
        {groups.map((g, gi) => (
          <div key={g.label} className={gi > 0 ? "mt-5" : ""}>
            <div
              className="px-2.5 pb-2 text-slate-500"
              style={{ fontSize: 10, letterSpacing: "0.12em", fontWeight: 600, textTransform: "uppercase" }}
            >
              {g.label}
            </div>
            <div className="space-y-0.5">
              {g.items.map((item) => {
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setView(item.id)}
                    className={`group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-all ${
                      active
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                    style={{ fontWeight: 500 }}
                  >
                    <item.icon
                      className={`h-4 w-4 ${active ? "text-white" : "text-slate-500"}`}
                      strokeWidth={1.75}
                    />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-3">
        <button
          onClick={onExit}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100"
        >
          <ChevronLeft className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
          Back to site
        </button>
      </div>
    </aside>
  );
}
