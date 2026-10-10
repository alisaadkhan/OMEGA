import type { z } from "zod";
import { staffSessionResponseSchema } from "@mushin/contracts";
import { ApiError, readApiResponse } from "../api/http";

let accessToken: string | null = null;
export const setAdminToken = (t: string | null) => {
  accessToken = t;
};
export const adminToken = () => accessToken;

async function send(path: string, init: { method?: string; body?: unknown }, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  try {
    return await fetch(`/api${path}`, { method: init.method ?? "GET", headers, credentials: "same-origin", body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch {
    throw new ApiError("NETWORK", "Can't reach the server. Check your connection and try again.", 0, null);
  }
}

/** Uses the refresh cookie (httpOnly) to get a new access token; null when the session has ended. */
export async function refreshAdminSession(): Promise<z.output<typeof staffSessionResponseSchema> | null> {
  const res = await send("/admin/v1/auth/refresh", { method: "POST" }, null);
  if (res.status === 401) return null;
  const session = await readApiResponse(res, staffSessionResponseSchema);
  setAdminToken(session.accessToken);
  return session;
}

/** Staff API call with the access token; a 401 triggers one refresh and one retry. */
export async function adminRequest<S extends z.ZodType>(path: string, schema: S, init: { method?: string; body?: unknown } = {}): Promise<z.output<S>> {
  let res = await send(path, init, accessToken);
  if (res.status === 401 && (await refreshAdminSession())) res = await send(path, init, accessToken);
  return readApiResponse(res, schema);
}
