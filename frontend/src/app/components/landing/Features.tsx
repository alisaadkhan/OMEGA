import { Search, ShieldCheck, Gauge, Workflow, Sparkles, Users } from "lucide-react";

const features = [
  {
    icon: Search,
    title: "Creator discovery",
    desc: "Search creators across Instagram, TikTok, and YouTube with niche, audience, and engagement filters — plus lookalike and semantic discovery.",
  },
  {
    icon: ShieldCheck,
    title: "Suspicious Activity Signals",
    desc: "Surface unusual follower growth, engagement patterns, and anomalies worth reviewing — signals to investigate, not verdicts.",
  },
  {
    icon: Gauge,
    title: "Creator Fit Score",
    desc: "A score for how closely a creator matches your campaign. Each score includes a reasoning panel so you can see what contributed.",
  },
  {
    icon: Sparkles,
    title: "Refresh creator data",
    desc: "Audience Details (AI-estimated), growth history, niche analysis, and summaries — labeled by confidence level.",
  },
  {
    icon: Workflow,
    title: "Campaign operations",
    desc: "Pipelines, approvals, outreach, and creator lists in one place. Move work out of spreadsheets and Slack threads.",
  },
  {
    icon: Users,
    title: "Workspace collaboration",
    desc: "Shared lists, campaigns, and permissions across brand and agency teams. Built for multi-org enterprise use.",
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
              <p className="mt-2 text-sm text-slate-600" style={{ lineHeight: 1.6 }}
                 dangerouslySetInnerHTML={{ __html: f.desc }} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
