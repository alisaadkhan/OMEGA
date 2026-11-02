import { useState } from "react";
import { LEGAL_VERSION } from "@mushin/contracts";
import { rememberLegalAcceptance } from "../../api/legal";
import { motion } from "motion/react";
import { ArrowRight, Check, User } from "lucide-react";
import { Button } from "../ui/button";
import { AuthAlert, AuthShell, CheckEmailState, FormField, StaggerItem } from "./AuthShell";
import { useAuth } from "../../auth/AuthContext";
import { checkEmailText } from "../../api/signup-outcome";

type Props = {
  onSuccess: () => void;
  goLogin: () => void;
  goForgot: () => void;
};

/** Four-step strength: length 8+, 12+, a capital and a digit, a symbol. Shown as a bar and a word. */
function strengthOf(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: "Minimum 8 characters" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return { score: Math.max(score, 1), label: pw.length < 8 ? "Too short" : score <= 1 ? "Weak" : score === 2 ? "Fair" : "Strong" };
}

export function Signup({ onSuccess, goLogin, goForgot }: Props) {
  const { signup, resendConfirmation } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Audit UX-01: consent is an explicit, unticked choice; the accepted version is recorded after sign-in.
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [touched, setTouched] = useState(false);
  const missing = { name: touched && !name.trim(), email: touched && !email.trim(), password: touched && password.length < 8, agreed: touched && !agreed };
  const strength = strengthOf(password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setExists(false);
    setTouched(true);
    if (!name.trim() || !email.trim() || password.length < 8) {
      setError("Fill in the highlighted fields to continue.");
      return;
    }
    if (!agreed) {
      setError("Please read and accept the Terms and the Privacy Policy to create an account.");
      return;
    }
    rememberLegalAcceptance();
    setSubmitting(true);
    try {
      const outcome = await signup(name, email, password);
      if (outcome.kind === "signed_in") {
        onSuccess();
        return;
      }
      if (outcome.kind === "check_email") setSentTo(outcome.email);
      else if (outcome.kind === "exists") {
        setError(outcome.message);
        setExists(true);
      } else setError(outcome.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (sentTo) {
    return (
      <AuthShell formKey="signup-sent" title="Check your email" subtitle="One more step: confirm your address.">
        <CheckEmailState email={sentTo} message={checkEmailText(sentTo)} onResend={() => resendConfirmation(sentTo)} onBack={goLogin} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      formKey="signup"
      title="Create your account"
      subtitle="Discover Pakistani creators in minutes. No card required."
      footer={
        <>
          Already on MUSHIN?{" "}
          <button onClick={goLogin} className="rounded font-semibold text-slate-900 underline-offset-4 transition-colors hover:underline focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
            Sign in
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <StaggerItem index={0}>
          <FormField label="Full name" value={name} onChange={setName} placeholder="Ayesha Malik" autoFocus autoComplete="name" icon={User} error={missing.name ? "Enter your full name." : null} />
        </StaggerItem>
        <StaggerItem index={1}>
          <FormField label="Work email" type="email" value={email} onChange={setEmail} placeholder="you@brand.pk" error={missing.email ? "Enter your work email." : exists ? "Already registered." : null} />
        </StaggerItem>
        <StaggerItem index={2}>
          <FormField
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            error={missing.password ? "Use at least 8 characters." : null}
            aside={<span className={`text-[10px] font-semibold uppercase tracking-wider ${strength.score >= 3 ? "text-cyan-700" : password && password.length < 8 ? "text-rose-600" : "text-slate-500"}`} aria-live="polite">{strength.label}</span>}
          />
          <div className="mt-2 flex h-1 w-full gap-1" aria-hidden>
            {[1, 2, 3, 4].map((i) => (
              <motion.span
                key={i}
                initial={false}
                animate={{ opacity: 1 }}
                className={`h-full flex-1 rounded-full transition-colors duration-300 ${
                  strength.score >= i && password ? (password.length < 8 ? "bg-rose-500" : strength.score >= 3 ? "bg-[#06B6D4]" : "bg-amber-400") : "bg-slate-200"
                }`}
              />
            ))}
          </div>
        </StaggerItem>

        <StaggerItem index={3}>
          <ul className="space-y-2 rounded-2xl bg-slate-50 p-3.5 text-xs text-slate-700">
            {["Free 14-day trial, activated after a short call", "No credit card required", "Nothing charged when it ends"].map((t, i) => (
              <motion.li key={t} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.55 + i * 0.06, duration: 0.3 }} className="flex items-center gap-2.5 font-medium">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-cyan-100 text-cyan-800">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                {t}
              </motion.li>
            ))}
          </ul>
        </StaggerItem>

        {error && (
          <AuthAlert kind="error">
            <p>{error}</p>
            {exists && (
              <p className="mt-1.5 flex gap-3">
                <button type="button" onClick={goLogin} className="rounded font-semibold underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-rose-300">Sign in</button>
                <button type="button" onClick={goForgot} className="rounded font-semibold underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-rose-300">Reset password</button>
              </p>
            )}
          </AuthAlert>
        )}

        <StaggerItem index={4}>
          <label className={`flex items-start gap-2.5 rounded-xl text-xs text-slate-600 ${missing.agreed ? "ring-1 ring-rose-500 p-2" : ""}`}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#131b2e]" aria-describedby="legal-draft-note" />
            <span>
              I accept the <a href="#/terms" target="_blank" rel="noreferrer" className="font-medium text-slate-900 underline">Terms of Service</a> and the{" "}
              <a href="#/privacy" target="_blank" rel="noreferrer" className="font-medium text-slate-900 underline">Privacy Policy</a>.
              <span id="legal-draft-note" className="block text-slate-500">These are drafts pending legal review (version {LEGAL_VERSION}).</span>
            </span>
          </label>
        </StaggerItem>
        <StaggerItem index={5}>
          <motion.div whileTap={{ scale: 0.98 }}>
            <Button type="submit" disabled={submitting} className="group relative h-12 w-full overflow-hidden rounded-full bg-[#131b2e] text-white shadow-md transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:opacity-50">
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
      </form>
    </AuthShell>
  );
}
