import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Navbar } from "./components/landing/Navbar";
import { Hero } from "./components/landing/Hero";
import { FeatureTabs } from "./components/landing/FeatureTabs";
import { Features } from "./components/landing/Features";
import { Metrics } from "./components/landing/Metrics";
import { Pricing } from "./components/landing/Pricing";
import { FAQ } from "./components/landing/FAQ";
import { CTA } from "./components/landing/CTA";
import { Footer } from "./components/landing/Footer";
import { Dashboard } from "./components/dashboard/Dashboard";
import { Login } from "./components/auth/Login";
import { Signup } from "./components/auth/Signup";
import { ForgotPassword } from "./components/auth/ForgotPassword";
import { AdminLogin } from "./components/admin/AdminLogin";
import { AdminApp } from "./components/admin/AdminApp";
import { RemoveMyData } from "./components/public/RemoveMyData";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AdminAuthProvider, useAdminAuth } from "./admin/AdminAuthContext";
import { ToastProvider, ConfirmProvider } from "./lib/toast";

type Route = "landing" | "dashboard" | "login" | "signup" | "forgot" | "admin-login" | "admin" | "remove-my-data";

/**
 * Simple hash-based router. Reads `#/path` from the URL so
 * mushin.io/#/admin/login opens the admin login page independently
 * of the user dashboard.
 */
function useHashRoute(initial: Route): [Route, (r: Route) => void] {
  const parse = (): Route => {
    if (typeof window === "undefined") return initial;
    const h = window.location.hash.replace(/^#\/?/, "");
    if (h.startsWith("admin/login")) return "admin-login";
    if (h.startsWith("admin")) return "admin";
    if (h === "login") return "login";
    if (h === "signup") return "signup";
    if (h === "forgot") return "forgot";
    if (h === "dashboard") return "dashboard";
    if (h === "remove-my-data") return "remove-my-data";
    return initial;
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
        r === "admin-login" ? "admin/login" :
        r === "admin" ? "admin" :
        r;
      window.location.hash = path ? `/${path}` : "";
    }
    setRoute(r);
  };
  return [route, push];
}

function Shell() {
  const { user, status } = useAuth();
  const { admin, signOut: adminSignOut } = useAdminAuth();
  const [route, setRoute] = useHashRoute("landing");

  const goPrimary = () => setRoute(user ? "dashboard" : "signup");

  // Guard admin route — if not signed in as admin, bounce to admin-login
  useEffect(() => {
    if (route === "admin" && !admin) setRoute("admin-login");
  }, [route, admin, setRoute]);

  // Session-problem handling: the dashboard needs a signed-in user.
  useEffect(() => {
    if (route === "dashboard" && status === "signedOut") setRoute("login");
  }, [route, status, setRoute]);

  return (
    <div
      className="min-h-screen bg-white text-slate-900 antialiased"
      style={{
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <AnimatePresence mode="wait">
        {route === "landing" && (
          <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <Navbar onPrimary={goPrimary} onLogin={() => setRoute("login")} />
            <main>
              <Hero onPrimary={goPrimary} />
              <FeatureTabs />
              <Features />
              <Metrics />
              <Pricing onPrimary={goPrimary} />
              <FAQ />
              <CTA onPrimary={goPrimary} />
            </main>
            <Footer />
          </motion.div>
        )}

        {route === "remove-my-data" && (
          <motion.div key="remove-my-data" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <RemoveMyData onExit={() => setRoute("landing")} />
          </motion.div>
        )}

        {route === "dashboard" && (
          <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <Dashboard onExit={() => setRoute("landing")} />
          </motion.div>
        )}

        {route === "login" && (
          <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <Login
              onSuccess={() => setRoute("dashboard")}
              goSignup={() => setRoute("signup")}
              goForgot={() => setRoute("forgot")}
            />
          </motion.div>
        )}

        {route === "signup" && (
          <motion.div key="signup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <Signup onSuccess={() => setRoute("dashboard")} goLogin={() => setRoute("login")} />
          </motion.div>
        )}

        {route === "forgot" && (
          <motion.div key="forgot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <ForgotPassword goLogin={() => setRoute("login")} />
          </motion.div>
        )}

        {route === "admin-login" && (
          <motion.div key="admin-login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <AdminLogin onSuccess={() => setRoute("admin")} onExit={() => setRoute("landing")} />
          </motion.div>
        )}

        {route === "admin" && admin && (
          <motion.div key="admin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <AdminApp
              onSignOut={() => {
                adminSignOut();
                setRoute("admin-login");
              }}
              onExit={() => setRoute("landing")}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AdminAuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <Shell />
          </ConfirmProvider>
        </ToastProvider>
      </AdminAuthProvider>
    </AuthProvider>
  );
}
