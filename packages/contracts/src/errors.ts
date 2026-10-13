import { z } from "zod";

export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "QUERY_TOO_BROAD",
  "UNAUTHENTICATED",
  "INSUFFICIENT_CREDITS",
  "FORBIDDEN",
  "ENTITLEMENT_REQUIRED",
  "NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "RATE_LIMITED",
  "INTERNAL",
  "PROVIDER_UNAVAILABLE",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
