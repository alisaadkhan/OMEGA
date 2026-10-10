import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Sidebar, type DashView } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Overview } from "./Overview";
import { SearchModule } from "./SearchModule";
import { Billing } from "./Billing";
import { BillingStatusBanner } from "./BillingStatusBanner";
import { Support } from "./Support";
import { ActivityLog } from "./ActivityLog";
import { Lists } from "./Lists";
import { Campaigns } from "./Campaigns";
import { Settings } from "./Settings";
import { Analytics } from "./Analytics";
import { Inbox } from "./Inbox";
import { useCredits } from "../../../app/lib/credits";
import { CreatorProfilePanel, type Creator } from "./CreatorProfilePanel";

export function Dashboard({ onExit }: { onExit: () => void }) {
  const [view, setView] = useState<DashView>("overview");
  const credits = useCredits();
  const [omniCreator, setOmniCreator] = useState<Creator | null>(null);
  const [liveJobId, setLiveJobId] = useState<string | null>(null);
  // Returning from the hosted checkout: ?checkout=success|failed (query string before the hash route).
  const [checkoutResult, setCheckoutResult] = useState<"success" | "failed" | null>(null);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("checkout");
    if (value !== "success" && value !== "failed") return;
    setCheckoutResult(value);
    setView("billing");
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
  }, []);

  return (
    <div className="flex h-screen bg-slate-50/40">
      <Sidebar view={view} setView={setView} onExit={onExit} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar credits={credits} view={view} setView={setView} onExit={onExit} onOpenCreator={setOmniCreator}
          onViewResults={(id) => {
            setLiveJobId(id);
            setView("search");
          }}
        />
        <main className="flex-1 overflow-y-auto px-6 py-6 sm:px-8 sm:py-8">
          <BillingStatusBanner onChoosePlan={() => setView("billing")} />
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {view === "overview" && <Overview credits={credits} setView={setView} />}
              {view === "search" && <SearchModule liveJobId={liveJobId} />}
              {view === "lists" && <Lists />}
              {view === "campaigns" && <Campaigns />}
              {view === "analytics" && <Analytics />}
              {view === "inbox" && <Inbox />}
              {view === "settings" && <Settings />}
              {view === "billing" && <Billing checkoutResult={checkoutResult} />}
              {view === "support" && <Support />}
              {view === "activity" && <ActivityLog />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CreatorProfilePanel creator={omniCreator} onClose={() => setOmniCreator(null)} />
    </div>
  );
}
