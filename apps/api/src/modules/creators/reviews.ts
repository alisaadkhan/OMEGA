import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { creatorReviewRequestSchema, creatorReviewResponseSchema, type CreatorReviewRequest, type CreatorReviewResponse } from "@mushin/contracts";
import { AppError, type TenantContext } from "@mushin/core";
import { creatorProfileReviews, type Db } from "@mushin/db";
import { tenantOf } from "../../auth/customer-guard";
import type { AppModule } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import { rateLimitError, type RateLimiter } from "../../rate-limit/types";

/**
 * Creator profile reviews (owner directive 2026-11-15 §3, 0090): a customer confirms a creator or flags a problem from a
 * card or the profile, in database search or Live Discovery. Only a creator customers can see may be reviewed; a
 * person's second flag on the same creator updates their open one. A confirmation is stored already resolved.
 */
export async function submitCreatorReview(db: Db, ctx: TenantContext, creatorId: string, body: CreatorReviewRequest): Promise<CreatorReviewResponse> {
  const fields = {
    platform: body.platform ?? null,
    sourceMode: body.sourceMode,
    verdict: body.verdict,
    reason: body.verdict === "invalid" ? (body.reason ?? null) : null,
    note: body.note?.trim() || null,
  };
  const status = body.verdict === "valid" ? ("resolved" as const) : ("pending" as const);
  return db.withTenant(ctx, async (tx) => {
    const visible = await tx.execute(sql`
      select 1 from gcp.creators where id = ${creatorId} and status = 'active' and not (is_minor and minor_override_by_staff_id is null)`);
    if (visible.length === 0) throw new AppError("NOT_FOUND", "Creator not found");
    const now = new Date();
    const mine = and(eq(creatorProfileReviews.workspaceId, ctx.workspaceId), eq(creatorProfileReviews.submittedBy, ctx.userId), eq(creatorProfileReviews.creatorId, creatorId), eq(creatorProfileReviews.status, "pending"));
    const update = async (id: string) => {
      await tx.update(creatorProfileReviews).set({ ...fields, status, resolvedAt: status === "resolved" ? now : null, updatedAt: now }).where(eq(creatorProfileReviews.id, id));
      return { id, status };
    };
    const [open] = await tx.select({ id: creatorProfileReviews.id }).from(creatorProfileReviews).where(mine);
    if (open) return update(open.id);
    const [row] = await tx
      .insert(creatorProfileReviews)
      .values({ workspaceId: ctx.workspaceId, submittedBy: ctx.userId, creatorId, ...fields, status, resolvedAt: status === "resolved" ? now : null })
      .onConflictDoNothing()
      .returning({ id: creatorProfileReviews.id });
    if (row) return { id: row.id, status };
    // A concurrent submission opened the flag first (one open flag per person and creator): update it instead.
    const [raced] = await tx.select({ id: creatorProfileReviews.id }).from(creatorProfileReviews).where(mine);
    if (!raced) throw new AppError("CONFLICT", "Your review could not be saved. Please try again.");
    return update(raced.id);
  });
}

const idParams = z.object({ id: z.uuid() });

export function createCreatorReviewsModule(o: { db: Db; limiter: RateLimiter }): AppModule {
  return {
    name: "creator-reviews",
    register: (app, guards) => {
      app.post("/v1/creators/:id/reviews", { preHandler: [guards.customer, guards.idempotent] }, async (req, reply) => {
        const { id } = parseInput(idParams, req.params);
        const ctx = tenantOf(req);
        const r = await o.limiter.limit("lookup", ctx.userId);
        if (!r.allowed) throw rateLimitError(r.retryAfterSeconds);
        return sendOk(reply, creatorReviewResponseSchema, await submitCreatorReview(o.db, ctx, id, parseInput(creatorReviewRequestSchema, req.body)), 201);
      });
    },
  };
}
