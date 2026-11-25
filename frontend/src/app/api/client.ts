import type { z } from "zod";
import { supabase } from "../lib/supabase";
import { ApiError, readApiResponse } from "./http";
import { markSessionExpired } from "./session";
import { dropInaccessibleWorkspace, selectedWorkspace } from "./workspace";

export { ApiError };

export async function apiRequest<S extends z.ZodType>(
  path: string,
  schema: S,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<z.output<S>> {
  const { data } = await supabase.auth.getSession();
  const send = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (token) headers["authorization"] = `Bearer ${token}`;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
    if (workspace) headers["x-workspace-id"] = workspace;
    try {
      return await fetch(`/api${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    } catch {
      throw new ApiError("NETWORK", "Can't reach the server. Check your connection and try again.", 0, null);
    }
  };
  const workspace = selectedWorkspace();
  let res = await send(data.session?.access_token ?? null);
  // A refused token is usually only an hour-old access token whose background refresh was late (a sleeping laptop, a
  // throttled background tab): refresh once and retry. People stay signed in until they sign out (owner, 25 Nov); only
  // a refresh the Auth server refuses (signed out elsewhere, account removed) ends the session (AUTH-08).
  if (res.status === 401 && data.session) {
    const refreshed = await supabase.auth.refreshSession().catch(() => null);
    const token = refreshed?.data.session?.access_token;
    if (token) res = await send(token);
    if (!token || res.status === 401) {
      markSessionExpired();
      void supabase.auth.signOut({ scope: "local" });
    }
  }
  await guardWorkspace(res, workspace);
  return readApiResponse(res, schema);
}

/**
 * Audit SEC-04: a request must act in the workspace this tab shows. A refused workspace is forgotten and the app
 * reloads into the person's own workspace with a notice; a response from any other workspace is treated as an error.
 */
/** Dispatched on window when the API asks for the second sign-in step. */
export const TWO_STEP_REQUIRED_EVENT = "mushin:two-step-required";

async function guardWorkspace(res: Response, selected: string | null): Promise<void> {
  if (res.status === 403) {
    const body = (await res.clone().json().catch(() => null)) as { error?: { details?: { reason?: string } } } | null;
    if (body?.error?.details?.reason === "workspace_access_denied") {
      dropInaccessibleWorkspace();
      window.location.reload();
      throw new ApiError("FORBIDDEN", "You no longer have access to that account.", 403, res.headers.get("x-request-id"));
    }
    // Two-step sign-in (0091): the session has not passed the second step; the app shows the code screen.
    if (body?.error?.details?.reason === "two_step_required") {
      window.dispatchEvent(new Event(TWO_STEP_REQUIRED_EVENT));
      throw new ApiError("FORBIDDEN", "Enter the code from your authenticator app to finish signing in.", 403, res.headers.get("x-request-id"));
    }
    // Mandatory email verification (0089): the API serves nothing before the Auth server confirms the address.
    if (body?.error?.details?.reason === "email_not_verified") {
      void supabase.auth.signOut({ scope: "local" });
      window.location.hash = "/login";
      throw new ApiError("FORBIDDEN", "Please confirm your email address first: open the link we sent you, then sign in again.", 403, res.headers.get("x-request-id"));
    }
  }
  const actedIn = res.headers.get("x-workspace-id");
  if (selected && actedIn && actedIn !== selected) {
    throw new ApiError("CONFLICT", "This request reached a different account than the one on screen. Reload the page.", res.status, res.headers.get("x-request-id"));
  }
}
