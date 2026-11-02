import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "../ui/button";
import { AuthShell, FormField, StaggerItem } from "./AuthShell";
import { useAuth } from "../../auth/AuthContext";

type Props = { onDone: () => void; goForgot: () => void };

/** Matches the hosted Auth policy; the Auth server enforces its own minimum as well. */
export const MIN_PASSWORD_LENGTH = 8;

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password !== confirm) return setError("The two passwords do not match.");
    setSubmitting(true);
    try {
      await updatePassword(password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password. Please try again.");
      setSubmitting(false);
    }
  };

  const back = (
    <button onClick={goForgot} className="inline-flex items-center gap-1 text-indigo-600 transition-colors hover:text-indigo-700" style={{ fontWeight: 500 }}>
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
        </StaggerItem>
        <StaggerItem index={1}>
          <FormField label="Repeat the new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </StaggerItem>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <StaggerItem index={2}>
          <Button type="submit" disabled={submitting} className="group h-12 w-full rounded-full bg-slate-950 text-white shadow-sm hover:bg-slate-800">
            Save new password
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </StaggerItem>
      </form>
    </AuthShell>
  );
}
