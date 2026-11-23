import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Smartphone } from "lucide-react";
import { staffTwoFactorSetupSchema, staffTwoFactorStatusSchema } from "@mushin/contracts";
import { adminRequest } from "../../admin/adminApi";
import { useToast } from "../../lib/toast";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { Badge, Card, errText } from "./kit";

const codeInput =
  "w-40 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 font-mono text-sm font-semibold tracking-widest tabular-nums text-slate-900 placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-400 focus:border-[#06B6D4] focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20";

/**
 * Two-factor sign-in (owner, 22 Nov): each staff member turns the authenticator code on or off and sets it up here.
 * Setting up shows a QR code for Google Authenticator, Microsoft Authenticator or 1Password; it is turned on only once a
 * code from the app is entered. Turning it off needs a current code.
 */
export function TwoFactorCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: ["admin", "two-factor"], queryFn: () => adminRequest("/admin/v1/security/two-factor", staffTwoFactorStatusSchema) });
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!setup) return setQr(null);
    let live = true;
    void QRCode.toDataURL(setup.uri, { margin: 1, width: 192 }).then((d) => live && setQr(d)).catch(() => live && setQr(null));
    return () => { live = false; };
  }, [setup]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setCode("");
      setCurrent("");
      setSetup(null);
      void qc.invalidateQueries({ queryKey: ["admin", "two-factor"] });
    } catch (err) {
      toast.error("Not changed", errText(err));
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    setBusy(true);
    try {
      setSetup(await adminRequest("/admin/v1/security/two-factor/setup", staffTwoFactorSetupSchema, { method: "POST", body: {} }));
      setCode("");
    } catch (err) {
      toast.error("Couldn't start the setup", errText(err));
    } finally {
      setBusy(false);
    }
  };
  const enable = (e: FormEvent) => { e.preventDefault(); void run(() => adminRequest("/admin/v1/security/two-factor/enable", staffTwoFactorStatusSchema, { method: "POST", body: { code, ...(on ? { currentCode: current } : {}) } }), on ? "New authenticator is on; your other sessions were signed out" : "Two-factor sign-in is on; your other sessions were signed out"); };
  const disable = (e: FormEvent) => { e.preventDefault(); void run(() => adminRequest("/admin/v1/security/two-factor/disable", staffTwoFactorStatusSchema, { method: "POST", body: { code } }), "Two-factor sign-in is off; your other sessions were signed out"); };
  const on = status.data?.enabled ?? false;

  return (
    <Card label="Two-factor sign-in">
      <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-cyan-100 bg-cyan-50 text-cyan-600"><Smartphone className="h-5 w-5" /></div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Two-factor sign-in</h2>
            <p className="mt-0.5 text-xs text-slate-500">When on, signing in also needs the 6-digit code from your authenticator app.</p>
          </div>
        </div>
        {status.data && <Badge tone={on ? "emerald" : "amber"} dot>{on ? "On" : "Off"}</Badge>}
      </div>
      {status.isPending ? <LoadingBlock lines={2} /> : status.isError ? <ErrorState body={errText(status.error)} onRetry={() => void status.refetch()} /> : (
        <div className="mt-5 space-y-4 text-[12.5px]">
          {setup ? (
            <form onSubmit={enable} className="flex flex-col gap-5 sm:flex-row">
              <div className="flex h-[200px] w-[200px] shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white p-1">
                {qr ? <img src={qr} alt="QR code for your authenticator app" width={192} height={192} /> : <span className="text-xs text-slate-500">Preparing QR code…</span>}
              </div>
              <div className="space-y-3">
                <ol className="list-decimal space-y-1 pl-4 text-slate-700">
                  <li>Open Google Authenticator, Microsoft Authenticator or 1Password and add an account.</li>
                  <li>Scan this QR code. If you cannot scan it, enter this key: <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11.5px] text-slate-900">{setup.secret}</code></li>
                  <li>Type the 6-digit code the app shows, to turn two-factor on.</li>
                </ol>
                <div className="flex flex-wrap items-center gap-2">
                  <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" aria-label="Code from your authenticator app" className={codeInput} autoFocus />
                  {on && <input value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="Code from old phone" aria-label="Current code from your existing authenticator" className={codeInput} />}
                  <button type="submit" disabled={busy || code.length !== 6 || (on && current.length !== 6)} className="btn btn-primary">{busy ? "Checking…" : "Turn on"}</button>
                  <button type="button" onClick={() => setSetup(null)} className="btn btn-outline">Cancel</button>
                </div>
                {on && <p className="text-xs text-slate-500">Also enter a code from your current authenticator. It keeps working until the new one is turned on.</p>}
              </div>
            </form>
          ) : on ? (
            <>
              <form onSubmit={disable} className="flex flex-wrap items-center gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="Current code" aria-label="Current code to turn two-factor off" className={codeInput} />
                <button type="submit" disabled={busy || code.length !== 6} className="btn btn-danger-outline">Turn off</button>
                <button type="button" onClick={() => void start()} disabled={busy} className="btn btn-outline">Move to a new phone</button>
              </form>
              <p className="text-xs text-slate-500">Turning it off needs a current code from your app.</p>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-slate-600">Two-factor is off: your password alone signs you in. Turning it on is recommended for staff accounts.</p>
              <button type="button" onClick={() => void start()} disabled={busy} className="btn btn-dark">{busy ? "Preparing…" : "Set up two-factor"}</button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
