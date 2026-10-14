import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { BillingInterval, CreditAction, PlanId } from "@mushin/contracts";
import {
  billingPayments,
  billingSchedule,
  billingSettings,
  checkouts,
  creditActionCosts,
  creditLedger,
  creditLots,
  creditReservations,
  plans,
  subscriptions,
  topupPacks,
  webhookEvents,
  type SystemTx,
  type TenantTx,
} from "@mushin/db";
import type { LedgerCursor, LotForSpend } from "./rules";

type AnyTx = TenantTx | SystemTx;

export type LotSource = (typeof creditLots.$inferSelect)["source"];
export type SettingsRow = typeof billingSettings.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type PackRow = typeof topupPacks.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type SubscriptionPatch = Partial<Omit<typeof subscriptions.$inferInsert, "workspaceId" | "createdAt" | "updatedAt">>;
export type ReservationRow = typeof creditReservations.$inferSelect;
export type CheckoutRow = typeof checkouts.$inferSelect;
export type PaymentRow = typeof billingPayments.$inferSelect;
export type LedgerInsert = typeof creditLedger.$inferInsert;
export type BillingJob = (typeof billingSchedule.$inferSelect)["job"];

/** Serializes every credit operation of one workspace until the transaction ends. */
export async function lockCredits(tx: TenantTx, workspaceId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`credits:${workspaceId}`}, 0))`);
}

// ── config ──────────────────────────────────────────────────────────────────
export async function getSettings(tx: AnyTx): Promise<SettingsRow> {
  const rows = await tx.select().from(billingSettings).limit(1);
  const row = rows[0];
  if (!row) throw new Error("platform.billing_settings has no row; run the migrations");
  return row;
}

export async function getActionCost(tx: AnyTx, action: CreditAction): Promise<number> {
  const rows = await tx.select({ credits: creditActionCosts.credits }).from(creditActionCosts).where(eq(creditActionCosts.action, action)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`no credit cost configured for ${action}`);
  return row.credits;
}

export function listActionCosts(tx: AnyTx) {
  return tx.select().from(creditActionCosts);
}

export function listPlans(tx: AnyTx): Promise<PlanRow[]> {
  return tx.select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.sortOrder));
}

export async function getPlan(tx: AnyTx, id: PlanId): Promise<PlanRow | null> {
  const rows = await tx.select().from(plans).where(eq(plans.id, id)).limit(1);
  return rows[0] ?? null;
}

export function listPacks(tx: AnyTx): Promise<PackRow[]> {
  return tx.select().from(topupPacks).where(eq(topupPacks.active, true)).orderBy(asc(topupPacks.credits));
}

export async function getPack(tx: AnyTx, id: string): Promise<PackRow | null> {
  const rows = await tx.select().from(topupPacks).where(and(eq(topupPacks.id, id), eq(topupPacks.active, true))).limit(1);
  return rows[0] ?? null;
}

export async function findPriceOwner(
  tx: AnyTx,
  priceId: string,
): Promise<{ kind: "plan"; plan: PlanRow; interval: BillingInterval } | { kind: "topup"; pack: PackRow } | null> {
  const planRows = await tx
    .select()
    .from(plans)
    .where(sql`${plans.paddlePriceIds}->>'month' = ${priceId} or ${plans.paddlePriceIds}->>'year' = ${priceId}`)
    .limit(1);
  const plan = planRows[0];
  if (plan) return { kind: "plan", plan, interval: plan.paddlePriceIds.month === priceId ? "month" : "year" };
  const packRows = await tx.select().from(topupPacks).where(eq(topupPacks.paddlePriceId, priceId)).limit(1);
  const pack = packRows[0];
  return pack ? { kind: "topup", pack } : null;
}

// ── subscriptions ───────────────────────────────────────────────────────────
export async function getSubscription(tx: TenantTx, workspaceId: string, opts: { forUpdate?: boolean } = {}): Promise<SubscriptionRow | null> {
  const base = tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
  const rows = opts.forUpdate ? await base.for("update").limit(1) : await base.limit(1);
  return rows[0] ?? null;
}

/** The API role may insert only these two columns; status defaults to 'trialing' (migration 0005). */
export async function insertTrialSubscription(tx: TenantTx, workspaceId: string, trialEndsAt: Date): Promise<boolean> {
  const rows = await tx.execute<{ workspace_id: string }>(sql`
    insert into wp.subscriptions (workspace_id, trial_ends_at) values (${workspaceId}, ${trialEndsAt.toISOString()}::timestamptz)
    on conflict (workspace_id) do nothing
    returning workspace_id`);
  return rows.length === 1;
}

export async function upsertSubscription(tx: TenantTx, workspaceId: string, patch: SubscriptionPatch & { status: SubscriptionRow["status"] }): Promise<void> {
  await tx
    .insert(subscriptions)
    .values({ workspaceId, ...patch })
    .onConflictDoUpdate({ target: subscriptions.workspaceId, set: patch });
}

export async function updateSubscription(tx: TenantTx, workspaceId: string, patch: SubscriptionPatch): Promise<void> {
  await tx.update(subscriptions).set(patch).where(eq(subscriptions.workspaceId, workspaceId));
}

// ── lots ────────────────────────────────────────────────────────────────────
export async function sumRemaining(tx: TenantTx, workspaceId: string, now: Date, sources: readonly LotSource[] | "all"): Promise<number> {
  const rows = await tx
    .select({ total: sql<number>`coalesce(sum(${creditLots.remaining}), 0)::int` })
    .from(creditLots)
    .where(
      and(
        eq(creditLots.workspaceId, workspaceId),
        gt(creditLots.remaining, 0),
        or(isNull(creditLots.expiresAt), gt(creditLots.expiresAt, now)),
        sources === "all" ? undefined : inArray(creditLots.source, [...sources]),
      ),
    );
  return rows[0]?.total ?? 0;
}

export async function lotsValidAt(tx: TenantTx, workspaceId: string, at: Date, scope: "all" | "topup_only"): Promise<LotForSpend[]> {
  return tx
    .select({ id: creditLots.id, remaining: creditLots.remaining, expiresAt: creditLots.expiresAt })
    .from(creditLots)
    .where(
      and(
        eq(creditLots.workspaceId, workspaceId),
        gt(creditLots.remaining, 0),
        or(isNull(creditLots.expiresAt), gt(creditLots.expiresAt, at)),
        scope === "topup_only" ? eq(creditLots.source, "topup") : undefined,
      ),
    );
}

export async function insertLot(
  tx: TenantTx,
  l: { workspaceId: string; source: LotSource; amount: number; expiresAt: Date | null; paymentId: string | null },
): Promise<string> {
  const rows = await tx.insert(creditLots).values({ ...l, remaining: l.amount }).returning({ id: creditLots.id });
  const id = rows[0]?.id;
  if (!id) throw new Error("credit lot insert returned no id");
  return id;
}

export async function takeFromLot(tx: TenantTx, lotId: string, take: number): Promise<void> {
  const rows = await tx
    .update(creditLots)
    .set({ remaining: sql`${creditLots.remaining} - ${take}` })
    .where(and(eq(creditLots.id, lotId), sql`${creditLots.remaining} >= ${take}`))
    .returning({ id: creditLots.id });
  if (rows.length !== 1) throw new Error(`credit lot ${lotId} cannot cover ${take} credits`);
}

export function expiredLots(tx: TenantTx, workspaceId: string, now: Date): Promise<{ id: string; remaining: number }[]> {
  return tx
    .select({ id: creditLots.id, remaining: creditLots.remaining })
    .from(creditLots)
    .where(and(eq(creditLots.workspaceId, workspaceId), gt(creditLots.remaining, 0), lte(creditLots.expiresAt, now)));
}

export async function zeroLot(tx: TenantTx, lotId: string): Promise<void> {
  await tx.update(creditLots).set({ remaining: 0 }).where(eq(creditLots.id, lotId));
}

/** Moves the expiry of a source's unexpired lots to `at` (the expiry job then writes the ledger rows). */
export async function endLotsOfSource(tx: TenantTx, workspaceId: string, source: LotSource, at: Date): Promise<void> {
  await tx
    .update(creditLots)
    .set({ expiresAt: at })
    .where(and(eq(creditLots.workspaceId, workspaceId), eq(creditLots.source, source), gt(creditLots.remaining, 0), gt(creditLots.expiresAt, at)));
}

export async function hasGrant(tx: TenantTx, workspaceId: string, sourceRef: string): Promise<boolean> {
  const rows = await tx
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(and(eq(creditLedger.workspaceId, workspaceId), eq(creditLedger.kind, "grant"), eq(creditLedger.sourceRef, sourceRef)))
    .limit(1);
  return rows.length === 1;
}

export async function insertLedger(tx: TenantTx, rows: LedgerInsert[]): Promise<void> {
  if (rows.length > 0) await tx.insert(creditLedger).values(rows);
}

export async function lotLedgerMismatches(tx: TenantTx, workspaceId: string): Promise<{ lotId: string; remaining: number; ledgerSum: number }[]> {
  const rows = await tx.execute<{ lot_id: string; remaining: number; ledger_sum: number }>(sql`
    select l.id as lot_id, l.remaining, coalesce(sum(e.amount), 0)::int as ledger_sum
    from wp.credit_lots l left join wp.credit_ledger e on e.lot_id = l.id
    where l.workspace_id = ${workspaceId}
    group by l.id, l.remaining
    having l.remaining <> coalesce(sum(e.amount), 0)`);
  return rows.map((r) => ({ lotId: r.lot_id, remaining: r.remaining, ledgerSum: r.ledger_sum }));
}

// ── reservations ────────────────────────────────────────────────────────────
export async function sumHeld(tx: TenantTx, workspaceId: string): Promise<number> {
  const rows = await tx
    .select({ total: sql<number>`coalesce(sum(${creditReservations.amount}), 0)::int` })
    .from(creditReservations)
    .where(and(eq(creditReservations.workspaceId, workspaceId), eq(creditReservations.status, "held")));
  return rows[0]?.total ?? 0;
}

export async function insertReservation(tx: TenantTx, r: typeof creditReservations.$inferInsert): Promise<ReservationRow> {
  const rows = await tx.insert(creditReservations).values(r).returning();
  const row = rows[0];
  if (!row) throw new Error("reservation insert returned no row");
  return row;
}

export async function getReservationForUpdate(tx: TenantTx, workspaceId: string, id: string): Promise<ReservationRow | null> {
  const rows = await tx
    .select()
    .from(creditReservations)
    .where(and(eq(creditReservations.workspaceId, workspaceId), eq(creditReservations.id, id)))
    .for("update")
    .limit(1);
  return rows[0] ?? null;
}

/** Guarded held → final transition; false if the reservation was no longer held. */
export async function finishReservation(tx: TenantTx, id: string, status: "committed" | "released" | "expired", at: Date): Promise<boolean> {
  const rows = await tx
    .update(creditReservations)
    .set(status === "committed" ? { status, committedAt: at } : { status, releasedAt: at })
    .where(and(eq(creditReservations.id, id), eq(creditReservations.status, "held")))
    .returning({ id: creditReservations.id });
  return rows.length === 1;
}

export async function extendReservation(tx: TenantTx, workspaceId: string, id: string, until: Date): Promise<boolean> {
  const rows = await tx
    .update(creditReservations)
    .set({ expiresAt: until })
    .where(and(eq(creditReservations.workspaceId, workspaceId), eq(creditReservations.id, id), eq(creditReservations.status, "held")))
    .returning({ id: creditReservations.id });
  return rows.length === 1;
}

export function abandonedReservations(tx: TenantTx, workspaceId: string, now: Date): Promise<ReservationRow[]> {
  return tx
    .select()
    .from(creditReservations)
    .where(and(eq(creditReservations.workspaceId, workspaceId), eq(creditReservations.status, "held"), lte(creditReservations.expiresAt, now)));
}

export async function countHeld(tx: TenantTx, workspaceId: string): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(creditReservations)
    .where(and(eq(creditReservations.workspaceId, workspaceId), eq(creditReservations.status, "held")));
  return rows[0]?.n ?? 0;
}

// ── ledger history, payments, checkouts ────────────────────────────────────
export function ledgerPage(tx: TenantTx, workspaceId: string, cursor: LedgerCursor | null, limit: number) {
  return tx
    .select({
      id: creditLedger.id,
      kind: creditLedger.kind,
      amount: creditLedger.amount,
      action: creditLedger.action,
      note: creditLedger.note,
      createdAt: creditLedger.createdAt,
      cursorAt: sql<string>`to_char(${creditLedger.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      lotSource: creditLots.source,
    })
    .from(creditLedger)
    .leftJoin(creditLots, eq(creditLots.id, creditLedger.lotId))
    .where(
      and(
        eq(creditLedger.workspaceId, workspaceId),
        cursor
          ? sql`(${creditLedger.createdAt}, ${creditLedger.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(limit + 1);
}

export async function insertPayment(tx: TenantTx, p: typeof billingPayments.$inferInsert): Promise<string | null> {
  const rows = await tx
    .insert(billingPayments)
    .values(p)
    .onConflictDoNothing({ target: billingPayments.paddleTransactionId })
    .returning({ id: billingPayments.id });
  return rows[0]?.id ?? null;
}

export function listPayments(tx: TenantTx, workspaceId: string): Promise<PaymentRow[]> {
  return tx.select().from(billingPayments).where(eq(billingPayments.workspaceId, workspaceId)).orderBy(desc(billingPayments.createdAt)).limit(24);
}

export async function insertCheckout(tx: TenantTx, c: typeof checkouts.$inferInsert): Promise<CheckoutRow> {
  const rows = await tx.insert(checkouts).values(c).returning();
  const row = rows[0];
  if (!row) throw new Error("checkout insert returned no row");
  return row;
}

export async function setCheckoutProvider(tx: TenantTx, workspaceId: string, id: string, providerCheckoutId: string, hostedUrl: string): Promise<void> {
  await tx.update(checkouts).set({ providerCheckoutId, hostedUrl }).where(and(eq(checkouts.workspaceId, workspaceId), eq(checkouts.id, id)));
}

export async function setCheckoutStatus(tx: TenantTx, workspaceId: string, id: string, status: "paid" | "failed" | "expired"): Promise<boolean> {
  const rows = await tx
    .update(checkouts)
    .set({ status })
    .where(and(eq(checkouts.workspaceId, workspaceId), eq(checkouts.id, id), eq(checkouts.status, "open")))
    .returning({ id: checkouts.id });
  return rows.length === 1;
}

/** Mock checkout pages carry the workspace id in their URL, so this lookup stays workspace-scoped (SRS §2.5). */
export async function getCheckout(tx: TenantTx, workspaceId: string, id: string): Promise<CheckoutRow | null> {
  const rows = await tx.select().from(checkouts).where(and(eq(checkouts.workspaceId, workspaceId), eq(checkouts.id, id))).limit(1);
  return rows[0] ?? null;
}

// ── webhooks ────────────────────────────────────────────────────────────────
export async function insertWebhookEvent(
  tx: SystemTx,
  e: { provider: string; providerEventId: string; eventType: string; payload: unknown },
): Promise<string | null> {
  const rows = await tx
    .insert(webhookEvents)
    .values(e)
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.providerEventId] })
    .returning({ id: webhookEvents.id });
  return rows[0]?.id ?? null;
}

export async function getWebhookEvent(tx: SystemTx, id: string) {
  const rows = await tx.select().from(webhookEvents).where(eq(webhookEvents.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function markWebhook(tx: SystemTx, id: string, error: string | null): Promise<void> {
  await tx
    .update(webhookEvents)
    .set(error ? { error: error.slice(0, 1000) } : { processedAt: sql`now()`, error: null })
    .where(eq(webhookEvents.id, id));
}

// ── due-work index (platform.billing_schedule holds workspace ids and times only) ──
/** Records that `job` should visit this workspace at `dueAt`; an earlier existing due time is kept. */
export async function scheduleJob(tx: TenantTx, workspaceId: string, job: BillingJob, dueAt: Date): Promise<void> {
  await tx.execute(sql`
    insert into platform.billing_schedule (workspace_id, job, due_at) values (${workspaceId}, ${job}, ${dueAt.toISOString()}::timestamptz)
    on conflict (workspace_id, job) do update set due_at = least(platform.billing_schedule.due_at, excluded.due_at)`);
}

/** Replaces the next due time after a job has run; null means there is nothing left to do. */
export async function setNextDue(tx: TenantTx, workspaceId: string, job: BillingJob, dueAt: Date | null): Promise<void> {
  if (dueAt === null) {
    await tx.delete(billingSchedule).where(and(eq(billingSchedule.workspaceId, workspaceId), eq(billingSchedule.job, job)));
    return;
  }
  await tx
    .insert(billingSchedule)
    .values({ workspaceId, job, dueAt })
    .onConflictDoUpdate({ target: [billingSchedule.workspaceId, billingSchedule.job], set: { dueAt } });
}

/** Workspaces a job must visit now. Reads only the platform index, never workspace tables. */
export async function dueWorkspaces(tx: SystemTx, job: BillingJob, now: Date, limit = 500): Promise<string[]> {
  const rows = await tx
    .select({ id: billingSchedule.workspaceId })
    .from(billingSchedule)
    .where(and(eq(billingSchedule.job, job), lte(billingSchedule.dueAt, now)))
    .orderBy(asc(billingSchedule.dueAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function earliestHeldExpiry(tx: TenantTx, workspaceId: string): Promise<Date | null> {
  const rows = await tx
    .select({ at: sql<string | null>`min(${creditReservations.expiresAt})` })
    .from(creditReservations)
    .where(and(eq(creditReservations.workspaceId, workspaceId), eq(creditReservations.status, "held")));
  const at = rows[0]?.at;
  return at ? new Date(at) : null;
}

export async function earliestLotExpiry(tx: TenantTx, workspaceId: string): Promise<Date | null> {
  const rows = await tx
    .select({ at: sql<string | null>`min(${creditLots.expiresAt})` })
    .from(creditLots)
    .where(and(eq(creditLots.workspaceId, workspaceId), gt(creditLots.remaining, 0)));
  const at = rows[0]?.at;
  return at ? new Date(at) : null;
}

// ── plan limits ─────────────────────────────────────────────────────────────
export async function incrementUsage(
  tx: TenantTx,
  workspaceId: string,
  key: "audience_views" | "outreach_emails",
  periodStart: string,
  limit: number | null,
): Promise<boolean> {
  if (limit === 0) return false;
  const rows = await tx.execute<{ count: number }>(sql`
    insert into wp.entitlement_usage (workspace_id, key, period_start, count)
    values (${workspaceId}, ${key}, ${periodStart}::date, 1)
    on conflict (workspace_id, key, period_start) do update
      set count = wp.entitlement_usage.count + 1
      where ${limit}::int is null or wp.entitlement_usage.count < ${limit}::int
    returning count`);
  return rows.length === 1;
}
