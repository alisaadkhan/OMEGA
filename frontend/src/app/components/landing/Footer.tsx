import { Logo } from "./Logo";

const columns = [
  {
    title: "Product",
    links: ["Platform", "Workflows", "Analytics", "Integrations", "Changelog", "Roadmap"],
  },
  {
    title: "Solutions",
    links: ["For Revenue", "For Product", "For Marketing", "For Data Teams", "Enterprise"],
  },
  {
    title: "Resources",
    links: ["Documentation", "Guides", "Customer Stories", "Blog", "Security", "Status"],
  },
  {
    title: "Company",
    links: ["About", "Careers", "Press", "Partners", "Contact"],
  },
];

export function Footer() {
  return (
    <footer className="bg-white py-16">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-6">
          <div className="col-span-2 md:col-span-2">
            <a href="#" className="flex items-center">
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
                  <li key={l}>
                    <a href="#" className="text-sm text-slate-700 hover:text-slate-900">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-slate-200 pt-8 text-xs text-slate-500 sm:flex-row sm:items-center">
          <div>© {new Date().getFullYear()} Mushin Technologies, Inc. All rights reserved.</div>
          <div className="flex gap-6">
            <a href="#" className="hover:text-slate-900">Privacy</a>
            <a href="#" className="hover:text-slate-900">Terms</a>
            <a href="#" className="hover:text-slate-900">Security</a>
            <a href="#" className="hover:text-slate-900">DPA</a>
            <a href="#/admin/login" className="text-slate-400 hover:text-slate-900">Staff</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
