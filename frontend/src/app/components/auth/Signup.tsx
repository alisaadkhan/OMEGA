import { useState } from "react";
import { LEGAL_VERSION } from "@mushin/contracts";
import { rememberLegalAcceptance } from "../../api/legal";
import { motion } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "../ui/button";
import { AuthShell, FormField, StaggerItem } from "./AuthShell";
import { useAuth } from "../../auth/AuthContext";

type Props = {
  onSuccess: () => void;
  goLogin: () => void;
};

export function Signup({ onSuccess, goLogin }: Props) {
  const { signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Audit UX-01: consent is an explicit, unticked choice; the accepted version is recorded after sign-in.
  const [agreed, setAgreed] = useState(false);

  const strength = Math.min(100, Math.round((password.length / 12) * 100));

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!agreed) {
      setError("Please read and accept the Terms and the Privacy Policy to create an account.");
      return;
    }
    rememberLegalAcceptance();
    setSubmitting(true);
    try {
      const { needsConfirmation } = await signup(name, email, password);
      if (needsConfirmation) {
        setNotice(`We've sent a confirmation link to ${email}. Confirm your email, then sign in.`);
        setSubmitting(false);
        return;
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      formKey="signup"
      title="Create your account"
      subtitle="Discover Pakistani creators in minutes — no card required."
      footer={
        <>
          Already on Mushin?{" "}
          <button
            onClick={goLogin}
            className="text-indigo-600 transition-colors hover:text-indigo-700"
            style={{ fontWeight: 500 }}
          >
            Sign in
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <StaggerItem index={0}>
          <FormField label="Full name" value={name} onChange={setName} placeholder="Ayesha Malik" autoFocus />
        </StaggerItem>
        <StaggerItem index={1}>
          <FormField label="Work email" type="email" value={email} onChange={setEmail} placeholder="you@brand.pk" />
        </StaggerItem>
        <StaggerItem index={2}>
          <FormField
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
          />
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
            <motion.div
              animate={{ width: `${strength}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="h-full rounded-full"
              style={{
                background:
                  strength < 40
                    ? "rgb(239 68 68)"
                    : strength < 75
                    ? "rgb(245 158 11)"
                    : "rgb(16 185 129)",
              }}
            />
          </div>
        </StaggerItem>

        <StaggerItem index={3}>
          <ul className="space-y-1.5 text-xs text-slate-600">
            {["Free 14-day trial, activated after a short call", "No credit card required", "Nothing charged when it ends"].map((t, i) => (
              <motion.li
                key={t}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.55 + i * 0.06, duration: 0.3 }}
                className="inline-flex items-center gap-1.5"
              >
                <Check className="h-3.5 w-3.5 text-emerald-600" /> {t}
              </motion.li>
            ))}
          </ul>
        </StaggerItem>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-emerald-700">
            {notice}
          </p>
        )}
        <StaggerItem index={4}>
          <motion.div whileTap={{ scale: 0.98 }}>
            <Button
              type="submit"
              disabled={submitting}
              className="group relative h-11 w-full overflow-hidden rounded-md bg-slate-900 text-white shadow-sm transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-md disabled:opacity-90"
            >
              {submitting ? (
                <span className="inline-flex items-center">
                  <span className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Creating account…
                </span>
              ) : (
                <span className="inline-flex items-center">
                  Create account
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              )}
            </Button>
          </motion.div>
        </StaggerItem>

        <StaggerItem index={5}>
          <label className="flex items-start gap-2 text-[11px] text-slate-600">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" aria-describedby="legal-draft-note" />
            <span>
              I accept the <a href="#/terms" target="_blank" rel="noreferrer" className="text-indigo-700 underline">Terms of Service</a> and the{" "}
              <a href="#/privacy" target="_blank" rel="noreferrer" className="text-indigo-700 underline">Privacy Policy</a>.
              <span id="legal-draft-note" className="block text-slate-500">These are drafts pending legal review (version {LEGAL_VERSION}).</span>
            </span>
          </label>
        </StaggerItem>
      </form>
    </AuthShell>
  );
}
