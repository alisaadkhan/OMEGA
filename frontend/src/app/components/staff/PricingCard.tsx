import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { staffPricingSchema, type StaffPricing } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { needsKey, useStepUp } from "../admin/staff-ui";
import { Card, CardTitle, errText, fmtNum } from "./kit";

const ACTION_LABEL: Record<string, string> = {
  search_existing: "Search the catalogue",
  find_new: "Find new creators",
  live_creator: "Live search, per creator",
  reveal_contact: "Unlock a contact",
  refresh_data: "Refresh a creator",
  refresh_tiktok: "Refresh a TikTok creator",
  audience_estimate: "Audience estimate",
};
const cell = "w-28 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right font-mono text-[12.5px] tabular-nums focus:border-cyan-600 focus:outline-none disabled:bg-slate-50";

/**
 * Plans and credit costs (owner, 22 Nov): what each plan grants every month, the PKR price customers see, and what each
 * action costs. A Super Admin changes them with a reason; the card charge stays whatever the payment provider is set to.
 */
export function PricingCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const step = useStepUp();
  const q = useQuery({ queryKey: ["admin", "pricing"], queryFn: () => adminRequest("/admin/v1/ops/pricing", staffPricingSchema) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const val = (key: string, current: number) => draft[key] ?? String(current);
  const setVal = (key: string, v: string) => setDraft((d) => ({ ...d, [key]: v.replace(/[^\d]/g, "") }));

  const save = async (p: StaffPricing) => {
    const calls: (() => Promise<unknown>)[] = [];
    for (const plan of p.plans) {
      const credits = Number(val(`c:${plan.id}`, plan.monthlyCredits));
      const price = Number(val(`p:${plan.id}`, plan.displayMonthlyMinor / 100)) * 100;
      if (credits !== plan.monthlyCredits || price !== plan.displayMonthlyMinor)
        calls.push(() => adminRequest(`/admin/v1/ops/pricing/plans/${plan.id}`, staffPricingSchema, { method: "PUT", body: { monthlyCredits: credits, displayMonthlyMinor: price, reason: reason.trim() } }));
    }
    for (const a of p.actions) {
      const credits = Number(val(`a:${a.action}`, a.credits));
      if (credits !== a.credits) calls.push(() => adminRequest(`/admin/v1/ops/pricing/actions/${a.action}`, staffPricingSchema, { method: "PUT", body: { credits, reason: reason.trim() } }));
    }
    if (calls.length === 0) return toast.error("Nothing changed");
    setBusy(true);
    try {
      for (const call of calls) {
        try {
          await call();
        } catch (err) {
          if (!(needsKey(err) && (await step.confirm()))) throw err;
          await call();
        }
      }
      toast.success("Pricing saved", `${calls.length} change${calls.length === 1 ? "" : "s"}, recorded in the audit log.`);
      setDraft({});
      setReason("");
      void qc.invalidateQueries({ queryKey: ["admin", "pricing"] });
      void qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
    } catch (err) {
      toast.error("Not saved", errText(err));
      void qc.invalidateQueries({ queryKey: ["admin", "pricing"] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card label="Plans and credit costs">
      <CardTitle title="Plans and credit costs" sub={canEdit ? "Change a number, give a reason, then save. Card charges stay as set with the payment provider." : "Only a Super Admin changes these."} />
      {q.isPending ? <LoadingBlock lines={4} /> : q.isError ? <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} /> : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-left text-[10px] font-bold uppercase tracking-wider text-slate-500"><th className="py-2">Plan</th><th className="py-2 text-right">Credits / month</th><th className="py-2 text-right">Shown price (Rs. / month)</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {q.data.plans.map((p) => (
                <tr key={p.id}>
                  <td className="py-2"><div className="font-bold text-slate-900">{p.name}</div><div className="text-[11px] text-slate-500">Card charge {p.chargeCurrency} {(p.chargeMonthlyMinor / 100).toFixed(2)}</div></td>
                  <td className="py-2 text-right"><input aria-label={`${p.name} credits per month`} value={val(`c:${p.id}`, p.monthlyCredits)} onChange={(e) => setVal(`c:${p.id}`, e.target.value)} disabled={!canEdit} className={cell} /></td>
                  <td className="py-2 text-right"><input aria-label={`${p.name} shown price`} value={val(`p:${p.id}`, p.displayMonthlyMinor / 100)} onChange={(e) => setVal(`p:${p.id}`, e.target.value)} disabled={!canEdit} className={cell} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-left text-[10px] font-bold uppercase tracking-wider text-slate-500"><th className="py-2">Action</th><th className="py-2 text-right">Credits</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {q.data.actions.map((a) => (
                <tr key={a.action}>
                  <td className="py-2 text-slate-800">{ACTION_LABEL[a.action] ?? a.action.replace(/_/g, " ")}</td>
                  <td className="py-2 text-right"><input aria-label={`${ACTION_LABEL[a.action] ?? a.action} credits`} value={val(`a:${a.action}`, a.credits)} onChange={(e) => setVal(`a:${a.action}`, e.target.value)} disabled={!canEdit} className={cell} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Reason for the change (at least 12 characters)" aria-label="Reason for the pricing change" className="min-w-[260px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] focus:border-cyan-600 focus:bg-white focus:outline-none" />
              <button type="button" disabled={busy || reason.trim().length < 12} onClick={() => void save(q.data)} className="rounded-xl bg-[#0f172a] px-4 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-50">{busy ? "Saving…" : "Save pricing"}</button>
              <span className="text-[11px] text-slate-500">{fmtNum(q.data.actions.length)} actions · new values apply to the next charge or monthly grant.</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
