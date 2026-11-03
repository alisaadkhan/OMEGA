import { LayoutDashboard, Search, ListChecks, FolderKanban, Inbox as InboxIcon } from "lucide-react";
import { Logo } from "../landing/Logo";

/**
 * Primary navigation (owner direction 2026-11-03): only the working pages, on the dark navy panel of the design.
 * Settings, Credits & billing, Activity log, Support, Leave a review, Back to site and Sign out live in the profile menu
 * (Topbar). Labels match the page headings; view ids are unchanged.
 */

export type DashView =
  | "overview"
  | "search"
  | "lists"
  | "campaigns"
  | "billing"
  | "settings"
  | "support"
  | "activity"
  | "inbox";

export const DASH_VIEWS: readonly DashView[] = ["overview", "search", "lists", "campaigns", "billing", "settings", "support", "activity", "inbox"];

const items: { id: DashView; label: string; icon: typeof Search }[] = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "search", label: "Search & Discovery", icon: Search },
  { id: "lists", label: "Shortlists", icon: ListChecks },
  { id: "campaigns", label: "Campaigns", icon: FolderKanban },
  { id: "inbox", label: "Inbox", icon: InboxIcon },
];

type Props = { view: DashView; setView: (v: DashView) => void };

export function Sidebar({ view, setView }: Props) {
  return (
    <aside className="flex w-60 flex-shrink-0 flex-col bg-[#0b1c30] text-white shadow-[0_1px_8px_rgba(0,0,0,0.08)]">
      <div className="flex h-16 items-center px-5">
        <Logo variant="dark" />
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#8a9ab3]">Discover</div>
        <div className="space-y-0.5">
          {items.map((item) => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                aria-current={active ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                  active ? "bg-[#131b2e] text-white shadow-sm ring-1 ring-white/10" : "text-[#b7c8e1] hover:bg-[#131b2e] hover:text-white"
                }`}
              >
                <item.icon aria-hidden className={`h-4 w-4 ${active ? "text-cyan-300" : "text-[#8a9ab3]"}`} strokeWidth={1.75} />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
