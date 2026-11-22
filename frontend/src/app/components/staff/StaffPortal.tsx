import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { staffJobListSchema, staffOverviewSchema, staffAlertsSchema, staffTicketListSchema, staffWorkspaceListSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { useAdminAuth } from "../../admin/AdminAuthContext";
import { AuditSearch, ProviderControls } from "../admin/OpsControls";
import { OpsJobs, OpsProviders } from "../admin/OpsViews";
import { RemovalRequests } from "../admin/RemovalRequests";
import { CreatorFlags } from "../admin/CreatorFlags";
import { Approvals, StaffDirectory } from "../admin/StaffAdmin";
import { StaffSecurity } from "../admin/StaffSecurity";
import { SupportAccessStaff } from "../admin/SupportAccessStaff";
import { SupportQueue } from "../admin/SupportQueue";
import { TrialRequests } from "../admin/TrialRequests";
import { ProductReviews, UsageInsights } from "../admin/Insights";
import { ALL_VIEWS, viewFromHash, type StaffView } from "./nav";
import { CreatorChecksPage } from "./CreatorChecksPage";
import { HealthPage } from "./HealthPage";
import { IntegrationsCard } from "./IntegrationsCard";
import { OverviewPage } from "./OverviewPage";
import { SettingsPage } from "./SettingsPage";
import { StaffLogin } from "./StaffLogin";
import { StaffShell } from "./StaffShell";
import { SubscriptionsPage } from "./SubscriptionsPage";
import { UsersPage } from "./UsersPage";

export function StaffPortal() {
  const { admin, status, signOut } = useAdminAuth();
  const [view, setView] = useState<StaffView | null>(() => viewFromHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setView(viewFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const qc = useQueryClient();
  // Pages open instantly after their first load: staff data stays fresh for a minute and in memory for 15, and the main
  // pages load in the background right after sign-in (every call crosses Pakistan to the Seoul servers, ~0.4 s each).
  useEffect(() => {
    qc.setQueryDefaults(["admin"], { staleTime: 60_000, gcTime: 15 * 60_000 });
  }, [qc]);
  useEffect(() => {
    if (!admin) return;
    const pre = (queryKey: unknown[], path: string, schema: Parameters<typeof adminRequest>[1]) => void qc.prefetchQuery({ queryKey, queryFn: () => adminRequest(path, schema) });
    pre(["admin", "overview"], "/admin/v1/ops/overview", staffOverviewSchema);
    pre(["admin", "alerts"], "/admin/v1/ops/alerts", staffAlertsSchema);
    pre(["admin", "workspaces", ""], "/admin/v1/ops/workspaces?q=", staffWorkspaceListSchema);
    pre(["admin", "jobs", ""], "/admin/v1/ops/jobs?limit=100", staffJobListSchema);
    pre(["admin", "tickets", "open"], "/admin/v1/support/tickets?status=open", staffTicketListSchema);
  }, [admin, qc]);
  useEffect(() => {
    document.title = admin ? "MUSHIN — Staff Console" : "MUSHIN — Staff Sign In";
  }, [admin]);

  if (status === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-[#0A0F24] text-xs text-slate-400" role="status">Checking your staff session…</div>;
  }
  if (!admin) return <StaffLogin onSuccess={() => undefined} />;

  const role = admin.role;
  const isAdmin = role !== "support";
  // Each role lands on its own primary page; a section the role cannot open falls back to it.
  const home: StaffView = isAdmin ? "overview" : "tickets";
  const allowed = (v: StaffView | null) => (v && ALL_VIEWS.find((i) => i.id === v)?.roles.includes(role) ? v : null);
  const current = allowed(view) ?? home;
  const go = (v: StaffView) => {
    window.location.hash = `/${v}`;
    setView(v);
    window.scrollTo(0, 0);
  };

  return (
    <StaffShell admin={admin} view={current} onView={go} onSignOut={() => void signOut()}>
      {current === "overview" && <OverviewPage canTest={isAdmin} />}
      {current === "health" && <HealthPage canTest={isAdmin} />}
      {current === "users" && <UsersPage role={role} />}
      {current === "subscriptions" && <SubscriptionsPage canEditPricing={role === "super_admin"} />}
      {current === "tickets" && <SupportQueue me={admin.id} canAssignOthers={isAdmin} role={role} />}
      {current === "scans" && <OpsJobs canAct={isAdmin} />}
      {current === "sources" && (
        <>
          <OpsProviders />
          <IntegrationsCard />
          <div className="mt-6"><ProviderControls /></div>
        </>
      )}
      {current === "checks" && <CreatorChecksPage canEdit={isAdmin} />}
      {current === "reports" && <CreatorFlags canDecide={isAdmin} />}
      {current === "removals" && <RemovalRequests />}
      {current === "approvals" && <Approvals me={admin.id} role={role} />}
      {current === "staff" && <StaffDirectory me={admin.id} role={role} />}
      {current === "trials" && (
        <div className="space-y-8">
          <TrialRequests role={role} />
          {isAdmin && <UsageInsights role={role} />}
          {isAdmin && <ProductReviews />}
        </div>
      )}
      {current === "activity" && <AuditSearch />}
      {current === "access" && <SupportAccessStaff />}
      {current === "settings" && <SettingsPage admin={admin} security={<StaffSecurity />} />}
    </StaffShell>
  );
}
