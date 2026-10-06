import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Search, Zap, Coins, Shield, GitBranch } from "lucide-react";

type EventType = "search" | "event" | "credit" | "system";
type Event = {
  id: string;
  type: EventType;
  title: string;
  meta: string;
  time: string;
};

const typeMeta: Record<EventType, { icon: any; color: string; bg: string; label: string }> = {
  search: { icon: Search, color: "text-indigo-600", bg: "bg-indigo-50", label: "Search" },
  event: { icon: Zap, color: "text-slate-700", bg: "bg-slate-100", label: "Event" },
  credit: { icon: Coins, color: "text-amber-600", bg: "bg-amber-50", label: "Credit" },
  system: { icon: Shield, color: "text-emerald-600", bg: "bg-emerald-50", label: "System" },
};

const seed: Event[] = [
  { id: "e1", type: "search", title: "Search executed · 'Pakistani lifestyle 50k+'", meta: "184 results · −2 credits", time: "just now" },
  { id: "e2", type: "event", title: "Workflow · outreach_send", meta: "queued · 142ms · outreach_8f2", time: "2s ago" },
  { id: "e3", type: "credit", title: "Daily soft cap warning", meta: "82 of 100 credits used", time: "12s ago" },
  { id: "e4", type: "system", title: "SSO group sync completed", meta: "12 members reconciled", time: "1m ago" },
  { id: "e5", type: "event", title: "Enrichment · @sanaa.k profile", meta: "success · 38ms", time: "2m ago" },
  { id: "e6", type: "search", title: "Search executed · 'Urdu comedy >5% ER'", meta: "62 results · −2 credits", time: "4m ago" },
  { id: "e7", type: "system", title: "Webhook endpoint verified", meta: "hooks.brandx.pk/mushin", time: "9m ago" },
  { id: "e8", type: "credit", title: "Credits replenished", meta: "+10,000 (auto top-up)", time: "22m ago" },
];

const newCandidates: Omit<Event, "id" | "time">[] = [
  { type: "search", title: "Search executed · 'bridal Lahore 30k–80k'", meta: "44 results · −2 credits" },
  { type: "event", title: "Enrichment batch · 312 profiles", meta: "success · 71ms" },
  { type: "credit", title: "Workflow deduction", meta: "−4 credits · workflow_3a1" },
  { type: "system", title: "Audit log exported", meta: "csv · 8.2MB" },
  { type: "event", title: "Report exported · cohort_q3", meta: "success · 96ms" },
];

export function ActivityLog() {
  const [events, setEvents] = useState<Event[]>(seed);

  useEffect(() => {
    const id = setInterval(() => {
      const pick = newCandidates[Math.floor(Math.random() * newCandidates.length)];
      const next: Event = {
        ...pick,
        id: `e-${Date.now()}-${Math.random()}`,
        time: "just now",
      };
      setEvents((prev) => [next, ...prev].slice(0, 18));
    }, 2800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="tracking-tight text-slate-900" style={{ fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
            Activity log
          </h1>
          <p className="mt-1 text-sm text-slate-500">Real-time stream of searches, workspace events, credit deductions, and system events.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs text-slate-600">Live</span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
          {(["search", "event", "credit", "system"] as EventType[]).map((t) => {
            const m = typeMeta[t];
            return (
              <span key={t} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${m.bg} ${m.color}`}>
                <m.icon className="h-3 w-3" strokeWidth={2} />
                {m.label}
              </span>
            );
          })}
          <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500">
            <GitBranch className="h-3 w-3" />
            workspace · production
          </div>
        </div>
        <ul className="divide-y divide-slate-100">
          <AnimatePresence initial={false}>
            {events.map((e) => {
              const m = typeMeta[e.type];
              return (
                <motion.li
                  key={e.id}
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-center gap-3 px-5 py-3.5"
                >
                  <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${m.bg}`}>
                    <m.icon className={`h-4 w-4 ${m.color}`} strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-900" style={{ fontWeight: 500 }}>
                      {e.title}
                    </div>
                    <div className="truncate text-xs text-slate-500">{e.meta}</div>
                  </div>
                  <div className="flex-shrink-0 text-xs text-slate-400">{e.time}</div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}
