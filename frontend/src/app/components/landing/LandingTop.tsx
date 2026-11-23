import { useEffect, useState } from "react";
import { AnimatePresence, motion, useScroll, useTransform } from "motion/react";
import { ArrowRight, Menu, X } from "lucide-react";
import { EASE } from "../../ui/kit";
import { cn } from "../ui/utils";
import { LandingShowcase } from "./LandingShowcase";

const NAV = [
  { label: "Features", id: "discovery" },
  { label: "Pricing", id: "pricing" },
  { label: "FAQ", id: "faq" },
  { label: "Compliance", id: "compliance" },
];

export const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export function Brand({ dark = true }: { dark?: boolean }) {
  return (
    <span className="group flex items-center gap-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-cyan shadow-[0_0_10px_#06B6D4] transition-transform group-hover:scale-125" />
      <span className={cn("font-display text-xl font-bold tracking-tight", dark ? "text-white" : "text-navy")}>MUSHIN</span>
    </span>
  );
}

export function LandingNav({ signedIn, onPrimary, onLogin }: { signedIn: boolean; onPrimary: () => void; onLogin: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={cn("sticky top-0 z-50 w-full border-b backdrop-blur-xl transition-all duration-300", scrolled ? "border-white/10 bg-navy/90 shadow-[0_8px_30px_rgba(0,0,0,0.25)]" : "border-white/5 bg-navy/70")}>
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 sm:px-8">
        <a href="#/" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-label="MUSHIN home">
          <Brand />
        </a>
        <nav aria-label="Site" className="hidden items-center gap-8 text-sm font-medium text-slate-300 md:flex">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => scrollToId(n.id)} className="relative transition-colors hover:text-white after:absolute after:-bottom-1 after:left-0 after:h-px after:w-0 after:bg-cyan after:transition-all hover:after:w-full">
              {n.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          {!signedIn && (
            <button onClick={onLogin} className="hidden px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white sm:inline-block">
              Sign In
            </button>
          )}
          <button onClick={onPrimary} className="flex h-10 items-center rounded-xl bg-cyan px-5 text-sm font-semibold text-navy shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all hover:bg-cyan-400 hover:shadow-[0_0_28px_rgba(6,182,212,0.5)] active:scale-[0.98]">
            {signedIn ? "Open dashboard" : "Request Access"}
          </button>
          <button className="text-slate-300 md:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-white/5 md:hidden">
            <div className="flex flex-col gap-1 px-6 py-4">
              {NAV.map((n) => (
                <button key={n.id} onClick={() => { setOpen(false); scrollToId(n.id); }} className="rounded-lg px-2 py-2.5 text-left text-sm text-slate-200 hover:bg-white/5">{n.label}</button>
              ))}
              {!signedIn && <button onClick={onLogin} className="rounded-lg px-2 py-2.5 text-left text-sm text-slate-200 hover:bg-white/5">Sign In</button>}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

/** "Apply for Early Access" opens the 14-day trial call-back form (owner, 23 Nov). */
export function LandingHero({ onTrial }: { onTrial: () => void }) {
  const { scrollY } = useScroll();
  const glowY = useTransform(scrollY, [0, 600], [0, 120]);
  const mockY = useTransform(scrollY, [0, 600], [0, -40]);
  return (
    <div className="relative w-full overflow-hidden bg-navy text-white">
      <motion.div aria-hidden style={{ y: glowY }} className="pointer-events-none absolute -top-40 left-1/2 h-[450px] w-[900px] -translate-x-1/2 rounded-full bg-cyan/[0.12] blur-[140px]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(to right,#fff 1px,transparent 1px),linear-gradient(to bottom,#fff 1px,transparent 1px)", backgroundSize: "56px 56px", maskImage: "radial-gradient(ellipse at 50% 20%, black 30%, transparent 70%)" }} />
      <section className="relative z-10 mx-auto flex max-w-7xl flex-col items-center px-6 pb-24 pt-16 text-center sm:px-8 sm:pt-24">
        <motion.span initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-cyan/10 px-3.5 py-1.5 text-xs font-semibold text-cyan-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" /> Built for Pakistan's creator economy
        </motion.span>
        <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.05 }} className="max-w-4xl font-display text-4xl font-extrabold leading-[1.12] tracking-tight sm:text-6xl md:text-7xl">
          Your entire influencer program, <br className="hidden sm:inline" />
          <span className="bg-gradient-to-r from-white via-slate-100 to-cyan bg-clip-text text-transparent">finally in one workflow.</span>
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.15 }} className="mt-6 max-w-2xl font-display text-base leading-relaxed text-slate-300 sm:text-xl">
          Find Pakistan-based creators, check the evidence behind every profile, and run campaigns without the spreadsheet chaos.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.25 }} className="mt-9 flex flex-col items-center gap-4 sm:flex-row">
          <button onClick={onTrial} className="group flex h-12 items-center gap-2 rounded-xl bg-cyan px-8 font-display text-base font-bold text-navy shadow-[0_0_25px_rgba(6,182,212,0.35)] transition-all hover:bg-cyan-400 hover:shadow-[0_0_35px_rgba(6,182,212,0.55)] active:scale-[0.98]">
            Apply for Early Access <ArrowRight className="h-[19px] w-[19px] transition-transform group-hover:translate-x-1" />
          </button>
        </motion.div>

        <motion.div style={{ y: mockY }} initial={{ opacity: 0, y: 40, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, ease: EASE, delay: 0.35 }} className="mt-16 w-full max-w-6xl">
          <LandingShowcase />
        </motion.div>
      </section>
    </div>
  );
}
