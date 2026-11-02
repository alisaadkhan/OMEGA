import { randomUUID } from "node:crypto";
import type { SearchRequest } from "@mushin/contracts";
import { sha256Hex, stableJson, type TenantContext } from "@mushin/core";
import { sql } from "drizzle-orm";
import type { Db } from "@mushin/db";
import type { BillingService } from "../billing/index";

/**
 * One logical catalogue search: the same user, text and filters within this window. Further pages, sorting, retries
 * and automatic refetches inside it are free; a different text or filter set is a new search (owner pricing 2026-10-14).
 */
export const SEARCH_CHARGE_WINDOW_MS = 30 * 60_000;

export type SearchCharge = { charged: boolean; creditsCharged: number };

/** Whitespace and case do not make a different search; the page does not either. */
export function searchChargeHash(req: Pick<SearchRequest, "text" | "filters">): string {
  return sha256Hex(stableJson({ text: req.text.trim().replace(/\s+/g, " ").toLowerCase(), filters: req.filters }));
}

/**
 * Charges the standalone catalogue search price once per logical search, with the price the user confirmed. Runs after
 * the search answered with at least one eligible creator (a search that finds none is free, owner decision 2026-10-28),
 * so a failed or empty search never costs anything; an internal lookup by Live Discovery never calls this.
 */
export async function chargeCatalogSearch(
  deps: { db: Db; billing: Pick<BillingService, "engine">; now: () => Date },
  ctx: TenantContext,
  req: Pick<SearchRequest, "text" | "filters" | "confirmedCost">,
): Promise<SearchCharge> {
  const hash = searchChargeHash(req);
  return deps.db.withTenant({ userId: ctx.userId, workspaceId: ctx.workspaceId }, async (tx) => {
    // Simultaneous identical searches wait here, so only the first one pays.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`catalog-search:${ctx.workspaceId}:${ctx.userId}:${hash}`}, 0))`);
    const since = new Date(deps.now().getTime() - SEARCH_CHARGE_WINDOW_MS).toISOString();
    const [recent] = await tx.execute<{ id: string }>(sql`
      select id from wp.catalog_search_charges
      where workspace_id = ${ctx.workspaceId} and user_id = ${ctx.userId} and search_hash = ${hash} and charged_at > ${since}::timestamptz
      limit 1`);
    if (recent) return { charged: false, creditsCharged: 0 };
    const { search_existing: price } = await deps.billing.engine.costs(tx, ["search_existing"]);
    const id = randomUUID();
    let reservationId: string | null = null;
    if (price > 0) {
      // Refuses a stale confirmed price (CONFLICT) or an empty balance (INSUFFICIENT_CREDITS) before anything is written.
      const held = await deps.billing.engine.spendInstant(
        tx,
        ctx.workspaceId,
        { action: "search_existing", confirmedCost: req.confirmedCost, refType: "catalog_search", refId: id },
        { userId: ctx.userId, requestId: ctx.requestId },
      );
      reservationId = held.reservationId;
    }
    await tx.execute(sql`
      insert into wp.catalog_search_charges (id, workspace_id, user_id, search_hash, reservation_id, credits, charged_at)
      values (${id}, ${ctx.workspaceId}, ${ctx.userId}, ${hash}, ${reservationId}, ${price}, ${deps.now().toISOString()}::timestamptz)`);
    // charged_at uses the same clock as the window check above (BUG-33): the database clock and the app clock can differ.
    return { charged: price > 0, creditsCharged: price };
  });
}

class DryRun extends Error {}

/**
 * Refuses a search the workspace could not pay for before it runs (security hardening 2026-11-03): charging only after a
 * search found creators let an account with no credits tell "matches exist" (refused) from "nothing matches" (free, empty).
 * The real charge is attempted and rolled back, so the same price and balance rules answer; a search already paid for
 * inside the window, or a free price, passes.
 */
export async function assertCanPayCatalogSearch(
  deps: { db: Db; billing: Pick<BillingService, "engine">; now: () => Date },
  ctx: TenantContext,
  req: Pick<SearchRequest, "text" | "filters" | "confirmedCost">,
): Promise<void> {
  const hash = searchChargeHash(req);
  try {
    await deps.db.withTenant({ userId: ctx.userId, workspaceId: ctx.workspaceId }, async (tx) => {
      const since = new Date(deps.now().getTime() - SEARCH_CHARGE_WINDOW_MS).toISOString();
      const [recent] = await tx.execute<{ id: string }>(sql`
        select id from wp.catalog_search_charges
        where workspace_id = ${ctx.workspaceId} and user_id = ${ctx.userId} and search_hash = ${hash} and charged_at > ${since}::timestamptz
        limit 1`);
      if (recent) throw new DryRun();
      const { search_existing: price } = await deps.billing.engine.costs(tx, ["search_existing"]);
      if (price > 0) {
        await deps.billing.engine.spendInstant(
          tx,
          ctx.workspaceId,
          { action: "search_existing", confirmedCost: req.confirmedCost, refType: "catalog_search", refId: randomUUID() },
          { userId: ctx.userId, requestId: ctx.requestId },
        );
      }
      throw new DryRun();
    });
  } catch (err) {
    if (err instanceof DryRun) return;
    throw err;
  }
}
