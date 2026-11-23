import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Check, CheckCircle2, Lock, Phone, Plus, X } from "lucide-react";
import { billingPlansSchema } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { PLAN_COPY, planFeatures, rupees, type CatalogPlan, type PricingFacts } from "../../lib/plans";
import { EASE, Reveal } from "../../ui/kit";
import { cn } from "../ui/utils";
import { trialPhone } from "../public/FreeTrial";
import { Brand, scrollToId } from "./LandingTop";

/** The server's plan catalogue (platform.plans): every price, allowance and feature on this page comes from it. */
export function usePublicPlans() {
  return useQuery({ queryKey: ["public-plans"], queryFn: () => apiRequest("/v1/public/plans", billingPlansSchema), staleTime: 5 * 60_000 });
}
const pkr = (n: number) => new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n);

export function LandingPricing({ onPrimary, onTrial }: { onPrimary: () => void; onTrial: () => void }) {
  const catalog = usePublicPlans();
  return (
    <div id="pricing" className="w-full scroll-mt-20 border-t border-white/5 bg-navy px-6 pb-16 pt-24 text-white sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center">
        <Reveal className="text-center">
          <h2 className="mx-auto mt-4 max-w-3xl font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl md:text-5xl">Find, verify, and manage creators, with a plan that fits.</h2>
          <p className="mx-auto mt-4 max-w-2xl font-display text-base leading-relaxed text-slate-300 sm:text-lg">Predictable monthly credit plans for boutique brands, growing labels and agencies. Prices in Pakistani Rupees.</p>
        </Reveal>

        {catalog.isPending ? (
          <div className="mt-14 grid w-full grid-cols-1 gap-8 md:grid-cols-3" aria-busy="true" aria-label="Loading plans">
            {[0, 1, 2].map((i) => <div key={i} className="h-[520px] animate-pulse rounded-2xl border border-white/10 bg-navy-2" />)}
          </div>
        ) : catalog.isError ? (
          <div role="alert" className="mt-14 rounded-2xl border border-white/10 bg-navy-2 p-6 text-center">
            <p className="text-sm text-slate-300">Plans could not be loaded.</p>
            <button onClick={() => void catalog.refetch()} className="mt-3 rounded-lg border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10">Try again</button>
          </div>
        ) : (
          <div className="mt-14 grid w-full grid-cols-1 items-stretch gap-8 md:grid-cols-3">
            {catalog.data.plans.map((p, i) => <PlanCard key={p.id} plan={p} facts={catalog.data} index={i} onPrimary={onPrimary} />)}
          </div>
        )}
        <p className="mt-6 text-center text-xs text-slate-400">Monthly credits reset each billing period. Top-up credits never expire. Cancel any time.</p>

        <LandingFaq />
        <LandingCta onTrial={onTrial} onPrimary={onPrimary} />
        <LandingFooter />
      </div>
    </div>
  );
}

function PlanCard({ plan, facts, index, onPrimary }: { plan: CatalogPlan; facts: PricingFacts; index: number; onPrimary: () => void }) {
  const copy = PLAN_COPY[plan.id];
  const hi = !!copy.highlight;
  // Every feature row, included or not, so plans compare honestly; data-* attributes let the E2E check the catalogue.
  const feats = planFeatures(plan, facts);
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay: index * 0.1, ease: EASE }}
      whileHover={{ y: -6 }}
      data-plan={plan.id}
      className={cn("relative flex flex-col justify-between rounded-2xl bg-navy-2 p-8 shadow-xl transition-colors", hi ? "border border-cyan/80 shadow-[0_0_35px_rgba(6,182,212,0.15)] ring-1 ring-cyan/50" : "border border-white/10 hover:border-white/20")}
    >
      {hi && <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-cyan px-3.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-navy shadow">Most popular</div>}
      <div>
        <span className={cn("text-xs font-bold uppercase tracking-wider", hi ? "text-cyan-400" : "text-slate-400")}>{plan.name}</span>
        <div className="mt-4 flex items-baseline gap-1">
          <span className="font-display text-3xl font-extrabold tabular-nums text-white">Rs. <span data-role="price">{pkr(rupees(plan.display.monthly.amountMinor))}</span></span>
          <span className="text-xs font-medium text-slate-400">/ mo</span>
        </div>
        <p className="mt-1 text-xs font-semibold text-cyan-400"><span data-role="credits">{pkr(plan.monthlyCredits)}</span> credits included</p>
        <p className={cn("mt-4 border-t border-white/10 pt-4 text-xs leading-relaxed sm:text-sm", hi ? "text-slate-300" : "text-slate-400")}>{copy.positioning}</p>
        <ul className="mt-6 flex flex-col gap-3 text-xs text-slate-300">
          {feats.map((f) => (
            <li key={f.key} data-feature={f.key} data-value={f.value} data-status={f.status ?? (f.included ? "included" : "not_included")} className={cn("flex items-start gap-2.5", !f.included && "text-slate-400")}>
              {!f.included ? <X aria-hidden className="h-4 w-4 shrink-0 text-slate-600" /> : hi ? <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan" /> : <Check className="h-4 w-4 shrink-0 text-cyan-400" />}
              <span>
                {f.label}
                {f.value !== "Included" && <span className="text-slate-400"> · {f.value}</span>}
                {f.status && <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-300">{f.status === "test_mode" ? "Test mode" : "Coming soon"}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <button onClick={onPrimary} className={cn("mt-8 flex h-11 w-full items-center justify-center rounded-xl text-xs font-semibold transition-all active:scale-[0.98] sm:text-sm", hi ? "bg-cyan font-bold text-navy shadow-[0_0_20px_rgba(6,182,212,0.35)] hover:bg-cyan-400" : "border border-white/10 bg-slate-800 text-white hover:bg-slate-700")}>
        Apply for {plan.name}
      </button>
    </motion.div>
  );
}

const FAQS = [
  { q: "How is a creator's location checked?", a: "MUSHIN only treats a creator as Pakistan-based when there is evidence on the profile, such as a stated location, location tags or a public record, and shows that evidence with its source. It never decides where someone lives from their name, language or appearance." },
  { q: "Which platforms are supported?", a: "Instagram, TikTok and YouTube. Every figure shows when it was observed, and you can refresh a creator's data on demand. YouTube data comes from the official YouTube API." },
  { q: "How do monthly credits work?", a: "Each plan includes monthly credits that reset every billing period, and you can buy top-up credits that never expire. Credits pay for searches, finding new creators, data refreshes and contact reveals, and every action shows its price before you confirm." },
  { q: "What is the MUSHIN IQ?", a: "A score from 0 to 100 for how well a creator matches your search. It weighs how closely their niche and content match what you typed, how close they are to your filters, their engagement rate, how real their audience looks and how fresh their figures are. It is an estimate to help you sort, not a verdict." },
  { q: "Can creators request removal of their profile?", a: "Yes. Any creator can use the Remove my data page to ask for their profile and contact information to be removed, and the request is reviewed by our team." },
];

function LandingFaq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div id="faq" className="mt-24 w-full max-w-3xl scroll-mt-24">
      <Reveal className="mb-10 text-center">
        <span className="rounded-full border border-cyan/30 bg-cyan-950/60 px-3.5 py-1.5 text-xs font-bold uppercase tracking-widest text-cyan-400">Frequently Answered</span>
        <h2 className="mt-4 font-display text-2xl font-bold text-white sm:text-3xl">Frequently asked questions.</h2>
      </Reveal>
      <div className="space-y-4">
        {FAQS.map((f, i) => {
          const on = open === i;
          return (
            <Reveal key={f.q} delay={i * 0.05}>
              <div className={cn("overflow-hidden rounded-2xl border bg-navy-2 transition-colors", on ? "border-cyan/30" : "border-white/10")}>
                <button aria-expanded={on} onClick={() => setOpen(on ? null : i)} className="flex w-full items-center justify-between px-6 py-4 text-left text-sm font-semibold text-white sm:text-base">
                  <span>{f.q}</span>
                  <motion.span animate={{ rotate: on ? 45 : 0 }} transition={{ duration: 0.2 }}><Plus className="h-5 w-5 text-cyan-400" /></motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: EASE }}>
                      <p className="border-t border-white/5 px-6 pb-4 pt-3 text-xs leading-relaxed text-slate-300 sm:text-sm">{f.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}

function LandingCta({ onTrial, onPrimary }: { onTrial: () => void; onPrimary: () => void }) {
  const phone = trialPhone();
  return (
    <Reveal className="w-full">
      <div id="beta-cta" className="relative mx-auto mt-24 w-full max-w-4xl overflow-hidden rounded-3xl border border-cyan/30 bg-gradient-to-b from-navy-2 to-[#0D132D] p-8 text-center shadow-2xl sm:p-14">
        <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-96 w-96 -translate-x-1/2 animate-pulse rounded-full bg-cyan/15 blur-[100px]" style={{ animationDuration: "4s" }} />
        <span className="relative rounded-full border border-cyan/30 bg-cyan-950/60 px-3.5 py-1.5 text-xs font-bold uppercase tracking-widest text-cyan-400">Scale with Precision</span>
        <h2 className="relative mt-4 font-display text-3xl font-extrabold tracking-tight text-white sm:text-5xl">Ready to work with evidence?</h2>
        <p className="relative mx-auto mt-4 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">Join Pakistani brands and marketing teams finding the right creator partners.</p>
        <div className="relative mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          {phone ? (
            <a href={phone.href} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-cyan px-8 text-sm font-bold text-navy shadow-[0_0_25px_rgba(6,182,212,0.4)] transition-all hover:bg-cyan-400 active:scale-[0.98]">
              <Phone className="h-[19px] w-[19px]" /> Call us for a free 14-day trial
            </a>
          ) : (
            <button onClick={onTrial} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-cyan px-8 text-sm font-bold text-navy shadow-[0_0_25px_rgba(6,182,212,0.4)] transition-all hover:bg-cyan-400 active:scale-[0.98]">
              <Phone className="h-[19px] w-[19px]" /> Ask for a free 14-day trial
            </button>
          )}
          <button onClick={onTrial} className="flex h-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-7 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/10">Request a call back</button>
        </div>
        <button onClick={onPrimary} className="relative mt-5 text-xs text-slate-400 underline-offset-4 hover:text-white hover:underline">or create an account</button>
      </div>
    </Reveal>
  );
}

function LandingFooter() {
  const cols: { t: string; l: { label: string; href?: string; id?: string; strong?: boolean }[] }[] = [
    { t: "Product", l: [{ label: "Search & Discovery", id: "discovery" }, { label: "Evidence & Signals", id: "capabilities" }, { label: "Campaigns", id: "capabilities" }, { label: "Pricing", id: "pricing" }] },
    { t: "Account", l: [{ label: "Client Sign In", href: "#/login" }, { label: "Create an account", href: "#/signup" }, { label: "Free trial", href: "#/free-trial" }] },
    { t: "Creators", l: [{ label: "Creator Data Notice", href: "#/creator-data" }, { label: "Remove my data", href: "#/remove-my-data", strong: true }, { label: "Terms of Service", href: "#/terms" }, { label: "Privacy Policy", href: "#/privacy" }] },
  ];
  return (
    <footer id="compliance" className="mt-24 w-full border-t border-white/10 pt-14">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
        <div className="flex flex-col md:col-span-5">
          <Brand />
          <p className="mt-4 max-w-sm text-xs leading-relaxed text-slate-400">The disciplined workflow for Pakistani influencer marketing: evidence-backed creator data, search, lists and campaigns for busy teams.</p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:col-span-7">
          {cols.map((c) => (
            <div key={c.t} className="flex flex-col gap-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-white">{c.t}</p>
              {c.l.map((l) =>
                l.id ? (
                  <button key={l.label} onClick={() => scrollToId(l.id!)} className="text-left text-xs text-slate-400 transition-colors hover:text-white">{l.label}</button>
                ) : (
                  <a key={l.label} href={l.href} className={cn("flex items-center gap-1 text-xs transition-colors", l.strong ? "font-semibold text-cyan-400 hover:text-cyan-300" : "text-slate-400 hover:text-white")}>
                    {l.strong && <Lock className="h-3.5 w-3.5" />}
                    {l.label}
                  </a>
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/5 pt-6 text-xs text-slate-400 sm:flex-row">
        <p>© {new Date().getFullYear()} MUSHIN. All rights reserved.</p>
        <div className="flex items-center gap-4">
          <a href="#/refunds" className="hover:text-white">Credits &amp; refunds</a>
          <span>•</span>
          <a href="#/privacy" className="hover:text-white">Privacy</a>
        </div>
      </div>
    </footer>
  );
}
