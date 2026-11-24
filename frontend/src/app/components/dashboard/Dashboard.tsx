import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { meResponseSchema } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { LegalGate } from "./LegalGate";
import { takeWorkspaceNotice } from "../../api/workspace";
import { rememberCurrentView, takeReturnView } from "../../api/session";
import { AnimatePresence, motion } from "motion/react";
import { Sidebar, type DashView, DASH_VIEWS } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Home } from "./Home";
import { WelcomeModal, Tour, hasOnboarded, markOnboarded } from "./Onboarding";
import { SearchModule } from "./SearchModule";
import { Billing } from "./Billing";
import { BillingStatusBanner } from "./BillingStatusBanner";
import { Support } from "./Support";
import { LeaveReview } from "./LeaveReview";
import { Lists } from "./Lists";
import { Campaigns } from "./Campaigns";
import { Settings, type SettingsTab } from "./Settings";
import { SupportAccessBanner } from "./SupportAccessSettings";
import { useAuth } from "../../auth/AuthContext";
import { useCredits } from "../../../app/lib/credits";
import { useLists } from "../../api/lists";
import { useCampaigns } from "../../api/campaigns";
import { CreatorProfilePanel, type Creator } from "./CreatorProfilePanel";
import { REACH_OUT_EVENT, type ReachOut } from "../../lib/reach-out";

/** The page named in a "#/dashboard/<page>" link (notification emails and the bell). */
export function viewFromHash(hash = typeof window === "undefined" ? "" : window.location.hash): DashView | null {
  const m = /^#\/dashboard\/([a-z]+)/.exec(hash);
  return m && (DASH_VIEWS as readonly string[]).includes(m[1] as string) ? (m[1] as DashView) : null;
}

export function Dashboard({ onExit }: { onExit: () => void }) {
  // After a session expired, signing in again reopens the page that was open (AUTH-08).
  const [view, setView] = useState<DashView>(() => takeReturnView(DASH_VIEWS) ?? viewFromHash() ?? "overview");
  useEffect(() => {
    rememberCurrentView(view);
  }, [view]);
  // Choosing a section in the sidebar always opens its first page, even when it is already the current section
  // (an open list or campaign goes back to the index; design gap G-17).
  const [navKey, setNavKey] = useState(0);
  const navigate = (v: DashView) => {
    setOpenCampaignId(null);
    setMailFor(null);
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
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(null);
  const [mailFor, setMailFor] = useState<string | null>(null);
  // Reach out on any creator profile opens that campaign's Outreach page with the creator selected (owner, 22 Nov).
  useEffect(() => {
    const on = (e: Event) => {
      const { campaignId, creatorId } = (e as CustomEvent<ReachOut>).detail;
      setOmniCreator(null);
      setOpenCampaignId(campaignId);
      setMailFor(creatorId);
      setView("campaigns");
    };
    window.addEventListener(REACH_OUT_EVENT, on);
    return () => window.removeEventListener(REACH_OUT_EVENT, on);
  }, []);
  // First-run onboarding (owner design 2026-11-16): the welcome dialog once per user, then the optional tour.
  const [welcome, setWelcome] = useState(false);
  const [tour, setTour] = useState(false);
  // Waits for the Terms acceptance dialog (LegalGate) so the two never overlap.
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiRequest("/v1/me", meResponseSchema), enabled: !!user });
  const legalPending = !me.data || me.data.legal.acceptedVersion !== me.data.legal.currentVersion;
  // Only while the workspace is still empty: an existing customer on a new device or browser is not "new" (the
  // "seen" mark lives in this browser only).
  const lists = useLists();
  const campaigns = useCampaigns();
  const emptyWorkspace = lists.data !== undefined && campaigns.data !== undefined && lists.data.lists.length === 0 && campaigns.data.campaigns.length === 0;
  useEffect(() => {
    if (user && !legalPending && emptyWorkspace && !hasOnboarded(user.id)) setWelcome(true);
  }, [user, legalPending, emptyWorkspace]);
  const closeWelcome = (startTour: boolean) => {
    if (user) markOnboarded(user.id);
    setWelcome(false);
    if (startTour) {
      navigate("overview");
      setTimeout(() => setTour(true), 300);
    }
  };
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
    <div className="flex h-screen bg-surface">
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
        <Topbar credits={credits} onOpenNav={() => setNavOpen(true)} view={view} setView={setView} onOpenCreator={setOmniCreator}
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
              {view === "overview" && <Home setView={navigate} onOpenCreator={setOmniCreator} onTour={() => setTour(true)} onOpenCampaign={(id) => { setOpenCampaignId(id); setView("campaigns"); }} />}
              {view === "search" && <SearchModule liveJobId={liveJobId} onGoToCampaigns={() => setView("campaigns")} />}
              {view === "lists" && <Lists key={navKey} onOpenCreator={setOmniCreator} onGoToSearch={() => setView("search")} />}
              {view === "campaigns" && <Campaigns key={navKey} initialId={openCampaignId} initialMailFor={mailFor} onOpenCreator={setOmniCreator} onGoToSearch={() => setView("search")} />}
              {view === "settings" && <Settings key={settingsTab} initialTab={settingsTab} onOpenSupport={() => setView("support")} onOpenBilling={() => setView("billing")} />}
              {view === "billing" && <Billing checkoutResult={checkoutResult} />}
              {view === "support" && <Support />}
            </motion.div>
          </AnimatePresence>
          <LeaveReview page={view} />
        </main>
      </div>
      <WelcomeModal open={welcome} onStart={() => closeWelcome(true)} onSkip={() => closeWelcome(false)} />
      <Tour open={tour} onClose={() => setTour(false)} />
      <CreatorProfilePanel creator={omniCreator} onClose={() => setOmniCreator(null)} onGoToCampaigns={() => { setOmniCreator(null); setView("campaigns"); }} />
    </div>
  );
}
