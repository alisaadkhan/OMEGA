import type { FastifyReply } from "fastify";
import type { z } from "zod";
import { AppError } from "@mushin/core";

export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError("VALIDATION_FAILED", "Request validation failed", {
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

/** Serializes through the response schema; a mismatch is a server bug and becomes a 500. */
export function sendOk<S extends z.ZodType>(reply: FastifyReply, schema: S, body: z.input<S>, status = 200): FastifyReply {
  return reply.status(status).send(schema.parse(body));
}
