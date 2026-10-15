import { useState } from "react";
import { Briefcase, CheckSquare, Eye, History, KeyRound, LayoutDashboard, LifeBuoy, Server, Users, UserX, Workflow, X } from "lucide-react";
import type { AdminRole } from "../../admin/AdminAuthContext";
import { AuditSearch, OpsAlerts, ProviderControls } from "../admin/OpsControls";
import { OpsJobs, OpsOverview, OpsProviders, OpsWorkspaces } from "../admin/OpsViews";
import { RemovalRequests } from "../admin/RemovalRequests";
import { Approvals, StaffDirectory } from "../admin/StaffAdmin";
import { StaffSecurity } from "../admin/StaffSecurity";
import { SupportAccessStaff } from "../admin/SupportAccessStaff";
import { SupportQueue } from "../admin/SupportQueue";
import { StepUpBar, StepUpProvider } from "../admin/staff-ui";

/**
 * Staff console (canonical spec pages 16, 20–23; staff spec §4). Every view reads the staff API, and the server enforces
 * each permission and the hardware-key step-up again, so this navigation filter is only a convenience.
 */
type AdminView = "overview" | "jobs" | "workspaces" | "access" | "support" | "providers" | "removals" | "approvals" | "staff" | "audit" | "security";

const ALL: AdminRole[] = ["support", "admin", "super_admin"];
const ADMINS: AdminRole[] = ["admin", "super_admin"];
const NAV: { id: AdminView; label: string; icon: typeof X; roles: AdminRole[] }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, roles: ALL },
  { id: "jobs", label: "Jobs", icon: Workflow, roles: ALL },
  { id: "workspaces", label: "Workspaces", icon: Briefcase, roles: ALL },
  { id: "access", label: "Workspace access", icon: Eye, roles: ALL },
  { id: "support", label: "Support queue", icon: LifeBuoy, roles: ALL },
  { id: "providers", label: "Providers", icon: Server, roles: ADMINS },
  { id: "removals", label: "Removal requests", icon: UserX, roles: ADMINS },
  { id: "approvals", label: "Approvals", icon: CheckSquare, roles: ADMINS },
  { id: "staff", label: "Staff", icon: Users, roles: ADMINS },
  { id: "audit", label: "Audit log", icon: History, roles: ADMINS },
  { id: "security", label: "Security", icon: KeyRound, roles: ALL },
];

export function AdminConsole({ onExit, role, staffId }: { onExit: () => void; role: AdminRole; staffId: string }) {
  const [view, setView] = useState<AdminView>("overview");
  const items = NAV.filter((n) => n.roles.includes(role));
  const admin = role !== "support";
  return (
    <StepUpProvider>
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
          <div className="border-t border-slate-200 p-3">
            <button onClick={onExit} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs text-slate-600 hover:bg-white" style={{ fontWeight: 500 }}>
              <X className="h-3.5 w-3.5" /> Exit staff console
            </button>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <StepUpBar onSetUp={() => setView("security")} />
          <main className="flex-1 overflow-y-auto bg-white px-6 py-6">
            {view === "overview" && (
              <>
                <OpsAlerts />
                <OpsOverview />
              </>
            )}
            {view === "jobs" && <OpsJobs canAct={admin} />}
            {view === "workspaces" && <OpsWorkspaces />}
            {view === "access" && <SupportAccessStaff />}
            {view === "support" && <SupportQueue me={staffId} canAssignOthers={admin} />}
            {view === "providers" && admin && (
              <>
                <ProviderControls />
                <OpsProviders />
              </>
            )}
            {view === "removals" && admin && <RemovalRequests />}
            {view === "approvals" && admin && <Approvals me={staffId} role={role} />}
            {view === "staff" && admin && <StaffDirectory me={staffId} role={role} />}
            {view === "audit" && admin && <AuditSearch />}
            {view === "security" && <StaffSecurity />}
          </main>
        </div>
      </div>
    </StepUpProvider>
  );
}
