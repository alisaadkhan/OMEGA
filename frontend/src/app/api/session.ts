/**
 * Session expiry (FRONTEND_REQUIREMENTS AUTH-08): when a session ends without the person signing out (refresh token
 * expired, or the API refused the token), the sign-in page says so, and after signing in again the person returns to
 * the dashboard page they were on. Kept in sessionStorage: this tab only, gone when the tab closes.
 */
const EXPIRED = "mushin.session-expired";
const CURRENT_VIEW = "mushin.current-view";
const RETURN_VIEW = "mushin.return-view";

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // storage blocked: the notice is a convenience, never required
  }
}

/** The dashboard page on screen now (written on every navigation). */
export function rememberCurrentView(view: string): void {
  store()?.setItem(CURRENT_VIEW, view);
}

/** The session ended on its own: show the notice, and come back to the page that was open. */
export function markSessionExpired(): void {
  const s = store();
  if (!s) return;
  s.setItem(EXPIRED, "1");
  const view = s.getItem(CURRENT_VIEW);
  if (view) s.setItem(RETURN_VIEW, view);
}

/** True once after an expiry (the sign-in page shows the notice and clears it). */
export function takeSessionExpired(): boolean {
  const s = store();
  if (!s || s.getItem(EXPIRED) !== "1") return false;
  s.removeItem(EXPIRED);
  return true;
}

/** The page to reopen after signing in again following an expiry; null otherwise. Read once. */
export function takeReturnView<V extends string>(allowed: readonly V[]): V | null {
  const s = store();
  const v = s?.getItem(RETURN_VIEW) ?? null;
  s?.removeItem(RETURN_VIEW);
  return v && (allowed as readonly string[]).includes(v) ? (v as V) : null;
}

/** A sign-out the person asked for: no notice and no return page. */
export function clearSessionNotice(): void {
  const s = store();
  s?.removeItem(EXPIRED);
  s?.removeItem(RETURN_VIEW);
}
