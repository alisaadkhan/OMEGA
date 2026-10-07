import type { ErrorCode } from "@mushin/contracts";

export type { ErrorCode };

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INSUFFICIENT_CREDITS: 402,
  FORBIDDEN: 403,
  ENTITLEMENT_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  PROVIDER_UNAVAILABLE: 503,
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppError";
    this.status = ERROR_STATUS[code];
  }
}
