import type { FastifyInstance, FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from "fastify";

export type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export type Guards = { customer: PreHandler; idempotent: PreHandler };
export type AppModule = { name: string; register(app: FastifyInstance, guards: Guards): void };
export type ReadinessCheck = { name: string; check: () => Promise<"ok" | "skipped"> };
export type OnRequestHook = onRequestAsyncHookHandler;
