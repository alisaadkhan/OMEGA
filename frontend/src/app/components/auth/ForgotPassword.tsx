import { useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "../ui/button";
import { AuthAlert, AuthShell, CheckEmailState, FormField, StaggerItem } from "./AuthShell";
import { useAuth } from "../../auth/AuthContext";

type Props = { goLogin: () => void };

export function ForgotPassword({ goLogin }: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { requestPasswordReset } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const missing = touched && !email.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTouched(true);
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reset link. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      formKey={sent ? "sent" : "forgot"}
      title={sent ? "Check your inbox" : "Reset your password"}
      subtitle={sent ? "Follow the link in the email to set a new password." : "Enter the email tied to your account and we'll send you a recovery link."}
      footer={
        sent ? undefined : (
          <button onClick={goLogin} className="inline-flex items-center gap-1.5 rounded-full font-medium text-slate-600 transition-colors hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to sign in
          </button>
        )
      }
    >
      {sent ? (
        <CheckEmailState
          email={email}
          message={
            <>
              If <span className="font-semibold text-slate-900">{email}</span> has a MUSHIN account, a recovery link is on its way. Follow it to reset your password.
            </>
          }
          onResend={() => requestPasswordReset(email)}
          onBack={goLogin}
        />
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <StaggerItem index={0}>
            <FormField label="Work email" type="email" value={email} onChange={setEmail} placeholder="name@company.pk" autoFocus error={missing ? "Enter the email you signed up with." : null} />
          </StaggerItem>
          {error && <AuthAlert kind="error">{error}</AuthAlert>}
          <StaggerItem index={1}>
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button type="submit" disabled={submitting} className="group h-12 w-full rounded-full bg-[#131b2e] text-white shadow-md transition-all hover:-translate-y-px hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:opacity-50">
                {submitting ? "Sending…" : "Send reset link"}
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </motion.div>
          </StaggerItem>
        </form>
      )}
    </AuthShell>
  );
}
