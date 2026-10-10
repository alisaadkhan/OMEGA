import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Shield, Lock, KeyRound } from "lucide-react";
import { Button } from "../ui/button";
import { LogoMark } from "../landing/Logo";
import { useAdminAuth } from "../../admin/AdminAuthContext";
import { FormField } from "../auth/AuthShell";

/** Staff sign-in (sub-project 1 API): email and password, then the 6-digit code from the authenticator app. */
export function AdminLogin({
  onSuccess,
  onExit,
}: {
  onSuccess: () => void;
  onExit: () => void;
}) {
  const { startLogin, completeLogin } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (!challenge) {
        setChallenge(await startLogin(email.trim(), password));
        setPassword("");
      } else {
        await completeLogin(challenge, code.trim());
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = "[&_input]:!bg-white/5 [&_input]:!border-white/10 [&_input]:!text-white [&_input]:placeholder:!text-white/40 [&_span]:!text-white/70";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-6 py-12 text-white">
      {/* Aurora */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(129,140,248,0.28), rgba(52,211,153,0.10), transparent 70%)" }}
        animate={{ scale: [1, 1.06, 1], rotate: [0, 6, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgb(255 255 255) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at center top, black 30%, transparent 75%)",
        }}
      />

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <LogoMark variant="dark" size={40} />
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/70 backdrop-blur">
            <Shield className="h-3 w-3" strokeWidth={2} />
            Internal operations
          </div>
          <div className="text-center">
            <div className="text-white" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
              mushin.io / admin
            </div>
            <div className="mt-1 text-xs text-white/50">Restricted access · sign in with your staff account</div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)] backdrop-blur"
        >
          <form onSubmit={(e) => void submit(e)} className="space-y-4">
            {!challenge ? (
              <>
                <div className={inputStyle}>
                  <FormField label="Staff email" type="email" value={email} onChange={setEmail} placeholder="you@mushin.pk" autoFocus />
                </div>
                <div className={inputStyle}>
                  <FormField label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" />
                </div>
              </>
            ) : (
              <div className={inputStyle}>
                <FormField label="6-digit code from your authenticator app" type="text" value={code} onChange={setCode} placeholder="123456" autoFocus />
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-white/60">
              <span className="inline-flex items-center gap-1 text-white/50">
                {challenge ? <KeyRound className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {challenge ? "Step 2 of 2" : "MFA required"}
              </span>
              {challenge && (
                <button
                  type="button"
                  onClick={() => {
                    setChallenge(null);
                    setCode("");
                    setError(null);
                  }}
                  className="hover:text-white/80"
                >
                  Use another account
                </button>
              )}
            </div>

            {error && <p className="text-xs text-red-300">{error}</p>}

            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                type="submit"
                disabled={submitting || (!challenge ? !email.trim() || !password : code.trim().length !== 6)}
                className="group h-11 w-full rounded-md bg-white text-slate-900 shadow-sm transition-all hover:-translate-y-px hover:bg-slate-100 disabled:opacity-90"
              >
                {submitting ? (
                  <span className="inline-flex items-center">
                    <span className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
                    {challenge ? "Checking code…" : "Verifying credentials…"}
                  </span>
                ) : (
                  <span className="inline-flex items-center">
                    {challenge ? "Verify and sign in" : "Continue"}
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                )}
              </Button>
            </motion.div>
          </form>
        </motion.div>

        <div className="mt-6 flex items-center justify-between text-xs text-white/50">
          <button onClick={onExit} className="hover:text-white/80">← Back to mushin.io</button>
          <span>Unauthorized access is logged and reported.</span>
        </div>
      </div>
    </div>
  );
}
