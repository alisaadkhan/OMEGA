import { useState, useEffect } from "react";
import { LegalGate } from "./LegalGate";
import { takeWorkspaceNotice } from "../../api/workspace";
import { rememberCurrentView, takeReturnView } from "../../api/session";
import { AnimatePresence, motion } from "motion/react";
import { Sidebar, type DashView, DASH_VIEWS } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Overview } from "./Overview";
import { SearchModule } from "./SearchModule";
import { Billing } from "./Billing";
import { BillingStatusBanner } from "./BillingStatusBanner";
import { Support } from "./Support";
import { LeaveReview } from "./LeaveReview";
import { ActivityLog } from "./ActivityLog";
import { Lists } from "./Lists";
import { Campaigns } from "./Campaigns";
import { Settings, type SettingsTab } from "./Settings";
import { SupportAccessBanner } from "./SupportAccessSettings";
import { useAuth } from "../../auth/AuthContext";
import { Analytics } from "./Analytics";
import { Inbox } from "./Inbox";
import { useCredits } from "../../../app/lib/credits";
import { CreatorProfilePanel, type Creator } from "./CreatorProfilePanel";

export function Dashboard({ onExit }: { onExit: () => void }) {
  // After a session expired, signing in again reopens the page that was open (AUTH-08).
  const [view, setView] = useState<DashView>(() => takeReturnView(DASH_VIEWS) ?? "overview");
  useEffect(() => rememberCurrentView(view), [view]);
  // Choosing a section in the sidebar always opens its first page, even when it is already the current section
  // (an open list or campaign goes back to the index; design gap G-17).
  const [navKey, setNavKey] = useState(0);
  const navigate = (v: DashView) => {
    setView(v);
    setNavKey((k) => k + 1);
  };
  // Shown once after the API refused a workspace this tab had selected (audit SEC-04).
  const [workspaceNotice] = useState(takeWorkspaceNotice);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  const { user } = useAuth();
  const canManageAccess = user?.role === "owner" || user?.role === "admin";
  const credits = useCredits();
  const [omniCreator, setOmniCreator] = useState<Creator | null>(null);
  const [liveJobId, setLiveJobId] = useState<string | null>(null);
  // Below 768 px the navigation is a drawer opened from the top bar (a fixed 240 px sidebar left phones ~150 px).
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    if (!navOpen) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [navOpen]);
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
      <div className="hidden md:flex">
        <Sidebar view={view} setView={navigate} onExit={onExit} />
      </div>
      {navOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setNavOpen(false)} />
          <div className="relative flex h-full shadow-xl">
            <Sidebar view={view} setView={(v) => { navigate(v); setNavOpen(false); }} onExit={onExit} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar credits={credits} onOpenNav={() => setNavOpen(true)} view={view} setView={setView} onExit={onExit} onOpenCreator={setOmniCreator}
          onViewResults={(id) => {
            setLiveJobId(id);
            setView("search");
          }}
        />
        {/* Focusable so keyboard users can scroll it (axe scrollable-region-focusable). */}
        <main tabIndex={0} className="min-w-0 flex-1 overflow-y-auto px-4 py-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-300 sm:px-8 sm:py-8">
          <div className="-mx-4 -mt-5 mb-4 empty:hidden sm:-mx-8 sm:-mt-8"><SupportAccessBanner canManage={canManageAccess} onOpen={() => { setSettingsTab("access"); setView("settings"); }} /></div>
          {workspaceNotice && <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">{workspaceNotice}</p>}
          <LegalGate />
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
              {view === "search" && <SearchModule liveJobId={liveJobId} onGoToCampaigns={() => setView("campaigns")} />}
              {view === "lists" && <Lists key={navKey} onOpenCreator={setOmniCreator} onGoToSearch={() => setView("search")} />}
              {view === "campaigns" && <Campaigns key={navKey} onOpenCreator={setOmniCreator} onGoToSearch={() => setView("search")} />}
              {view === "analytics" && <Analytics />}
              {view === "inbox" && <Inbox onGoToCampaigns={() => setView("campaigns")} />}
              {view === "settings" && <Settings key={settingsTab} initialTab={settingsTab} onOpenSupport={() => setView("support")} />}
              {view === "billing" && <Billing checkoutResult={checkoutResult} />}
              {view === "support" && <Support />}
              {view === "activity" && <ActivityLog />}
            </motion.div>
          </AnimatePresence>
          <LeaveReview page={view} />
        </main>
      </div>
      <CreatorProfilePanel creator={omniCreator} onClose={() => setOmniCreator(null)} onGoToCampaigns={() => { setOmniCreator(null); setView("campaigns"); }} />
    </div>
  );
}
