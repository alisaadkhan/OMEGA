import type { BillingPlans } from "@mushin/contracts";

/**
 * Presentation only (owner plan model 2026-10-16). Prices, credits, entitlements and what is switched on all come
 * from the server catalogue (GET /v1/public/plans, platform.plans); nothing here decides what a plan includes.
 */
export type CatalogPlan = BillingPlans["plans"][number];
export type Availability = BillingPlans["availability"];
export type PlanId = CatalogPlan["id"];

export const PLAN_COPY: Record<PlanId, { tagline: string; positioning: string; cta: string; highlight?: boolean }> = {
  explorer: { tagline: "For freelancers and solo brands", positioning: "Everything you need to start finding the right creators.", cta: "Start free trial" },
  growth: { tagline: "For active brands and agencies", positioning: "More credits, unlimited campaigns and outreach email.", cta: "Choose Growth", highlight: true },
  scale: { tagline: "For agencies operating at volume", positioning: "The most credits, more outreach email and data export.", cta: "Choose Scale" },
};

export type PlanFeature = {
  key: "existing" | "new" | "contact" | "lists" | "campaigns" | "audience" | "email" | "export" | "outreach_log";
  label: string;
  /** What the plan gives; "Not included" when it does not. */
  value: string;
  included: boolean;
  /** Included in the plan but not usable yet on this server (honest status, never shown as live). */
  status?: "coming_soon" | "test_mode";
  note?: string;
};

const fmt = (n: number) => new Intl.NumberFormat("en-PK").format(n);

/** The pricing facts the copy needs, all from the server catalogue. */
export type PricingFacts = Pick<BillingPlans, "availability" | "actionCosts" | "liveTiktokMinimum">;

/**
 * Live Discovery charging, worded exactly as the server settles it (audit BIL-01): base fee when at least one creator is
 * delivered (already-known creators included), plus each new creator, a TikTok minimum, never above the quote.
 */
export function liveDiscoveryRule(f: Pick<PricingFacts, "actionCosts" | "liveTiktokMinimum">): string {
  return `A run that delivers at least one creator costs ${fmt(f.actionCosts.find_new)} credits plus ${fmt(f.actionCosts.live_creator)} for each new creator, and at least ${fmt(f.liveTiktokMinimum)} when TikTok is included, never more than the quote you confirm. If it delivers no creator, it costs nothing.`;
}

/** The feature rows of one plan, derived from its server entitlements and the server's capability switches. */
export function planFeatures(plan: CatalogPlan, facts: PricingFacts): PlanFeature[] {
  const availability: Availability = facts.availability;
  const e = plan.entitlements;
  const emails = e.outreachEmailsPerMonth;
  const audienceIncluded = e.audienceViewsPerMonth !== 0;
  return [
    { key: "existing", label: "Creator discovery", value: "Included", included: true, note: "Each new search uses credits; further pages and repeats within 30 minutes are free." },
    { key: "new", label: "Live creator discovery", value: "Included", included: true, note: `Quoted before you confirm. ${liveDiscoveryRule(facts)}` },
    { key: "contact", label: "Creator contact information", value: "Included", included: true, note: "Revealing a creator's contact details uses credits; only stored, public contact details are shown." },
    { key: "lists", label: "Saved creators and lists", value: "Included", included: true },
    { key: "campaigns", label: "Campaigns", value: e.campaignLimit === null ? "Unlimited" : `Up to ${e.campaignLimit}`, included: true, ...(e.campaignLimit === null ? {} : { note: "Archived campaigns don't count towards the limit." }) },
    {
      key: "audience",
      label: "Audience details",
      value: audienceIncluded ? "Included" : "Not included",
      included: audienceIncluded,
      ...(audienceIncluded && !availability.audienceDetails
        ? { status: "coming_soon" as const, note: "Not available yet: it starts once an approved, accurate data source is in place. MUSHIN never shows invented demographics." }
        : {}),
    },
    {
      key: "email",
      label: "Outreach emails",
      value: emails === 0 ? "Not included" : emails === null ? "Unlimited" : `${fmt(emails)} per billing period`,
      included: emails !== 0,
      ...(emails !== 0 && availability.outreachEmail === "off"
        ? { status: "coming_soon" as const, note: "Sending through MUSHIN is not live yet. Until then, contact creators directly and log it in the campaign." }
        : emails !== 0 && availability.outreachEmail === "test"
          ? { status: "test_mode" as const, note: "Test mode: emails are recorded but not delivered." }
          : {}),
    },
    { key: "export", label: "Data export", value: e.export ? "Included" : "Not included", included: e.export, ...(e.export ? { note: "CSV of your lists and campaigns, available for 24 hours." } : {}), ...(e.export && !availability.export ? { status: "coming_soon" as const } : {}) },
    { key: "outreach_log", label: "Outreach log", value: "Included", included: true, note: "Record outreach you do outside MUSHIN by hand." },
  ];
}

/** Rupees from PKR minor units (paisa). */
export const rupees = (minor: number) => Math.round(minor / 100);
