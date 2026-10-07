import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, MailCheck } from "lucide-react";
import { Button } from "../ui/button";
import { AuthShell, FormField, StaggerItem } from "./AuthShell";
import { useAuth } from "../../auth/AuthContext";

type Props = { goLogin: () => void };

export function ForgotPassword({ goLogin }: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { requestPasswordReset } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reset link. Please try again.");
    }
  };

  return (
    <AuthShell
      formKey={sent ? "sent" : "forgot"}
      title={sent ? "Check your inbox" : "Reset your password"}
      subtitle={
        sent
          ? `We've sent a recovery link to ${email}. Follow it to set a new password.`
          : "Enter the email tied to your account and we'll send you a recovery link."
      }
      footer={
        <button
          onClick={goLogin}
          className="inline-flex items-center gap-1 text-indigo-600 transition-colors hover:text-indigo-700"
          style={{ fontWeight: 500 }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </button>
      }
    >
      <AnimatePresence mode="wait">
        {sent ? (
          <motion.div
            key="sent"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-3 rounded-md border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 16, delay: 0.15 }}
            >
              <MailCheck className="h-5 w-5 flex-shrink-0 text-emerald-600" />
            </motion.div>
            <span>Recovery link sent. Didn't get it? Check spam, or try again in a minute.</span>
          </motion.div>
        ) : (
          <motion.form key="form" onSubmit={submit} className="space-y-4">
            <StaggerItem index={0}>
              <FormField label="Email" type="email" value={email} onChange={setEmail} placeholder="ahmed@mushin.pk" autoFocus />
            </StaggerItem>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <StaggerItem index={1}>
              <motion.div whileTap={{ scale: 0.98 }}>
                <Button
                  type="submit"
                  className="group h-11 w-full rounded-md bg-slate-900 text-white shadow-sm transition-all hover:-translate-y-px hover:bg-slate-800 hover:shadow-md"
                >
                  Send reset link
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </motion.div>
            </StaggerItem>
          </motion.form>
        )}
      </AnimatePresence>
    </AuthShell>
  );
}
