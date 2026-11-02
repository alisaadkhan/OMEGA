import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { ArrowRight, Eye, EyeOff, Info, Lock, Mail, MailCheck, RefreshCw } from "lucide-react";
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
      <div
        className="relative min-h-screen overflow-hidden bg-white"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 40%, #fafafa 0%, #ffffff 100%), linear-gradient(to right, rgba(198,198,205,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(198,198,205,0.12) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 32px 32px, 32px 32px",
        }}
      >
        <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-200/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute right-1/4 top-48 h-80 w-80 rounded-full bg-indigo-100/40 blur-3xl" />

        <div className="relative mx-auto flex min-h-screen w-full max-w-[480px] flex-col justify-center px-4 py-10 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden rounded-3xl bg-white px-6 pt-9 shadow-xl sm:px-10"
          >
            <div className="flex flex-col items-center text-center">
              <Logo />
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#06B6D4]" />
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

            {footer ? <div className="-mx-6 mt-8 bg-slate-50/70 px-6 py-5 text-center text-sm text-slate-600 sm:-mx-10">{footer}</div> : <div className="pb-9" />}
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
  error,
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
  /** Inline validation message: rose border and helper text under the input. */
  error?: string | null;
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
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`h-12 w-full rounded-xl border ${error ? "border-rose-500 bg-rose-50/40" : "border-transparent bg-slate-100"} text-sm text-slate-900 placeholder:text-slate-500 transition-colors focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/15 ${Icon ? "pl-10" : "pl-3.5"} ${isPassword ? "pr-11" : "pr-3.5"}`}
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
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-rose-600 animate-in fade-in slide-in-from-top-1 duration-200">
          {error}
        </p>
      )}
    </div>
  );
}

/** Animated message under a form: rose for errors, cyan for success. */
export function AuthAlert({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
  const cls = kind === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : kind === "success" ? "border-cyan-200 bg-cyan-50 text-cyan-900" : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <motion.div role={kind === "error" ? "alert" : "status"} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className={`rounded-xl border px-3.5 py-2.5 text-sm ${cls}`}>
      {children}
    </motion.div>
  );
}

/**
 * "Check your email" success screen (sign-up confirmation and password recovery): the address it went to, a 45-second
 * cooldown before a resend, and the way back to sign-in.
 */
export function CheckEmailState({ email, message, onResend, onBack }: { email: string; message: ReactNode; onResend: () => Promise<void>; onBack: () => void }) {
  const [seconds, setSeconds] = useState(45);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);
  const resend = async () => {
    setSending(true);
    setNote(null);
    try {
      await onResend();
      setNote({ kind: "success", text: `Sent again to ${email}.` });
      setSeconds(45);
    } catch (err) {
      setNote({ kind: "error", text: err instanceof Error ? err.message : "Couldn't send it again. Try again in a minute." });
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="flex flex-col items-center text-center">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 320, damping: 18 }} className="relative mb-4 flex items-center justify-center">
        <span aria-hidden className="absolute inset-0 scale-125 animate-pulse rounded-full bg-cyan-200/50 blur-xl" />
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-cyan-50 text-cyan-700">
          <MailCheck className="h-8 w-8" />
        </span>
      </motion.div>
      <p className="max-w-xs text-sm text-slate-600">{message}</p>
      <div className="my-5 flex w-full items-start gap-2.5 rounded-xl bg-slate-50 p-3 text-left">
        <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700" />
        <div className="text-xs">
          <div className="font-semibold text-slate-900">Didn't receive the email?</div>
          <div className="text-slate-500">Check your spam folder, or resend {seconds > 0 ? <>in <span className="font-semibold tabular-nums text-slate-900">{seconds}s</span></> : "now"}.</div>
        </div>
      </div>
      {note && <div className="mb-3 w-full"><AuthAlert kind={note.kind}>{note.text}</AuthAlert></div>}
      <button type="button" onClick={onBack} className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#131b2e] text-sm font-medium text-white shadow-md transition-all hover:-translate-y-px hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/50">
        Back to sign in <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </button>
      <button type="button" onClick={() => void resend()} disabled={seconds > 0 || sending} className="mt-4 inline-flex items-center gap-1.5 rounded-full text-xs font-semibold text-slate-600 transition-colors hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50">
        <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${sending ? "animate-spin" : ""}`} /> {sending ? "Sending…" : "Resend email"}
      </button>
    </div>
  );
}
