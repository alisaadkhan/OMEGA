import { errorEnvelopeSchema, type ErrorCode } from "@mushin/contracts";
import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | "NETWORK",
    message: string,
    readonly status: number,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function readApiResponse<S extends z.ZodType>(res: Response, schema: S): Promise<z.output<S>> {
  const text = await res.text();
  const body = text ? parseJson(text) : null;
  if (!res.ok) {
    const envelope = errorEnvelopeSchema.safeParse(body);
    if (envelope.success) {
      const e = envelope.data.error;
      throw new ApiError(e.code, e.message, res.status, e.requestId);
    }
    throw new ApiError("INTERNAL", `Unexpected server response (${res.status}). Please try again.`, res.status, res.headers.get("x-request-id"));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError("INTERNAL", "Unexpected response from the server.", res.status, res.headers.get("x-request-id"));
  return parsed.data;
}
