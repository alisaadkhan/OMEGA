import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { meResponseSchema } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { takeRememberedAcceptance } from "../../api/legal";
import { useAuth } from "../../auth/AuthContext";
import { motion } from "motion/react";
import { Alert } from "../../ui/kit";

/**
 * Audit UX-01: nobody uses MUSHIN without having accepted the current Terms and Privacy Policy, and the server records
 * which version and when. A choice made on the sign-up form is recorded automatically; otherwise this asks.
 */
export function LegalGate() {
  const { status } = useAuth();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiRequest("/v1/me", meResponseSchema), enabled: status === "signedIn" });
  const [agreed, setAgreed] = useState(false);
  const autoTried = useRef(false);
  const accept = useMutation({
    mutationFn: (version: string) => apiRequest("/v1/me/legal-acceptance", meResponseSchema, { method: "POST", body: { version } }),
    onSuccess: (data) => qc.setQueryData(["me"], data),
  });
  const legal = me.data?.legal;
  const needed = !!legal && legal.acceptedVersion !== legal.currentVersion;

  useEffect(() => {
    if (needed && legal && !autoTried.current && takeRememberedAcceptance()) {
      autoTried.current = true;
      accept.mutate(legal.currentVersion);
    }
  }, [needed, legal, accept]);

  // The automatic acceptance (ticked at sign-up) runs without a dialog; a manual one keeps the dialog until the server
  // has recorded it, so nobody reaches the app before the acceptance is stored.
  if (!needed || !legal || (accept.isPending && autoTried.current)) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-navy/60 px-4">
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} role="dialog" aria-modal="true" aria-labelledby="legal-gate-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id="legal-gate-title" className="text-slate-900" style={{ fontSize: 18, fontWeight: 700 }}>Before you continue</h2>
        <p className="mt-2 text-sm text-slate-600">Please read and accept MUSHIN's Terms of Service and Privacy Policy (version {legal.currentVersion}, drafts pending legal review).</p>
        <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
          <span>
            I accept the <a href="#/terms" target="_blank" rel="noreferrer" className="text-teal underline">Terms of Service</a> and the{" "}
            <a href="#/privacy" target="_blank" rel="noreferrer" className="text-teal underline">Privacy Policy</a>.
          </span>
        </label>
        <div className="mt-3"><Alert tone="error">{accept.isError ? (accept.error instanceof Error ? accept.error.message : "Could not record your acceptance.") : null}</Alert></div>
        <button disabled={!agreed || accept.isPending} onClick={() => accept.mutate(legal.currentVersion)} className="mt-4 w-full rounded-xl bg-ink px-3 py-2.5 text-sm text-white transition-all hover:bg-[#1d2742] active:scale-[0.98] disabled:opacity-50" style={{ fontWeight: 600 }}>
          {accept.isPending ? "Saving…" : "Accept and continue"}
        </button>
      </motion.div>
    </motion.div>
  );
}
