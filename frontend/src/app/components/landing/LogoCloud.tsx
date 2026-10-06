export function LogoCloud() {
  const logos = ["NORTHWIND", "ACME", "LATTICE", "VERTEX", "HELIX", "PARALLAX"];
  return (
    <section className="border-b border-slate-200/60 bg-white py-14">
      <div className="mx-auto max-w-7xl px-6">
        <p className="text-center text-xs uppercase tracking-[0.18em] text-slate-500">
          Trusted by data and revenue teams at category-defining companies
        </p>
        <div className="mt-8 grid grid-cols-2 items-center gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
          {logos.map((l) => (
            <div
              key={l}
              className="text-center text-slate-400 transition-colors hover:text-slate-700"
              style={{ fontWeight: 600, letterSpacing: "0.12em" }}
            >
              {l}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
