import { useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  Compass,
  Activity,
  Layers,
  Building2,
  Sparkles,
  Shield,
  Check,
  Search,
  Radio,
  Phone,
  Mail,
  FolderOpen,
  Info,
} from "lucide-react";
import { PLANS, type Plan as Tier } from "../../lib/plans";

const featureIcons = {
  existing: Search,
  new: Radio,
  contact: Phone,
  campaigns: FolderOpen,
  lists: FolderOpen,
  outreach_log: Mail,
} as const;

const tierIcons = { explorer: Compass, growth: Activity, scale: Layers } as const;

const tiers = PLANS;

const formatPkr = (n: number) =>
  new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n);

export function Pricing({ onPrimary }: { onPrimary?: () => void } = {}) {
  const [billing, setBilling] = useState<"monthly" | "yearly">("yearly");

  return (
    <section
      id="pricing"
      className="relative overflow-hidden border-b border-white/5 bg-[#0A0E1A] py-28 text-white"
    >
      {/* Subtle grid backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgb(255 255 255) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at center top, black 30%, transparent 75%)",
        }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[820px] -translate-x-1/2 -translate-y-1/3 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(124,92,255,0.22), transparent 70%)" }}
        animate={{ scale: [1, 1.05, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative mx-auto max-w-7xl px-6">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-[#7C5CFF]" />
            Transparent PKR pricing
          </div>
          <h2
            className="mt-5 tracking-tight"
            style={{
              fontSize: "clamp(2rem, 4vw, 3rem)",
              lineHeight: 1.1,
              fontWeight: 600,
              letterSpacing: "-0.03em",
            }}
          >
            Find, verify, and manage creators —
            <span className="block bg-gradient-to-r from-indigo-300 via-white to-emerald-300 bg-clip-text text-transparent">
              with a plan that fits.
            </span>
          </h2>
          <p className="mt-4 text-white/70" style={{ fontSize: "1.0625rem", lineHeight: 1.6 }}>
            Pick a monthly credit allowance. Upgrade, downgrade, or cancel any time.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="mt-8 flex flex-col items-center gap-3">
          <div
            role="tablist"
            className="relative flex items-center rounded-full border border-white/10 bg-white/[0.04] p-1 text-xs backdrop-blur"
          >
            {(["monthly", "yearly"] as const).map((b) => (
              <button
                key={b}
                role="tab"
                aria-selected={billing === b}
                onClick={() => setBilling(b)}
                className={`relative z-10 rounded-full px-4 py-1.5 capitalize transition-colors ${
                  billing === b ? "text-slate-900" : "text-white/70 hover:text-white"
                }`}
                style={{ fontWeight: 500 }}
              >
                {billing === b && (
                  <motion.span
                    layoutId="pricing-toggle"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    className="absolute inset-0 rounded-full bg-white"
                  />
                )}
                <span className="relative">{b === "yearly" ? "Yearly · save 20%" : "Monthly"}</span>
              </button>
            ))}
          </div>
          <div className="text-[11px] text-white/50">Prices in Pakistani Rupees · JazzCash · EasyPaisa · card</div>
        </div>

        {/* Tiers */}
        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-stretch">
          {tiers.map((t, i) => (
            <TierCard key={t.id} tier={t} index={i} billing={billing} onPrimary={onPrimary} />
          ))}
        </div>

        {/* Enterprise strip */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mt-10 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-6 backdrop-blur lg:p-8"
        >
          <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
                <Building2 className="h-5 w-5 text-white/80" strokeWidth={1.75} />
              </span>
              <div>
                <div className="inline-flex items-center gap-2 text-white" style={{ fontSize: 15, fontWeight: 600, letterSpacing: "0.14em" }}>
                  ENTERPRISE
                  <span className="rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-white/70" style={{ fontWeight: 500 }}>Custom</span>
                </div>
                <p className="mt-1.5 max-w-xl text-sm text-white/65" style={{ lineHeight: 1.55 }}>
                  For agency networks and enterprise brands. Custom credit volumes, team access, and
                  a dedicated point of contact. Tell us what you need and we will scope it with you.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/50">
                  <span className="inline-flex items-center gap-1"><Shield className="h-3 w-3" /> Role-based access</span>
                  <span>Volume pricing</span>
                </div>
              </div>
            </div>
            <button disabled title="Sales contact is not available yet" className="group inline-flex h-11 flex-shrink-0 cursor-not-allowed items-center gap-2 rounded-lg bg-white/70 px-5 text-sm text-slate-500 shadow-sm" style={{ fontWeight: 500 }}>
              Talk to sales (coming soon)
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          </div>
        </motion.div>

        {/* Trust row */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-white/50">
          <TrustPill>14-day free trial · no card</TrustPill>
          <TrustPill>Cancel anytime</TrustPill>
          <TrustPill>Monthly credits reset each billing period</TrustPill>
          
        </div>
      </div>
    </section>
  );
}

function TrustPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Check className="h-3 w-3 text-emerald-400" strokeWidth={2.5} />
      {children}
    </span>
  );
}

function FeatureTooltip({ note }: { note: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex items-center text-white/30 transition-colors hover:text-white/70 focus:outline-none"
        aria-label="More info"
      >
        <Info className="h-3 w-3" strokeWidth={2} />
      </button>
      {open && (
        <span
          className="absolute bottom-full left-1/2 z-50 mb-2 w-52 -translate-x-1/2 rounded-lg border border-white/10 bg-[#16182a] px-3 py-2 text-[11px] text-white/75 shadow-xl"
          style={{ lineHeight: 1.5 }}
          role="tooltip"
        >
          {note}
          <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-[#16182a]" />
        </span>
      )}
    </span>
  );
}

function TierCard({
  tier,
  index,
  billing,
  onPrimary,
}: {
  tier: Tier;
  index: number;
  billing: "monthly" | "yearly";
  onPrimary?: () => void;
}) {
  const isHighlight = !!tier.highlight;
  const Icon = tierIcons[tier.id];
  const price = billing === "yearly" ? tier.yearly : tier.monthly;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.45, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      className={`group relative flex flex-col rounded-2xl border p-7 backdrop-blur transition-all duration-200 will-change-transform hover:-translate-y-1 ${
        isHighlight
          ? "border-white/[0.14] bg-gradient-to-b from-white/[0.06] to-white/[0.02] shadow-[0_30px_80px_-30px_rgba(124,92,255,0.5)] lg:-translate-y-3"
          : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16] hover:bg-white/[0.04]"
      }`}
    >
      {/* Hover glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ boxShadow: "0 0 0 1px rgba(124,92,255,0.35), 0 20px 60px -25px rgba(124,92,255,0.5)" }}
      />

      {isHighlight && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#7C5CFF] to-[#4F46E5] px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-white shadow-lg"
            style={{ fontWeight: 600 }}
          >
            <Sparkles className="h-3 w-3" strokeWidth={2.25} />
            Most popular
          </span>
        </div>
      )}

      {/* Plan header */}
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.04]">
            <Icon className="h-4 w-4 text-white/80" strokeWidth={1.75} />
          </div>
          <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">
            Plan {index + 1}
          </span>
        </div>

        <div className="mt-6 text-white" style={{ fontSize: "0.875rem", fontWeight: 600, letterSpacing: "0.14em" }}>
          {tier.name}
        </div>
        <div className="mt-1 text-sm text-white/60" style={{ lineHeight: 1.55 }}>
          {tier.tagline}
        </div>

        {/* Price */}
        <div className="mt-6">
          <div className="flex items-baseline gap-1.5">
            <span className="text-white/70" style={{ fontSize: "1rem" }}>Rs.</span>
            <span
              className="tabular-nums"
              style={{ fontSize: "2.75rem", fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1 }}
            >
              {formatPkr(price)}
            </span>
            <span className="text-sm text-white/50">/ mo</span>
          </div>
          <div className="mt-2 text-[11px] text-white/45">
            {billing === "yearly" ? (
              <>
                Billed yearly at <span className="tabular-nums text-white/70">Rs. {formatPkr(price * 12)}</span> ·{" "}
                <span className="tabular-nums text-emerald-300">save Rs. {formatPkr((tier.monthly - tier.yearly) * 12)}</span>
              </>
            ) : (
              <>Billed monthly · switch to yearly to save 20%</>
            )}
          </div>
        </div>
      </div>

      {/* Credits block — the hero number */}
      <div
        className={`relative mt-6 overflow-hidden rounded-xl p-4 ${
          isHighlight
            ? "border border-[#7C5CFF]/30 bg-[#7C5CFF]/10"
            : "border border-white/[0.07] bg-white/[0.03]"
        }`}
      >
        <div className="flex items-end justify-between gap-2">
          <div>
            <div
              className={`tabular-nums leading-none ${isHighlight ? "text-[#A78BFA]" : "text-white"}`}
              style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.03em" }}
            >
              {new Intl.NumberFormat("en-PK").format(tier.credits)}
            </div>
            <div className="mt-1 text-xs text-white/50" style={{ fontWeight: 500 }}>
              credits per month
            </div>
          </div>
          <Sparkles className={`h-5 w-5 flex-shrink-0 ${isHighlight ? "text-[#7C5CFF]" : "text-white/20"}`} strokeWidth={1.75} />
        </div>
        <p className="mt-2 text-[11px] text-white/45" style={{ lineHeight: 1.5 }}>
          Credits are used for actions that require live data or AI processing. You always see the cost before you confirm.
        </p>
      </div>

      <p className="mt-4 text-sm text-white/60" style={{ lineHeight: 1.6 }}>
        {tier.positioning}
      </p>

      <div className="relative my-5 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* What's included */}
      <div className="relative flex-1">
        <div className="mb-3 text-[10px] uppercase tracking-[0.14em] text-white/35" style={{ fontWeight: 600 }}>
          What&apos;s included
        </div>
        <ul className="space-y-2">
          {tier.features.map((f) => {
            const FIcon = featureIcons[f.key];
            return (
              <li
                key={f.label + (f.value ?? "")}
                className="flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${
                      isHighlight ? "bg-[#7C5CFF]/15 text-[#A78BFA]" : "bg-white/[0.05] text-white/50"
                    }`}
                  >
                    <FIcon className="h-3 w-3" strokeWidth={2} />
                  </span>
                  <span className="truncate text-sm text-white/80" style={{ lineHeight: 1.4 }}>
                    {f.label}
                  </span>
                  {f.note && <FeatureTooltip note={f.note} />}
                </div>
                {f.value && (
                  <span
                    className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
                      isHighlight
                        ? "bg-[#7C5CFF]/20 text-[#C4B5FD]"
                        : "bg-white/[0.06] text-white/60"
                    }`}
                    style={{ fontWeight: 600 }}
                  >
                    {f.value}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* CTA */}
      <button
        onClick={onPrimary}
        className={`group/btn relative mt-7 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg px-5 text-sm transition-all duration-200 ${
          isHighlight
            ? "bg-gradient-to-r from-[#7C5CFF] to-[#4F46E5] text-white shadow-[0_8px_24px_-8px_rgba(124,92,255,0.7)] hover:shadow-[0_16px_40px_-12px_rgba(124,92,255,0.9)]"
            : "border border-white/15 bg-white/[0.03] text-white hover:border-white/30 hover:bg-white/[0.06]"
        }`}
        style={{ fontWeight: 500 }}
      >
        {tier.cta}
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-0.5" />
      </button>
    </motion.div>
  );
}
