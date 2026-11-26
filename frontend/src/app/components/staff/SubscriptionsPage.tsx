import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Layers, Receipt, TrendingUp } from "lucide-react";
import { staffSubscriptionsSchema, type StaffSubscriptions } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { PricingCard } from "./PricingCard";
import { Badge, Card, CardTitle, DataTable, Drawer, Empty, Kpi, PageHeader, Pills, SearchInput, errText, fmtNum, fmtWhen } from "./kit";

const money = (minor: number, currency: string) => `${currency === "PKR" ? "Rs." : currency} ${fmtNum(Math.round(minor / 100))}`;
const PAGE = 10;
type Payment = StaffSubscriptions["payments"][number];
type Kind = "all" | "subscription" | "topup";
type Status = "all" | "paid" | "other";
const isPaid = (p: Payment) => p.status === "completed" || p.status === "paid";

function ReceiptDrawer({ p, onClose }: { p: Payment; onClose: () => void }) {
  const net = p.amountMinor - p.refundedMinor;
  return (
    <Drawer eyebrow="Payment" title={p.workspaceName} sub={fmtWhen(p.createdAt)} onClose={onClose}>
      <dl className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
        {[
          ["What", p.kind === "topup" ? "Credit top-up" : "Subscription"],
          ["Amount", money(p.amountMinor, p.currency)],
          ["Refunded", p.refundedMinor ? money(p.refundedMinor, p.currency) : "Nothing"],
          ["Kept after refunds", money(net, p.currency)],
          ["Status", p.status],
          ["Payment id", p.id],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="break-all text-right font-semibold text-slate-900">{v}</dd></div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-slate-500">Recorded by the payment provider. Refunds and receipts are handled in the provider's dashboard; nothing here changes a payment.</p>
    </Drawer>
  );
}

/**
 * Subscriptions (owner design, 25 Nov): revenue at list prices, each plan's accounts and revenue, and the payment ledger.
 * Every figure comes from the accounts and recorded payments: there is no manual invoice entry, because billing records
 * come from the payment provider alone.
 */
export function SubscriptionsPage({ canEditPricing }: { canEditPricing: boolean }) {
  const q = useQuery({ queryKey: ["admin", "subscriptions"], queryFn: () => adminRequest("/admin/v1/ops/subscriptions", staffSubscriptionsSchema), refetchInterval: 60_000 });
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [status, setStatus] = useState<Status>("all");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Payment | null>(null);
  if (q.isPending) return <LoadingBlock lines={6} />;
  if (q.isError) return <ErrorState body={errText(q.error)} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const paying = d.plans.reduce((s, p) => s + p.paying, 0);
  const comp = d.plans.reduce((s, p) => s + p.complimentary, 0);
  const trials = d.plans.reduce((s, p) => s + p.trialing, 0);
  const currency = d.plans[0]?.displayCurrency ?? "PKR";
  const mrr = d.plans.reduce((s, p) => s + p.paying * p.displayMonthlyMinor, 0);
  const since = Date.now() - 30 * 86_400_000;
  const paid30 = d.payments.filter(isPaid).filter((p) => Date.parse(p.createdAt) >= since);
  const received = paid30.filter((p) => p.currency === currency).reduce((s, p) => s + p.amountMinor - p.refundedMinor, 0);
  const popular = d.plans.reduce<string | null>((best, p) => (p.accounts > 0 && (!best || p.accounts > (d.plans.find((x) => x.id === best)?.accounts ?? 0)) ? p.id : best), null);
  const planned = Math.max(1, d.plans.reduce((s, p) => s + p.accounts, 0));

  const term = text.trim().toLowerCase();
  const shown = d.payments
    .filter((p) => !term || p.workspaceName.toLowerCase().includes(term))
    .filter((p) => kind === "all" || (kind === "topup" ? p.kind === "topup" : p.kind !== "topup"))
    .filter((p) => status === "all" || (status === "paid" ? isPaid(p) : !isPaid(p)));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0); };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Revenue" title="Subscriptions" sub={`Plans, subscribed accounts and recorded payments. Read ${fmtWhen(d.at)}.`} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Monthly recurring revenue" value={money(mrr, currency)} icon={<TrendingUp className="h-4 w-4" />} tone="emerald" hint="Paying accounts × their plan's list price" />
        <Kpi label="Paying accounts" value={fmtNum(paying)} icon={<CreditCard className="h-4 w-4" />} tone="cyan" hint={`${fmtNum(trials)} on trial · ${fmtNum(comp)} given by MUSHIN · ${fmtNum(d.withoutPlan)} without a plan`} />
        <Kpi label="Average per paying account" value={paying ? money(Math.round(mrr / paying), currency) : "—"} icon={<Layers className="h-4 w-4" />} tone="indigo" hint="Monthly, at list prices" />
        <Kpi label="Received, last 30 days" value={money(received, currency)} icon={<Receipt className="h-4 w-4" />} tone="amber" hint={`${paid30.length} payment${paid30.length === 1 ? "" : "s"}, after refunds`} />
      </div>

      <Card label="Plan distribution">
        <CardTitle title="Plan distribution" sub="Accounts on each plan right now, and what the paying ones bring in each month" right={<Badge tone="cyan">Billed monthly</Badge>} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {d.plans.map((p) => {
            const top = p.id === popular;
            const share = Math.round((p.accounts / planned) * 100);
            return (
              <div key={p.id} className={`relative flex flex-col justify-between rounded-2xl bg-white p-5 ${top ? "border-2 border-cyan-400 shadow-md shadow-cyan-100" : "border border-slate-200"}`}>
                {top && <span className="absolute -top-3 left-5 rounded-full bg-cyan-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">★ Most popular</span>}
                <div>
                  <div className="flex items-center justify-between gap-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-500"><span>{share}% of accounts</span></div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <h3 className="text-lg font-bold text-slate-900">{p.name}</h3>
                    <div className="font-mono text-base font-extrabold text-slate-900">{money(p.displayMonthlyMinor, p.displayCurrency)}<span className="text-[11px] font-medium text-slate-500">/mo</span></div>
                  </div>
                  <div className="mt-4 space-y-2 rounded-xl border border-slate-200/70 bg-slate-50 p-3.5 text-[12px]">
                    <div className="flex justify-between"><span className="text-slate-600">Paying</span><span className="font-mono font-extrabold">{fmtNum(p.paying)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-600">On trial · given by MUSHIN</span><span className="font-mono font-extrabold">{fmtNum(p.trialing)} · {fmtNum(p.complimentary)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-600">Monthly revenue</span><span className="font-mono font-extrabold text-emerald-700">{money(p.paying * p.displayMonthlyMinor, p.displayCurrency)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-600">Credits each month</span><Badge>{fmtNum(p.monthlyCredits)} credits</Badge></div>
                  </div>
                </div>
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="mb-1.5 flex justify-between font-mono text-[10.5px]"><span className="font-bold uppercase tracking-wider text-slate-500">Accounts</span><span className="font-bold text-slate-900">{fmtNum(p.accounts)} / {fmtNum(d.accounts)}</span></div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${top ? "bg-cyan-500" : "bg-indigo-400"}`} style={{ width: `${share}%` }} /></div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <PricingCard canEdit={canEditPricing} />

      <Card label="Payments">
        <CardTitle title="Payments and top-ups" sub="Recorded by the payment provider, newest first (the last 100). Open one for its receipt details." right={<div className="w-56"><SearchInput value={text} onChange={reset(setText)} placeholder="Filter by account…" label="Filter payments by account" /></div>} />
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Pills<Kind> value={kind} onChange={reset(setKind)} label="Payment kind" options={[{ id: "all", label: "Everything" }, { id: "subscription", label: "Subscriptions" }, { id: "topup", label: "Credit top-ups" }]} />
          <Pills<Status> value={status} onChange={reset(setStatus)} label="Payment status" options={[{ id: "all", label: "Any status" }, { id: "paid", label: "Paid" }, { id: "other", label: "Pending or failed" }]} />
        </div>
        {d.payments.length === 0 ? <Empty title="No payments recorded yet" body="Payments appear here once the payment provider is live and a customer pays." /> : shown.length === 0 ? <Empty title="No payment matches" /> : (
          <>
            <DataTable head={["Account", "What", "Amount", "Refunded", "Status", "When", ""]}>
              {shown.slice(at * PAGE, at * PAGE + PAGE).map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/90">
                  <td className="px-4 py-3 font-bold text-slate-900">{p.workspaceName}</td>
                  <td className="px-4 py-3">{p.kind === "topup" ? <Badge tone="indigo">Credit top-up</Badge> : <Badge tone="cyan">Subscription</Badge>}</td>
                  <td className="px-4 py-3 font-mono font-extrabold">{money(p.amountMinor, p.currency)}</td>
                  <td className="px-4 py-3 font-mono">{p.refundedMinor ? money(p.refundedMinor, p.currency) : "—"}</td>
                  <td className="px-4 py-3"><Badge tone={isPaid(p) ? "emerald" : "amber"}>{p.status}</Badge></td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[11.5px] text-slate-500">{fmtWhen(p.createdAt)}</td>
                  <td className="px-4 py-3 text-right"><button type="button" onClick={() => setOpen(p)} className="btn btn-outline btn-sm">Receipt</button></td>
                </tr>
              ))}
            </DataTable>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
              <span>Showing {fmtNum(Math.min(shown.length, at * PAGE + 1))}–{fmtNum(Math.min(shown.length, at * PAGE + PAGE))} of {fmtNum(shown.length)}</span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={at === 0} onClick={() => setPage(at - 1)} className="btn btn-outline btn-sm">Previous</button>
                <span className="tabular-nums">{at + 1} of {pages}</span>
                <button type="button" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} className="btn btn-outline btn-sm">Next</button>
              </div>
            </div>
          </>
        )}
      </Card>
      {open && <ReceiptDrawer p={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
