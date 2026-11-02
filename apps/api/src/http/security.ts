import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";

export async function registerSecurity(app: FastifyInstance, allowedOrigins: string[]): Promise<void> {
  // The API answers JSON only: nothing may be framed, run or loaded from its responses (pre-deploy check 2026-10-28).
  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
    frameguard: { action: "deny" },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
  });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["authorization", "content-type", "idempotency-key", "x-request-id", "x-workspace-id"],
    exposedHeaders: ["x-request-id", "retry-after", "idempotent-replayed", "x-workspace-id"],
  });
}
