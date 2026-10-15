export type PlanFeature = {
  key: "existing" | "new" | "contact" | "campaigns" | "lists" | "outreach_log";
  label: string;
  value?: string;
  note?: string;
};

export type Plan = {
  id: "explorer" | "growth" | "scale";
  name: string;
  tagline: string;
  positioning: string;
  monthly: number;
  yearly: number;
  credits: number;
  features: PlanFeature[];
  cta: string;
  highlight?: boolean;
};

/**
 * The public pricing cards. Prices and credits mirror `platform.plans` (checked by plans-claims.test.ts); the persisted
 * id of Starter stays `explorer`. Every feature listed here works on every plan today; the campaign limit is the
 * server-enforced `campaignLimit` entitlement. Not listed because they are not available yet: audience demographics,
 * outreach email sending and data export.
 */
const FEATURES: PlanFeature[] = [
  { key: "existing", label: "Search Existing Creators", note: "Each new search uses credits; further pages and repeats within 30 minutes are free." },
  { key: "new", label: "Find New Creators", note: "Quoted before you confirm. You pay only for new creators actually added; nothing if none is found." },
  { key: "contact", label: "Reveal Contact Information" },
  { key: "lists", label: "Lists" },
  { key: "campaigns", label: "Campaigns" },
  { key: "outreach_log", label: "Outreach log", note: "Record your outreach by hand. MUSHIN does not send emails yet." },
];

/** The same features with the plan's open-campaign limit (null: no limit), as enforced by the API. */
const withCampaignLimit = (limit: number | null): PlanFeature[] =>
  FEATURES.map((f) => (f.key === "campaigns" ? { ...f, value: limit === null ? "Unlimited" : `Up to ${limit} open`, note: "Completed campaigns don't count." } : f));
export const CAMPAIGN_LIMITS: Record<Plan["id"], number | null> = { explorer: 3, growth: null, scale: null };

export const PLANS: Plan[] = [
  {
    id: "explorer",
    name: "STARTER",
    tagline: "For freelancers and solo brands",
    positioning: "Everything you need to start finding the right creators.",
    monthly: 4900,
    yearly: 3900,
    credits: 2500,
    features: withCampaignLimit(CAMPAIGN_LIMITS.explorer),
    cta: "Start free trial",
  },
  {
    id: "growth",
    name: "GROWTH",
    tagline: "For active brands and agencies",
    positioning: "The same tools with nearly five times the credits.",
    monthly: 12900,
    yearly: 10900,
    credits: 12000,
    features: withCampaignLimit(CAMPAIGN_LIMITS.growth),
    cta: "Upgrade to Growth",
    highlight: true,
  },
  {
    id: "scale",
    name: "SCALE",
    tagline: "For agencies operating at volume",
    positioning: "The most credits, for teams running several brands.",
    monthly: 24900,
    yearly: 19900,
    credits: 35000,
    features: withCampaignLimit(CAMPAIGN_LIMITS.scale),
    cta: "Choose Scale",
  },
];
