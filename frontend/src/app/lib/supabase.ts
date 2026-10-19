import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !key) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set in the repo-root .env");
}

/**
 * PKCE flow (audit UX-02): email links (sign-up confirmation, password recovery) come back with `?code=` in the query
 * string, which the client exchanges for a session. The implicit flow put tokens in the URL fragment, which collided with
 * the `#/` router and left recovery links on a broken page.
 */
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

/**
 * Which kind of email link this browser asked for last (gap UX-08). A failed link comes back with only an error in the
 * address, so this picks the screen that explains it: sign-up confirmation or password reset (the default).
 */
const LINK_KIND_KEY = "mushin.emailLink";
export function rememberEmailLink(kind: "signup" | "recovery") {
  try {
    localStorage.setItem(LINK_KIND_KEY, kind);
  } catch {
    // storage blocked: failed links fall back to the password-reset screen
  }
}
function emailLinkRoute(): string {
  try {
    return localStorage.getItem(LINK_KIND_KEY) === "signup" ? "#/confirmed" : "#/reset-password";
  } catch {
    return "#/reset-password";
  }
}

/**
 * Removes the one-time code or error from the address bar once the client has read it, keeping the `#/` route. A link
 * that failed (expired, already used) comes back with the error in the fragment instead (`#error=…`), which replaces the
 * route; that case is sent to the screen that explains it and offers a new link.
 */
export function linkResultFromUrl(): { error: string | null } {
  if (typeof window === "undefined") return { error: null };
  const message = (e: string | null) => (e ? `${e}. Request a new link to continue.` : "This link has expired or was already used. Request a new link to continue.");
  const fragment = window.location.hash.replace(/^#/, "");
  if (/^(error|error_code|error_description)=/.test(fragment)) {
    const error = new URLSearchParams(fragment).get("error_description");
    // No reload (the error is in the query string too): rewrite the address, then tell the router.
    window.history.replaceState(null, "", `${window.location.pathname}${emailLinkRoute()}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return { error: message(error) };
  }
  const q = new URLSearchParams(window.location.search);
  if (!q.has("code") && !q.has("error") && !q.has("error_description")) return { error: null };
  const error = q.has("error") || q.has("error_description") ? message(q.get("error_description")) : null;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
  return { error };
}
