import type { z } from "zod";
import type { ErrorCode } from "@mushin/contracts";
import { supabase } from "../lib/supabase";
import { ApiError, readApiResponse } from "./http";
import { dropInaccessibleWorkspace, selectedWorkspace } from "./workspace";

export { ApiError };

export async function apiRequest<S extends z.ZodType>(
  path: string,
  schema: S,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<z.output<S>> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = { accept: "application/json" };
  if (data.session) headers["authorization"] = `Bearer ${data.session.access_token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
  const workspace = selectedWorkspace();
  if (workspace) headers["x-workspace-id"] = workspace;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError("NETWORK", "Can't reach the server. Check your connection and try again.", 0, null);
  }
  await guardWorkspace(res, workspace);
  return readApiResponse(res, schema);
}

/**
 * Audit SEC-04: a request must act in the workspace this tab shows. A refused workspace is forgotten and the app
 * reloads into the person's own workspace with a notice; a response from any other workspace is treated as an error.
 */
async function guardWorkspace(res: Response, selected: string | null): Promise<void> {
  if (res.status === 403) {
    const body = (await res.clone().json().catch(() => null)) as { error?: { details?: { reason?: string } } } | null;
    if (body?.error?.details?.reason === "workspace_access_denied") {
      dropInaccessibleWorkspace();
      window.location.reload();
      throw new ApiError("FORBIDDEN", "You no longer have access to that workspace.", 403, res.headers.get("x-request-id"));
    }
  }
  const actedIn = res.headers.get("x-workspace-id");
  if (selected && actedIn && actedIn !== selected) {
    throw new ApiError("CONFLICT", "This request reached a different workspace than the one on screen. Reload the page.", res.status, res.headers.get("x-request-id"));
  }
}

/** Downloads a file the API serves (for example a data export) and hands it to the browser as a save. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (data.session) headers["authorization"] = `Bearer ${data.session.access_token}`;
  const workspace = selectedWorkspace();
  if (workspace) headers["x-workspace-id"] = workspace;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { headers });
  } catch {
    throw new ApiError("NETWORK", "Can't reach the server. Check your connection and try again.", 0, null);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError((body?.error?.code ?? "INTERNAL") as ErrorCode, body?.error?.message ?? "The download failed.", res.status, null);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
