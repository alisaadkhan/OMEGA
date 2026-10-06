import { useState } from "react";
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

  const strength = Math.min(100, Math.round((password.length / 12) * 100));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setTimeout(() => {
      signup(name, email, password);
      onSuccess();
    }, 600);
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
            {["14-day free trial", "No credit card required", "Cancel anytime"].map((t, i) => (
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
          <p className="text-center text-[11px] text-slate-500">
            By creating an account you agree to the Terms and Privacy Policy.
          </p>
        </StaggerItem>
      </form>
    </AuthShell>
  );
}
