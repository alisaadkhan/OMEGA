export type PlanFeature = {
  key: "existing" | "new" | "audience" | "contact" | "outreach" | "campaigns" | "lists" | "export";
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

const AUDIENCE_NOTE =
  "Age, gender and location of a creator's audience. AI-estimated from public signals.";

export const PLANS: Plan[] = [
  {
    id: "explorer",
    name: "EXPLORER",
    tagline: "For freelancers and solo brands",
    positioning: "Everything you need to start finding the right creators.",
    monthly: 4900,
    yearly: 3900,
    credits: 2500,
    features: [
      { key: "existing", label: "Search Existing Creators" },
      { key: "new", label: "Find New Creators" },
      { key: "audience", label: "Audience Details", value: "5 profiles / month", note: AUDIENCE_NOTE },
      { key: "contact", label: "Reveal Contact Information" },
      { key: "campaigns", label: "Campaigns", value: "3 campaigns" },
      { key: "lists", label: "Lists" },
    ],
    cta: "Start free trial",
  },
  {
    id: "growth",
    name: "GROWTH",
    tagline: "For active brands and agencies",
    positioning: "Search, evaluate, and reach out to creators with more room to work.",
    monthly: 12900,
    yearly: 10900,
    credits: 12000,
    features: [
      { key: "existing", label: "Search Existing Creators" },
      { key: "new", label: "Find New Creators" },
      { key: "audience", label: "Audience Details", value: "AI-estimated", note: AUDIENCE_NOTE },
      { key: "contact", label: "Reveal Contact Information" },
      { key: "outreach", label: "Outreach Emails", value: "500 / month" },
      { key: "campaigns", label: "Campaigns", value: "Unlimited" },
      { key: "lists", label: "Lists" },
    ],
    cta: "Upgrade to Growth",
    highlight: true,
  },
  {
    id: "scale",
    name: "SCALE",
    tagline: "For agencies operating at volume",
    positioning: "More credits and outreach capacity for teams running several brands.",
    monthly: 24900,
    yearly: 19900,
    credits: 35000,
    features: [
      { key: "existing", label: "Search Existing Creators" },
      { key: "new", label: "Find New Creators" },
      { key: "audience", label: "Audience Details", value: "AI-estimated", note: AUDIENCE_NOTE },
      { key: "contact", label: "Reveal Contact Information" },
      { key: "outreach", label: "Outreach Emails", value: "2,000 / month" },
      { key: "campaigns", label: "Campaigns", value: "Unlimited" },
      { key: "lists", label: "Lists" },
      { key: "export", label: "Data Export" },
    ],
    cta: "Choose Scale",
  },
];
