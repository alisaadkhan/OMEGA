import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { Button } from "../ui/button";
import { AuthShell, FormField, StaggerItem } from "./AuthShell";
import { useAuth } from "../../auth/AuthContext";

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
      subtitle="Sign in to continue to your Mushin workspace."
      footer={
        <>
          New to Mushin?{" "}
          <button
            onClick={goSignup}
            className="text-indigo-600 transition-colors hover:text-indigo-700"
            style={{ fontWeight: 500 }}
          >
            Create an account
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <StaggerItem index={0}>
          <FormField
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="ahmed@mushin.pk"
            autoFocus
          />
        </StaggerItem>
        <StaggerItem index={1}>
          <FormField
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
          />
        </StaggerItem>

        <StaggerItem index={2}>
          <div className="flex items-center justify-between text-xs">
            <label className="inline-flex items-center gap-2 text-slate-600">
              <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300" defaultChecked />
              Remember me
            </label>
            <button
              type="button"
              onClick={goForgot}
              className="text-indigo-600 hover:text-indigo-700"
              style={{ fontWeight: 500 }}
            >
              Forgot password?
            </button>
          </div>
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
              className="group relative h-11 w-full overflow-hidden rounded-md bg-slate-900 text-white shadow-sm transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-md disabled:opacity-90"
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
                  <Mail className="mr-2 h-4 w-4" />
                  Sign in
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </motion.span>
              )}
            </Button>
          </motion.div>
        </StaggerItem>

        <StaggerItem index={4}>
          <div className="relative my-2">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
              <span className="bg-white px-2 text-slate-500">or</span>
            </div>
          </div>
        </StaggerItem>

        <StaggerItem index={5}>
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:shadow-sm"
          >
            <Lock className="h-4 w-4 text-slate-500" /> Continue with SSO
          </motion.button>
        </StaggerItem>
      </form>
    </AuthShell>
  );
}
