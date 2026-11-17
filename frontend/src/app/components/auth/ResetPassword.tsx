import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "../ui/button";
import { AuthAlert, AuthShell, FormField, StaggerItem } from "./AuthShell";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../auth/AuthContext";
import { PASSWORD_HINT, passwordMeetsRules } from "../../auth/password-rules";
import { PasswordChecklist } from "./PasswordChecklist";

type Props = { onDone: () => void; goForgot: () => void };

/**
 * Set a new password after following a recovery email (audit UX-02). The link signs the person in through the PKCE code
 * exchange (lib/supabase.ts); without that session the link was expired, already used or opened in another browser.
 */
export function ResetPassword({ onDone, goForgot }: Props) {
  const { status, updatePassword, linkError } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [tried, setTried] = useState(false);
  // Two-step sign-in: the sign-in service changes a password only from a session that passed the code step.
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTried(true);
    if (!passwordMeetsRules(password)) return setError(PASSWORD_HINT);
    if (password !== confirm) return setError("The two passwords do not match.");
    setSubmitting(true);
    try {
      const aal = (await supabase.auth.mfa.getAuthenticatorAssuranceLevel()).data;
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        if (!/^\d{6}$/.test(code)) {
          setNeedsCode(true);
          setSubmitting(false);
          return setError("Two-step sign-in is on for this account: enter the code from your authenticator app.");
        }
        const totp = (await supabase.auth.mfa.listFactors()).data?.totp[0];
        const verified = totp ? await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code }) : null;
        if (!verified || verified.error) {
          setSubmitting(false);
          return setError("That authenticator code is not right, or it has expired.");
        }
      }
      await updatePassword(password);
      setDone(true);
      setTimeout(onDone, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password. Please try again.");
      setSubmitting(false);
    }
  };

  const back = (
    <button onClick={goForgot} className="inline-flex items-center gap-1 text-teal transition-colors hover:text-teal-deep" style={{ fontWeight: 500 }}>
      <ArrowLeft className="h-3.5 w-3.5" />
      Request a new link
    </button>
  );

  if (status === "loading") {
    return <AuthShell formKey="reset-checking" title="Checking your link" subtitle="One moment…" footer={back}>{null}</AuthShell>;
  }
  if (status === "signedOut") {
    return (
      <AuthShell
        formKey="reset-expired"
        title="This link no longer works"
        subtitle={linkError ?? "Recovery links work once, for a limited time, in the browser where you asked for them. Request a new link to continue."}
        footer={back}
      >
        {null}
      </AuthShell>
    );
  }
  return (
    <AuthShell formKey="reset" title="Set a new password" subtitle="Choose a new password for your MUSHIN account." footer={back}>
      <form onSubmit={submit} className="space-y-4">
        <StaggerItem index={0}>
          <FormField label="New password" type="password" value={password} onChange={setPassword} autoFocus autoComplete="new-password" />
          <PasswordChecklist password={password} showErrors={tried} />
        </StaggerItem>
        <StaggerItem index={1}>
          <FormField label="Repeat the new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </StaggerItem>
        {needsCode && (
          <FormField label="Authenticator code" value={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} autoComplete="one-time-code" />
        )}
        {error && <AuthAlert kind="error">{error}</AuthAlert>}
        {done && <AuthAlert kind="success">Password changed. Opening your dashboard…</AuthAlert>}
        <StaggerItem index={2}>
          <Button type="submit" disabled={submitting || done} className="group h-12 w-full rounded-full bg-slate-950 text-white shadow-sm hover:bg-slate-800">
            Save new password
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </StaggerItem>
      </form>
    </AuthShell>
  );
}
