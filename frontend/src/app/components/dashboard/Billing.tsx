import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, BarChart3, FileText, Lock, Mail, Plus, PlusCircle, Radio, RefreshCw, Search, ShoppingBag, SlidersHorizontal, Zap } from "lucide-react";
import { Alert, Button, Card, CountUp, EASE, NotYet, PageHeader, Pill, Progress, Segmented, Toggle } from "../../ui/kit";
import { PlanPicker } from "./PlanPicker";
import type { BillingInterval, CreditAction, PlanId } from "@mushin/contracts";
import { COPY } from "../../lib/copy";
import { useConfirm } from "../../lib/toast";
import { formatTrialDate } from "../../api/trial";
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
  live_creator: { label: "New creator found (live)", icon: Radio, tone: "bg-indigo-50 text-indigo-700" },
  reveal_contact: { label: COPY.revealContact, icon: Mail, tone: "bg-emerald-50 text-emerald-700" },
  refresh_data: { label: COPY.refreshData, icon: RefreshCw, tone: "bg-amber-50 text-amber-800" },
  refresh_tiktok: { label: "Refresh TikTok creator", icon: RefreshCw, tone: "bg-amber-50 text-amber-800" },
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

export const formatMoney = (m: { amountMinor: number; currency: string }) =>
  m.currency === "PKR" ? `Rs. ${(m.amountMinor / 100).toLocaleString("en-PK")}` : `$${(m.amountMinor / 100).toFixed(2)}`;
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });


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
  const [chosenInterval, setBillingInterval] = useState<BillingInterval>("month");
  // Yearly billing is offered only once the owner approves annual prices (the server catalogue says so).
  const annual = plans.data?.annualBilling === true;
  const billingInterval: BillingInterval = annual ? chosenInterval : "month";
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

  const allowance = s?.plan?.monthlyCredits ?? s?.testingAllowance?.monthlyCredits ?? 0;
  const available = s?.balance.available ?? 0;
  const used = allowance ? Math.max(0, allowance - Math.min(available, allowance)) : 0;
  const pct = allowance ? (used / allowance) * 100 : 0;
  const renews = s?.currentPeriodEnd ?? s?.testingAllowance?.renewsAt ?? s?.trialEndsAt ?? null;
  const planLabel = s?.plan ? (s.complimentary ? `${s.plan.name} · Complimentary` : s.plan.name) : trialing ? "Free trial" : "No active plan";
  const planPrice = s?.plan ? plans.data?.plans.find((x) => x.id === s.plan!.id) : undefined;

  async function onCancel() {
    const ok = await confirm({
      title: "Cancel your subscription?",
      body: `Your plan stays active until ${s?.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : "the end of this billing period"}. After that, its monthly credits and features end; paid top-up credits never expire.`,
      confirmLabel: "Cancel subscription",
      cancelLabel: "Keep my plan",
      destructive: true,
    });
    if (ok) cancel.mutate(undefined, { onSuccess: () => { setAwaiting({ kind: "cancel" }); setNotice("Your subscription will end at the close of this billing period."); } });
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 py-2">
      <PageHeader
        title="Credits & Billing"
        subtitle="Manage your plan and track your credit usage."
        actions={<Pill tone={s?.plan || trialing ? "cyan" : "neutral"} dot>{s?.plan ? (s.complimentary ? "Complimentary access active" : "Billing cycle active") : trialing ? "Free trial active" : "No active plan"}</Pill>}
      />

      <Alert tone={checkoutResult === "failed" ? "error" : "success"}>
        {checkoutResult === "success" ? (activating ? "Payment received. Activating your plan…" : "Payment received. Your plan and credits update within a few seconds.") : checkoutResult === "failed" ? "The payment did not go through. No credits were charged." : null}
      </Alert>
      <Alert tone="error">{error ? error.message : null}</Alert>
      <Alert tone={confirming ? "info" : "success"} onClose={confirming ? undefined : () => setNotice(null)}>
        {error ? null : confirming ? (awaiting?.kind === "cancel" ? "Cancelling your subscription… confirming with the payment provider." : "Upgrading your plan… confirming with the payment provider.") : notice}
      </Alert>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: EASE }}>
          <Card className="relative flex h-full flex-col justify-between overflow-hidden p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-soft">Current Balance</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-soft px-2.5 py-1 text-[10px] font-semibold text-[#006172]"><Zap className="h-3 w-3" /> CREDITS</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-[44px] font-semibold leading-none tracking-tight tabular-nums text-on"><CountUp value={available} /></span>
                <span className="text-[13px] text-ink-soft">available</span>
              </div>
              {(s?.balance.reserved ?? 0) > 0 && <p className="text-xs text-ink-soft"><CountUp value={s!.balance.reserved} /> credits held for running searches, released automatically if a job fails.</p>}
              {allowance > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-medium text-on">{Math.round(pct)}% utilized this cycle</span>
                    <span className="tabular-nums text-ink-soft">{used.toLocaleString("en-PK")} / {allowance.toLocaleString("en-PK")} used</span>
                  </div>
                  <Progress value={pct} bar="bg-gradient-to-r from-ink to-teal" />
                  {renews && <p className="pt-1 text-xs text-ink-soft">{s?.testingAllowance && !s.plan ? "Testing credits renew" : "Credits refresh"} on {formatDate(renews)}. Unused monthly credits do not roll over.</p>}
                </div>
              )}
            </div>
            <div className="mt-6 flex items-center justify-between pt-5">
              {/* Members see why, not a dead button: only the owner or an admin can buy (the API refuses everyone else). */}
              {canManage ? (
                <Button icon={PlusCircle} disabled={busy} onClick={() => setShowPlans(true)} className="bg-teal hover:bg-teal-deep">Buy Credits</Button>
              ) : (
                <span className="text-xs text-ink-soft">Credits are bought by the account owner or an admin.</span>
              )}
              <span className="text-right text-[11px] text-ink-soft">No expiration on purchased top-ups</span>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: EASE, delay: 0.06 }}>
          <Card className="flex h-full flex-col justify-between p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-soft">Current Plan</span>
                <Pill tone={s?.plan || trialing ? "dark" : "neutral"}>{s?.plan ? "Active Plan" : trialing ? "Trial" : "None"}</Pill>
              </div>
              <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-baseline">
                <h2 className="text-2xl font-semibold text-on">{planLabel}</h2>
                {planPrice && !s?.complimentary && <div className="text-lg font-semibold text-on">{formatMoney(s?.interval === "year" ? planPrice.display.yearlyPerMonth : planPrice.display.monthly)} <span className="text-xs font-normal text-ink-soft">/ month</span></div>}
              </div>
              <p className="text-xs leading-relaxed text-ink-soft">
                {s?.plan && s.currentPeriodEnd
                  ? s.complimentary ? `Complimentary access until ${formatDate(s.currentPeriodEnd)}. No payment is taken.` : `${s.plan.monthlyCredits.toLocaleString("en-PK")} monthly credits. ${s.cancelAtPeriodEnd ? "Ends" : "Renews"} on ${formatDate(s.currentPeriodEnd)}.`
                  : trialing && s?.trialDaysLeft != null ? `${s.trialDaysLeft} days of trial left${s.trialStartedAt && s.trialEndsAt ? ` · ${formatTrialDate(s.trialStartedAt)} to ${formatTrialDate(s.trialEndsAt)}` : ""}.`
                  : s?.awaitingTrial ? "Free trial not active yet: our team activates it after a short call." : "Choose a plan to get monthly credits."}
              </p>
              {s?.scheduledChange && <Alert tone="warning">Changes to {plans.data?.plans.find((x) => x.id === s.scheduledChange!.planId)?.name ?? s.scheduledChange.planId} at the end of this period.</Alert>}
              {s?.testingAllowance && (
                <div className="rounded-xl bg-surface-low p-3.5 text-xs text-ink-soft" data-testid="testing-allowance">
                  <span className="font-semibold text-on">Testing credits: <span className="tabular-nums">{s.testingAllowance.remaining.toLocaleString("en-US")}</span> of <span className="tabular-nums">{s.testingAllowance.monthlyCredits.toLocaleString("en-US")}</span> left this month.</span> Unused testing credits do not carry over.
                </div>
              )}
              <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-low p-3.5">
                <div className="flex flex-col pr-2">
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-on">Auto-refill <NotYet /></span>
                  <span className="text-xs text-ink-soft">Automatically add credits when your balance runs low.</span>
                </div>
                <Toggle checked={false} onChange={() => undefined} label="Auto-refill" disabled />
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-2 pt-5">
              {canManage && !s?.complimentary ? (
                <div className="flex gap-2">
                  <Button variant="soft" icon={SlidersHorizontal} onClick={() => setShowPlans(true)} disabled={busy}>{hasPlan ? "Change Plan" : "Choose a Plan"}</Button>
                  {hasPlan && !s?.cancelAtPeriodEnd && <Button variant="ghost" disabled={busy} onClick={() => void onCancel()} className="text-danger">Cancel subscription</Button>}
                </div>
              ) : <span className="text-xs text-ink-soft">Plan changes are made by the account owner or an admin.</span>}
              <span className="text-[10px] font-semibold tracking-wide text-ink-soft">Payments use the secure checkout; MUSHIN never stores cards.</span>
            </div>
          </Card>
        </motion.div>
      </div>

      <PlanPicker
        open={showPlans && canManage && !!plans.data}
        onClose={() => setShowPlans(false)}
        plans={plans.data}
        currentPlanId={s?.plan?.id ?? null}
        currentInterval={s?.interval ?? null}
        hasPlan={hasPlan}
        trialing={trialing}
        annual={annual}
        interval={billingInterval}
        setInterval={setBillingInterval}
        busy={busy}
        onChoose={(id) => { setShowPlans(false); choosePlan(id); }}
        onTopup={(packId) => checkout.mutate({ kind: "topup", packId })}
      />

      <div className="flex items-start gap-2.5 rounded-xl bg-cyan-pale/25 px-4 py-3 text-xs text-teal-deep ring-1 ring-cyan-soft/30">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span><span className="font-semibold">How live discovery is billed.</span> Starting a live search reserves its credits up front; if the search fails, they are released back to your balance automatically.</span>
      </div>

      {canManage && <TransactionHistory entries={ledger.data?.entries ?? null} invoices={invoices.data?.invoices ?? []} />}
    </div>
  );
}

const USAGE_KINDS = new Set(["spend", "reserve", "release", "expire"]);

function TransactionHistory({ entries, invoices }: { entries: NonNullable<ReturnType<typeof useLedger>["data"]>["entries"] | null; invoices: NonNullable<ReturnType<typeof useInvoices>["data"]>["invoices"] }) {
  const [filter, setFilter] = useState<"all" | "usage" | "purchases" | "invoices">("all");
  const rows = (entries ?? []).filter((e) => filter === "all" || (filter === "usage" ? USAGE_KINDS.has(e.kind) : !USAGE_KINDS.has(e.kind)));
  return (
    <Card className="flex flex-col space-y-5 p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold text-on">Transaction History</h2>
          <p className="mt-0.5 text-xs text-ink-soft">Every credit added, reserved, spent, released and expired, and your payments.</p>
        </div>
        <Segmented<"all" | "usage" | "purchases" | "invoices"> value={filter} onChange={setFilter} options={[{ id: "all", label: "All" }, { id: "usage", label: "Usage" }, { id: "purchases", label: "Credits added" }, { id: "invoices", label: "Invoices" }]} />
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={filter} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="-mx-6 overflow-x-auto px-6" tabIndex={0} role="region" aria-label="Transaction history table">
          {filter === "invoices" ? (
            <table className="w-full text-left">
              <thead><tr className="bg-surface-low text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-soft"><th className="rounded-l-lg px-4 py-3">Date</th><th className="px-4 py-3">Purchase</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Amount</th><th className="rounded-r-lg px-4 py-3 text-center">Receipt</th></tr></thead>
              <tbody className="divide-y divide-surface-low">
                {invoices.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-ink-soft">No payments yet.</td></tr> : invoices.map((i) => (
                  <tr key={i.id} className="transition-colors hover:bg-surface-low/60">
                    <td className="whitespace-nowrap px-4 py-4 text-xs text-ink-soft">{formatDate(i.createdAt)}</td>
                    <td className="px-4 py-4"><span className="flex items-center gap-2 text-[13px] font-medium text-on"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-soft text-[#006172]"><ShoppingBag className="h-3.5 w-3.5" /></span>{i.kind === "topup" ? "Credit top-up" : "Subscription"}</span></td>
                    <td className="px-4 py-4"><Pill tone="cyan">{i.status}</Pill></td>
                    <td className="whitespace-nowrap px-4 py-4 text-right text-[13px] font-semibold tabular-nums text-on">{formatMoney(i.amount)}</td>
                    <td className="px-4 py-4 text-center">{i.invoiceUrl ? <a href={i.invoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-surface-mid px-2.5 py-1 text-[11px] font-semibold text-ink-soft transition-colors hover:bg-surface-high hover:text-on"><FileText className="h-3.5 w-3.5" /> Invoice <ArrowUpRight className="h-3 w-3" /></a> : <span className="text-ink-soft">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left">
              <thead><tr className="bg-surface-low text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-soft"><th className="rounded-l-lg px-4 py-3">Date &amp; Time</th><th className="px-4 py-3">Action</th><th className="rounded-r-lg px-4 py-3 text-right">Amount</th></tr></thead>
              <tbody className="divide-y divide-surface-low">
                {entries === null ? (
                  <tr><td colSpan={3} className="px-4 py-6"><div className="skeleton h-8 rounded-lg" /></td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-ink-soft">{entries.length === 0 ? "No credit activity yet." : "Nothing in this view."}</td></tr>
                ) : rows.map((e, k) => {
                  const meta = e.action ? ACTION_META[e.action as keyof typeof ACTION_META] : null;
                  const Icon = meta?.icon ?? Plus;
                  const signed = e.kind === "reserve" ? -e.amount : e.amount;
                  return (
                    <motion.tr key={e.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(k, 12) * 0.03 }} className="transition-colors hover:bg-surface-low/60">
                      <td className="whitespace-nowrap px-4 py-4 text-xs text-ink-soft">{new Date(e.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta?.tone ?? "bg-surface-mid text-ink-soft"}`}><Icon className="h-3.5 w-3.5" /></span>
                          <span>
                            <span className="block text-[13px] font-medium text-on">{meta ? `${KIND_LABEL[e.kind]} · ${meta.label}` : KIND_LABEL[e.kind]}</span>
                            {e.note && <span className="block max-w-md truncate text-[11px] text-ink-soft">{e.note}</span>}
                          </span>
                        </div>
                      </td>
                      <td className={`whitespace-nowrap px-4 py-4 text-right text-[13px] font-semibold tabular-nums ${signed < 0 ? "text-danger" : "text-teal"}`}>{signed > 0 ? `+${signed.toLocaleString("en-PK")}` : signed.toLocaleString("en-PK")} credits</td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </motion.div>
      </AnimatePresence>
    </Card>
  );
}
