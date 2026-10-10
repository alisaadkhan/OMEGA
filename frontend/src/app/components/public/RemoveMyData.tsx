import { useState } from "react";
import { removalReceivedSchema } from "@mushin/contracts";
import { readApiResponse } from "../../api/http";
import { LogoMark } from "../landing/Logo";

/** SRS §6.3, Diagrams 1/2/10: a creator asks MUSHIN to remove their data. No sign-in. */
export function RemoveMyData({ onExit }: { onExit: () => void }) {
  const [urls, setUrls] = useState(["", "", ""]);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [website, setWebsite] = useState(""); // bot trap, hidden from people
  const [state, setState] = useState<"form" | "sending" | "done">("form");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState("sending");
    try {
      const res = await fetch("/api/v1/public/removal-requests", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ urls: urls.map((u) => u.trim()).filter(Boolean), email: email.trim(), reason: reason.trim() || undefined, confirm, website }),
      });
      await readApiResponse(res, removalReceivedSchema);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setState("form");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <button onClick={onExit} className="mb-4 flex items-center gap-2 text-xs text-slate-500 hover:text-slate-800"><LogoMark size={20} /> Back to mushin.io</button>
        <h1 className="text-slate-900" style={{ fontSize: 20, fontWeight: 600 }}>Remove my data from MUSHIN</h1>
        {state === "done" ? (
          <p className="mt-3 text-sm text-slate-600">We've received your request. Your profile is hidden from MUSHIN customers while our team reviews it, and we'll confirm by email when your data has been removed.</p>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-4 text-sm">
            <p className="text-slate-600">MUSHIN shows public information from creators' Instagram, TikTok and YouTube profiles to brands. If you're a creator and want your information removed, tell us which profiles are yours.</p>
            <div className="space-y-2">
              <label className="text-xs text-slate-700" style={{ fontWeight: 600 }}>Your profile links (up to 3)</label>
              {urls.map((u, i) => (
                <input key={i} value={u} onChange={(e) => setUrls((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))} placeholder={i === 0 ? "https://instagram.com/yourname" : "Another profile (optional)"} aria-label={`Profile link ${i + 1}`} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              ))}
            </div>
            <div>
              <label className="text-xs text-slate-700" style={{ fontWeight: 600 }} htmlFor="rm-email">Your email</label>
              <input id="rm-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              <p className="mt-1 text-[11px] text-slate-500">Used only to confirm the removal.</p>
            </div>
            <div>
              <label className="text-xs text-slate-700" style={{ fontWeight: 600 }} htmlFor="rm-reason">Reason (optional)</label>
              <textarea id="rm-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <input tabIndex={-1} autoComplete="off" aria-hidden value={website} onChange={(e) => setWebsite(e.target.value)} className="absolute left-[-9999px] h-0 w-0 opacity-0" name="website" />
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
              I am this creator, or I am authorised to act for them.
            </label>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button type="submit" disabled={state === "sending" || !confirm || !urls[0]?.trim() || !email.trim()} className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50" style={{ fontWeight: 500 }}>
              {state === "sending" ? "Sending…" : "Send removal request"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
