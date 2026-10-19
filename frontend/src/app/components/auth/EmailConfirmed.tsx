import { useState } from "react";
import { ArrowRight, CheckCircle2, MailWarning } from "lucide-react";
import { Button } from "../ui/button";
import { AuthShell, FormField } from "./AuthShell";
import { useAuth } from "../../auth/AuthContext";

type Props = { goDashboard: () => void; goLogin: () => void };

/**
 * Where the sign-up confirmation email lands (`#/confirmed`; mandate v3 §3.2 UX-02, gap UX-08). The PKCE code exchange
 * signs the person in when the link is opened in the browser that signed up. In another browser the address is still
 * confirmed (the Auth server did that before redirecting), so the person signs in. An expired or used link says so and
 * offers a new email.
 */
export function EmailConfirmed({ goDashboard, goLogin }: Props) {
  const { status, linkError, resendConfirmation } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "loading") {
    return <AuthShell formKey="confirm-checking" title="Checking your link" subtitle="One moment…">{null}</AuthShell>;
  }
  if (status === "signedIn" && !linkError) {
    return (
      <AuthShell formKey="confirmed" title="Your email is confirmed" subtitle="Your account is ready.">
        <div className="flex items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
          <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-600" aria-hidden="true" /> You are signed in.
        </div>
        <Button onClick={goDashboard} className="mt-4 h-11 w-full rounded-md bg-slate-900 text-white hover:bg-slate-800">
          Continue to MUSHIN <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </AuthShell>
    );
  }
  if (!linkError) {
    return (
      <AuthShell formKey="confirmed-signin" title="Your email is confirmed" subtitle="Sign in to continue. (The link was opened in a different browser from the one you signed up in.)">
        <Button onClick={goLogin} className="h-11 w-full rounded-md bg-slate-900 text-white hover:bg-slate-800">
          Sign in <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </AuthShell>
    );
  }
  const resend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await resendConfirmation(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a new link. Please try again.");
    }
  };
  return (
    <AuthShell
      formKey="confirm-expired"
      title="This confirmation link no longer works"
      subtitle={`${linkError} If you already confirmed your email, just sign in.`}
      footer={<button onClick={goLogin} className="text-indigo-600 hover:text-indigo-700" style={{ fontWeight: 500 }}>Sign in</button>}
    >
      {sent ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
          <MailWarning className="h-5 w-5 flex-shrink-0 text-emerald-600" aria-hidden="true" /> If {email} has an unconfirmed account, a new link is on its way.
        </div>
      ) : (
        <form onSubmit={resend} className="space-y-4">
          <FormField label="Email" type="email" value={email} onChange={setEmail} placeholder="you@company.pk" />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="h-11 w-full rounded-md bg-slate-900 text-white hover:bg-slate-800">Send a new confirmation link</Button>
        </form>
      )}
    </AuthShell>
  );
}
