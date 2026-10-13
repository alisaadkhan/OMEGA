import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, BarChart3, Check, CheckCircle2, CreditCard, Lock, Mail, Plus, Radio, RefreshCw, Search, Smartphone, XCircle } from "lucide-react";
import type { BillingInterval, CreditAction, PlanId } from "@mushin/contracts";
import { AnimatedNumber } from "./AnimatedNumber";
import { COPY } from "../../lib/copy";
import { useConfirm } from "../../lib/toast";
import {
  useBillingPlans,
  useBillingSummary,
  useCancelSubscription,
  useChangePlan,
  useInvoices,
  useLedger,
  useRefreshBilling,
  useStartCheckout,
} from "../../api/billing";

/**
 * Credits & billing. Prices are shown in PKR and charged in USD by the payment provider (spec D1).
 * Every purchase opens the provider's hosted checkout (REQ-08.01). The spend-caps section is hidden (spec D6).
 */

const ACTION_META: Record<CreditAction, { label: string; icon: typeof Search; tone: string }> = {
  search_existing: { label: COPY.searchExisting, icon: Search, tone: "bg-slate-100 text-slate-600" },
  find_new: { label: COPY.findNew, icon: Radio, tone: "bg-indigo-50 text-indigo-700" },
  reveal_contact: { label: COPY.revealContact, icon: Mail, tone: "bg-emerald-50 text-emerald-700" },
  refresh_data: { label: COPY.refreshData, icon: RefreshCw, tone: "bg-amber-50 text-amber-700" },
  refresh_tiktok: { label: "Refresh TikTok creator", icon: RefreshCw, tone: "bg-amber-50 text-amber-700" },
  audience_estimate: { label: "Audience estimate", icon: BarChart3, tone: "bg-violet-50 text-violet-700" },
};

const KIND_LABEL = {
  grant: "Credits added",
  spend: "Credits spent",
  refund: "Refund",
  expire: "Credits expired",
  adjust: "Adjustment",
  reserve: "Credits reserved",
  release: "Reservation released",
} as const;

const formatMoney = (m: { amountMinor: number; currency: string }) =>
  m.currency === "PKR" ? `Rs. ${(m.amountMinor / 100).toLocaleString("en-PK")}` : `$${(m.amountMinor / 100).toFixed(2)}`;
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const paymentMethods = [
  { id: "pm-1", kind: "easypaisa", label: "EasyPaisa wallet", detail: "0300 •••• 4521", badge: "EP", tone: "bg-emerald-600", primary: true },
  { id: "pm-2", kind: "jazzcash", label: "JazzCash wallet", detail: "0321 •••• 8890", badge: "JC", tone: "bg-red-600", primary: false },
  { id: "pm-3", kind: "card", label: "Visa debit", detail: "•••• •••• •••• 6042", badge: "", tone: "bg-slate-800", primary: false },
] as const;

export function Billing({ checkoutResult }: { checkoutResult?: "success" | "failed" | null }) {
  const summary = useBillingSummary();
  const plans = useBillingPlans();
  const canManage = summary.data?.canPurchase ?? false;
  const ledger = useLedger(canManage);
  const invoices = useInvoices(canManage);
  const checkout = useStartCheckout();
  const changePlan = useChangePlan();
  const cancel = useCancelSubscription();
  const refresh = useRefreshBilling();
  const confirm = useConfirm();
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const [showPlans, setShowPlans] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const s = summary.data;
  const hasPlan = Boolean(s?.plan);
  const trialing = s?.status === "trialing";

  // After the hosted checkout returns, the payment webhook is applied by the worker, which can take tens of
  // seconds on a slow connection. Until the plan shows up, keep refreshing and hold the plan buttons: a click
  // made while the screen still shows "no plan" would start a second checkout instead of a plan change.
  const [waitedOut, setWaitedOut] = useState(false);
  const activating = checkoutResult === "success" && summary.isSuccess && !hasPlan && !waitedOut;
  useEffect(() => {
    if (checkoutResult !== "success") return;
    const poll = window.setInterval(() => void refresh(), 2000);
    const stop = window.setTimeout(() => {
      window.clearInterval(poll);
      setWaitedOut(true);
    }, 90_000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(stop);
    };
  }, [checkoutResult, refresh]);
  useEffect(() => {
    // A top-up return already has a plan: a few refreshes pick up its credits.
    if (checkoutResult === "success" && hasPlan) setWaitedOut(true);
  }, [checkoutResult, hasPlan]);

  // A cancellation or an upgrade is accepted at once (202) but shows up only when the worker applies the payment
  // provider's webhook. Until then keep refreshing and hold the buttons, so the screen never invites a second click.
  const [awaiting, setAwaiting] = useState<{ kind: "cancel" } | { kind: "upgrade"; planId: PlanId; interval: BillingInterval } | null>(null);
  const applied =
    awaiting === null ||
    (awaiting.kind === "cancel" ? Boolean(s?.cancelAtPeriodEnd) : s?.plan?.id === awaiting.planId && s?.interval === awaiting.interval);
  const confirming = awaiting !== null && !applied;
  useEffect(() => {
    if (awaiting === null) return;
    if (applied) {
      setAwaiting(null);
      return;
    }
    const poll = window.setInterval(() => void refresh(), 2000);
    const stop = window.setTimeout(() => setAwaiting(null), 90_000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(stop);
    };
  }, [awaiting, applied, refresh]);

  const error = checkout.error ?? changePlan.error ?? cancel.error;
  const busy = checkout.isPending || changePlan.isPending || cancel.isPending || activating || confirming;

  const choosePlan = (planId: PlanId) => {
    setNotice(null);
    if (hasPlan) {
      changePlan.mutate(
        { planId, interval: billingInterval },
        {
          onSuccess: (r) => {
            if (r.effective === "now") setAwaiting({ kind: "upgrade", planId, interval: billingInterval });
            setNotice(r.effective === "now" ? "Your upgrade is active." : "Downgrade scheduled for the end of this billing period.");
          },
        },
      );
    } else {
      checkout.mutate({ kind: "subscription", planId, interval: billingInterval });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="tracking-tight text-slate-900" style={{ fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Credits &amp; billing
        </h1>
        <p className="mt-1 text-sm text-slate-500">Your balance, plan, credit history and invoices.</p>
      </div>

      {checkoutResult && (
        <div
          role="status"
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${checkoutResult === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}
        >
          {checkoutResult === "success" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {checkoutResult === "success"
            ? activating
              ? "Payment received. Activating your plan…"
              : "Payment received. Your plan and credits update within a few seconds."
            : "The payment did not go through. No credits were charged."}
        </div>
      )}
      {(notice || error) && (
        <div role={error ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-indigo-100 bg-indigo-50 text-indigo-900"}`}>
          {error
            ? error.message
            : confirming
              ? awaiting?.kind === "cancel"
                ? "Cancelling your subscription… confirming with the payment provider."
                : "Upgrading your plan… confirming with the payment provider."
              : notice}
        </div>
      )}

      {/* Balance row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BalanceTile label="Available credits" value={s?.balance.available ?? 0} accent />
        <BalanceTile
          label="Reserved (held for running searches)"
          value={s?.balance.reserved ?? 0}
          sub={(s?.balance.reserved ?? 0) === 0 ? "Nothing running: no credits held" : "Released automatically if a job fails or stops"}
        />
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="rounded-xl border border-slate-200 bg-slate-900 p-6 text-white shadow-sm"
        >
          <div className="text-xs uppercase tracking-wider text-slate-400">Current plan</div>
          <div className="mt-1 text-white" style={{ fontSize: "1.25rem", fontWeight: 600 }}>
            {s?.plan ? `${s.plan.name} · ${s.interval === "year" ? "Yearly" : "Monthly"}` : trialing ? "Free trial" : "No active plan"}
          </div>
          <div className="mt-3 text-xs text-slate-400">
            {s?.plan && s.currentPeriodEnd
              ? s.cancelAtPeriodEnd
                ? `Ends on ${formatDate(s.currentPeriodEnd)}`
                : `Renews on ${formatDate(s.currentPeriodEnd)}`
              : trialing && s?.trialDaysLeft !== null && s?.trialDaysLeft !== undefined
                ? `${s.trialDaysLeft} days of trial left`
                : "Choose a plan to get monthly credits"}
          </div>
          {s?.scheduledChange && (
            <div className="mt-2 text-xs text-amber-300">
              Changes to {s.scheduledChange.planId} at the end of this period
            </div>
          )}
          {canManage && (
            <div className="mt-6 grid gap-2">
              <button
                onClick={() => setShowPlans((v) => !v)}
                className="w-full rounded-md bg-white px-3 py-2 text-sm text-slate-900 transition-all hover:-translate-y-px hover:shadow-md"
              >
                {hasPlan ? "Change plan" : "Choose a plan"}
              </button>
              {hasPlan && !s?.cancelAtPeriodEnd && (
                <button
                  disabled={busy}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Cancel your subscription?",
                      body: `Your plan stays active until ${s?.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "the end of this billing period"}. After that, its monthly credits and features end; paid top-up credits stay usable until they expire.`,
                      confirmLabel: "Cancel subscription",
                      cancelLabel: "Keep my plan",
                      destructive: true,
                    });
                    if (ok) {
                      cancel.mutate(undefined, {
                        onSuccess: () => {
                          setAwaiting({ kind: "cancel" });
                          setNotice("Your subscription will end at the close of this billing period.");
                        },
                      });
                    }
                  }}
                  className="w-full rounded-md border border-white/20 px-3 py-2 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-50"
                >
                  Cancel subscription
                </button>
              )}
            </div>
          )}
        </motion.div>
      </div>

      {/* Plans and top-ups */}
      {canManage && showPlans && plans.data && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Plans</div>
            <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-xs">
              {(["month", "year"] as const).map((i) => (
                <button key={i} onClick={() => setBillingInterval(i)} className={`rounded px-2.5 py-1 ${billingInterval === i ? "bg-slate-900 text-white" : "text-slate-600"}`}>
                  {i === "month" ? "Monthly" : "Yearly"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {plans.data.plans.map((p) => {
              const current = s?.plan?.id === p.id && s.interval === billingInterval;
              const price = billingInterval === "month" ? p.display.monthly : p.display.yearlyPerMonth;
              return (
                <div key={p.id} className={`rounded-lg border p-4 ${current ? "border-indigo-300 bg-indigo-50/40" : "border-slate-200"}`}>
                  <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>{p.name}</div>
                  <div className="mt-1 text-slate-900" style={{ fontSize: 22, fontWeight: 600 }}>
                    {formatMoney(price)}
                    <span className="text-xs text-slate-500"> / month{billingInterval === "year" ? ", billed yearly" : ""}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {p.monthlyCredits.toLocaleString()} credits / month · charged {formatMoney(billingInterval === "month" ? p.charge.monthly : p.charge.yearly)}
                  </div>
                  <button
                    disabled={busy || current}
                    onClick={() => choosePlan(p.id)}
                    className="mt-4 w-full rounded-md bg-slate-900 px-3 py-2 text-xs text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ fontWeight: 600 }}
                  >
                    {current ? "Current plan" : hasPlan ? `Switch to ${p.name}` : `Choose ${p.name}`}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-6 text-sm text-slate-900" style={{ fontWeight: 600 }}>Credit top-ups</div>
          <div className="mt-1 text-xs text-slate-500">
            {trialing ? "Top-ups unlock once you choose a plan." : "Valid for 12 months. Spent after your monthly credits run out."}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            {plans.data.topupPacks.map((k) => (
              <button
                key={k.id}
                disabled={busy || trialing}
                onClick={() => checkout.mutate({ kind: "topup", packId: k.id })}
                className="rounded-lg border border-slate-200 p-4 text-left hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>{k.credits.toLocaleString()} credits</div>
                <div className="text-xs text-slate-500">
                  {formatMoney(k.display)} · charged {formatMoney(k.charge)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Reservation model explainer */}
      <div className="flex items-start gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-xs text-indigo-900">
        <Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-indigo-500" strokeWidth={2} />
        <div style={{ lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600 }}>How live discovery is billed.</span> When you start a live search we reserve its credits up front.
          If the search fails, the reserved credits are released back to your balance automatically.
        </div>
      </div>

      {/* Credit history (the ledger) */}
      {canManage && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Credit history</div>
            <div className="text-xs text-slate-500">Every credit added, reserved, spent, released and expired</div>
          </div>
          <div className="divide-y divide-slate-100">
            {(ledger.data?.entries ?? []).map((e) => {
              const meta = e.action ? ACTION_META[e.action] : null;
              const Icon = meta?.icon ?? Plus;
              // Reserve rows store the held amount as a positive number; show it as a deduction.
              const signed = e.kind === "reserve" ? -e.amount : e.amount;
              return (
                <div key={e.id} className="flex items-center gap-3 px-5 py-3">
                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${meta?.tone ?? "bg-slate-100 text-slate-600"}`}>
                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{meta ? `${KIND_LABEL[e.kind]} · ${meta.label}` : KIND_LABEL[e.kind]}</span>
                      <span className="text-[11px] text-slate-400">{formatDate(e.createdAt)}</span>
                    </div>
                    {e.note && <div className="truncate text-xs text-slate-500">{e.note}</div>}
                  </div>
                  <span className={`flex-shrink-0 tabular-nums text-sm ${signed < 0 ? "text-slate-900" : "text-emerald-700"}`} style={{ fontWeight: 600 }}>
                    {signed > 0 ? `+${signed}` : signed}
                  </span>
                </div>
              );
            })}
            {ledger.data && ledger.data.entries.length === 0 && <div className="px-5 py-6 text-sm text-slate-500">No credit activity yet.</div>}
          </div>
        </div>
      )}

      {/* Invoices */}
      {canManage && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Invoices</div>
          <div className="mt-4 space-y-3">
            {(invoices.data?.invoices ?? []).map((i) => (
              <div key={i.id} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0">
                <div>
                  <div className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{formatDate(i.createdAt)}</div>
                  <div className="text-xs text-slate-500">{i.kind === "topup" ? "Credit top-up" : "Subscription"}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{i.status}</span>
                  <span className="tabular-nums text-sm text-slate-900" style={{ fontWeight: 500 }}>{formatMoney(i.amount)}</span>
                  {i.invoiceUrl ? (
                    <a href={i.invoiceUrl} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-700" aria-label="Open invoice">
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
            {invoices.data && invoices.data.invoices.length === 0 && <div className="text-sm text-slate-500">No payments yet.</div>}
          </div>
        </div>
      )}

      {/* Payment methods: unchanged sample data until sub-project 7 removes EasyPaisa/JazzCash. */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Payment methods</div>
          <div className="text-xs text-slate-500">How you top up credits and pay invoices.</div>
        </div>
        <div className="mt-4 space-y-2.5">
          {paymentMethods.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
              <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white ${m.tone}`}>
                {m.kind === "card" ? <CreditCard className="h-4 w-4" strokeWidth={1.75} /> : <span className="text-[11px]" style={{ fontWeight: 700 }}>{m.badge}</span>}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{m.label}</span>
                  {m.primary && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700" style={{ fontWeight: 600 }}>
                      <Check className="h-2.5 w-2.5" strokeWidth={2.5} /> Primary
                    </span>
                  )}
                </div>
                <div className="tabular-nums text-xs text-slate-500">{m.detail}</div>
              </div>
              {m.kind !== "card" && <Smartphone className="h-4 w-4 flex-shrink-0 text-slate-300" strokeWidth={1.75} />}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-400" style={{ lineHeight: 1.5 }}>
          Sample data for demonstration.
        </p>
      </div>
    </div>
  );
}

function BalanceTile({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-2 tabular-nums ${accent ? "text-slate-900" : "text-slate-700"}`} style={{ fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
        <AnimatedNumber value={value} />
      </div>
      {sub && <div className="mt-1.5 text-[11px] text-slate-500" style={{ lineHeight: 1.5 }}>{sub}</div>}
    </motion.div>
  );
}
