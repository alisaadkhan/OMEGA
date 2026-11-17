import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Columns3, MessageSquare, Navigation, Rocket, Search, ShieldCheck, X } from "lucide-react";
import { EASE, useEscape } from "../../ui/kit";
import { cn } from "../ui/utils";

/** First-run onboarding (owner design 2026-11-16): a welcome dialog shown once per user, then an optional guided tour. */
const seenKey = (userId: string) => `mushin.onboarded.${userId}`;
export function hasOnboarded(userId: string): boolean {
  try {
    return localStorage.getItem(seenKey(userId)) === "1";
  } catch {
    return true; // storage unavailable: never nag on every visit
  }
}
export function markOnboarded(userId: string) {
  try {
    localStorage.setItem(seenKey(userId), "1");
  } catch {
    /* storage unavailable */
  }
}

const FEATURES = [
  { icon: Search, t: "Discover", b: "Search across Instagram, TikTok and YouTube with precise filters." },
  { icon: ShieldCheck, t: "Verify", b: "See the evidence behind every location, niche and engagement figure." },
  { icon: Columns3, t: "Manage", b: "Track creators, stages and agreed fees in campaigns." },
  { icon: MessageSquare, t: "Communicate", b: "Log outreach and keep every conversation next to the campaign." },
];

export function WelcomeModal({ open, onStart, onSkip }: { open: boolean; onStart: () => void; onSkip: () => void }) {
  useEscape(open, onSkip);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="welcome-title" initial={{ opacity: 0, scale: 0.92, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.4, ease: EASE }} className="relative w-full max-w-[490px] overflow-hidden rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
            <div aria-hidden className="pointer-events-none absolute -top-16 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-cyan-soft/20 blur-2xl" />
            <div className="relative flex flex-col items-center text-center">
              <motion.div initial={{ scale: 0.5, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 220, damping: 14, delay: 0.1 }} className="relative flex h-20 w-20 items-center justify-center rounded-full bg-ink shadow-lg shadow-teal/20">
                <span className="absolute inset-0 animate-ping rounded-full bg-cyan-soft/30 opacity-25" />
                <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-tr from-ink via-teal-deep to-cyan-soft p-0.5">
                  <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-ink">
                    <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(87,223,254,0.45),transparent_70%)]" />
                    <svg className="relative z-10 h-8 w-8 text-cyan-soft" fill="none" viewBox="0 0 32 32" aria-hidden>
                      <motion.circle cx="16" cy="16" r="12" stroke="currentColor" strokeDasharray="2 3" strokeWidth="1.5" opacity="0.65" animate={{ rotate: 360 }} transition={{ duration: 12, repeat: Infinity, ease: "linear" }} style={{ originX: "16px", originY: "16px" }} />
                      <circle cx="16" cy="16" r="7.5" stroke="#fff" strokeWidth="1.75" />
                      <circle cx="16" cy="16" r="3" fill="currentColor" />
                      <path d="M16 2V6M16 26V30M2 16H6M26 16H30" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" opacity="0.5" />
                    </svg>
                  </span>
                </span>
              </motion.div>
              <h2 id="welcome-title" className="mt-6 text-2xl font-semibold tracking-tight text-on">Welcome to MUSHIN.</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">Your account is ready. Discover, verify, manage and communicate with creators in a single platform.</p>
              <div className="my-6 flex w-full flex-col gap-2.5 text-left">
                {FEATURES.map((f, i) => (
                  <motion.div key={f.t} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.08, ease: EASE }} className="flex items-center gap-3.5 rounded-xl bg-slate-50 p-3 transition-colors hover:bg-slate-100/80">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-white text-cyan-600 shadow-sm"><f.icon className="h-4 w-4" /></span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[13px] font-semibold leading-snug text-slate-900">{f.t}</span>
                      <span className="text-xs leading-normal text-slate-500">{f.b}</span>
                    </span>
                  </motion.div>
                ))}
              </div>
              <button onClick={onStart} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-6 py-3 font-semibold text-slate-900 shadow-sm transition-all hover:bg-cyan-400 active:scale-[0.98]">Get Started <ArrowRight className="h-4 w-4" /></button>
              <button onClick={onSkip} className="mt-3 text-sm text-slate-400 transition-colors hover:text-slate-600">Go to dashboard</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type Step = { title: string; body: string; target: string; placement: "bottom" | "top" | "right" };
const STEPS: Step[] = [
  { title: "Your Command Center", body: "Credits used, shortlists, running and paused campaigns, at a single glance.", target: "[data-tour='metrics']", placement: "bottom" },
  { title: "Precision Discovery", body: "Search Pakistan-based creators by niche, city or keywords, then narrow with platform, follower and engagement filters.", target: "[data-tour='search']", placement: "bottom" },
  { title: "Curate Your Talent", body: "Group creators into shortlists for seasonal pitches, regional drops or a client review.", target: "[data-tour='shortlists']", placement: "right" },
  { title: "Turn Lists into Action", body: "Create campaigns, move creators through stages, agree fees and log every conversation.", target: "[data-tour='campaigns']", placement: "right" },
];

/** Spotlight tour: a glowing frame moves to each target and a card explains it. Arrow keys and Escape work. */
export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i]!;
  const measure = useCallback(() => {
    const el = document.querySelector(step.target);
    if (!el) return setRect(null);
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setRect(el.getBoundingClientRect());
  }, [step.target]);
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const t = setTimeout(measure, 350);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(t); window.removeEventListener("resize", measure); };
  }, [open, measure]);
  useEffect(() => { if (open) setI(0); }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((v) => Math.min(STEPS.length - 1, v + 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  const pad = 8;
  const W = Math.min(380, window.innerWidth - 32);
  let top = 76, left = 16;
  if (rect) {
    if (step.placement === "right") { top = Math.max(76, rect.top + rect.height / 2 - 110); left = rect.right + 28; }
    else if (step.placement === "bottom") { top = rect.bottom + 18; left = rect.left + rect.width / 2 - W / 2; }
    else { top = rect.top - 240; left = rect.left + rect.width / 2 - W / 2; }
    left = Math.max(16, Math.min(window.innerWidth - W - 16, left));
    top = Math.max(76, Math.min(window.innerHeight - 260, top));
  }
  const last = i === STEPS.length - 1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="fixed inset-0" onClick={onClose} />
          {!rect && <div className="fixed inset-0 bg-navy/65" />}
          {rect && (
            <motion.div aria-hidden className="pointer-events-none fixed rounded-2xl" style={{ boxShadow: "0 0 0 2px #57dffe, 0 0 35px rgba(6,182,212,0.45), 0 0 0 9999px rgba(10,15,36,0.62)" }} animate={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} transition={{ duration: 0.5, ease: EASE }}>
              {["-left-1.5 -top-1.5 border-l-2 border-t-2", "-right-1.5 -top-1.5 border-r-2 border-t-2", "-bottom-1.5 -left-1.5 border-b-2 border-l-2", "-bottom-1.5 -right-1.5 border-b-2 border-r-2"].map((c) => <span key={c} className={cn("absolute h-3 w-3 border-cyan-soft", c)} />)}
            </motion.div>
          )}
          <div className="fixed left-1/2 top-5 z-[81] flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink/90 px-4 py-2 shadow-2xl backdrop-blur-md">
            <Navigation className="h-4 w-4 text-cyan-soft" />
            <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-soft">Walkthrough</span>
            {STEPS.map((_, k) => (
              <button key={k} onClick={() => setI(k)} aria-label={`Step ${k + 1}`} className={cn("rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors", k === i ? "bg-cyan-soft text-teal-deep" : "text-mist hover:text-white")}>{k + 1}</button>
            ))}
            <button onClick={onClose} aria-label="Close tour" className="ml-2 text-steel-2 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
          <motion.div role="dialog" aria-label={step.title} className="fixed z-[81] flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-2xl" style={{ width: W }} animate={{ top, left }} transition={{ duration: 0.5, ease: EASE }}>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-pale/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-teal"><span className="h-2 w-2 rounded-full bg-teal" />Step {i + 1} of {STEPS.length}</span>
              <span className="flex items-center gap-1.5">
                {STEPS.map((_, k) => <motion.span key={k} animate={{ width: k === i ? 16 : 8 }} className={cn("h-2 rounded-full", k === i ? "bg-cyan-soft" : "bg-surface-high")} />)}
              </span>
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="flex flex-col gap-1.5">
                <h2 className="text-lg font-bold tracking-tight text-on">{step.title}</h2>
                <p className="text-[13px] leading-relaxed text-ink-soft">{step.body}</p>
              </motion.div>
            </AnimatePresence>
            <div className="flex items-center justify-between pt-2">
              <button onClick={onClose} className="text-[11px] font-semibold text-ink-soft hover:text-on">Skip tour</button>
              <div className="flex items-center gap-2">
                <button onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0} className="flex items-center gap-1 rounded-lg bg-surface-mid px-3 py-1.5 text-[13px] font-medium text-on transition-colors hover:bg-surface-high disabled:pointer-events-none disabled:opacity-40"><ArrowLeft className="h-4 w-4" />Back</button>
                <button onClick={() => (last ? onClose() : setI(i + 1))} className={cn("flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium text-white shadow-md transition-all", last ? "bg-teal shadow-[0_0_16px_rgba(6,182,212,0.4)]" : "bg-ink hover:opacity-90")}>
                  {last ? <>Get Started <Rocket className="h-4 w-4" /></> : <>Next <ArrowRight className="h-4 w-4" /></>}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
