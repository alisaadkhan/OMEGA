import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { activityFeedSchema, approvalSchema, staffAccountSchema, staffPlanGrantResultSchema, type StaffWorkspace } from "@mushin/contracts";
import type { AdminRole } from "../../admin/AdminAuthContext";
import { adminRequest } from "../../admin/adminApi";
import { useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { needsKey, useStepUp } from "../admin/staff-ui";
import { Badge, Drawer, errText, fmtAgo, fmtNum, fmtWhen } from "./kit";

const PLANS = [
  { id: "explorer", label: "Explorer" },
  { id: "growth", label: "Growth" },
  { id: "scale", label: "Scale" },
] as const;
const input = "w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] text-slate-900 focus:border-cyan-600 focus:bg-white focus:outline-none";
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
    {children}
  </div>
);

/** Runs a privileged call; when the server asks for the security key, confirms it once and retries. */
function useKeyed() {
  const step = useStepUp();
  return async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (needsKey(err) && (await step.confirm())) return fn();
      throw err;
    }
  };
}

function AssignPlan({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const keyed = useKeyed();
  const toast = useToast();
  const [planId, setPlanId] = useState<(typeof PLANS)[number]["id"]>("growth");
  const [months, setMonths] = useState(1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await keyed(() => adminRequest(`/admin/v1/ops/workspaces/${workspaceId}/plan`, staffPlanGrantResultSchema, { method: "POST", body: { planId, months, reason: reason.trim() } }));
      toast.success(`Plan assigned until ${fmtWhen(r.periodEnd)}`, `${fmtNum(r.monthlyCredits)} credits granted for the first month.`);
      setReason("");
      onDone();
    } catch (err) {
      toast.error("Plan not assigned", errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2 rounded-xl border border-slate-200 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-semibold text-slate-600">Plan<select value={planId} onChange={(e) => setPlanId(e.target.value as typeof planId)} className={`mt-1 ${input}`}>{PLANS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label className="text-[11px] font-semibold text-slate-600">Months (no payment)<input type="number" min={1} max={24} value={months} onChange={(e) => setMonths(Math.max(1, Math.min(24, Number(e.target.value) || 1)))} className={`mt-1 ${input} tabular-nums`} /></label>
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Reason (at least 12 characters)" aria-label="Reason for the plan" className={input} />
      <button type="submit" disabled={busy || reason.trim().length < 12} className="w-full rounded-xl bg-[#0f172a] px-3 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-50">{busy ? "Assigning…" : "Assign complimentary plan"}</button>
      <p className="text-[11px] text-slate-500">Refused when the account already pays through the payment provider. Recorded in the audit log.</p>
    </form>
  );
}

function AddCredits({ workspaceId, role, onDone }: { workspaceId: string; role: AdminRole; onDone: () => void }) {
  const keyed = useKeyed();
  const toast = useToast();
  const [amount, setAmount] = useState(500);
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { action: "credits.grant", payload: { workspaceId, amount, expiresInDays: days }, reason: reason.trim() };
      const req = await keyed(() => adminRequest("/admin/v1/approvals", approvalSchema, { method: "POST", body }));
      // A Super Admin may approve their own credit grant (0071); anyone else waits for a second person.
      if (role === "super_admin") {
        await keyed(() => adminRequest(`/admin/v1/approvals/${req.id}/decision`, approvalSchema, { method: "POST", body: { decision: "approve", note: "Added from the Users page" } }));
        toast.success(`${fmtNum(amount)} credits added`);
      } else toast.success("Credit request sent", "Another staff member approves it under Approvals.");
      setReason("");
      onDone();
    } catch (err) {
      toast.error("Credits not added", errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2 rounded-xl border border-slate-200 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-semibold text-slate-600">Credits<input type="number" min={1} max={100000} value={amount} onChange={(e) => setAmount(Math.max(1, Math.min(100_000, Math.round(Number(e.target.value) || 1))))} className={`mt-1 ${input} tabular-nums`} /></label>
        <label className="text-[11px] font-semibold text-slate-600">Expire after (days)<input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Math.max(1, Math.min(365, Math.round(Number(e.target.value) || 1))))} className={`mt-1 ${input} tabular-nums`} /></label>
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Reason (at least 12 characters)" aria-label="Reason for the credits" className={input} />
      <button type="submit" disabled={busy || reason.trim().length < 12} className="w-full rounded-xl bg-[#0f172a] px-3 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-50">{busy ? "Working…" : role === "super_admin" ? "Add credits" : "Request credits (needs a second person)"}</button>
    </form>
  );
}

export function AccountDrawer({ workspace, role, onClose }: { workspace: StaffWorkspace; role: AdminRole; onClose: () => void }) {
  const qc = useQueryClient();
  const admin = role !== "support";
  const acct = useQuery({ queryKey: ["admin", "account", workspace.id], queryFn: () => adminRequest(`/admin/v1/ops/workspaces/${workspace.id}/account`, staffAccountSchema), enabled: admin });
  const feed = useQuery({ queryKey: ["admin", "account-activity", workspace.id], queryFn: () => adminRequest(`/admin/v1/ops/workspaces/${workspace.id}/activity?limit=20`, activityFeedSchema), enabled: admin });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin"] });
  const a = acct.data;
  const plan = a?.plan;
  const used = a ? a.credits.spent30d : 0;
  const pool = a ? used + Math.max(0, a.credits.available) : 0;
  return (
    <Drawer eyebrow="Account details" title={workspace.name} sub={`${workspace.ownerEmail} · created ${fmtWhen(workspace.createdAt)}`} onClose={onClose}>
      {!admin ? (
        <p className="rounded-xl bg-slate-50 p-3 text-slate-600">Plan, credits and activity are open to Admins. Use Customer Access to view an account with the customer's consent.</p>
      ) : acct.isPending ? <LoadingBlock lines={6} /> : acct.isError ? <ErrorState body={errText(acct.error)} onRetry={() => void acct.refetch()} /> : a ? (
        <>
          <Section title="Plan">
            {plan ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-900">{plan.name ?? "No plan"}</span>
                <Badge tone={plan.status === "active" ? "emerald" : plan.status === "trialing" ? "cyan" : "amber"}>{plan.status}</Badge>
                {plan.complimentary && <Badge tone="indigo">Complimentary</Badge>}
                <span className="text-xs text-slate-500">{plan.status === "trialing" ? `Trial ends ${fmtWhen(plan.trialEndsAt)}` : plan.periodEnd ? `Until ${fmtWhen(plan.periodEnd)}` : ""}</span>
              </div>
            ) : <p className="text-slate-500">No subscription.</p>}
          </Section>
          <Section title="Credits">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-800 tabular-nums"><span>{fmtNum(used)} used in 30 days</span><span>{fmtNum(a.credits.available)} available{a.credits.reserved ? ` · ${fmtNum(a.credits.reserved)} held` : ""}</span></div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#06b6d4]" style={{ width: `${pool ? Math.round((used / pool) * 100) : 0}%` }} /></div>
            <p className="mt-1 text-[11px] text-slate-500">{fmtNum(a.credits.granted30d)} credits granted in the last 30 days.</p>
          </Section>
          <Section title="Credit history">
            {a.ledger.length === 0 ? <p className="text-slate-500">No credit movements yet.</p> : (
              <ul className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-1">
                {a.ledger.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 last:border-b-0">
                    <span className="min-w-0 truncate text-slate-700">{l.note ?? `${l.kind}${l.action ? ` · ${l.action.replace(/_/g, " ")}` : ""}`}{l.byStaff ? " (staff)" : ""}<span className="ml-2 text-[10.5px] text-slate-400">{fmtAgo(l.createdAt)}</span></span>
                    <span className={`shrink-0 font-mono text-[11px] font-bold ${l.amount < 0 ? "text-rose-600" : "text-emerald-700"}`}>{l.amount > 0 ? "+" : ""}{fmtNum(l.amount)} cr</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title={`People (${a.members.length})`}>
            <ul className="space-y-1.5">{a.members.map((m) => <li key={m.email} className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50 p-2.5"><span className="min-w-0 truncate"><span className="font-semibold text-slate-900">{m.name ?? m.email}</span> <span className="text-slate-500">{m.name ? m.email : ""}</span></span><Badge tone={m.role === "owner" ? "slate" : "cyan"}>{m.role}</Badge></li>)}</ul>
          </Section>
          <Section title="Recent activity">
            {feed.isPending ? <LoadingBlock lines={3} /> : feed.isError ? <ErrorState body={errText(feed.error)} /> : feed.data.events.length === 0 ? <p className="text-slate-500">No activity recorded.</p> : (
              <ul className="space-y-1.5">{feed.data.events.map((e) => <li key={e.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50 p-2.5"><span className="min-w-0 truncate text-slate-800">{e.actor?.name ?? "Someone"} {e.text}</span><span className="shrink-0 font-mono text-[10px] text-slate-400">{fmtAgo(e.at)}</span></li>)}</ul>
            )}
          </Section>
          <Section title="Add credits"><AddCredits workspaceId={workspace.id} role={role} onDone={refresh} /></Section>
          {role === "super_admin" && <Section title="Assign plan"><AssignPlan workspaceId={workspace.id} onDone={refresh} /></Section>}
        </>
      ) : null}
    </Drawer>
  );
}
