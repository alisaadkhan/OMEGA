import { useState } from "react";
import { Briefcase, History, LayoutDashboard, LifeBuoy, Server, UserX, Workflow, X } from "lucide-react";
import { OpsAudit, OpsJobs, OpsOverview, OpsProviders, OpsWorkspaces } from "../admin/OpsViews";
import { RemovalRequests } from "../admin/RemovalRequests";
import { SupportQueue } from "../admin/SupportQueue";

/**
 * Staff console (canonical spec pages 16, 20–23). Every view reads the staff API; the server enforces each permission
 * again, so the navigation filter is only a convenience. Not in the MVP, and therefore not shown: user management,
 * credit adjustments, revenue, global settings and super-admin tools (spec page 22 keeps them disabled).
 */
type AdminView = "overview" | "jobs" | "workspaces" | "support" | "providers" | "audit" | "removals";

const NAV: { id: AdminView; label: string; icon: typeof X; roles: ("admin" | "support")[] }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, roles: ["admin", "support"] },
  { id: "jobs", label: "Jobs", icon: Workflow, roles: ["admin", "support"] },
  { id: "workspaces", label: "Workspaces", icon: Briefcase, roles: ["admin", "support"] },
  { id: "support", label: "Support queue", icon: LifeBuoy, roles: ["admin", "support"] },
  { id: "providers", label: "Providers", icon: Server, roles: ["admin"] },
  { id: "removals", label: "Removal requests", icon: UserX, roles: ["admin"] },
  { id: "audit", label: "Audit log", icon: History, roles: ["admin"] },
];

export function AdminConsole({ onExit, role }: { onExit: () => void; role: "admin" | "support" }) {
  const [view, setView] = useState<AdminView>("overview");
  const items = NAV.filter((n) => n.roles.includes(role));
  return (
    <div className="flex h-full min-h-0 flex-1">
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50/60">
        <div className="border-b border-slate-200 px-4 py-3 text-slate-900" style={{ fontSize: 13, fontWeight: 600 }}>Staff console</div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Staff console">
          {items.map((item) => {
            const active = view === item.id;
            return (
              <button key={item.id} onClick={() => setView(item.id)} aria-current={active ? "page" : undefined} className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm ${active ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white"}`} style={{ fontWeight: 500 }}>
                <item.icon className={`h-4 w-4 ${active ? "text-indigo-600" : "text-slate-500"}`} strokeWidth={1.75} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <p className="border-t border-slate-200 px-4 py-3 text-[11px] text-slate-500">User management, credit adjustments and global settings are not available in the MVP.</p>
        <div className="border-t border-slate-200 p-3">
          <button onClick={onExit} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs text-slate-600 hover:bg-white" style={{ fontWeight: 500 }}>
            <X className="h-3.5 w-3.5" /> Exit staff console
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-white px-6 py-6">
        {view === "overview" && <OpsOverview />}
        {view === "jobs" && <OpsJobs />}
        {view === "workspaces" && <OpsWorkspaces />}
        {view === "support" && <SupportQueue />}
        {view === "providers" && role === "admin" && <OpsProviders />}
        {view === "removals" && role === "admin" && <RemovalRequests />}
        {view === "audit" && role === "admin" && <OpsAudit />}
      </main>
    </div>
  );
}
