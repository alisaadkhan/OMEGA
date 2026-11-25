import { Coins, Menu } from "lucide-react";
import { AnimatedNumber } from "./AnimatedNumber";
import { useAuth } from "../../auth/AuthContext";
import { useBillingSummary } from "../../api/billing";
import { NotificationCenter } from "./NotificationCenter";
import type { DashView } from "./Sidebar";
import { Logo } from "../landing/Logo";
import type { Creator } from "./CreatorProfilePanel";
import { JobTray } from "./JobTray";
import { accountInitials, accountLabel } from "../../lib/billing-status";

type Props = {
  credits: number | null;
  view: DashView;
  setView: (v: DashView) => void;
  onOpenCreator: (c: Creator) => void;
  onViewResults: (jobId: string) => void;
  /** Opens the navigation drawer on small screens. */
  onOpenNav?: () => void;
};


const METER_STYLES = {
  normal: { box: "bg-cyan-pale/40 hover:bg-cyan-pale/70", icon: "text-teal", value: "text-teal-deep", title: "Credits" },
  amber: { box: "bg-amber-50 ring-1 ring-amber-300 hover:bg-amber-100", icon: "text-amber-600", value: "text-amber-800", title: "Credits are running low" },
  red: { box: "bg-red-50 ring-1 ring-red-300 hover:bg-red-100", icon: "text-red-600", value: "text-red-700", title: "Credits are very low" },
} as const;

export function Topbar({ credits, view, setView, onOpenCreator, onViewResults, onOpenNav }: Props) {
  const { user } = useAuth();
  // Never an invented person: the account's own name, else its email (finding: a placeholder name was shown).
  const name = accountLabel(user);
  const email = user?.email ?? "";
  const initials = user?.initials ?? accountInitials(name);
  const avatar = user?.avatar;
  const meter = useBillingSummary().data?.balance.meter ?? "normal";

  const go = (v: DashView) => setView(v);

  return (
    <div className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 bg-surface/[0.97] px-3 shadow-[0_1px_8px_rgba(0,0,0,0.04)] sm:px-8">
      <div className="flex min-w-0 items-center gap-2 md:hidden">
        <button onClick={onOpenNav} aria-label="Open navigation" className="rounded-md p-2 text-slate-700 hover:bg-slate-100">
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <span className="sm:hidden"><Logo /></span>
      </div>
      <div className="hidden md:block" />

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <JobTray onOpenCreator={onOpenCreator} onViewResults={onViewResults} />
        <button
          onClick={() => go("billing")}
          title={METER_STYLES[meter].title}
          aria-label={credits === null ? "Credits: balance not loaded" : `${METER_STYLES[meter].title}: ${credits} available`}
          className={`hidden items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors sm:flex ${METER_STYLES[meter].box}`}
        >
          <Coins className={`h-3.5 w-3.5 ${METER_STYLES[meter].icon}`} strokeWidth={2} />
          <span className={`text-[11px] font-semibold uppercase tracking-[0.04em] tabular-nums ${METER_STYLES[meter].value}`}>
            {credits === null ? <span className="text-slate-400" aria-hidden="true">—</span> : <AnimatedNumber value={credits} />} credits
          </span>
        </button>
        <NotificationCenter onOpenView={setView} />

        {/* Who is signed in. Display only: every account action is in the sidebar (owner, 17 Nov). */}
        <div className="flex items-center gap-2.5 pl-1">
          <span className="sr-only xl:hidden">Signed in as {name}</span>
          {avatar ? (
            <img src={avatar} alt="" className="h-9 w-9 rounded-full object-cover ring-2 ring-white shadow-sm" />
          ) : (
            <div aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-ink to-teal text-white" style={{ fontSize: "0.75rem", fontWeight: 600 }}>
              {initials}
            </div>
          )}
          <span className="hidden min-w-0 flex-col text-left leading-tight xl:flex">
            <span className="truncate text-xs font-semibold text-slate-900">{name}</span>
            <span className="max-w-[160px] truncate text-[11px] text-slate-500">{email}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
