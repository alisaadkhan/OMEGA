import { Search, ShieldCheck, Gauge, Workflow, Sparkles, Users } from "lucide-react";

/** What the product does today. Every line maps to a working, tested capability (plans-claims.test.ts). */
const features = [
  {
    icon: Search,
    title: "Creator discovery",
    desc: "Search MUSHIN's catalogue of Instagram, TikTok and YouTube creators in English, Roman Urdu or Urdu, with platform, city, follower and engagement filters. Find new creators from a brief, with the price quoted before you confirm.",
  },
  {
    icon: ShieldCheck,
    title: "Suspicious Activity Signals",
    desc: "Unusual follower growth or engagement patterns worth reviewing, each shown with the evidence behind it. Signals to investigate, not verdicts.",
  },
  {
    icon: Gauge,
    title: "Creator Fit",
    desc: "How closely a creator matches your search or brief, with the reasons shown alongside the score.",
  },
  {
    icon: Sparkles,
    title: "Fresh, sourced data",
    desc: "Follower counts, engagement and summaries carry the date they were observed, so stale numbers are marked, not hidden.",
  },
  {
    icon: Workflow,
    title: "Campaign tracking",
    desc: "Lists, campaign stages, agreed fees and a manual outreach log in one place.",
  },
  {
    icon: Users,
    title: "Workspace roles",
    desc: "Owner, admin and member roles decide who can buy credits, see the ledger and manage the workspace.",
  },
];

export function Features() {
  return (
    <section id="features" className="border-b border-slate-200/60 bg-slate-50/50 py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group relative bg-white p-7 transition-colors duration-200 hover:bg-slate-50/60"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm transition-all duration-200 group-hover:-translate-y-px group-hover:shadow-md">
                <f.icon className="h-5 w-5 text-indigo-600" strokeWidth={1.75} />
              </div>
              <h3
                className="mt-5 text-slate-900"
                style={{ fontWeight: 600, letterSpacing: "-0.01em" }}
              >
                {f.title}
              </h3>
              <p className="mt-2 text-sm text-slate-600" style={{ lineHeight: 1.6 }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
