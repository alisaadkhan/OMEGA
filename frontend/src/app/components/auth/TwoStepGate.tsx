import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { meResponseSchema } from "@mushin/contracts";
import { apiRequest, TWO_STEP_REQUIRED_EVENT } from "../../api/client";

/**
 * Two-step sign-in (owner, 17 Nov): a person with an authenticator app must enter its 6-digit code before the app opens.
 * The API enforces the same rule (it refuses a session without the second step), so this screen is the way through, not
 * the protection itself.
 */
export function TwoStepGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [state, setState] = useState<"checking" | "needed" | "ok">("checking");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setState(data && data.nextLevel === "aal2" && data.currentLevel !== "aal2" ? "needed" : "ok");
  }, []);

  useEffect(() => {
    void check();
    const onRequired = () => setState("needed");
    window.addEventListener(TWO_STEP_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(TWO_STEP_REQUIRED_EVENT, onRequired);
  }, [check]);

  async function verify() {
    setBusy(true);
    setError(null);
    const factors = await supabase.auth.mfa.listFactors();
    const totp = factors.data?.totp[0];
    if (!totp) {
      setBusy(false);
      setError("No authenticator is set up for this account. Sign out and contact Support.");
      return;
    }
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
    setBusy(false);
    if (err) {
      setError("That code is not right, or it has expired. Enter the newest code from your app.");
      setCode("");
      return;
    }
    setState("ok");
    // The account has an authenticator: make sure the API enforces it too, even if it was set up outside MUSHIN
    // (audit 2026-11-17, finding 3). The API reads the Auth server's own record; a failure here changes nothing.
    await apiRequest("/v1/me/two-step/sync", meResponseSchema, { method: "POST" }).catch(() => undefined);
    void qc.invalidateQueries();
  }

  if (state === "ok") return <>{children}</>;
  if (state === "checking") return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500" role="status">Checking your sign-in…</div>;
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d{6}$/.test(code)) void verify();
        }}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700"><ShieldCheck className="h-5 w-5" aria-hidden /></span>
        <h1 className="mt-4 text-xl font-semibold text-slate-900">Two-step sign-in</h1>
        <p className="mt-1 text-sm text-slate-600">Enter the 6-digit code from your authenticator app.</p>
        <label className="mt-5 block text-[13px] font-semibold text-slate-900">
          Code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            aria-invalid={error !== null}
            className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-center font-mono text-lg tracking-[0.4em] focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/30"
          />
        </label>
        {error && <p role="alert" className="mt-2 text-[12px] text-rose-600">{error}</p>}
        <button type="submit" disabled={busy || code.length !== 6} className="mt-5 w-full rounded-xl bg-[#0A0F24] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50">
          {busy ? "Checking…" : "Continue"}
        </button>
        <button type="button" onClick={() => void supabase.auth.signOut().then(() => { window.location.hash = "/login"; })} className="mt-3 w-full text-center text-[12px] font-semibold text-slate-500 hover:text-slate-800">
          Sign out
        </button>
      </form>
    </div>
  );
}
