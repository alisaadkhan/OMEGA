import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Clock, Eye, EyeOff, Info, KeyRound, Lock, Mail, ShieldCheck } from "lucide-react";
import { useAdminAuth } from "../../admin/AdminAuthContext";
import { LogoMark } from "../landing/Logo";

/**
 * Staff sign-in at /_omega_ (owner design, 22 Nov). One form: work email, password and the 6-digit authenticator code.
 * The server checks the password first, then the code; after 5 wrong attempts it pauses sign-in for 15 minutes and
 * answers the same way for every failure, so the page shows its message rather than guessing the cause.
 */
const field =
  "w-full rounded-2xl border border-slate-200 bg-[#F8FAFC] py-2.5 pl-10 pr-4 text-sm font-medium text-slate-900 placeholder:text-slate-400 transition-all focus:border-[#06B6D4] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/20";

function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      <style>{`@keyframes omegaOrb{0%,100%{transform:translate3d(0,0,0) scale(1)}33%{transform:translate3d(45px,-35px,0) scale(1.08)}66%{transform:translate3d(-35px,30px,0) scale(.95)}}
@media (prefers-reduced-motion: reduce){.omega-orb{animation:none!important}}`}</style>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#121B42_0%,#0A0F24_62%,#060917_100%)]" />
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundSize: "44px 44px",
          backgroundImage: "linear-gradient(to right, rgba(6,182,212,.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(6,182,212,.08) 1px, transparent 1px)",
          maskImage: "radial-gradient(circle at 50% 50%, black 35%, transparent 82%)",
        }}
      />
      <div className="omega-orb absolute -left-24 -top-28 h-[480px] w-[480px] rounded-full bg-[#06B6D4]/15 blur-[110px]" style={{ animation: "omegaOrb 18s ease-in-out infinite" }} />
      <div className="omega-orb absolute -bottom-32 -right-24 h-[520px] w-[520px] rounded-full bg-indigo-500/20 blur-[125px]" style={{ animation: "omegaOrb 22s ease-in-out infinite reverse" }} />
    </div>
  );
}

export function StaffLogin({ onSuccess }: { onSuccess: () => void }) {
  const { startLogin, completeLogin } = useAdminAuth();
  const [view, setView] = useState<"signin" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the password was right and this person has two-factor on: the next step asks for the code.
  const [challenge, setChallenge] = useState<string | null>(null);
  const paused = error !== null && /too many attempts/i.test(error);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!challenge) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter your staff work email.");
      if (!password) return setError("Enter your password.");
    } else if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from your authenticator app.");
    setError(null);
    setBusy(true);
    try {
      if (!challenge) {
        const token = await startLogin(email.trim(), password);
        if (token === null) return onSuccess();
        setChallenge(token);
        setPassword("");
        return;
      }
      await completeLogin(challenge, code);
      onSuccess();
    } catch (err) {
      setCode("");
      setError(err instanceof Error ? err.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[#0A0F24] px-4 py-10 text-slate-900 antialiased">
      <Backdrop />
      <main className="relative z-10 w-full max-w-[440px]">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-[0_28px_70px_-15px_rgba(0,0,0,0.65)] sm:p-9">
          {error && (
            <div role="alert" className={`mb-5 flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-xs font-semibold ${paused ? "border-amber-200 bg-amber-50 text-amber-900" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
              {paused ? <Clock className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <div className="leading-relaxed">{paused ? "Sign-in paused for 15 minutes after too many wrong attempts. Try again later." : error}</div>
            </div>
          )}

          {view === "signin" ? (
            <section>
              <div className="text-center">
                <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0A0F24] shadow-md"><LogoMark size={40} /></div>
                <div className="mt-3 text-xl font-extrabold tracking-wide text-slate-900">MUSHIN</div>
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-cyan-200/80 bg-cyan-50 px-3 py-1 text-[11px] font-bold text-cyan-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#06B6D4]" /> Staff Only
                </div>
                <h1 className="mt-3 text-[22px] font-extrabold tracking-tight text-slate-900">Staff Sign In</h1>
                <p className="mt-1 text-xs text-slate-500">{challenge ? "Enter the 6-digit code from your authenticator app." : "Sign in with your staff email and password."}</p>
              </div>

              <form onSubmit={(e) => void submit(e)} noValidate className="mt-6 space-y-4">
                {!challenge ? (
                  <>
                <div>
                  <label htmlFor="staff-email" className="mb-1.5 block text-xs font-bold text-slate-700">Work Email</label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input id="staff-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@mushin.pk" className={field} autoFocus />
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="staff-password" className="block text-xs font-bold text-slate-700">Password</label>
                    <button type="button" onClick={() => { setError(null); setView("forgot"); }} className="text-xs font-bold text-cyan-700 hover:text-cyan-800">Forgot Password?</button>
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input id="staff-password" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" className={`${field} pr-11`} />
                    <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl p-1.5 text-slate-400 hover:text-slate-700">
                      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                  </>
                ) : (
                  <div>
                  <label htmlFor="staff-code" className="mb-1.5 block text-xs font-bold text-slate-700">6-Digit Authenticator Code</label>
                  <div className="relative">
                    <ShieldCheck className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="staff-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      className={`${field} font-mono font-bold tabular-nums tracking-[0.28em] placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-300`}
                    />
                  </div>
                </div>
                )}
                <button type="submit" disabled={busy || paused} className="btn btn-primary w-full !py-3 !text-sm">
                  {busy ? "Signing in…" : challenge ? <>Verify Code <ArrowRight className="h-4 w-4" /></> : <>Sign In <ArrowRight className="h-4 w-4" /></>}
                </button>
                {challenge && (
                  <button type="button" onClick={() => { setChallenge(null); setCode(""); setError(null); }} className="w-full text-center text-xs font-semibold text-slate-500 hover:text-slate-900">Use another account</button>
                )}
                <p className="flex items-start gap-2 pt-1 text-[11.5px] text-slate-500">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> 5 wrong password attempts will pause sign-in for 15 minutes.
                </p>
              </form>
            </section>
          ) : (
            <section>
              <div className="text-center">
                <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-100 bg-cyan-50 text-[#06B6D4]"><KeyRound className="h-5 w-5" /></div>
                <h1 className="mt-4 text-[22px] font-extrabold tracking-tight text-slate-900">Reset Your Password</h1>
              </div>
              {/* No staff reset email exists (staff passwords and codes are issued by a Super Admin), so nothing is "sent". */}
              <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
                Staff passwords are not reset by email. Ask a Super Admin to reset your staff account; you then sign in here with the new temporary password.
              </p>
              <div className="mt-6 border-t border-slate-100 pt-5 text-center">
                <button type="button" onClick={() => setView("signin")} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to Sign In
                </button>
              </div>
            </section>
          )}
        </div>
        <div className="mt-5 flex items-center justify-center gap-2 text-[11px] font-medium text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-[#06B6D4]" /> Protected Staff Access · Every sign-in is logged
        </div>
      </main>
    </div>
  );
}
