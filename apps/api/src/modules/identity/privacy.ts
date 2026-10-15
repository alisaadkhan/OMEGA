import { sql } from "drizzle-orm";
import { AppError, type TenantContext } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { CustomerIdentity } from "../../auth/customer-token";

/** Workspace tables in an export, read through the tenant role (row-level security keeps them to this workspace). */
const EXPORT_TABLES = [
  "lists", "list_members", "campaigns", "campaign_creators", "outreach_events", "saved_searches", "support_tickets", "support_messages",
  "discovery_jobs", "discovery_results", "contact_reveals", "audience_views", "catalog_search_charges", "subscriptions", "payments", "credit_lots", "credit_ledger",
] as const;
/** Stated to the customer after a deletion; the retention period itself is an open owner decision. */
const RETAINED = [
  "Billing records (subscription, payments, credit lots and ledger) are kept for accounting until MUSHIN's retention period ends.",
  "MUSHIN's internal staff audit log keeps a record of staff actions that involved this workspace.",
];

/**
 * Customer privacy self-service (readiness H8): an export of the workspace's own data, workspace deletion and account
 * deletion. Revealed contact values are not exported (they are third parties' data); staff-only notes never are.
 */
export function createPrivacyService(deps: { db: Db; onWorkspaceErased?: (workspaceId: string) => Promise<void>; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });

  /** Refuses deletion while money or work is in flight: a paid subscription, a running job or held credits. */
  async function assertDeletable(ctx: TenantContext) {
    const [r] = await deps.db.withTenant(tenant(ctx), (tx) =>
      tx.execute<{ sub: string | null; jobs: number; held: number }>(sql`select
        (select status from wp.subscriptions where workspace_id = ${ctx.workspaceId} order by created_at desc limit 1) sub,
        (select count(*)::int from wp.discovery_jobs where workspace_id = ${ctx.workspaceId} and status in ('queued', 'running')) jobs,
        (select count(*)::int from wp.credit_reservations where workspace_id = ${ctx.workspaceId} and status = 'held') held`),
    );
    if (r?.sub === "active" || r?.sub === "past_due") throw new AppError("CONFLICT", "Cancel the paid subscription first (Billing). The workspace can be deleted once it has ended.", { reason: "subscription_active" });
    if ((r?.jobs ?? 0) > 0 || (r?.held ?? 0) > 0) throw new AppError("CONFLICT", "A run is still in progress. Wait for it to finish, then delete the workspace.", { reason: "work_in_progress" });
  }

  async function erase(workspaceId: string) {
    const [r] = await deps.db.withSystem((tx) => tx.execute<{ v: Record<string, number> }>(sql`select platform.erase_workspace(${workspaceId}) v`));
    await deps.onWorkspaceErased?.(workspaceId);
    return r?.v ?? {};
  }

  return {
    async exportWorkspace(ctx: TenantContext) {
      if (ctx.role !== "owner" && ctx.role !== "admin") throw new AppError("FORBIDDEN", "Only the workspace owner or an admin can export the workspace.");
      return deps.db.withTenant(tenant(ctx), async (tx) => {
        const [w] = await tx.execute<{ id: string; name: string; created_at: string }>(sql`select id, name, created_at from wp.workspaces where id = ${ctx.workspaceId}`);
        if (!w) throw new AppError("NOT_FOUND", "Workspace not found");
        const tables: Record<string, Record<string, unknown>[]> = {};
        tables["members"] = [...(await tx.execute<Record<string, unknown>>(sql`select id, display_name, email, role, joined_at from platform.workspace_people()`))];
        for (const t of EXPORT_TABLES) tables[t] = [...(await tx.execute<Record<string, unknown>>(sql`select * from ${sql.identifier("wp")}.${sql.identifier(t)} where workspace_id = ${ctx.workspaceId} limit 50000`))];
        return {
          format: "mushin.workspace-export.v1" as const,
          exportedAt: now().toISOString(),
          workspace: { id: w.id, name: w.name, createdAt: new Date(w.created_at).toISOString() },
          tables,
          notes: [
            "Creator profiles are MUSHIN's public catalogue and are referenced by id; they are not part of your workspace data.",
            "Contact details you revealed are not included: they belong to the creators. You can still see them in the app.",
          ],
        };
      });
    },

    /** Owner only, with the workspace name typed to confirm. */
    async deleteWorkspace(ctx: TenantContext, confirmName: string) {
      if (ctx.role !== "owner") throw new AppError("FORBIDDEN", "Only the workspace owner can delete the workspace.");
      const [w] = await deps.db.withTenant(tenant(ctx), (tx) => tx.execute<{ name: string }>(sql`select name from wp.workspaces where id = ${ctx.workspaceId}`));
      if (!w || w.name !== confirmName.trim()) throw new AppError("VALIDATION_FAILED", "Type the workspace name exactly to confirm.", { field: "confirmName" });
      await assertDeletable(ctx);
      await erase(ctx.workspaceId);
      return { deleted: true as const, retained: RETAINED };
    },

    /**
     * Deletes the signed-in person's account. Refused while they own a workspace that still has other members (ownership
     * moves first) or own one with a paid subscription. The sign-in identity is held by the identity provider; removing
     * it there needs the provider's admin access, which this deployment does not hold, so it is reported, not claimed.
     */
    async deleteAccount(ctx: TenantContext, identity: CustomerIdentity, confirmEmail: string) {
      if (confirmEmail !== identity.email) throw new AppError("VALIDATION_FAILED", "Type your account email exactly to confirm.", { field: "confirmEmail" });
      if (ctx.role === "owner") await assertDeletable(ctx);
      const [r] = await deps.db.withSystem((tx) => tx.execute<{ v: { deleted: boolean; reason?: string; erasedWorkspaces?: string[] } }>(sql`select platform.delete_account(${ctx.userId}) v`));
      if (!r?.v.deleted) {
        throw new AppError("CONFLICT", r?.v.reason === "subscription_active" ? "A workspace you own still has a paid subscription. Cancel it first (Billing)." : "You own a workspace that other people still use. Transfer ownership first (Settings › Workspace & team).", { reason: r?.v.reason ?? "refused" });
      }
      for (const id of r.v.erasedWorkspaces ?? []) await deps.onWorkspaceErased?.(id);
      return { deleted: true as const, retained: RETAINED, identityProviderAccount: "not_deleted_requires_provider" as const };
    },
  };
}

export type PrivacyService = ReturnType<typeof createPrivacyService>;
