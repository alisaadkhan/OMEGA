import { lazy, Suspense, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LandingHero, LandingNav } from "./components/landing/LandingTop";
import { LandingFeatures } from "./components/landing/LandingFeatures";
import { LandingPricing } from "./components/landing/LandingBottom";
import { Login } from "./components/auth/Login";
import { Signup } from "./components/auth/Signup";
import { ForgotPassword } from "./components/auth/ForgotPassword";
import { ResetPassword } from "./components/auth/ResetPassword";
import { EmailConfirmed } from "./components/auth/EmailConfirmed";
import { AppErrorBoundary, NotFound, ServiceStatusBanner } from "./components/public/StatusScreens";
import { FreeTrial } from "./components/public/FreeTrial";
import { RemoveMyData } from "./components/public/RemoveMyData";
import { LegalPage, type LegalDoc } from "./components/public/LegalPage";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AdminAuthProvider } from "./admin/AdminAuthContext";
import { isStaffPath } from "./components/staff/path";
import { ToastProvider, ConfirmProvider } from "./lib/toast";

import { TwoStepGate } from "./components/auth/TwoStepGate";

// Loaded on demand (audit UX-04): visitors to the landing page do not download the dashboard or the staff console.
const Dashboard = lazy(() => import("./components/dashboard/Dashboard").then((m) => ({ default: m.Dashboard })));
const StaffPortal = lazy(() => import("./components/staff/StaffPortal").then((m) => ({ default: m.StaffPortal })));
const Loading = () => <div className="flex min-h-screen items-center justify-center text-sm text-slate-500" role="status">Loading…</div>;

type Route = "landing" | "dashboard" | "login" | "signup" | "forgot" | "reset-password" | "confirmed" | "not-found" | "remove-my-data" | "free-trial" | LegalDoc;
const LEGAL_DOCS: readonly LegalDoc[] = ["terms", "privacy", "refunds", "creator-data"];

/**
 * Simple hash-based router. Reads `#/path` from the URL so
 * mushin.io/#/login opens the customer sign-in page independently
 * of the user dashboard.
 */
function useHashRoute(initial: Route): [Route, (r: Route) => void] {
  const parse = (): Route => {
    if (typeof window === "undefined") return initial;
    const h = window.location.hash.replace(/^#\/?/, "");
    // Staff sign in only at /_omega_ (owner, 22 Nov); the old #/admin and #/staff links are unknown routes now.
    if (h === "login") return "login";
    if (h === "signup") return "signup";
    if (h === "forgot") return "forgot";
    if (h === "reset-password") return "reset-password";
    if (h === "confirmed") return "confirmed";
    if (h === "dashboard") return "dashboard";
    if (h === "remove-my-data") return "remove-my-data";
    if (h === "free-trial") return "free-trial";
    if ((LEGAL_DOCS as readonly string[]).includes(h)) return h as LegalDoc;
    // The home page, and Supabase's own link fragments (handled by lib/supabase.ts), are not unknown routes.
    if (h === "" || /^(access_token|error|error_code|error_description|type)=/.test(h)) return initial;
    return "not-found";
  };
  const [route, setRoute] = useState<Route>(initial);
  useEffect(() => {
    setRoute(parse());
    const onHash = () => setRoute(parse());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const push = (r: Route) => {
    if (typeof window !== "undefined") {
      const path =
        r === "landing" ? "" :
        r;
      window.location.hash = path ? `/${path}` : "";
    }
    setRoute(r);
  };
  return [route, push];
}

function Shell() {
  const { user, status } = useAuth();
  const [route, setRoute] = useHashRoute("landing");

  const goPrimary = () => setRoute(user ? "dashboard" : "signup");
  const afterAuth = () => setRoute("dashboard");


  // Session-problem handling: the dashboard needs a signed-in user.
  useEffect(() => {
    if (route === "dashboard" && status === "signedOut") setRoute("login");
  }, [route, status, setRoute]);

  return (
    <div
      className="min-h-screen bg-white text-slate-900 antialiased"
      style={{
        fontFamily:
          "'Geist Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <ServiceStatusBanner />
      <AnimatePresence mode="wait">
        {route === "not-found" && (
          <motion.div key="not-found" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <NotFound onHome={() => setRoute("landing")} onSignIn={() => setRoute("login")} />
          </motion.div>
        )}

        {route === "confirmed" && (
          <motion.div key="confirmed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <EmailConfirmed goDashboard={afterAuth} goLogin={() => setRoute("login")} />
          </motion.div>
        )}

        {route === "landing" && (
          <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <div className="bg-navy font-display">
              <LandingNav signedIn={!!user} onPrimary={goPrimary} onLogin={() => setRoute("login")} />
              <main>
                <LandingHero onPrimary={goPrimary} />
                <LandingFeatures />
                <LandingPricing onPrimary={goPrimary} onTrial={() => setRoute("free-trial")} />
              </main>
            </div>
          </motion.div>
        )}

        {(LEGAL_DOCS as readonly string[]).includes(route) && (
          <motion.div key={route} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <LegalPage doc={route as LegalDoc} onBack={() => setRoute(user ? "dashboard" : "landing")} />
          </motion.div>
        )}

        {route === "free-trial" && (
          <motion.div key="free-trial" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <FreeTrial onExit={() => setRoute("landing")} onSignup={() => setRoute("signup")} />
          </motion.div>
        )}

        {route === "remove-my-data" && (
          <motion.div key="remove-my-data" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <RemoveMyData onExit={() => setRoute("landing")} />
          </motion.div>
        )}

        {route === "dashboard" && (
          <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <Suspense fallback={<Loading />}>
              <TwoStepGate><Dashboard onExit={() => setRoute("landing")} /></TwoStepGate>
            </Suspense>
          </motion.div>
        )}

        {route === "login" && (
          <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <Login
              onSuccess={afterAuth}
              goSignup={() => setRoute("signup")}
              goForgot={() => setRoute("forgot")}
            />
          </motion.div>
        )}

        {route === "signup" && (
          <motion.div key="signup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <Signup onSuccess={afterAuth} goLogin={() => setRoute("login")} goForgot={() => setRoute("forgot")} />
          </motion.div>
        )}

        {route === "forgot" && (
          <motion.div key="forgot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <ForgotPassword goLogin={() => setRoute("login")} />
          </motion.div>
        )}

        {route === "reset-password" && (
          <motion.div key="reset-password" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <ResetPassword onDone={() => setRoute("dashboard")} goForgot={() => setRoute("forgot")} />
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}

export default function App() {
  // The staff portal is its own app at /_omega_: no customer session, no customer pages.
  if (typeof window !== "undefined" && isStaffPath(window.location.pathname)) {
    return (
      <AdminAuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AppErrorBoundary>
              <Suspense fallback={<div className="min-h-screen bg-[#0A0F24]" role="status" aria-label="Loading" />}>
                <StaffPortal />
              </Suspense>
            </AppErrorBoundary>
          </ConfirmProvider>
        </ToastProvider>
      </AdminAuthProvider>
    );
  }
  return (
    <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AppErrorBoundary>
              <Shell />
            </AppErrorBoundary>
          </ConfirmProvider>
        </ToastProvider>
    </AuthProvider>
  );
}
