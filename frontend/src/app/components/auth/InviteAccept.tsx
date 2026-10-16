import { useEffect, useState } from "react";
import { acceptedInvitationSchema, invitationPreviewSchema } from "@mushin/contracts";
import { apiRequest } from "../../api/client";
import { selectWorkspace } from "../../api/workspace";
import { useAuth } from "../../auth/AuthContext";
import { ErrorState, LoadingBlock } from "../dashboard/states";

const PENDING_KEY = "mushin.pendingInvite";
/** The token from `#/invite/<token>`; kept for the session so signing in or up returns here. */
export function inviteTokenFromHash(): string | null {
  const m = /^#\/invite\/([A-Za-z0-9_-]{20,200})$/.exec(window.location.hash);
  if (m?.[1]) {
    try {
      sessionStorage.setItem(PENDING_KEY, m[1]);
    } catch {
      // Without session storage the link must be opened again after signing in.
    }
    return m[1];
  }
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}
const clearPending = () => {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // nothing to clear
  }
};

type Preview = ReturnType<typeof invitationPreviewSchema.parse>;

/** Accepting a workspace invitation: only the invited, confirmed email can join; the page says why otherwise. */
export function InviteAccept({ token, goLogin, goSignup, onJoined }: { token: string; goLogin: () => void; goSignup: () => void; onJoined: () => void }) {
  const { status, user } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (status !== "signedIn") return;
    apiRequest("/v1/invitations/preview", invitationPreviewSchema, { method: "POST", body: { token } }).then(setPreview, (err: unknown) => setError(err instanceof Error ? err.message : "This invitation link is not valid."));
  }, [status, token]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiRequest("/v1/invitations/accept", acceptedInvitationSchema, { method: "POST", body: { token } });
      clearPending();
      selectWorkspace(r.workspaceId);
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The invitation could not be accepted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <main className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-slate-900" style={{ fontSize: 20, fontWeight: 700 }}>Workspace invitation</h1>
        {status === "loading" ? <LoadingBlock lines={2} /> : status !== "signedIn" ? (
          <div className="mt-3 space-y-3 text-sm text-slate-600">
            <p>Sign in, or create an account, with the email address the invitation was sent to. You will come back here to accept it.</p>
            <div className="flex gap-2">
              <button onClick={goLogin} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white" style={{ fontWeight: 600 }}>Sign in</button>
              <button onClick={goSignup} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700">Create account</button>
            </div>
          </div>
        ) : error && !preview ? <ErrorState title="Invitation not available" body={error} /> : !preview ? <LoadingBlock lines={2} /> : (
          <div className="mt-3 space-y-3 text-sm text-slate-600">
            <p><span className="text-slate-900" style={{ fontWeight: 600 }}>{preview.invitedBy}</span> invited <span className="font-mono">{preview.email}</span> to join <span className="text-slate-900" style={{ fontWeight: 600 }}>{preview.workspaceName}</span> as {preview.role === "admin" ? "an admin" : "a member"}.</p>
            {preview.status !== "pending" ? <p className="rounded-md bg-slate-50 px-3 py-2 text-xs">This invitation is {preview.status}. Ask for a new one.</p> : user && user.email.toLowerCase() !== preview.email ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">You are signed in as {user.email}. Only {preview.email} can accept this invitation; sign in with that address.</p>
            ) : (
              <button onClick={() => void accept()} disabled={busy} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50" style={{ fontWeight: 600 }}>{busy ? "Joining…" : `Join ${preview.workspaceName}`}</button>
            )}
            {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
          </div>
        )}
      </main>
    </div>
  );
}
