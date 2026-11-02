import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Clock } from "lucide-react";
import { Button } from "../ui/button";
import { AuthShell, FormField, StaggerItem } from "./AuthShell";
import { useAuth } from "../../auth/AuthContext";
import { takeSessionExpired } from "../../api/session";

type Props = {
  onSuccess: () => void;
  goSignup: () => void;
  goForgot: () => void;
};

export function Login({ onSuccess, goSignup, goForgot }: Props) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read once: after a session expired on its own, say so (AUTH-08).
  const [expired] = useState(() => takeSessionExpired());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      formKey="login"
      title="Welcome back"
      subtitle="Sign in to continue to your MUSHIN workspace."
      footer={
        <>
          New to MUSHIN?{" "}
          <button
            onClick={goSignup}
            className="text-sm font-semibold text-slate-900 underline-offset-4 transition-colors hover:underline"
          >
            Create an account
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {expired && (
          <p role="status" className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            Your session expired. Sign in again to continue where you left off.
          </p>
        )}
        <StaggerItem index={0}>
          <FormField
            label="Work email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="name@company.pk"
            autoFocus
          />
        </StaggerItem>
        <StaggerItem index={1}>
          <FormField
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="Your password"
            aside={
              <button type="button" onClick={goForgot} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                Forgot password?
              </button>
            }
          />
        </StaggerItem>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <StaggerItem index={3}>
          <motion.div whileTap={{ scale: 0.98 }}>
            <Button
              type="submit"
              disabled={submitting}
              className="group relative h-12 w-full overflow-hidden rounded-full bg-slate-950 text-white shadow-sm transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-md disabled:opacity-90"
            >
              {submitting ? (
                <motion.span
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="inline-flex items-center"
                >
                  <span className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Signing in…
                </motion.span>
              ) : (
                <motion.span
                  key="ready"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="inline-flex items-center"
                >
                  Sign in
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </motion.span>
              )}
            </Button>
          </motion.div>
        </StaggerItem>

      </form>
    </AuthShell>
  );
}
