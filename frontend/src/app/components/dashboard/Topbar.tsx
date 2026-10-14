import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Coins, BarChart3, Activity, Settings, LifeBuoy, LogOut, ChevronDown } from "lucide-react";
import { AnimatedNumber } from "./AnimatedNumber";
import { useAuth } from "../../auth/AuthContext";
import { useBillingSummary } from "../../api/billing";
import { NotificationCenter } from "./NotificationCenter";
import type { DashView } from "./Sidebar";
import { Logo } from "../landing/Logo";
import type { Creator } from "./CreatorProfilePanel";
import { JobTray } from "./JobTray";
import { Omnibar } from "./Omnibar";

type Props = {
  credits: number;
  view: DashView;
  setView: (v: DashView) => void;
  onExit: () => void;
  onOpenCreator: (c: Creator) => void;
  onViewResults: (jobId: string) => void;
};

const MENU: { id: DashView; label: string; icon: any }[] = [
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "activity", label: "Activity log", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "support", label: "Support", icon: LifeBuoy },
];

const METER_STYLES = {
  normal: { box: "border-slate-200 bg-white hover:bg-slate-50", icon: "text-emerald-600", value: "text-slate-900", title: "Credits" },
  amber: { box: "border-amber-300 bg-amber-50 hover:bg-amber-100", icon: "text-amber-600", value: "text-amber-800", title: "Credits are running low" },
  red: { box: "border-red-300 bg-red-50 hover:bg-red-100", icon: "text-red-600", value: "text-red-700", title: "Credits are very low" },
} as const;

export function Topbar({ credits, view, setView, onExit, onOpenCreator, onViewResults }: Props) {
  const { user, logout } = useAuth();
  const name = user?.name ?? "Ahmed Raza Khan";
  const email = user?.email ?? "ahmed@mushin.pk";
  const initials = user?.initials ?? "AR";
  const avatar = user?.avatar;
  const [open, setOpen] = useState(false);
  const meter = useBillingSummary().data?.balance.meter ?? "normal";

  const go = (v: DashView) => {
    setView(v);
    setOpen(false);
  };

  return (
    <div className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur-md">
      <div className="flex items-center gap-2 sm:hidden">
        <Logo />
      </div>
      <div className="hidden sm:block"><Omnibar onOpen={onOpenCreator} /></div>

      <div className="flex items-center gap-3">
        <JobTray onOpenCreator={onOpenCreator} onViewResults={onViewResults} />
        <button
          onClick={() => go("billing")}
          title={METER_STYLES[meter].title}
          aria-label={`${METER_STYLES[meter].title}: ${credits} available`}
          className={`hidden items-center gap-2 rounded-md border px-3 py-1.5 transition-colors sm:flex ${METER_STYLES[meter].box}`}
        >
          <Coins className={`h-3.5 w-3.5 ${METER_STYLES[meter].icon}`} strokeWidth={2} />
          <span className="text-xs text-slate-500">Credits</span>
          <span className={`text-sm tabular-nums ${METER_STYLES[meter].value}`} style={{ fontWeight: 600 }}>
            <AnimatedNumber value={credits} />
          </span>
        </button>
        <NotificationCenter onSeeAll={() => setView("activity")} />

        {/* Profile menu — holds Analytics, Activity, Settings, Support */}
        <div className="relative pl-1">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-slate-100"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            {avatar ? (
              <img src={avatar} alt={name} className="h-9 w-9 rounded-full object-cover ring-2 ring-white shadow-sm" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-emerald-500 text-white" style={{ fontSize: "0.75rem", fontWeight: 600 }}>
                {initials}
              </div>
            )}
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
          </button>

          <AnimatePresence>
            {open && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  role="menu"
                  className="absolute right-0 top-12 z-50 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
                >
                  <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                    {avatar ? (
                      <img src={avatar} alt={name} className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-emerald-500 text-white" style={{ fontSize: "0.75rem", fontWeight: 600 }}>
                        {initials}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm text-slate-900" style={{ fontWeight: 600 }}>{name}</div>
                      <div className="truncate text-xs text-slate-500">{email}</div>
                    </div>
                  </div>

                  <div className="py-1">
                    {MENU.map((m) => {
                      const active = view === m.id;
                      return (
                        <button
                          key={m.id}
                          onClick={() => go(m.id)}
                          role="menuitem"
                          className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors ${
                            active ? "bg-slate-50 text-slate-900" : "text-slate-700 hover:bg-slate-50"
                          }`}
                          style={{ fontWeight: 500 }}
                        >
                          <m.icon className={`h-4 w-4 ${active ? "text-slate-900" : "text-slate-500"}`} strokeWidth={1.75} />
                          {m.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="border-t border-slate-100 py-1">
                    <button
                      onClick={() => {
                        setOpen(false);
                        void logout();
                        onExit();
                      }}
                      role="menuitem"
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                      style={{ fontWeight: 500 }}
                    >
                      <LogOut className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
                      Sign out
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
