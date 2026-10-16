import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Invitation } from "@mushin/contracts";
import { AppError, type TenantContext } from "@mushin/core";
import { workspaceInvitations, workspaceMembers, workspaces, type Db } from "@mushin/db";
import { EmailCheckUnavailable, type VerifyEmail } from "../../auth/auth-admin";
import type { CustomerIdentity } from "../../auth/customer-token";

const INVITE_DAYS = 7;
const MAX_PENDING = 50;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Workspace team management (readiness H7): invitations by email, role changes, removal, leaving and ownership
 * transfer. Roles: the owner manages everything; an admin invites and removes members only; a member can leave.
 * There is no seat limit in any plan, so none is enforced.
 */
/** `verifyEmail`: the Auth server's record of the user's email (audit SEC-03); null when not configured (fail closed). */
export function createTeamService(deps: { db: Db; appUrl: string; verifyEmail: VerifyEmail | null; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });
  const managers = (ctx: TenantContext) => {
    if (ctx.role !== "owner" && ctx.role !== "admin") throw new AppError("FORBIDDEN", "Only the workspace owner or an admin can manage the team.");
  };
  const ownerOnly = (ctx: TenantContext, what: string) => {
    if (ctx.role !== "owner") throw new AppError("FORBIDDEN", `Only the workspace owner can ${what}.`);
  };
  const toApi = (r: typeof workspaceInvitations.$inferSelect & { inviterName: string | null }): Invitation => ({
    id: r.id,
    email: r.email,
    role: r.role,
    status: r.status === "pending" && r.expiresAt <= now() ? "expired" : r.status,
    invitedBy: r.inviterName ?? "A teammate",
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  });

  return {
    async invitations(ctx: TenantContext): Promise<Invitation[]> {
      managers(ctx);
      const rows = await deps.db.withTenant(tenant(ctx), (tx) =>
        tx.select({ i: workspaceInvitations, inviterName: sql<string | null>`(select display_name from platform.workspace_people() p where p.id = ${workspaceInvitations.invitedBy})` }).from(workspaceInvitations).orderBy(desc(workspaceInvitations.createdAt)).limit(100),
      );
      return rows.map((r) => toApi({ ...r.i, inviterName: r.inviterName }));
    },

    /** Creates an invitation and returns its link once. Owners may invite admins; admins invite members only. */
    async invite(ctx: TenantContext, email: string, role: "admin" | "member"): Promise<Invitation & { acceptUrl: string }> {
      managers(ctx);
      if (role === "admin" && ctx.role !== "owner") throw new AppError("FORBIDDEN", "Only the workspace owner can invite admins.");
      const token = randomBytes(32).toString("base64url");
      return deps.db.withTenant(tenant(ctx), async (tx) => {
        const people = await tx.execute<{ email: string }>(sql`select email from platform.workspace_people()`);
        if (people.some((p) => p.email.toLowerCase() === email)) throw new AppError("CONFLICT", "This person is already in the workspace.");
        const [pending] = await tx.select({ n: sql<number>`count(*)::int` }).from(workspaceInvitations).where(eq(workspaceInvitations.status, "pending"));
        if ((pending?.n ?? 0) >= MAX_PENDING) throw new AppError("CONFLICT", `A workspace can have up to ${MAX_PENDING} open invitations.`);
        // An expired pending invitation for this address is replaced; a live one is refused (revoke it first).
        await tx.update(workspaceInvitations).set({ status: "revoked" }).where(and(eq(workspaceInvitations.email, email), eq(workspaceInvitations.status, "pending"), sql`${workspaceInvitations.expiresAt} <= ${now().toISOString()}::timestamptz`));
        const [row] = await tx
          .insert(workspaceInvitations)
          .values({ workspaceId: ctx.workspaceId, email, role, tokenHash: hash(token), invitedBy: ctx.userId, expiresAt: new Date(now().getTime() + INVITE_DAYS * 86_400_000) })
          .onConflictDoNothing()
          .returning();
        if (!row) throw new AppError("CONFLICT", "This person already has an open invitation. Revoke it to send a new one.");
        return { ...toApi({ ...row, inviterName: null }), acceptUrl: `${deps.appUrl}/#/invite/${token}` };
      });
    },

    async revoke(ctx: TenantContext, id: string): Promise<void> {
      managers(ctx);
      const done = await deps.db.withTenant(tenant(ctx), (tx) => tx.update(workspaceInvitations).set({ status: "revoked" }).where(and(eq(workspaceInvitations.id, id), eq(workspaceInvitations.status, "pending"))).returning({ id: workspaceInvitations.id }));
      if (done.length === 0) throw new AppError("NOT_FOUND", "Open invitation not found");
    },

    async preview(token: string) {
      const [r] = await deps.db.withSystem((tx) => tx.execute<{ v: unknown }>(sql`select platform.invitation_preview(${hash(token)}) v`));
      if (!r?.v) throw new AppError("NOT_FOUND", "This invitation link is not valid.");
      return r.v;
    },

    /** Joins the workspace when the signed-in, verified email is the invited one; a forwarded link does not work. */
    async accept(identity: CustomerIdentity, token: string): Promise<{ workspaceId: string; role: "owner" | "admin" | "member" }> {
      // The confirmed address comes from the Auth server's record, never from the token's user_metadata (SEC-03).
      if (!deps.verifyEmail) throw new AppError("CONFLICT", "Invitations cannot be accepted on this server yet: the sign-in service's admin access is not configured.", { reason: "email_check_unavailable" });
      let verified: Awaited<ReturnType<VerifyEmail>>;
      try {
        verified = await deps.verifyEmail(identity.userId);
      } catch (err) {
        if (err instanceof EmailCheckUnavailable) throw new AppError("PROVIDER_UNAVAILABLE", "The email address could not be checked right now. Try again in a minute.", { reason: "email_check_unavailable" });
        throw err;
      }
      if (!verified?.confirmed || verified.email !== identity.email) throw new AppError("FORBIDDEN", "Confirm your email address first, then open the invitation again.", { reason: "email_unverified" });
      const [r] = await deps.db.withSystem((tx) => tx.execute<{ v: { workspaceId: string; role: "owner" | "admin" | "member" } | null }>(sql`select platform.accept_invitation(${hash(token)}, ${identity.userId}, ${verified.email}, ${identity.fullName}) v`));
      if (!r?.v) throw new AppError("FORBIDDEN", "This invitation is not valid for your account: it may have expired, been revoked or been sent to a different email address.", { reason: "invitation_invalid" });
      return r.v;
    },

    async myWorkspaces(ctx: TenantContext) {
      const [r] = await deps.db.withSystem((tx) => tx.execute<{ v: { id: string; name: string; role: "owner" | "admin" | "member" }[] }>(sql`select platform.my_workspaces(${ctx.userId}) v`));
      return r?.v ?? [];
    },

    /** Owner only; the owner's own role cannot change (transfer ownership instead). */
    async setRole(ctx: TenantContext, userId: string, role: "admin" | "member"): Promise<void> {
      ownerOnly(ctx, "change roles");
      if (userId === ctx.userId) throw new AppError("CONFLICT", "Transfer ownership to change your own role.");
      const done = await deps.db.withTenant(tenant(ctx), (tx) => tx.update(workspaceMembers).set({ role }).where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId), sql`${workspaceMembers.role} <> 'owner'`)).returning({ u: workspaceMembers.userId }));
      if (done.length === 0) throw new AppError("NOT_FOUND", "Member not found");
    },

    /** The owner removes anyone else; an admin removes members; anyone except the owner may leave. */
    async remove(ctx: TenantContext, userId: string): Promise<void> {
      await deps.db.withTenant(tenant(ctx), async (tx) => {
        const [target] = await tx.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)));
        if (!target) throw new AppError("NOT_FOUND", "Member not found");
        const self = userId === ctx.userId;
        if (target.role === "owner") throw new AppError("CONFLICT", self ? "Transfer ownership before leaving the workspace." : "The owner cannot be removed.");
        if (!self && ctx.role === "member") throw new AppError("FORBIDDEN", "Only the workspace owner or an admin can remove people.");
        if (!self && ctx.role === "admin" && target.role !== "member") throw new AppError("FORBIDDEN", "Only the workspace owner can remove an admin.");
        await tx.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)));
      });
    },

    /** Owner hands the workspace to another member, who becomes owner; the previous owner becomes an admin. */
    async transfer(ctx: TenantContext, userId: string): Promise<void> {
      ownerOnly(ctx, "transfer ownership");
      if (userId === ctx.userId) throw new AppError("CONFLICT", "You already own this workspace.");
      await deps.db.withTenant(tenant(ctx), async (tx) => {
        // Active members of this workspace (other users' rows are not readable directly under row-level security).
        const [target] = await tx.execute<{ id: string }>(sql`select id from platform.workspace_people() where id = ${userId}`);
        if (!target) throw new AppError("NOT_FOUND", "Member not found");
        await tx.update(workspaceMembers).set({ role: "owner" }).where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)));
        await tx.update(workspaceMembers).set({ role: "admin" }).where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, ctx.userId)));
        await tx.update(workspaces).set({ ownerUserId: userId }).where(eq(workspaces.id, ctx.workspaceId));
      });
    },
  };
}

export type TeamService = ReturnType<typeof createTeamService>;
