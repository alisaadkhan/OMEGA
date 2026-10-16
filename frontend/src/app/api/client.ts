import type { z } from "zod";
import { supabase } from "../lib/supabase";
import { ApiError, readApiResponse } from "./http";
import { selectedWorkspace } from "./workspace";

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
  return readApiResponse(res, schema);
}
