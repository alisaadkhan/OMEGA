type Testimonial = {
  quote: string;
  name: string;
  role: string;
  company: string;
  initials: string;
};

const items: Testimonial[] = [
  {
    quote:
      "Mushin replaced six internal tools and gave us a single, trustworthy view of our customers. We shipped attribution and lifecycle automation in a quarter.",
    name: "Sarah Klein",
    role: "VP Data Platform",
    company: "Orbit",
    initials: "SK",
  },
  {
    quote:
      "The workflow engine is the first I've seen that scales without becoming a maintenance burden. Our team trusts it with production-critical paths.",
    name: "Daniel Park",
    role: "Director of Engineering",
    company: "Apex",
    initials: "DP",
  },
  {
    quote:
      "We replaced a 14-step manual operations process. The audit trail and access controls were what won over our security team.",
    name: "Priya Raman",
    role: "Head of Revenue Operations",
    company: "Strata",
    initials: "PR",
  },
  {
    quote:
      "Onboarding took two days. Two months in we're processing four billion events a month with a single dedicated engineer.",
    name: "Marcus Lindberg",
    role: "Staff Engineer",
    company: "Nova Labs",
    initials: "ML",
  },
];

function CompanyMark({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-1.5 text-slate-500">
      <svg width="14" height="14" viewBox="0 0 32 32">
        <rect x="4" y="4" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <rect x="17" y="17" width="11" height="11" rx="2" fill="currentColor" />
      </svg>
      <span style={{ fontWeight: 600, letterSpacing: "0.08em", fontSize: "0.6875rem" }}>
        {name.toUpperCase()}
      </span>
    </div>
  );
}

export function Testimonials() {
  return (
    <section className="border-b border-slate-200/60 bg-slate-50/50 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs uppercase tracking-[0.18em] text-indigo-600">Customer stories</p>
          <h2
            className="mt-3 tracking-tight text-slate-900"
            style={{ fontSize: "clamp(1.875rem, 3.5vw, 2.75rem)", lineHeight: 1.1, fontWeight: 600, letterSpacing: "-0.025em" }}
          >
            Teams ship faster with Mushin
          </h2>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-2">
          {items.map((t) => (
            <figure
              key={t.name}
              className="group flex flex-col rounded-xl border border-slate-200 bg-white p-7 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
            >
              <CompanyMark name={t.company} />
              <blockquote
                className="mt-5 text-slate-800"
                style={{ fontSize: "1rem", lineHeight: 1.65, letterSpacing: "-0.005em" }}
              >
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3 border-t border-slate-100 pt-5">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white"
                  style={{ fontSize: "0.75rem", fontWeight: 600 }}
                >
                  {t.initials}
                </div>
                <div>
                  <div className="text-sm text-slate-900" style={{ fontWeight: 500 }}>
                    {t.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {t.role}, {t.company}
                  </div>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
