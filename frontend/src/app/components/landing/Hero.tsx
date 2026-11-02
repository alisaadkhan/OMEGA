import { ArrowRight, Check } from "lucide-react";
import { Button } from "../ui/button";

export function Hero({ onPrimary, onTrial }: { onPrimary?: () => void; onTrial?: () => void } = {}) {
  return (
    // MUSHIN design (2026-10-27): dark navy hero with the cyan accent; the product preview stays light on top of it.
    <section id="top" className="relative overflow-hidden bg-[#0b1220]">
      {/* Subtle background grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgb(148 163 184 / 0.12) 1px, transparent 1px), linear-gradient(to bottom, rgb(148 163 184 / 0.12) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at center top, black 30%, transparent 75%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(87,223,254,0.22), rgba(6,182,212,0.06), transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-6 pb-24 pt-20 sm:pt-28">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
            <span className="flex h-1.5 w-1.5 rounded-full bg-cyan-300" />
            Pakistan-first creator intelligence
          </div>

          <h1
            className="mt-6 text-balance tracking-tight text-white"
            style={{
              fontSize: "clamp(2.5rem, 5.5vw, 4.25rem)",
              lineHeight: 1.05,
              fontWeight: 600,
              letterSpacing: "-0.035em",
            }}
          >
            The intelligence layer for
            <span className="block text-cyan-300">
              modern creator campaigns
            </span>
          </h1>

          <p
            className="mx-auto mt-6 max-w-2xl text-balance text-slate-300"
            style={{ fontSize: "1.125rem", lineHeight: 1.6 }}
          >
            MUSHIN finds creators across Instagram, TikTok, and YouTube, shows how well each one fits your brief and how fresh the data is, and keeps your lists, campaigns and outreach log in one place.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button onClick={onTrial} className="group h-12 rounded-full bg-cyan-300 px-6 font-semibold text-slate-950 shadow-[0_0_32px_-8px_rgba(103,232,249,0.7)] hover:bg-cyan-200">
              Call us for a free 14-day trial
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
            <Button
              onClick={onPrimary}
              variant="outline"
              className="h-12 rounded-full border-white/25 bg-white/5 px-6 font-semibold text-white hover:bg-white/10 hover:text-white"
            >
              Create your account
            </Button>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-400">
            {["No credit card required", "14 days, 2,500 credits", "Nothing charged when it ends"].map((t) => (
              <div key={t} className="inline-flex items-center gap-1.5">
                <Check aria-hidden className="h-3.5 w-3.5 text-cyan-300" />
                {t}
              </div>
            ))}
          </div>
        </div>

        {/* Product preview */}
        <div className="relative mx-auto mt-16 max-w-6xl">
          <div
            aria-hidden
            className="absolute -inset-x-8 -inset-y-8 rounded-2xl"
            style={{
              background:
                "linear-gradient(180deg, rgba(15,23,42,0.04), rgba(15,23,42,0))",
            }}
          />
          <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_20px_60px_-20px_rgba(15,23,42,0.25)]">
            <div className="flex h-9 items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
              <div className="ml-3 h-4 w-64 rounded bg-slate-100" />
            </div>
            <div className="grid grid-cols-12 gap-0">
              <aside className="col-span-3 hidden border-r border-slate-100 bg-slate-50/40 p-4 md:block">
                <div className="mb-4 h-3 w-24 rounded bg-slate-200" />
                {["Overview", "Search", "Lists", "Campaigns", "Credits", "Support"].map((n, i) => (
                  <div
                    key={n}
                    className={`mb-1 flex items-center gap-2 rounded-md px-2 py-2 ${
                      i === 0 ? "bg-white shadow-sm" : ""
                    }`}
                  >
                    <span className="h-2 w-2 rounded-sm bg-slate-300" />
                    <span className="text-xs text-slate-600">{n}</span>
                  </div>
                ))}
              </aside>
              <div className="col-span-12 p-6 md:col-span-9">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <div className="mb-2 h-3 w-32 rounded bg-slate-200" />
                    <div className="h-2 w-48 rounded bg-slate-100" />
                  </div>
                  <div className="flex gap-2">
                    <div className="h-8 w-20 rounded-md border border-slate-200" />
                    <div className="h-8 w-24 rounded-md bg-slate-900" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {["Shortlisted", "Contacted", "Confirmed"].map((label) => (
                    <div key={label} className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="text-xs text-slate-500">{label}</div>
                      <div className="mt-2 h-3 w-14 rounded bg-slate-200" />
                      <div className="mt-2 h-2 w-10 rounded bg-slate-100" />
                    </div>
                  ))}
                </div>
                <div className="mt-4 h-56 rounded-lg border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4">
                  <svg viewBox="0 0 600 180" className="h-full w-full">
                    <defs>
                      <linearGradient id="g1" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M0,140 C60,120 100,80 160,90 C220,100 260,40 320,55 C380,70 420,30 480,50 C540,70 580,40 600,30 L600,180 L0,180 Z"
                      fill="url(#g1)"
                    />
                    <path
                      d="M0,140 C60,120 100,80 160,90 C220,100 260,40 320,55 C380,70 420,30 480,50 C540,70 580,40 600,30"
                      fill="none"
                      stroke="rgb(79 70 229)"
                      strokeWidth="2"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
