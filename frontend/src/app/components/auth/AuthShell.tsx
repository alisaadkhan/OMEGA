import { motion, AnimatePresence } from "motion/react";
import { useState, type ReactNode } from "react";
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
  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      {/* Animated aurora orbs */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(99,102,241,0.16), rgba(16,185,129,0.06), transparent 70%)",
        }}
        animate={{ scale: [1, 1.08, 1], rotate: [0, 8, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -right-32 bottom-10 h-[420px] w-[420px] rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(99,102,241,0.10), transparent 70%)" }}
        animate={{ x: [0, 24, -10, 0], y: [0, -18, 12, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-32 h-[420px] w-[420px] rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(16,185,129,0.10), transparent 70%)" }}
        animate={{ x: [0, -22, 14, 0], y: [0, 16, -12, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
      />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgb(226 232 240 / 0.6) 1px, transparent 1px), linear-gradient(to bottom, rgb(226 232 240 / 0.6) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at center top, black 30%, transparent 75%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="flex justify-center"
        >
          <Logo />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
          className="relative mt-12 overflow-hidden rounded-2xl border border-slate-200 bg-white/90 p-8 shadow-[0_30px_80px_-30px_rgba(15,23,42,0.25)] backdrop-blur"
        >
          {/* Sweeping highlight on mount */}
          <motion.div
            aria-hidden
            initial={{ x: "-120%" }}
            animate={{ x: "120%" }}
            transition={{ duration: 1.4, ease: "easeInOut", delay: 0.2 }}
            className="pointer-events-none absolute inset-y-0 left-0 w-1/2"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(99,102,241,0.10), transparent)",
            }}
          />

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={formKey ?? title}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <motion.h1
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.15 }}
                className="tracking-tight text-slate-900"
                style={{ fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.02em" }}
              >
                {title}
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.2 }}
                className="mt-1.5 text-sm text-slate-600"
              >
                {subtitle}
              </motion.p>
              <div className="mt-6">{children}</div>
            </motion.div>
          </AnimatePresence>
        </motion.div>

        {footer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.4 }}
            className="mt-6 text-center text-sm text-slate-600"
          >
            {footer}
          </motion.div>
        )}
      </div>
    </div>
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

export function FormField({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <label className="block">
      <span className="text-xs text-slate-700" style={{ fontWeight: 500 }}>
        {label}
      </span>
      <motion.div
        animate={{
          boxShadow: focused
            ? "0 0 0 4px rgba(99,102,241,0.16), 0 0 24px -4px rgba(99,102,241,0.25)"
            : "0 0 0 0 rgba(99,102,241,0)",
        }}
        transition={{ duration: 0.2 }}
        className="mt-1.5 rounded-md"
      >
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-indigo-300 focus:outline-none"
        />
      </motion.div>
    </label>
  );
}
