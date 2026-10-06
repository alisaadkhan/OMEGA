import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Shield, LifeBuoy, Lock } from "lucide-react";
import { Button } from "../ui/button";
import { LogoMark } from "../landing/Logo";
import { useAdminAuth, type AdminRole } from "../../admin/AdminAuthContext";
import { FormField } from "../auth/AuthShell";

export function AdminLogin({
  onSuccess,
  onExit,
}: {
  onSuccess: () => void;
  onExit: () => void;
}) {
  const { signIn } = useAdminAuth();
  const [role, setRole] = useState<AdminRole>("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setTimeout(() => {
      signIn(email, password, role);
      onSuccess();
    }, 550);
  };

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
            <div className="mt-1 text-xs text-white/50">Restricted access · sign in with your workplace credentials</div>
          </div>
        </div>

        {/* Role toggle */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          {(
            [
              { id: "admin" as const, label: "Admin", icon: Shield, sub: "Platform controls" },
              { id: "support" as const, label: "Support", icon: LifeBuoy, sub: "User assistance" },
            ]
          ).map((r) => {
            const active = role === r.id;
            return (
              <motion.button
                key={r.id}
                onClick={() => setRole(r.id)}
                whileTap={{ scale: 0.98 }}
                className={`relative overflow-hidden rounded-xl border p-3 text-left transition-all ${
                  active
                    ? "border-indigo-400/60 bg-indigo-500/10"
                    : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-md ${
                      active ? "bg-indigo-500/25 text-indigo-200" : "bg-white/10 text-white/70"
                    }`}
                  >
                    <r.icon className="h-3.5 w-3.5" strokeWidth={2} />
                  </span>
                  <div>
                    <div className="text-sm text-white" style={{ fontWeight: 600 }}>{r.label}</div>
                    <div className="text-[11px] text-white/50">{r.sub}</div>
                  </div>
                </div>
                {active && (
                  <motion.span
                    layoutId="role-active"
                    className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-gradient-to-r from-indigo-400 to-emerald-300"
                  />
                )}
              </motion.button>
            );
          })}
        </div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)] backdrop-blur"
        >
          <form onSubmit={submit} className="space-y-4">
            <div className="[&_input]:!bg-white/5 [&_input]:!border-white/10 [&_input]:!text-white [&_input]:placeholder:!text-white/40 [&_span]:!text-white/70">
              <FormField
                label={role === "admin" ? "Admin email" : "Support email"}
                type="email"
                value={email}
                onChange={setEmail}
                placeholder={role === "admin" ? "faisal@mushin.pk" : "mira@mushin.pk"}
                autoFocus
              />
            </div>
            <div className="[&_input]:!bg-white/5 [&_input]:!border-white/10 [&_input]:!text-white [&_input]:placeholder:!text-white/40 [&_span]:!text-white/70">
              <FormField
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-white/60">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="h-3.5 w-3.5 rounded border-white/20 bg-white/10" defaultChecked />
                Remember this device
              </label>
              <span className="inline-flex items-center gap-1 text-white/50">
                <Lock className="h-3 w-3" />
                MFA required
              </span>
            </div>

            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                type="submit"
                disabled={submitting}
                className="group h-11 w-full rounded-md bg-white text-slate-900 shadow-sm transition-all hover:-translate-y-px hover:bg-slate-100 disabled:opacity-90"
              >
                {submitting ? (
                  <span className="inline-flex items-center">
                    <span className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
                    Verifying credentials…
                  </span>
                ) : (
                  <span className="inline-flex items-center">
                    Sign in as {role === "admin" ? "Admin" : "Support"}
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
