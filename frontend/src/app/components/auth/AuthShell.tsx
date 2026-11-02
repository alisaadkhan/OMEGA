import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { Logo } from "../landing/Logo";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  formKey,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  formKey?: string;
}) {
  // MUSHIN design system (2026-10-27): one soft cyan glow on the surface colour, a white card with the mark, the
  // audience chip and a centred heading. No looping background animation; motion honours "reduce motion".
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen overflow-hidden bg-[#f7f9fb]">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-48 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full"
          style={{ background: "radial-gradient(closest-side, rgba(87,223,254,0.28), rgba(87,223,254,0.08) 60%, transparent 75%)" }}
        />

        <div className="relative mx-auto flex min-h-screen w-full max-w-[480px] flex-col justify-center px-4 py-10 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-3xl border border-slate-200/70 bg-white px-6 py-9 shadow-[0_24px_60px_-28px_rgba(15,23,42,0.22)] sm:px-10"
          >
            <div className="flex flex-col items-center text-center">
              <Logo />
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
                For brands &amp; agencies
              </span>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={formKey ?? title}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              >
                <h1 className="mt-7 text-center text-[26px] font-semibold leading-8 tracking-[-0.025em] text-slate-900">{title}</h1>
                <p className="mt-2 text-center text-sm text-slate-600">{subtitle}</p>
                <div className="mt-8">{children}</div>
              </motion.div>
            </AnimatePresence>

            {footer && <div className="mt-7 text-center text-sm text-slate-600">{footer}</div>}
          </motion.div>
        </div>
      </div>
    </MotionConfig>
  );
}

/** Staggered children container — wrap form fields in this and pass index. */
export function StaggerItem({ index, children }: { index: number; children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.25 + index * 0.07, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

const AUTOCOMPLETE: Record<string, string> = { email: "email", password: "current-password" };
const ICONS: Record<string, typeof Mail> = { email: Mail, password: Lock };

export function FormField({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoFocus,
  autoComplete,
  icon,
  aside,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Defaults by type: email, current-password. Pass "new-password" on sign-up and reset. */
  autoComplete?: string;
  /** Leading icon; email and password fields get one by default. */
  icon?: typeof Mail;
  /** Shown at the right of the label, e.g. "Forgot password?" (outside the label, so it never names the input). */
  aside?: ReactNode;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const Icon = icon ?? ICONS[type];
  const isPassword = type === "password";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-slate-900">
          {label}
        </label>
        {aside}
      </div>
      <div className="relative mt-2">
        {Icon && <Icon aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />}
        <input
          id={id}
          type={isPassword && visible ? "text" : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete={autoComplete ?? AUTOCOMPLETE[type] ?? "off"}
          className={`h-12 w-full rounded-xl border border-transparent bg-slate-100 text-sm text-slate-900 placeholder:text-slate-500 transition-colors focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/15 ${Icon ? "pl-10" : "pl-3.5"} ${isPassword ? "pr-11" : "pr-3.5"}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide characters" : "Show characters"}
            aria-pressed={visible}
            aria-controls={id}
            className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/60 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {visible ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
