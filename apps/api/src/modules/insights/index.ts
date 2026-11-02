import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  analyticsWindowSchema,
  creatorViewStatsSchema,
  productReviewCreatedSchema,
  productReviewCreateSchema,
  productReviewStatusSchema,
  searchStatsSchema,
  staffProductReviewListSchema,
  staffProductReviewUpdateSchema,
  supportPerformanceSchema,
} from "@mushin/contracts";
import { AppError, type TenantContext } from "@mushin/core";
import type { Db } from "@mushin/db";
import { tenantOf } from "../../auth/customer-guard";
import type { AppModule, PreHandler } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import { recordStaffAudit, type StaffAction, type StaffPrincipal } from "../staff/index";

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({ status: productReviewStatusSchema.optional(), limit: z.coerce.number().int().min(1).max(500).default(200) });
const statsQuery = analyticsWindowSchema.extend({ limit: z.coerce.number().int().min(1).max(100).default(10) });
/** One review per person per 10 minutes: enough for a change of mind, not for flooding the staff page. */
const REVIEW_INTERVAL = "10 minutes";

const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });

/**
 * Product reviews, usage analytics and support performance (research-informed plan, Phases 11-12).
 * Customers leave a review (no email is sent for it). Staff Admin and Super Admin read reviews and the usage figures;
 * staff performance is Super Admin only. Staff reads go through security-definer functions that return no person, no
 * email and no query text (0064, 0065); every staff change is audited.
 */
export function createInsightsModule(o: { db: Db; requireStaff: (action: StaffAction) => PreHandler }): AppModule {
  const staffOf = (req: FastifyRequest): StaffPrincipal => {
    if (!req.staff) throw new AppError("UNAUTHENTICATED", "Admin authentication required");
    return req.staff;
  };
  const fn = async <T>(schema: z.ZodType<T>, query: ReturnType<typeof sql>): Promise<T> =>
    schema.parse((await o.db.withSystem((tx) => tx.execute<{ v: unknown }>(query)))[0]?.v);

  async function createReview(ctx: TenantContext, body: z.infer<typeof productReviewCreateSchema>) {
    return o.db.withTenant(tenant(ctx), async (tx) => {
      const [recent] = await tx.execute<{ n: number }>(
        sql`select count(*)::int n from wp.product_reviews where user_id = ${ctx.userId} and created_at > now() - ${REVIEW_INTERVAL}::interval`,
      );
      if ((recent?.n ?? 0) > 0) throw new AppError("RATE_LIMITED", "Thanks, we already have your review. You can leave another in a few minutes.", { retryAfterSeconds: 600 });
      const [row] = await tx.execute<{ id: string; created_at: string }>(sql`
        insert into wp.product_reviews (workspace_id, user_id, rating, comment, page)
        values (${ctx.workspaceId}, ${ctx.userId}, ${body.rating}, ${body.comment ? body.comment : null}, ${body.page ?? null})
        returning id, created_at`);
      if (!row) throw new Error("review insert returned no row");
      return { id: row.id, createdAt: new Date(row.created_at).toISOString() };
    });
  }

  function register(app: FastifyInstance, guards: { customer: PreHandler }) {
    const r = o.requireStaff;
    app.post("/v1/feedback", { preHandler: guards.customer, bodyLimit: 8_192 }, async (req, reply) =>
      sendOk(reply, productReviewCreatedSchema, await createReview(tenantOf(req), parseInput(productReviewCreateSchema, req.body)), 201),
    );

    app.get("/admin/v1/feedback", { preHandler: r("feedback.read") }, async (req, reply) => {
      const q = parseInput(listQuery, req.query);
      const reviews = await fn(staffProductReviewListSchema.shape.reviews, sql`select platform.staff_product_reviews(${q.status ?? null}, ${q.limit}) v`);
      return sendOk(reply, staffProductReviewListSchema, { reviews });
    });
    app.patch("/admin/v1/feedback/:id", { preHandler: r("feedback.review") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      const { status } = parseInput(staffProductReviewUpdateSchema, req.body);
      const p = staffOf(req);
      await o.db.withSystem(async (tx) => {
        const [row] = await tx.execute<{ ok: boolean }>(sql`select platform.staff_product_review_status(${id}, ${p.staffId}, ${status}) ok`);
        if (!row?.ok) throw new AppError("NOT_FOUND", "Review not found");
        await recordStaffAudit(tx, { staffId: p.staffId, action: "feedback.status_changed", metadata: { reviewId: id, status }, ip: req.ip ?? null, requestId: req.id });
      });
      return reply.status(204).send();
    });

    app.get("/admin/v1/analytics/creator-views", { preHandler: r("analytics.read") }, async (req, reply) => {
      const q = parseInput(statsQuery, req.query);
      return sendOk(reply, creatorViewStatsSchema, await fn(creatorViewStatsSchema, sql`select platform.staff_creator_view_stats(${q.days}, ${q.limit}) v`));
    });
    app.get("/admin/v1/analytics/searches", { preHandler: r("analytics.read") }, async (req, reply) => {
      const q = parseInput(analyticsWindowSchema, req.query);
      return sendOk(reply, searchStatsSchema, await fn(searchStatsSchema, sql`select platform.staff_search_stats(${q.days}) v`));
    });
    app.get("/admin/v1/support/performance", { preHandler: r("support.performance.read") }, async (req, reply) => {
      const q = parseInput(analyticsWindowSchema, req.query);
      return sendOk(reply, supportPerformanceSchema, await fn(supportPerformanceSchema, sql`select platform.staff_support_performance(${q.days}) v`));
    });
  }
  return { name: "insights", register };
}
