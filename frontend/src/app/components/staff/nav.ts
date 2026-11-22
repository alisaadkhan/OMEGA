import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { BarChart3, BookUser, CheckCircle2, CreditCard, Database, Eye, Flag, LayoutGrid, LifeBuoy, Radar, Settings, Shield, ShieldCheck, Trash2, UserCog, Users, type LucideIcon } from "lucide-react";
import { creatorFlagListSchema, staffAlertsSchema, staffOverviewSchema } from "@mushin/contracts";
import type { AdminRole } from "../../admin/AdminAuthContext";
import { adminRequest } from "../../admin/adminApi";

/** Staff portal sections (owner design, 22 Nov). The server enforces every permission again; this only hides links. */
export type StaffView =
  | "overview" | "users" | "subscriptions" | "tickets" | "scans" | "sources"
  | "catalogue" | "checks" | "reports" | "removals"
  | "approvals" | "staff" | "trials" | "activity" | "access" | "settings";

const ALL: AdminRole[] = ["support", "admin", "super_admin"];
const ADMINS: AdminRole[] = ["admin", "super_admin"];
export type BadgeKey = "tickets" | "scans" | "checks" | "reports" | "removals" | "approvals";
export type NavItem = { id: StaffView; label: string; icon: LucideIcon; roles: AdminRole[]; badge?: BadgeKey };

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "System",
    items: [
      { id: "overview", label: "Overview", icon: LayoutGrid, roles: ALL },
      { id: "users", label: "Users", icon: Users, roles: ALL },
      { id: "subscriptions", label: "Subscriptions", icon: CreditCard, roles: ADMINS },
      { id: "tickets", label: "Tickets", icon: LifeBuoy, roles: ALL, badge: "tickets" },
      { id: "scans", label: "Live Scans", icon: Radar, roles: ALL, badge: "scans" },
      { id: "sources", label: "Data Sources", icon: Database, roles: ADMINS },
    ],
  },
  {
    group: "Creators",
    items: [
      { id: "catalogue", label: "Catalogue", icon: BookUser, roles: ALL },
      { id: "checks", label: "Creator Checks", icon: ShieldCheck, roles: ALL, badge: "checks" },
      { id: "reports", label: "Reported Profiles", icon: Flag, roles: ALL, badge: "reports" },
      { id: "removals", label: "Data Removals", icon: Trash2, roles: ADMINS, badge: "removals" },
    ],
  },
  {
    group: "Team & Logs",
    items: [
      { id: "approvals", label: "Approvals", icon: CheckCircle2, roles: ADMINS, badge: "approvals" },
      { id: "staff", label: "Staff Team", icon: UserCog, roles: ADMINS },
      { id: "trials", label: "Trials & Stats", icon: BarChart3, roles: ALL },
      { id: "activity", label: "Activity & Security", icon: Shield, roles: ADMINS },
      { id: "access", label: "Customer Access", icon: Eye, roles: ALL },
      { id: "settings", label: "Settings", icon: Settings, roles: ALL },
    ],
  },
];

export const ALL_VIEWS = NAV.flatMap((g) => g.items);
export const viewFromHash = (hash: string): StaffView | null => {
  const id = hash.replace(/^#\/?/, "").split(/[/?]/)[0] ?? "";
  return (ALL_VIEWS.find((v) => v.id === id)?.id ?? null) as StaffView | null;
};

const reviewCounts = z.object({ counts: z.object({ country: z.number(), minor: z.number(), organisation: z.number(), assessment: z.number() }) });

/** Live counts for the sidebar badges, read from the same staff endpoints the pages use. 0 shows no badge. */
export function useNavBadges(role: AdminRole): Partial<Record<BadgeKey, number>> {
  const admin = role !== "support";
  const opt = { refetchInterval: 60_000, staleTime: 30_000 } as const;
  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: () => adminRequest("/admin/v1/ops/overview", staffOverviewSchema), ...opt });
  const alerts = useQuery({ queryKey: ["admin", "alerts"], queryFn: () => adminRequest("/admin/v1/ops/alerts", staffAlertsSchema), ...opt });
  const review = useQuery({ queryKey: ["admin", "nav", "review"], queryFn: () => adminRequest("/admin/v1/catalogue/review?kind=country&offset=0", reviewCounts), ...opt });
  const flags = useQuery({ queryKey: ["admin", "nav", "flags"], queryFn: () => adminRequest("/admin/v1/catalogue/flags?status=pending", creatorFlagListSchema), ...opt });
  const c = review.data?.counts;
  return {
    tickets: overview.data?.openTickets,
    scans: overview.data?.openJobs,
    checks: c ? c.country + c.minor + c.organisation + c.assessment : undefined,
    reports: flags.data?.counts.pending,
    removals: admin ? alerts.data?.pendingRemovals : undefined,
    approvals: admin ? alerts.data?.pendingApprovals : undefined,
  };
}
