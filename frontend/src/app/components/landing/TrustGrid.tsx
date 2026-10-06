// Logo-only grayscale trust grid. Marks are abstract/geometric and don't reference real trademarks.
const marks = [
  // Concentric circles (think: data orbit)
  (
    <svg viewBox="0 0 120 32" className="h-7 w-auto">
      <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="16" cy="16" r="4" fill="currentColor" />
      <text x="34" y="21" fill="currentColor" style={{ fontWeight: 600, letterSpacing: "0.08em", fontSize: 12 }}>
        ORBIT
      </text>
    </svg>
  ),
  // Triangle wordmark
  (
    <svg viewBox="0 0 120 32" className="h-7 w-auto">
      <path d="M16 6 L26 24 L6 24 Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <text x="34" y="21" fill="currentColor" style={{ fontWeight: 600, letterSpacing: "0.08em", fontSize: 12 }}>
        APEX
      </text>
    </svg>
  ),
  // Two stacked bars
  (
    <svg viewBox="0 0 120 32" className="h-7 w-auto">
      <rect x="6" y="9" width="16" height="4" rx="1" fill="currentColor" />
      <rect x="10" y="19" width="16" height="4" rx="1" fill="currentColor" />
      <text x="34" y="21" fill="currentColor" style={{ fontWeight: 600, letterSpacing: "0.08em", fontSize: 12 }}>
        STRATA
      </text>
    </svg>
  ),
  // Hexagon
  (
    <svg viewBox="0 0 120 32" className="h-7 w-auto">
      <path d="M16 5 L25 10 L25 22 L16 27 L7 22 L7 10 Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <text x="34" y="21" fill="currentColor" style={{ fontWeight: 600, letterSpacing: "0.08em", fontSize: 12 }}>
        NOVA LABS
      </text>
    </svg>
  ),
  // Cross / plus
  (
    <svg viewBox="0 0 120 32" className="h-7 w-auto">
      <rect x="13" y="5" width="6" height="22" rx="1" fill="currentColor" />
      <rect x="5" y="13" width="22" height="6" rx="1" fill="currentColor" />
      <text x="34" y="21" fill="currentColor" style={{ fontWeight: 600, letterSpacing: "0.08em", fontSize: 12 }}>
        AXION
      </text>
    </svg>
  ),
  // Diamond + dot
  (
    <svg viewBox="0 0 120 32" className="h-7 w-auto">
      <path d="M16 5 L27 16 L16 27 L5 16 Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="16" cy="16" r="2.5" fill="currentColor" />
      <text x="34" y="21" fill="currentColor" style={{ fontWeight: 600, letterSpacing: "0.08em", fontSize: 12 }}>
        PRISM
      </text>
    </svg>
  ),
];

export function TrustGrid() {
  return (
    <section className="border-b border-slate-200/60 bg-white py-16">
      <div className="mx-auto max-w-7xl px-6">
        <h2
          className="text-center tracking-tight text-slate-900"
          style={{ fontSize: "1.0625rem", fontWeight: 500, letterSpacing: "-0.005em" }}
        >
          Trusted by teams building with data at scale
        </h2>
        <div className="mx-auto mt-10 grid max-w-5xl grid-cols-2 items-center gap-x-10 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
          {marks.map((m, i) => (
            <div
              key={i}
              className="flex items-center justify-center text-slate-400 opacity-70 transition-all duration-300 hover:opacity-100 hover:text-slate-700"
            >
              {m}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
