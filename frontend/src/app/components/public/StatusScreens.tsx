import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Compass, WifiOff } from "lucide-react";

/**
 * Global status screens (mandate v3 §8.4; gap UX-06/UX-07): a page for unknown routes, a safety net for render errors,
 * and banners for a partly unavailable service or a lost connection. Every message says only what is known; nothing here
 * claims monitoring, paging or a status page that does not exist.
 */

function Screen({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center sm:p-8">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700" aria-hidden="true">{icon}</div>
        <h1 className="text-slate-900" style={{ fontSize: 20, fontWeight: 700 }}>{title}</h1>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
        {children && <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>}
      </div>
    </main>
  );
}

const buttonClass = "inline-flex min-h-[44px] items-center rounded-md px-4 text-sm";

/** Unknown `#/…` route. */
export function NotFound({ onHome, onSignIn }: { onHome: () => void; onSignIn: () => void }) {
  return (
    <Screen icon={<Compass className="h-5 w-5" />} title="Page not found" body="This address does not match a page in MUSHIN. The link may be mistyped or out of date.">
      <button onClick={onHome} className={`${buttonClass} bg-slate-900 text-white`} style={{ fontWeight: 600 }}>Go to the home page</button>
      <button onClick={onSignIn} className={`${buttonClass} border border-slate-200 text-slate-700 hover:bg-slate-50`}>Sign in</button>
    </Screen>
  );
}

/**
 * Last line of defence for an error while drawing a page: the rest of the app keeps working after a reload. API errors
 * are shown where they happen (with their request id); this only catches bugs in the page itself.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept in the browser console for support; no personal data is sent anywhere.
    console.error("MUSHIN page error", error.message, info.componentStack?.split("\n").slice(0, 4).join("\n"));
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Screen icon={<AlertTriangle className="h-5 w-5" />} title="This page could not be shown" body="Something went wrong while drawing this page. Nothing you saved was lost. Reload to try again; if it happens again, contact support and say which page you were on.">
        <button onClick={() => window.location.reload()} className={`${buttonClass} bg-slate-900 text-white`} style={{ fontWeight: 600 }}>Reload</button>
        <button onClick={() => { window.location.hash = ""; window.location.reload(); }} className={`${buttonClass} border border-slate-200 text-slate-700 hover:bg-slate-50`}>Go to the home page</button>
      </Screen>
    );
  }
}

/**
 * Banner while the API reports itself partly unavailable (`/health/ready` answers 503 "degraded"), or cannot be reached
 * at all. Checked once a minute; it disappears as soon as the service is ready again.
 */
export function ServiceStatusBanner() {
  const [state, setState] = useState<"ok" | "degraded" | "unreachable">("ok");
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (!navigator.onLine) return;
      try {
        const res = await fetch("/api/health/ready", { cache: "no-store" });
        if (!stopped) setState(res.ok ? "ok" : "degraded");
      } catch {
        if (!stopped) setState("unreachable");
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 60_000);
    const goOnline = () => {
      setOnline(true);
      void check();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  if (!online) {
    return (
      <div role="status" className="flex items-center justify-center gap-2 bg-slate-900 px-4 py-2 text-xs text-white">
        <WifiOff className="h-3.5 w-3.5" aria-hidden="true" /> You are offline. Changes you make now are not saved; MUSHIN reconnects by itself.
      </div>
    );
  }
  if (state === "ok") return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-xs text-amber-900">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      {state === "degraded"
        ? "MUSHIN is partly unavailable right now: some actions may fail. Nothing is charged for an action that fails."
        : "MUSHIN's server cannot be reached right now. Try again in a few minutes."}
    </div>
  );
}
