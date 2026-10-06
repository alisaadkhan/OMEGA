export function Testimonial() {
  return (
    <section className="border-b border-slate-200/60 bg-slate-900 py-24 text-white">
      <div className="mx-auto max-w-5xl px-6 text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-indigo-300">Customer story</p>
        <blockquote
          className="mt-6 text-balance tracking-tight"
          style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)", lineHeight: 1.3, fontWeight: 500, letterSpacing: "-0.02em" }}
        >
          &ldquo;Mushin replaced six internal tools and gave us a single, trustworthy view of our customers. We
          shipped attribution and lifecycle automation in a quarter — work that previously took two years.&rdquo;
        </blockquote>
        <div className="mt-8 flex items-center justify-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-emerald-300 text-slate-900" style={{ fontWeight: 600 }}>
            SK
          </div>
          <div className="text-left">
            <div style={{ fontWeight: 500 }}>Sarah Klein</div>
            <div className="text-sm text-slate-400">VP Data Platform, Northwind</div>
          </div>
        </div>
      </div>
    </section>
  );
}
