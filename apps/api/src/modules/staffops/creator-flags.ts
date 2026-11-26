import { sql } from "drizzle-orm";
import { creatorFlagListSchema, type CreatorFlagDecision } from "@mushin/contracts";
import type { z } from "zod";
import { AppError } from "@mushin/core";
import { writeOutbox, type Db } from "@mushin/db";
import { recordStaffAudit, type StaffPrincipal } from "../staff/index";

type Meta = { ip: string | null; requestId: string };

/**
 * Staff side of creator profile reviews (owner directive 2026-11-15 §3, 0090): the queue of customer flags in the
 * Catalogue review, and one-click decisions. "resolve" closes a flag fixed with the other catalogue tools (country,
 * organisation, minor); "exclude" records a staff account type (public figure, brand, …), which neither the rules nor
 * the AI review ever replace, so the creator leaves search; "dismiss" closes a flag that was wrong. Every decision is
 * audited. Staff read the tenant table only through the security-definer functions (0090).
 */
export function createCreatorFlags(deps: { db: Db }) {
  return {
    async list(q: { status: "pending" | "resolved" | "dismissed"; offset: number }): Promise<z.infer<typeof creatorFlagListSchema>> {
      const [r] = await deps.db.withSystem((tx) => tx.execute<{ data: unknown }>(sql`select platform.staff_creator_reviews(${q.status}, 50, ${q.offset}) as data`));
      return creatorFlagListSchema.parse(r?.data ?? { items: [], total: 0, counts: { pending: 0, resolved: 0, dismissed: 0 } });
    },

    async decide(staff: StaffPrincipal, id: string, body: CreatorFlagDecision, meta: Meta): Promise<{ status: "resolved" | "dismissed"; creatorId: string }> {
      const status = body.action === "dismiss" ? ("dismissed" as const) : ("resolved" as const);
      const resolution = body.action === "exclude" ? `Excluded as ${body.excludeAs}: ${body.note}` : body.note;
      return deps.db.withSystem(async (tx) => {
        const [closed] = await tx.execute<{ creator_id: string | null }>(sql`select platform.staff_close_creator_review(${id}, ${staff.staffId}, ${status}, ${resolution}) as creator_id`);
        const creatorId = closed?.creator_id ?? null;
        if (!creatorId) throw new AppError("CONFLICT", "This flag is no longer open.");
        if (body.action === "exclude") {
          await tx.execute(sql`
            update gcp.creators set account_type = ${body.excludeAs ?? null}, account_type_source = 'staff', account_type_confidence = 'high',
              account_type_evidence = left(${`Staff review of a customer flag: ${body.note}`}, 300), account_type_assessed_at = now(), updated_at = now()
            where id = ${creatorId}`);
          await writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: creatorId, workspaceId: null, payload: { creatorId }, requestId: meta.requestId });
        }
        // Auto-hidden by reports (0106) and now no report left open: dismissing the last one brings the creator back.
        const restored = body.action === "dismiss" && (await tx.execute<{ ok: boolean }>(sql`select platform.staff_restore_auto_hidden(${creatorId}) ok`))[0]?.ok === true;
        if (restored) await writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: creatorId, workspaceId: null, payload: { creatorId }, requestId: meta.requestId });
        await recordStaffAudit(tx, { staffId: staff.staffId, action: `catalogue.flag_${body.action}`, metadata: { reviewId: id, creatorId, excludeAs: body.excludeAs ?? null, note: body.note, restored }, ip: meta.ip, requestId: meta.requestId });
        return { status, creatorId };
      });
    },
  };
}
