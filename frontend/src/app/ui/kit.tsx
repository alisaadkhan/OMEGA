import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Info, Loader2, X, type LucideIcon } from "lucide-react";
import { cn } from "../components/ui/utils";

/** Shared building blocks of the 2026-11-16 redesign: one place for motion, alerts, fields, dialogs and drawers. */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** Fades and lifts its children in when they scroll into view (once). */
export function Reveal({ children, delay = 0, y = 18, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "0px 0px -60px 0px" });
  const reduce = useReducedMotion();
  return (
    <motion.div ref={ref} className={className} initial={reduce ? false : { opacity: 0, y }} animate={seen ? { opacity: 1, y: 0 } : undefined} transition={{ duration: 0.6, delay, ease: EASE }}>
      {children}
    </motion.div>
  );
}

/** Children appear one after another (cards, rows). Use with <StaggerItem>. */
export function Stagger({ children, className, gap = 0.06 }: { children: ReactNode; className?: string; gap?: number }) {
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }}>
      {children}
    </motion.div>
  );
}
export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } } }}>
      {children}
    </motion.div>
  );
}

/** A number that counts up to its value. */
export function CountUp({ value, format = (n) => n.toLocaleString("en-PK") }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const reduce = useReducedMotion();
  const from = useRef(0);
  useEffect(() => {
    if (reduce) return setShown(value);
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      setShown(Math.round(a + (value - a) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce]);
  return <>{format(shown)}</>;
}

type Tone = "error" | "success" | "info" | "warning";
const TONE: Record<Tone, { box: string; icon: LucideIcon }> = {
  error: { box: "bg-danger-soft/70 text-danger-ink ring-1 ring-danger/15", icon: AlertTriangle },
  success: { box: "bg-cyan-pale/40 text-teal-deep ring-1 ring-teal/15", icon: CheckCircle2 },
  info: { box: "bg-surface-low text-ink-soft ring-1 ring-surface-top", icon: Info },
  warning: { box: "bg-amber-50 text-amber-900 ring-1 ring-amber-200", icon: AlertTriangle },
};

/** Inline message that animates in (errors shake once) and out. Pass null to hide it. */
export function Alert({ tone, children, onClose, className }: { tone: Tone; children: ReactNode | null; onClose?: () => void; className?: string }) {
  const T = TONE[tone];
  return (
    <AnimatePresence initial={false}>
      {children ? (
        <motion.div
          key={tone + String(typeof children === "string" ? children : "x")}
          role={tone === "error" ? "alert" : "status"}
          initial={{ opacity: 0, height: 0, y: -6 }}
          animate={{ opacity: 1, height: "auto", y: 0 }}
          exit={{ opacity: 0, height: 0, y: -6 }}
          transition={{ duration: 0.28, ease: EASE }}
          className="overflow-hidden"
        >
          <div className={cn("flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-5", T.box, tone === "error" && "animate-shake", className)}>
            <T.icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">{children}</div>
            {onClose && (
              <button type="button" onClick={onClose} aria-label="Dismiss" className="-m-1 rounded p-1 opacity-60 hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

type BtnVariant = "primary" | "dark" | "cyan" | "soft" | "ghost" | "danger" | "outline";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-ink text-white hover:bg-[#1d2742] shadow-sm",
  dark: "bg-black text-white hover:bg-ink shadow-md",
  cyan: "bg-cyan text-navy hover:bg-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_28px_rgba(6,182,212,0.5)] font-semibold",
  soft: "bg-surface-low text-on hover:bg-surface-mid",
  ghost: "text-ink-soft hover:bg-surface-low hover:text-on",
  danger: "bg-danger text-white hover:opacity-90 shadow-sm",
  outline: "bg-white text-on ring-1 ring-surface-top hover:bg-surface-low shadow-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean; icon?: LucideIcon; size?: "sm" | "md" | "lg"; pill?: boolean }>(
  function Button({ variant = "primary", loading, icon: Icon, size = "md", pill, className, children, disabled, ...rest }, ref) {
    const sz = size === "sm" ? "h-8 px-3 text-xs gap-1.5" : size === "lg" ? "h-12 px-7 text-[15px] gap-2" : "h-10 px-4 text-[13px] gap-1.5";
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 focus-visible:ring-offset-2",
          pill ? "rounded-full" : "rounded-xl",
          sz,
          BTN[variant],
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);

/** Labelled input with an optional leading icon, password reveal and an animated error line. */
export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; icon?: LucideIcon; error?: string | null; hint?: ReactNode; aside?: ReactNode }>(
  function Field({ label, icon: Icon, error, hint, aside, type, className, id, ...rest }, ref) {
    const auto = useId();
    const fid = id ?? auto;
    const [show, setShow] = useState(false);
    const isPw = type === "password";
    return (
      <div className="flex flex-col gap-1.5 text-left">
        <div className="flex items-center justify-between">
          <label htmlFor={fid} className="text-[13px] font-medium text-on">{label}</label>
          {aside}
        </div>
        <div className="relative flex items-center">
          {Icon && <Icon className="pointer-events-none absolute left-3.5 h-[18px] w-[18px] text-faint" aria-hidden />}
          <input
            ref={ref}
            id={fid}
            type={isPw && show ? "text" : type}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${fid}-err` : undefined}
            className={cn(
              "w-full rounded-xl bg-surface-low py-3 text-[13px] text-on outline-none transition-all duration-200 placeholder:text-faint focus:bg-white focus:shadow-md focus:ring-2 focus:ring-cyan/30",
              Icon ? "pl-11" : "pl-3.5",
              isPw ? "pr-11" : "pr-4",
              error && "ring-2 ring-danger/40 focus:ring-danger/40",
              className,
            )}
            {...rest}
          />
          {isPw && (
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-3.5 text-faint transition-colors hover:text-on">
              {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
            </button>
          )}
        </div>
        <AnimatePresence initial={false}>
          {error && (
            <motion.p id={`${fid}-err`} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-xs text-danger">
              {error}
            </motion.p>
          )}
        </AnimatePresence>
        {hint && !error && <div className="text-xs text-faint">{hint}</div>}
      </div>
    );
  },
);

/** Centered dialog with a blurred backdrop; Escape and backdrop click close it. */
export function Modal({ open, onClose, children, label, width = "max-w-[540px]" }: { open: boolean; onClose: () => void; children: ReactNode; label: string; width?: string }) {
  useEscape(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-navy/50 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.25, ease: EASE }}
            className={cn("relative max-h-[92vh] w-full overflow-y-auto rounded-2xl bg-white shadow-2xl", width)}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Panel that slides in from the right. */
export function Drawer({ open, onClose, children, label, dark, width = "w-[420px]" }: { open: boolean; onClose: () => void; children: ReactNode; label: string; dark?: boolean; width?: string }) {
  useEscape(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-[60] bg-navy/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.32, ease: EASE }}
            className={cn("fixed bottom-0 right-0 top-0 z-[61] flex max-w-full flex-col shadow-2xl", width, dark ? "bg-ink text-white" : "bg-white")}
          >
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function useEscape(active: boolean, fn: () => void) {
  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && fn();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [active, fn]);
}

/** White rounded card used across the app. */
export function Card({ children, className, hover }: { children: ReactNode; className?: string; hover?: boolean }) {
  return <div className={cn("rounded-2xl bg-white shadow-sm", hover && "transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md", className)}>{children}</div>;
}

export function Pill({ children, tone = "neutral", dot, className }: { children: ReactNode; tone?: "neutral" | "cyan" | "dark" | "danger" | "amber"; dot?: boolean; className?: string }) {
  const t = {
    neutral: "bg-surface-mid text-ink-soft",
    cyan: "bg-cyan-pale/50 text-teal-deep",
    dark: "bg-ink text-white",
    danger: "bg-danger-soft/60 text-danger-ink",
    amber: "bg-amber-50 text-amber-800",
  }[tone];
  const d = { neutral: "bg-faint", cyan: "bg-teal", dark: "bg-cyan-soft", danger: "bg-danger", amber: "bg-amber-500" }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold", t, className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", d)} />}
      {children}
    </span>
  );
}

/** Label for UI the new design shows but the server does not support yet (owner 2026-11-16: keep the design, decide later). */
export function NotYet({ label = "Not available yet", className }: { label?: string; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full bg-surface-mid px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-faint", className)}>{label}</span>;
}

export function Avatar({ name, src, size = 36, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const [bad, setBad] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.34) };
  if (src && !bad) return <img src={src} alt="" onError={() => setBad(true)} style={style} className={cn("shrink-0 rounded-full bg-surface-mid object-cover", className)} />;
  return (
    <span style={style} className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ink to-teal font-semibold text-white", className)} aria-hidden>
      {initials}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-lg", className)} />;
}

/** Animated on/off switch. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", checked ? "bg-teal" : "bg-surface-top")}
    >
      <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }} className={cn("h-5 w-5 rounded-full bg-white shadow", checked ? "ml-[22px]" : "ml-0.5")} />
    </button>
  );
}

/** Segmented pill tabs with a sliding active background. */
export function Segmented<const T extends string>({ value, onChange, options, dark, className }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode }[]; dark?: boolean; className?: string }) {
  const group = useId();
  return (
    <div role="tablist" className={cn("inline-flex items-center gap-1 rounded-xl bg-surface-low p-1", className)}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} role="tab" aria-selected={on} type="button" onClick={() => onChange(o.id)} className={cn("relative whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors", on ? (dark ? "text-white" : "text-on") : "text-ink-soft hover:text-on")}>
            {on && <motion.span layoutId={group} className={cn("absolute inset-0 rounded-lg shadow-sm", dark ? "bg-black" : "bg-white")} transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <span className="relative z-10 inline-flex items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Thin progress bar that animates to its width. */
export function Progress({ value, className, bar = "bg-ink" }: { value: number; className?: string; bar?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-mid", className)}>
      <motion.div className={cn("h-full rounded-full", bar)} initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, value))}%` }} transition={{ duration: 0.9, ease: EASE }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="mb-7 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
      <div className="min-w-0">
        {eyebrow}
        <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.025em] text-on sm:text-[32px] sm:leading-10">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </motion.header>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center rounded-2xl bg-white px-6 py-14 text-center shadow-sm">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-soft/20 text-teal">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="text-[15px] font-semibold text-on">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-[13px] text-ink-soft">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

/** Rupees from paisa in Pakistani short form: Rs 9.2L (lakh), Rs 1.5Cr (crore), Rs 85K. */
export function shortRupees(minor: number | null): string {
  if (minor === null) return "—";
  const r = minor / 100;
  if (r >= 1e7) return `Rs ${(r / 1e7).toFixed(r >= 1e8 ? 0 : 1)}Cr`;
  if (r >= 1e5) return `Rs ${(r / 1e5).toFixed(1)}L`;
  if (r >= 1e3) return `Rs ${Math.round(r / 1e3)}K`;
  return `Rs ${Math.round(r)}`;
}
