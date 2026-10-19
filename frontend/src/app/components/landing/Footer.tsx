import { Logo } from "./Logo";

// Only places that exist (mandate v3 §2.9): the template's "Careers", "Customer stories", "Status" and similar links
// pointed nowhere. Sections of this page scroll; everything else is a real route.
type FooterLink = { label: string; section?: string; href?: string };
const columns: { title: string; links: FooterLink[] }[] = [
  { title: "Product", links: [{ label: "Features", section: "features" }, { label: "Pricing", section: "pricing" }, { label: "FAQ", section: "faq" }] },
  { title: "Account", links: [{ label: "Sign in", href: "#/login" }, { label: "Create an account", href: "#/signup" }, { label: "Reset password", href: "#/forgot" }] },
  { title: "Creators", links: [{ label: "Creator data notice", href: "#/creator-data" }, { label: "Remove my data", href: "#/remove-my-data" }] },
];
const linkClass = "inline-flex min-h-[28px] items-center text-sm text-slate-700 hover:text-slate-900";

export function Footer() {
  return (
    <footer className="bg-white py-16">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
          <div className="col-span-2 md:col-span-2">
            <a href="#/" className="flex items-center">
              <Logo />
            </a>
            <p className="mt-4 max-w-xs text-sm text-slate-600" style={{ lineHeight: 1.6 }}>
              Creator intelligence for the Pakistani market. Honest data, clear decisions.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {["Public-data sourced", "Freshness-labeled", "Role-based access"].map((b) => (
                <span
                  key={b}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-600"
                >
                  {b}
                </span>
              ))}
            </div>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <div className="text-xs uppercase tracking-[0.14em] text-slate-500">{col.title}</div>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.section ? (
                      <button type="button" onClick={() => document.getElementById(l.section ?? "")?.scrollIntoView({ behavior: "smooth", block: "start" })} className={linkClass}>
                        {l.label}
                      </button>
                    ) : (
                      <a href={l.href} className={linkClass}>
                        {l.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-slate-200 pt-8 text-xs text-slate-500 sm:flex-row sm:items-center">
          <div>© {new Date().getFullYear()} MUSHIN</div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="#/privacy" className="hover:text-slate-900">Privacy</a>
            <a href="#/terms" className="hover:text-slate-900">Terms</a>
            <a href="#/refunds" className="hover:text-slate-900">Credits & refunds</a>
            <a href="#/creator-data" className="hover:text-slate-900">Creator data</a>
            <a href="#/remove-my-data" className="hover:text-slate-900">Remove my data</a>
            <a href="#/admin/login" className="text-slate-500 hover:text-slate-900">Staff</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
