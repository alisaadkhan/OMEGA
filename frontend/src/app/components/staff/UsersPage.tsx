import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, LifeBuoy, Users as UsersIcon } from "lucide-react";
import { staffOverviewSchema, staffWorkspaceListSchema, type StaffWorkspace } from "@mushin/contracts";
import type { AdminRole } from "../../admin/AdminAuthContext";
import { adminRequest } from "../../admin/adminApi";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { AccountDrawer } from "./AccountDrawer";
import { Badge, DataTable, Empty, Kpi, PageHeader, Pills, SearchInput, errText, fmtAgo, fmtNum, initials, type Tone } from "./kit";

type Filter = "all" | "trialing" | "active" | "none";
const SUB_TONE: Record<string, Tone> = { active: "emerald", trialing: "cyan", past_due: "amber", canceled: "rose", expired: "slate" };

/**
 * Users (owner, 22 Nov): every customer account (brand or agency workspace), newest first or found by name, exact owner
 * email or id. Opening one shows its plan, credits, credit history, people and activity; Admins add credits and a Super
 * Admin assigns a plan there. Support staff see masked emails and the summary only.
 */
export function UsersPage({ role }: { role: AdminRole }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<StaffWorkspace | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text.trim()), 350);
    return () => window.clearTimeout(t);
  }, [text]);
  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: () => adminRequest("/admin/v1/ops/overview", staffOverviewSchema) });
  const list = useQuery({ queryKey: ["admin", "workspaces", query], queryFn: () => adminRequest(`/admin/v1/ops/workspaces?q=${encodeURIComponent(query)}`, staffWorkspaceListSchema) });
  const rows = (list.data?.workspaces ?? []).filter((w) => (filter === "all" ? true : filter === "none" ? !w.subscriptionStatus : w.subscriptionStatus === filter));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Customers" title="Users" sub="Brand and agency accounts registered on MUSHIN. Searches and account views are recorded in the audit log." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Kpi label="Customer accounts" value={overview.data ? fmtNum(overview.data.workspaces) : "—"} icon={<Building2 className="h-4 w-4" />} tone="cyan" hint="Active brand and agency accounts" />
        <Kpi label="People signed up" value={overview.data ? fmtNum(overview.data.users) : "—"} icon={<UsersIcon className="h-4 w-4" />} hint="Active customer users" />
        <Kpi label="Open tickets" value={overview.data ? fmtNum(overview.data.openTickets) : "—"} icon={<LifeBuoy className="h-4 w-4" />} tone="amber" hint="Waiting on MUSHIN or the customer" />
      </div>
      <section className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm xl:flex-row xl:items-center">
        <div className="min-w-[220px] flex-1"><SearchInput value={text} onChange={setText} placeholder="Search by account name, exact owner email or account id…" label="Search accounts" /></div>
        <Pills<Filter> value={filter} onChange={setFilter} label="Filter by subscription" options={[{ id: "all", label: "All" }, { id: "trialing", label: "Trial" }, { id: "active", label: "Subscribed" }, { id: "none", label: "No plan" }]} />
      </section>
      {list.isPending ? <LoadingBlock lines={6} /> : list.isError ? <ErrorState body={errText(list.error)} onRetry={() => void list.refetch()} /> : rows.length === 0 ? <Empty title="No accounts match" body={query ? "Partial email searches are not allowed; use the exact owner email, the account name or its id." : undefined} /> : (
        <>
          <DataTable head={["Account", "Owner", "People", "Subscription", "Jobs (30 days)", "Open tickets", "Created", ""]} minWidth={900}>
            {rows.map((w) => (
              <tr key={w.id} onClick={() => setOpen(w)} className="cursor-pointer transition-colors hover:bg-slate-50/90">
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0f172a] font-mono text-[11px] font-bold text-[#4cd7f6]">{initials(w.name)}</div>
                    <div className="min-w-0"><div className="truncate font-bold text-slate-900">{w.name}</div><div className="truncate font-mono text-[10.5px] text-slate-500">{w.id.slice(0, 8)}</div></div>
                  </div>
                </td>
                <td className="px-4 py-3.5 font-mono text-[11.5px] text-slate-600">{w.ownerEmail}</td>
                <td className="px-4 py-3.5 tabular-nums">{w.members}</td>
                <td className="px-4 py-3.5">{w.subscriptionStatus ? <Badge tone={SUB_TONE[w.subscriptionStatus] ?? "slate"} dot>{w.subscriptionStatus === "trialing" ? "Trial" : w.subscriptionStatus.replace(/_/g, " ")}</Badge> : <Badge>No plan</Badge>}</td>
                <td className="px-4 py-3.5 text-right font-mono font-bold tabular-nums text-slate-800">{fmtNum(w.jobs30d)}</td>
                <td className="px-4 py-3.5 tabular-nums">{w.openTickets}</td>
                <td className="whitespace-nowrap px-4 py-3.5 font-mono text-[11px] text-slate-500">{fmtAgo(w.createdAt)}</td>
                <td className="px-4 py-3.5 text-right"><span className="text-[11px] font-semibold text-cyan-700">Open</span></td>
              </tr>
            ))}
          </DataTable>
          <p className="text-[11px] text-slate-500">Showing {rows.length} account{rows.length === 1 ? "" : "s"}{query ? " matching your search" : " (the 50 newest; search to find others)"}.</p>
        </>
      )}
      {open && <AccountDrawer key={open.id} workspace={open} role={role} onClose={() => setOpen(null)} />}
    </div>
  );
}
