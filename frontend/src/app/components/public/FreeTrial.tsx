import { useState } from "react";
import { Phone } from "lucide-react";
import { TRIAL_CONSENT_TEXT, trialReceivedSchema } from "@mushin/contracts";
import { readApiResponse } from "../../api/http";
import { LogoMark } from "../landing/Logo";

/**
 * The owner's business number, set at build time (VITE_TRIAL_PHONE, international format such as +923001234567).
 * Without a valid number the page offers only the callback form: a placeholder is never shown as a real number.
 */
export function trialPhone(raw: string | undefined = import.meta.env.VITE_TRIAL_PHONE as string | undefined): { href: string; label: string } | null {
  const digits = raw?.replace(/[\s()-]/g, "") ?? "";
  if (!/^\+[1-9]\d{7,14}$/.test(digits)) return null;
  return { href: `tel:${digits}`, label: raw?.trim() ?? digits };
}

const WINDOWS = [
  ["morning", "Morning (9am–12pm)"],
  ["afternoon", "Afternoon (12pm–5pm)"],
  ["evening", "Evening (5pm–8pm)"],
  ["anytime", "Any time"],
] as const;

/** Mandate v4 Phase 3: "Call us for a free 14-day trial", or ask for a call back. No sign-in. */
export function FreeTrial({ onExit, onSignup }: { onExit: () => void; onSignup: () => void }) {
  const phone = trialPhone();
  const [f, setF] = useState({ contactName: "", businessName: "", email: "", phone: "", callbackWindow: "anytime", useCase: "" });
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // bot trap, hidden from people
  const [state, setState] = useState<"form" | "sending" | "done">("form");
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState("sending");
    try {
      const res = await fetch("/api/v1/public/trial-requests", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          contactName: f.contactName.trim(),
          businessName: f.businessName.trim(),
          email: f.email.trim() || undefined,
          phone: f.phone.trim() || undefined,
          callbackWindow: f.callbackWindow,
          useCase: f.useCase.trim() || undefined,
          consent,
          website,
        }),
      });
      await readApiResponse(res, trialReceivedSchema);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setState("form");
    }
  }

  const input = "mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm";
  const label = "text-xs text-slate-700";
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200/80 bg-white p-6">
        <button onClick={onExit} className="mb-4 flex items-center gap-2 text-xs text-slate-500 hover:text-slate-800"><LogoMark size={20} /> Back to mushin.io</button>
        <h1 className="text-slate-900" style={{ fontSize: 20, fontWeight: 600 }}>Call us for a free 14-day trial</h1>
        <p className="mt-2 text-sm text-slate-600">
          A short call helps us set MUSHIN up for your brand. After the call our team activates your 14-day trial with 2,500 credits. No card is needed and
          nothing is charged when the trial ends.
        </p>
        {phone && (
          <a href={phone.href} className="mt-4 flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2.5 text-sm text-white hover:bg-slate-800" style={{ fontWeight: 600 }}>
            <Phone className="h-4 w-4" /> Call {phone.label}
          </a>
        )}
        {state === "done" ? (
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
            <p style={{ fontWeight: 600 }}>Thanks, we've received your request.</p>
            <p className="mt-1">We'll call or email you in the window you chose. To save time, create your MUSHIN account now with the same email; your trial is activated on it after the call.</p>
            <button onClick={onSignup} className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 600 }}>Create your account</button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-3 text-sm" aria-label="Request a call back">
            <h2 className="text-slate-900" style={{ fontSize: 15, fontWeight: 600 }}>{phone ? "Can't call now? We'll call you back" : "Request a call back"}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} style={{ fontWeight: 600 }} htmlFor="ft-name">Your name</label>
                <input id="ft-name" required maxLength={120} value={f.contactName} onChange={set("contactName")} autoComplete="name" className={input} />
              </div>
              <div>
                <label className={label} style={{ fontWeight: 600 }} htmlFor="ft-business">Business name</label>
                <input id="ft-business" required maxLength={160} value={f.businessName} onChange={set("businessName")} autoComplete="organization" className={input} />
              </div>
              <div>
                <label className={label} style={{ fontWeight: 600 }} htmlFor="ft-email">Business email</label>
                <input id="ft-email" type="email" maxLength={254} value={f.email} onChange={set("email")} autoComplete="email" className={input} />
              </div>
              <div>
                <label className={label} style={{ fontWeight: 600 }} htmlFor="ft-phone">Phone</label>
                <input id="ft-phone" type="tel" maxLength={24} value={f.phone} onChange={set("phone")} autoComplete="tel" placeholder="+92 …" className={input} />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">Give an email, a phone number, or both.</p>
            <div>
              <label className={label} style={{ fontWeight: 600 }} htmlFor="ft-window">Best time to call (Pakistan time)</label>
              <select id="ft-window" value={f.callbackWindow} onChange={set("callbackWindow")} className={input}>
                {WINDOWS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={label} style={{ fontWeight: 600 }} htmlFor="ft-use">What would you use MUSHIN for? (optional)</label>
              <textarea id="ft-use" maxLength={1000} rows={3} value={f.useCase} onChange={set("useCase")} className={input} />
            </div>
            <input tabIndex={-1} autoComplete="off" aria-hidden value={website} onChange={(e) => setWebsite(e.target.value)} className="absolute left-[-9999px] h-0 w-0 opacity-0" name="website" />
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
              {TRIAL_CONSENT_TEXT}
            </label>
            {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
            <button type="submit" disabled={state === "sending" || !consent || !f.contactName.trim() || !f.businessName.trim() || !(f.email.trim() || f.phone.trim())} className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50" style={{ fontWeight: 500 }}>
              {state === "sending" ? "Sending…" : "Request a call back"}
            </button>
            <p className="text-[11px] text-slate-500">See our <a href="#/privacy" className="underline">Privacy notice</a>.</p>
          </form>
        )}
      </div>
    </div>
  );
}
