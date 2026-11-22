import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Gift, Layers, Receipt } from "lucide-react";
import { staffSubscriptionsSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { PricingCard } from "./PricingCard";
import { Badge, Card, CardTitle, DataTable, Empty, Kpi, PageHeader, SearchInput, errText, fmtNum, fmtWhen } from "./kit";

const money = (minor: number, currency: string) => `${currency === "PKR" ? "Rs." : currency} ${fmtNum(Math.round(minor / 100))}`;

/**
 * Subscriptions (owner design, 22 Nov): accounts on each plan (paying, complimentary, trial) and the payments the payment
 * provider recorded. Revenue is shown only from recorded payments: there is no estimate, and no manual invoice entry,
 * because billing records come from the payment provider alone.
 */
export function SubscriptionsPage({ canEditPricing }: { canEditPricing: boolean }) {
  const q = useQuery({ queryKey: ["admin", "subscriptions"], queryFn: () => adminRequest("/admin/v1/ops/subscriptions", staffSubscriptionsSchema), refetchInterval: 60_000 });
  const [text, setText] = useState("");
  if (q.isPending) return <LoadingBlock lines={6} />;
  if (q.isError) return <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const paying = d.plans.reduce((s, p) => s + p.paying, 0);
  const comp = d.plans.reduce((s, p) => s + p.complimentary, 0);
  const trials = d.plans.reduce((s, p) => s + p.trialing, 0);
  const since = Date.now() - 30 * 86_400_000;
  const paid30 = d.payments.filter((p) => p.status === "completed" || p.status === "paid").filter((p) => Date.parse(p.createdAt) >= since);
  const byCurrency = Object.entries(paid30.reduce<Record<string, number>>((m, p) => ({ ...m, [p.currency]: (m[p.currency] ?? 0) + p.amountMinor - p.refundedMinor }), {}));
  const shown = d.payments.filter((p) => !text.trim() || p.workspaceName.toLowerCase().includes(text.trim().toLowerCase()));
  const top = Math.max(1, ...d.plans.map((p) => p.accounts));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Revenue" title="Subscriptions" sub={`Plans, subscribed accounts and recorded payments. Read ${fmtWhen(d.at)}.`} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Kpi label="Payments, last 30 days" value={byCurrency.length ? byCurrency.map(([c, v]) => money(v, c)).join(" · ") : "None"} icon={<Receipt className="h-4 w-4" />} tone="emerald" hint={`${paid30.length} payment${paid30.length === 1 ? "" : "s"} after refunds`} />
        <Kpi label="Paying accounts" value={fmtNum(paying)} icon={<CreditCard className="h-4 w-4" />} tone="cyan" hint={`of ${fmtNum(d.accounts)} accounts · ${fmtNum(d.withoutPlan)} without a plan`} />
        <Kpi label="Trials and complimentary" value={`${fmtNum(trials)} · ${fmtNum(comp)}`} icon={<Gift className="h-4 w-4" />} tone="indigo" hint="Free trials · plans given by MUSHIN" />
      </div>
      <Card label="Plan distribution">
        <CardTitle title="Plan distribution" sub="Accounts on each plan right now, including trials" right={<Layers className="h-4 w-4 text-cyan-600" />} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {d.plans.map((p, i) => (
            <div key={p.id} className={`flex flex-col justify-between rounded-2xl bg-white p-5 ${i === 1 ? "border-2 border-[#38bdf8] shadow-sm" : "border border-slate-200"}`}>
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-lg font-bold text-slate-900">{p.name}</h3>
                  <div className="font-mono text-base font-extrabold text-slate-900">{money(p.displayMonthlyMinor, p.displayCurrency)}<span className="text-[11px] font-medium text-slate-500">/mo</span></div>
                </div>
                <div className="mt-4 space-y-2 rounded-xl border border-slate-200/70 bg-slate-50 p-3.5 text-[12px]">
                  <div className="flex justify-between"><span className="text-slate-500">Paying</span><span className="font-mono font-extrabold">{fmtNum(p.paying)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Complimentary</span><span className="font-mono font-extrabold">{fmtNum(p.complimentary)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">On trial</span><span className="font-mono font-extrabold">{fmtNum(p.trialing)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Credits each month</span><Badge>{fmtNum(p.monthlyCredits)} credits</Badge></div>
                </div>
              </div>
              <div className="mt-4 border-t border-slate-100 pt-3">
                <div className="mb-1.5 flex justify-between font-mono text-[10.5px]"><span className="font-bold uppercase tracking-wider text-slate-500">Accounts</span><span className="font-bold text-slate-900">{fmtNum(p.accounts)} / {fmtNum(d.accounts)}</span></div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#00c2e0]" style={{ width: `${Math.round((p.accounts / top) * 100)}%` }} /></div>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <PricingCard canEdit={canEditPricing} />
      <Card label="Payments">
        <CardTitle title="Recent payments" sub="Recorded by the payment provider, newest first (the last 100)" right={<div className="w-56"><SearchInput value={text} onChange={setText} placeholder="Filter by account…" label="Filter payments by account" /></div>} />
        {d.payments.length === 0 ? <Empty title="No payments recorded yet" body="Payments appear here once the payment provider is live and a customer pays." /> : (
          <DataTable head={["Account", "Kind", "Amount", "Refunded", "Status", "When"]}>
            {shown.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50/90">
                <td className="px-4 py-3 font-bold text-slate-900">{p.workspaceName}</td>
                <td className="px-4 py-3 capitalize">{p.kind === "topup" ? "Credit top-up" : "Subscription"}</td>
                <td className="px-4 py-3 font-mono font-extrabold">{money(p.amountMinor, p.currency)}</td>
                <td className="px-4 py-3 font-mono">{p.refundedMinor ? money(p.refundedMinor, p.currency) : "—"}</td>
                <td className="px-4 py-3"><Badge tone={p.status === "completed" || p.status === "paid" ? "emerald" : "amber"}>{p.status}</Badge></td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-[11.5px] text-slate-500">{fmtWhen(p.createdAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}
