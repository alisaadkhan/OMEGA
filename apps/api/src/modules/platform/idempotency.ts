import type { FastifyInstance } from "fastify";
import { AppError, sha256Hex } from "@mushin/core";
import type { Db } from "@mushin/db";
import { tenantOf } from "../../auth/customer-guard";
import type { PreHandler } from "../../http/types";
import * as repo from "./repository";

declare module "fastify" {
  interface FastifyRequest {
    idempotency: { workspaceId: string; key: string } | null;
  }
}

const KEY = /^[A-Za-z0-9._:-]{8,200}$/;

/** The serialized response body as JSON for replay, or `ok: false` when it is not JSON (text, buffers, streams). */
export function storableBody(payload: unknown): { ok: true; body: unknown } | { ok: false } {
  if (payload === null || payload === undefined || payload === "") return { ok: true, body: null };
  if (typeof payload !== "string") return { ok: false };
  try {
    return { ok: true, body: JSON.parse(payload) as unknown };
  } catch {
    return { ok: false };
  }
}

export function createIdempotency(db: Db, ttlHours: number) {
  const requireIdempotencyKey: PreHandler = async (req, reply) => {
    const tenant = tenantOf(req);
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !KEY.test(key)) {
      throw new AppError("VALIDATION_FAILED", "Idempotency-Key header is required (8-200 characters: letters, digits, . _ : -)");
    }
    const hash = sha256Hex(JSON.stringify({ method: req.method, route: req.routeOptions.url, body: req.body ?? null }));
    const outcome = await db.withSystem((tx) => repo.claimKey(tx, { workspaceId: tenant.workspaceId, key, hash, ttlHours }));
    if (outcome.kind === "mismatch") throw new AppError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different request");
    if (outcome.kind === "in_progress") throw new AppError("CONFLICT", "A request with this Idempotency-Key is still being processed");
    if (outcome.kind === "replay") {
      void reply.header("idempotent-replayed", "true");
      return reply.status(outcome.status).send(outcome.body);
    }
    req.idempotency = { workspaceId: tenant.workspaceId, key };
    return undefined;
  };

  function register(app: FastifyInstance) {
    app.decorateRequest("idempotency", null);
    app.addHook("onSend", async (req, reply, payload) => {
      const claim = req.idempotency;
      if (!claim) return payload;
      req.idempotency = null;
      if (reply.statusCode >= 500) {
        await db.withSystem((tx) => repo.releaseKey(tx, claim));
        return payload;
      }
      const stored = storableBody(payload);
      if (!stored.ok) {
        // Cannot replay this body faithfully: free the key rather than fail a request whose work already ran.
        req.log.warn({ route: req.routeOptions.url }, "idempotent response is not JSON; key released instead of stored");
        await db.withSystem((tx) => repo.releaseKey(tx, claim));
        return payload;
      }
      await db.withSystem((tx) => repo.storeResponse(tx, { ...claim, status: reply.statusCode, body: stored.body }));
      return payload;
    });
  }

  return { requireIdempotencyKey, register };
}
