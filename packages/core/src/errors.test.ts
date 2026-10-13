import { describe, expect, it } from "vitest";
import { AppError, ERROR_STATUS } from "./errors";

describe("AppError", () => {
  it("maps every code to the spec's HTTP status", () => {
    expect(ERROR_STATUS).toEqual({
      VALIDATION_FAILED: 400,
      QUERY_TOO_BROAD: 422,
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
    });
  });

  it("carries code, status, details and cause", () => {
    const cause = new Error("root");
    const err = new AppError("CONFLICT", "Already exists", { field: "email" }, { cause });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("CONFLICT");
    expect(err.status).toBe(409);
    expect(err.details).toEqual({ field: "email" });
    expect(err.cause).toBe(cause);
  });
});
