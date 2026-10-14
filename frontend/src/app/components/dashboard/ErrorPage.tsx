import { motion } from "motion/react";
import {
  AlertTriangle,
  Ban,
  Compass,
  Search,
  ArrowLeft,
  Home,
  WifiOff,
  Clock,
  ServerCrash,
  Wrench,
} from "lucide-react";

/**
 * Volume 9 — Error pages & system states.
 * 400 / 401 / 403 / 404 'Lost in the Noise' / 409 / 429 / 500 / maintenance / offline.
 * Each provides: illustration, primary + secondary actions, diagnostic ID, support link.
 */

type Preset =
  | "400"
  | "401"
  | "403"
  | "404"
  | "409"
  | "429"
  | "500"
  | "maintenance"
  | "offline"
  | "no-credits"
  | "workspace-missing"
  | "search-failed";

const presets: Record<
  Preset,
  {
    icon: any;
    tone: "slate" | "amber" | "red" | "indigo";
    eyebrow: string;
    title: string;
    body: string;
    primary: string;
    secondary?: string;
  }
> = {
  "400": {
    icon: AlertTriangle,
    tone: "amber",
    eyebrow: "400",
    title: "That request didn't quite land",
    body: "We couldn't parse the request. Try again — if it keeps happening, share the diagnostic ID with support.",
    primary: "Try again",
    secondary: "Back to dashboard",
  },
  "401": {
    icon: Ban,
    tone: "amber",
    eyebrow: "401",
    title: "Your session has expired",
    body: "For your security we signed you out. Sign back in to pick up where you left off.",
    primary: "Sign in again",
    secondary: "Learn more",
  },
  "403": {
    icon: Ban,
    tone: "red",
    eyebrow: "403",
    title: "You don't have access to this",
    body: "Your workspace role doesn't include permission for this action. Ask a workspace admin if you need it.",
    primary: "Request access",
    secondary: "Back to dashboard",
  },
  "404": {
    icon: Compass,
    tone: "indigo",
    eyebrow: "404 · Lost in the Noise",
    title: "This page doesn't exist",
    body: "The link may be broken, the page may have moved, or you may have taken a very creative typing risk.",
    primary: "Back to dashboard",
    secondary: "Search creators",
  },
  "409": {
    icon: AlertTriangle,
    tone: "amber",
    eyebrow: "409",
    title: "Duplicate detected",
    body: "There's already a resource with these values in your workspace. Open the existing one or pick a different name.",
    primary: "Open existing",
    secondary: "Cancel",
  },
  "429": {
    icon: Clock,
    tone: "amber",
    eyebrow: "429",
    title: "Slow down for a moment",
    body: "You've hit the rate limit for this workflow. Wait a minute and try again — nothing was charged.",
    primary: "Retry in 60s",
    secondary: "Upgrade plan",
  },
  "500": {
    icon: ServerCrash,
    tone: "red",
    eyebrow: "500",
    title: "Something broke on our side",
    body: "Our engineers were paged. Share the diagnostic ID with support and we'll unblock you quickly.",
    primary: "Try again",
    secondary: "Contact support",
  },
  maintenance: {
    icon: Wrench,
    tone: "indigo",
    eyebrow: "Maintenance",
    title: "We're upgrading MUSHIN",
    body: "Scheduled maintenance is running. We'll be back shortly — status.mushin.pk has live updates.",
    primary: "View status page",
    secondary: "Back to home",
  },
  offline: {
    icon: WifiOff,
    tone: "slate",
    eyebrow: "Offline",
    title: "You're not connected",
    body: "We couldn't reach the MUSHIN servers. Check your connection and try again — your work is safe locally.",
    primary: "Retry connection",
    secondary: "Learn more",
  },
  "no-credits": {
    icon: AlertTriangle,
    tone: "amber",
    eyebrow: "No credits",
    title: "You're out of credits",
    body: "Top up your credit balance to keep discovering creators. New credits activate instantly after payment.",
    primary: "Top up credits",
    secondary: "See pricing",
  },
  "workspace-missing": {
    icon: Compass,
    tone: "amber",
    eyebrow: "Workspace missing",
    title: "This workspace no longer exists",
    body: "The workspace was deleted or you were removed. Switch to a different one or create a new workspace.",
    primary: "Switch workspace",
    secondary: "Create new",
  },
  "search-failed": {
    icon: Search,
    tone: "red",
    eyebrow: "Search failed",
    title: "We couldn't complete your search",
    body: "A provider timed out mid-run. Your credits were refunded — retry now or use a saved filter set.",
    primary: "Retry search",
    secondary: "Use a saved filter",
  },
};

const toneMap = {
  slate: {
    ring: "ring-slate-200",
    icon: "text-slate-600",
    iconBg: "bg-slate-100",
    eyebrow: "text-slate-500",
    orbA: "rgba(148,163,184,0.20)",
    orbB: "rgba(100,116,139,0.10)",
  },
  amber: {
    ring: "ring-amber-200",
    icon: "text-amber-600",
    iconBg: "bg-amber-50",
    eyebrow: "text-amber-600",
    orbA: "rgba(245,158,11,0.20)",
    orbB: "rgba(217,119,6,0.10)",
  },
  red: {
    ring: "ring-red-200",
    icon: "text-red-600",
    iconBg: "bg-red-50",
    eyebrow: "text-red-600",
    orbA: "rgba(239,68,68,0.20)",
    orbB: "rgba(220,38,38,0.10)",
  },
  indigo: {
    ring: "ring-indigo-200",
    icon: "text-indigo-600",
    iconBg: "bg-indigo-50",
    eyebrow: "text-indigo-600",
    orbA: "rgba(99,102,241,0.20)",
    orbB: "rgba(79,70,229,0.10)",
  },
} as const;

export function ErrorPage({
  preset,
  onPrimary,
  onSecondary,
  onBack,
  onHome,
  onSupport,
  diagnosticId,
}: {
  preset: Preset;
  onPrimary?: () => void;
  onSecondary?: () => void;
  onBack?: () => void;
  onHome?: () => void;
  onSupport?: () => void;
  /** The server request id, when there is one. Never invented: a made-up id would send support looking for nothing. */
  diagnosticId?: string;
}) {
  const p = presets[preset];
  const tones = toneMap[p.tone];
  const Icon = p.icon;
  const diag = diagnosticId ?? null;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white px-6 py-12">
      {/* Aurora background */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full"
        style={{ background: `radial-gradient(closest-side, ${tones.orbA}, ${tones.orbB}, transparent 70%)` }}
        animate={{ scale: [1, 1.06, 1], rotate: [0, 6, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
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

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-lg text-center"
      >
        {/* Icon */}
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.15 }}
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${tones.iconBg} ring-1 ${tones.ring} shadow-sm`}
        >
          <Icon className={`h-6 w-6 ${tones.icon}`} strokeWidth={1.75} />
        </motion.div>

        <div className={`mt-6 text-xs uppercase tracking-[0.18em] ${tones.eyebrow}`} style={{ fontWeight: 600 }}>
          {p.eyebrow}
        </div>
        <h1
          className="mt-3 text-balance tracking-tight text-slate-900"
          style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.1 }}
        >
          {p.title}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm text-slate-600" style={{ lineHeight: 1.6 }}>
          {p.body}
        </p>

        {/* Actions */}
        <div className="mt-8 flex flex-col items-center justify-center gap-2 sm:flex-row">
          {onPrimary && (
            <button
              onClick={onPrimary}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm text-white shadow-sm transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-md"
              style={{ fontWeight: 500 }}
            >
              {p.primary}
            </button>
          )}
          {p.secondary && (
            <button
              onClick={onSecondary}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm text-slate-700 transition-all hover:-translate-y-px hover:bg-slate-50 hover:shadow-sm"
              style={{ fontWeight: 500 }}
            >
              {p.secondary}
            </button>
          )}
        </div>

        {/* Utility footer */}
        <div className="mt-8 flex items-center justify-center gap-3 text-xs text-slate-500">
          {onBack && (
            <button onClick={onBack} className="inline-flex items-center gap-1 hover:text-slate-800">
              <ArrowLeft className="h-3 w-3" strokeWidth={2} />
              Go back
            </button>
          )}
          <span className="h-3 w-px bg-slate-200" />
          {onHome && <button onClick={onHome} className="inline-flex items-center gap-1 hover:text-slate-800">
            <Home className="h-3 w-3" strokeWidth={2} />
            Home
          </button>}
          <span className="h-3 w-px bg-slate-200" />
          {onSupport && <button onClick={onSupport} className="inline-flex items-center gap-1 hover:text-slate-800">
            <Search className="h-3 w-3" strokeWidth={2} />
            Contact support
          </button>}
        </div>

        {diag && (
          <div className="mt-4 text-[11px] text-slate-500 tabular-nums">
            Request ID · <span className="text-slate-500">{diag}</span>
          </div>
        )}
      </motion.div>
    </div>
  );
}
