import type { FastifyInstance } from "fastify";
import { AppError, createLogger, type Logger } from "@mushin/core";
import { buildApp, type AppDeps } from "../app";
import type { Guards } from "../http/types";

export function testLogger(): Logger {
  return createLogger({ level: "silent" });
}

export function noGuards(): Guards {
  const deny = async () => {
    throw new AppError("UNAUTHENTICATED", "Authentication required");
  };
  return { customer: deny, idempotent: deny };
}

export function buildTestApp(partial: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  return buildApp({
    logger: testLogger(),
    allowedOrigins: ["http://localhost:5173"],
    guards: noGuards(),
    modules: [],
    readiness: [],
    ...partial,
  });
}
