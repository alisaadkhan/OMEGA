import type { FastifyInstance } from "fastify";
import type { ErrorCode } from "@mushin/contracts";
import { AppError } from "@mushin/core";

function envelope(code: ErrorCode, message: string, requestId: string, details?: Record<string, unknown>) {
  return { error: { code, message, requestId, ...(details ? { details } : {}) } };
}

function statusOf(err: unknown): number | null {
  if (typeof err === "object" && err !== null && "statusCode" in err && typeof err.statusCode === "number") return err.statusCode;
  return null;
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      const retryAfter = err.details?.["retryAfterSeconds"];
      if (err.code === "RATE_LIMITED" && typeof retryAfter === "number") void reply.header("retry-after", String(retryAfter));
      if (err.status >= 500) req.log.error({ err }, err.message);
      return reply.status(err.status).send(envelope(err.code, err.message, req.id, err.details));
    }
    const status = statusOf(err);
    if (status !== null && status >= 400 && status < 500) {
      return reply.status(status).send(envelope("VALIDATION_FAILED", "The request could not be processed", req.id));
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send(envelope("INTERNAL", "Something went wrong. Please try again.", req.id));
  });

  app.setNotFoundHandler((req, reply) => reply.status(404).send(envelope("NOT_FOUND", "Route not found", req.id)));
}
