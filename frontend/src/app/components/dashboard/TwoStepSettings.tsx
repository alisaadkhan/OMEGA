import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import { meResponseSchema } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { supabase } from "../../lib/supabase";
import { useConfirm, useToast } from "../../lib/toast";

const btn =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:opacity-50";

type Enrolment = { factorId: string; qr: string; secret: string };

/**
 * Two-step sign-in with an authenticator app (owner, 17 Nov). The authenticator lives in the sign-in service; after any
 * change the API copies the on/off state from the service's own record (POST /v1/me/two-step/sync) and from then on
 * refuses sessions that skipped the code.
 */
export function TwoStepSettings({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [enrol, setEnrol] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    const me = await apiRequest("/v1/me/two-step/sync", meResponseSchema, { method: "POST" });
    qc.setQueryData(["me"], me);
    return me.user.twoStepEnabled;
  }

  async function start() {
    setBusy(true);
    setError(null);
    // An earlier set-up that was never finished would block a new one: remove unverified authenticators first.
    const listed = await supabase.auth.mfa.listFactors();
    for (const f of listed.data?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (err || !data) {
      toast.error("Couldn't start two-step sign-in", err?.message);
      return;
    }
    setEnrol({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function finish() {
    if (!enrol) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrol.factorId, code });
    if (err) {
      setBusy(false);
      setError("That code is not right, or it has expired. Enter the newest code from your app.");
      return;
    }
    try {
      const on = await sync();
      setEnrol(null);
      setCode("");
      if (on) toast.success("Two-step sign-in is on", "You'll enter a code from your app each time you sign in.");
      else toast.error("Two-step sign-in was not saved", "Please try again.");
    } catch (e) {
      toast.error("Your authenticator is set up, but MUSHIN couldn't record it", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (enrol) await supabase.auth.mfa.unenroll({ factorId: enrol.factorId });
    setEnrol(null);
    setCode("");
    setError(null);
  }

  async function turnOff() {
    if (!(await confirm({ title: "Turn off two-step sign-in?", body: "Your account will be protected by your password alone.", confirmLabel: "Turn off", destructive: true }))) return;
    setBusy(true);
    const listed = await supabase.auth.mfa.listFactors();
    for (const f of listed.data?.totp ?? []) {
      const { error: err } = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (err) {
        setBusy(false);
        toast.error("Couldn't turn off two-step sign-in", err.message);
        return;
      }
    }
    try {
      await sync();
      toast.success("Two-step sign-in is off");
    } catch (e) {
      toast.error("Couldn't update your account", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5 rounded-xl bg-slate-50 p-5">
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm">
          <Smartphone className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-slate-900">Two-step sign-in</span>
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>{enabled ? "On" : "Off"}</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {enabled ? "Each sign-in asks for a code from your authenticator app." : "Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and similar) each time you sign in."}
          </p>
          {!enrol && (
            <button type="button" disabled={busy} onClick={() => void (enabled ? turnOff() : start())} className={`${btn} mt-3 ${enabled ? "bg-white text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50" : "bg-[#0A0F24] text-white hover:bg-slate-800"}`}>
              {busy ? "Please wait…" : enabled ? "Turn off" : "Turn on"}
            </button>
          )}
        </div>
      </div>
      {enrol && (
        <form
          className="mt-4 flex flex-col gap-4 rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{6}$/.test(code)) void finish();
          }}
        >
          <img src={enrol.qr} alt="QR code to scan with your authenticator app" className="h-40 w-40 shrink-0 self-center rounded-lg bg-white" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 text-xs text-slate-600">
            <p><span className="font-semibold text-slate-900">1.</span> Scan the code with your authenticator app, or enter this key: <span className="break-all font-mono text-slate-900">{enrol.secret}</span></p>
            <label className="flex flex-col gap-1">
              <span><span className="font-semibold text-slate-900">2.</span> Enter the 6-digit code it shows</span>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" aria-label="6-digit code" aria-invalid={error !== null}
                className="w-40 rounded-xl border border-slate-200 px-3 py-2 text-center font-mono text-base tracking-[0.3em] focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/30" />
            </label>
            {error && <p role="alert" className="text-rose-600">{error}</p>}
            <div className="mt-1 flex gap-2">
              <button type="submit" disabled={busy || code.length !== 6} className={`${btn} bg-[#0A0F24] text-white hover:bg-slate-800`}>{busy ? "Checking…" : "Turn on"}</button>
              <button type="button" disabled={busy} onClick={() => void cancel()} className={`${btn} bg-slate-100 text-slate-800 hover:bg-slate-200`}>Cancel</button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
