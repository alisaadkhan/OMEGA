import { motion } from "motion/react";
import { Check, CheckCircle2, Zap } from "lucide-react";
import type { BillingInterval, BillingPlans, PlanId } from "@mushin/contracts";
import { PLAN_COPY, planFeatures } from "../../lib/plans";
import { Button, EASE, Modal, Segmented } from "../../ui/kit";
import { cn } from "../ui/utils";

const money = (m: { amountMinor: number; currency: string }) => (m.currency === "PKR" ? `Rs. ${(m.amountMinor / 100).toLocaleString("en-PK")}` : `$${(m.amountMinor / 100).toFixed(2)}`);

/** Choose or change a plan, or buy a top-up pack. Everything shown comes from the server catalogue. */
export function PlanPicker(p: {
  open: boolean;
  onClose: () => void;
  plans: BillingPlans | undefined;
  currentPlanId: PlanId | null;
  currentInterval: BillingInterval | null;
  hasPlan: boolean;
  trialing: boolean;
  annual: boolean;
  interval: BillingInterval;
  setInterval: (i: BillingInterval) => void;
  busy: boolean;
  onChoose: (id: PlanId) => void;
  onTopup: (packId: string) => void;
}) {
  const data = p.plans;
  return (
    <Modal open={p.open} onClose={p.onClose} label="Plans and credit top-ups" width="max-w-[980px]">
      {data && (
        <div className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-on">{p.hasPlan ? "Change your plan" : "Choose a plan"}</h2>
              <p className="mt-1 text-[13px] text-ink-soft">Upgrades apply now; downgrades and cancellations at the end of the billing period. Prices in Pakistani Rupees.</p>
            </div>
            {p.annual && <Segmented value={p.interval} onChange={p.setInterval} options={[{ id: "month", label: "Monthly" }, { id: "year", label: "Yearly" }]} />}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {data.plans.map((plan, i) => {
              const current = p.currentPlanId === plan.id && p.currentInterval === p.interval;
              const hi = PLAN_COPY[plan.id].highlight;
              const price = p.interval === "month" ? plan.display.monthly : plan.display.yearlyPerMonth;
              return (
                <motion.div key={plan.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07, ease: EASE }} className={cn("relative flex flex-col justify-between rounded-2xl p-5 ring-1 transition-shadow hover:shadow-lg", hi ? "ring-2 ring-cyan" : "ring-surface-top", current && "bg-cyan-pale/20")}>
                  {hi && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-cyan px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-navy">Most popular</span>}
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-teal">{plan.name}</div>
                    <div className="mt-2 text-2xl font-bold tabular-nums text-on">{money(price)} <span className="text-xs font-normal text-ink-soft">/ month{p.interval === "year" ? ", billed yearly" : ""}</span></div>
                    <div className="mt-1 text-xs font-semibold text-teal">{plan.monthlyCredits.toLocaleString("en-PK")} credits / month</div>
                    <div className="text-[11px] text-ink-soft">Charged {money(p.interval === "month" ? plan.charge.monthly : plan.charge.yearly)}</div>
                    <ul className="mt-4 space-y-2 text-xs" aria-label={`What ${plan.name} includes`}>
                      {planFeatures(plan, data).map((f) => (
                        <li key={f.key} className={cn("flex items-start gap-2", f.included ? "text-on" : "text-faint line-through decoration-faint/40")}>
                          {f.included ? <CheckCircle2 className="h-4 w-4 shrink-0 text-teal" /> : <Check className="h-4 w-4 shrink-0 opacity-30" />}
                          <span>{f.label}{f.value !== "Included" && f.included ? <span className="text-ink-soft"> · {f.value}</span> : null}{f.status && <span className="ml-1 text-[10px] font-semibold uppercase text-faint">{f.status === "test_mode" ? "Test mode" : "Coming soon"}</span>}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Button className="mt-5 w-full" variant={hi ? "primary" : "outline"} disabled={p.busy || current} onClick={() => p.onChoose(plan.id)}>
                    {current ? "Current plan" : p.hasPlan ? `Switch to ${plan.name}` : `Choose ${plan.name}`}
                  </Button>
                </motion.div>
              );
            })}
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-on">Credit top-ups</h3>
            <p className="mt-0.5 text-xs text-ink-soft">{p.trialing ? "Top-ups unlock once you choose a plan." : "Never expire. Spent after your monthly credits run out."}</p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              {data.topupPacks.map((k, i) => (
                <motion.button key={k.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.05 }} disabled={p.busy || p.trialing} onClick={() => p.onTopup(k.id)} className="group flex items-center justify-between rounded-xl p-4 text-left ring-1 ring-surface-top transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-cyan disabled:pointer-events-none disabled:opacity-50">
                  <span>
                    <span className="block text-[15px] font-semibold text-on">{k.credits.toLocaleString("en-PK")} credits</span>
                    <span className="text-xs text-ink-soft">{money(k.display)} · charged {money(k.charge)}</span>
                  </span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-pale/40 text-teal transition-transform group-hover:scale-110"><Zap className="h-4 w-4" /></span>
                </motion.button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
