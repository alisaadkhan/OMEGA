import { Database, Radio, ShieldCheck, Scale } from "lucide-react";

/**
 * Product pillars — spec §4/§29: no fabricated metrics, uptime SLAs, or
 * "conversion lift" claims we can't substantiate. We state what the product
 * does and how it treats data honestly instead of inventing numbers.
 */
export function Metrics() {
  const pillars = [
    { icon: Database, title: "Search first, spend later", body: "Query your database instantly for free — pay credits only when you deliberately go live." },
    { icon: Radio, title: "Live discovery on demand", body: "Reach the open web when you need fresh creators, with the credit cost shown up front." },
    { icon: ShieldCheck, title: "Honest data, always", body: "Every figure is labeled by freshness and confidence. Estimates are never dressed up as facts." },
    { icon: Scale, title: "Decisions, not dashboards", body: "Compare creators on the criteria that matter and see the trade-offs — no universal “winner.”" },
  ];
  return (
    <section className="border-b border-slate-200/60 bg-white py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {pillars.map((p) => (
            <div key={p.title}>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
                <p.icon className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div className="mt-4 text-slate-900" style={{ fontSize: "1.05rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
                {p.title}
              </div>
              <p className="mt-1.5 text-sm text-slate-500" style={{ lineHeight: 1.6 }}>
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
