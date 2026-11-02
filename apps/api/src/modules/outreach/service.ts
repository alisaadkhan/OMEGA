import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import type { OutreachCompose, OutreachDraft, OutreachEmail, OutreachPreview, OutreachUsage, SendOutreachEmail } from "@mushin/contracts";
import { AppError, decryptSecret, sha256Hex, type Logger, type TenantContext } from "@mushin/core";
import { outreachEmails, type Db, type SystemTx, type TenantTx } from "@mushin/db";
import { parseEmailEvent, verifyEmailWebhook, type EmailProvider } from "@mushin/integrations";
import type { BillingService } from "../billing/index";
import { composeContext, draftText, renderEmail, resolveRecipient, senderAddress } from "./compose";

export type OutreachDeps = {
  db: Db;
  billing: Pick<BillingService, "getAccess" | "engine">;
  /** Null when outreach email is off on this server (OUTREACH_EMAIL_MODE=off). */
  provider: EmailProvider | null;
  from: string;
  /** The sender's postal address for the email footer; required for real sends (configuration), optional in test mode. */
  postalAddress?: string | null;
  /** Decrypts the revealed contact value at send time (the address is never stored with the send). */
  encryptionKey: Buffer;
  /** Signs unsubscribe links. */
  unsubscribeKey: Buffer;
  /** Where the unsubscribe page lives (the app). */
  appUrl: string;
  /** Resend webhook signing secret; null in test mode (no provider webhooks). */
  webhookSecret: string | null;
  logger: Logger;
  now?: () => Date;
};

/** Abuse limit on top of the plan allowance: one person cannot send more than this many emails an hour. */
export const SENDS_PER_USER_PER_HOUR = 30;
const RANK: Record<OutreachEmail["status"], number> = { requested: 0, failed: 0, accepted: 1, delivered: 2, bounced: 3, complained: 3 };
const HOUR = 3_600_000;

export function createOutreachEmailService(deps: OutreachDeps) {
  const now = deps.now ?? (() => new Date());
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });
  const mode = (): OutreachUsage["mode"] => (deps.provider === null ? "off" : deps.provider.mode === "test" ? "test" : "live");

  const sign = (hash: string) => createHmac("sha256", deps.unsubscribeKey).update(`unsubscribe:${hash}`).digest("hex").slice(0, 32);
  const unsubscribeUrl = (hash: string) => `${deps.appUrl}/#/unsubscribe/${hash}.${sign(hash)}`;

  async function limitFor(ctx: TenantContext): Promise<number | null> {
    return (await deps.billing.getAccess(ctx)).entitlements.outreachEmailsPerMonth;
  }

  async function usedIn(tx: TenantTx, workspaceId: string, periodStart: Date): Promise<number> {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(outreachEmails)
      .where(and(eq(outreachEmails.workspaceId, workspaceId), gte(outreachEmails.periodStart, periodStart), ne(outreachEmails.status, "failed")));
    return r?.n ?? 0;
  }

  async function usage(ctx: TenantContext): Promise<OutreachUsage> {
    const limit = await limitFor(ctx);
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const period = await deps.billing.engine.allowancePeriod(tx, ctx.workspaceId);
      return { mode: mode(), limit, used: await usedIn(tx, ctx.workspaceId, period), periodStart: period.toISOString() };
    });
  }

  function toApi(r: typeof outreachEmails.$inferSelect & { sentByName: string }): OutreachEmail {
    return {
      id: r.id,
      campaignId: r.campaignId,
      creatorId: r.creatorId,
      recipient: r.recipientMasked,
      subject: r.subject,
      status: r.status,
      mode: r.mode,
      failureReason: r.failureReason,
      sentBy: { id: r.requestedBy, name: r.sentByName },
      createdAt: r.createdAt.toISOString(),
      statusAt: r.statusAt.toISOString(),
    };
  }

  const sentByName = sql<string>`coalesce((select p.display_name from platform.workspace_people() p where p.id = ${outreachEmails.requestedBy}), 'Former member')`;

  async function list(ctx: TenantContext, campaignId: string): Promise<OutreachEmail[]> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const rows = await tx
        .select({ e: outreachEmails, sentByName })
        .from(outreachEmails)
        .where(and(eq(outreachEmails.workspaceId, ctx.workspaceId), eq(outreachEmails.campaignId, campaignId)))
        .orderBy(desc(outreachEmails.createdAt))
        .limit(200);
      return rows.map((r) => toApi({ ...r.e, sentByName: r.sentByName }));
    });
  }

  /**
   * Sends one email the person confirmed, to a creator in one of their campaigns. Checks, in order: the server has a
   * provider; the plan includes outreach email; the creator is in this (not archived) campaign; the contact is an email
   * this workspace revealed and not known to be invalid; the address is not suppressed; the person's hourly limit; and,
   * under a per-workspace lock, the billing period's allowance. The send row is written before the provider is called.
   */
  async function send(ctx: TenantContext, campaignId: string, creatorId: string, input: SendOutreachEmail & { confirm: true }, idempotencyKey: string): Promise<OutreachEmail> {
    const provider = deps.provider;
    if (!provider) throw new AppError("CONFLICT", "Sending email through MUSHIN is not available yet. Contact the creator directly and log it in the campaign.", { reason: "outreach_email_unavailable" });
    const limit = await limitFor(ctx);
    if (limit === 0) {
      throw new AppError("ENTITLEMENT_REQUIRED", "Your plan does not include outreach emails. Growth includes 500 a month and Scale 2,000.", { reason: "plan_feature", key: "outreach_emails" });
    }
    const t = now();

    const claimed = await deps.db.withTenant(tenant(ctx), async (tx) => {
      const existing = await tx.select().from(outreachEmails).where(and(eq(outreachEmails.workspaceId, ctx.workspaceId), eq(outreachEmails.idempotencyKey, idempotencyKey))).limit(1);
      if (existing[0]) return { row: existing[0], fresh: false, to: null, c: null };

      const c = await composeContext(tx, ctx, campaignId, creatorId);
      if (c.campaign.status === "archived") throw new AppError("CONFLICT", "This campaign is archived. Restore it to contact creators.", { reason: "campaign_archived" });
      // Real sends need the sender's postal address in the footer (configuration requires it for live mode).
      if (provider.mode === "resend" && !deps.postalAddress) throw new AppError("CONFLICT", "Sending is not available: no sender postal address is configured.", { reason: "outreach_email_unavailable" });

      // A revealed creator contact, or an address this person entered (stored for this workspace only).
      const contact = await resolveRecipient(tx, ctx, creatorId, input, { encryptionKey: deps.encryptionKey, persist: true });
      if (contact.status === "invalid") throw new AppError("CONFLICT", "This email address is known to be invalid. Contact the creator another way and log it.", { reason: "contact_invalid" });
      const [suppressed] = await tx.execute<{ reason: string }>(sql`select reason from platform.email_suppressions where recipient_hash = ${contact.hash}`);
      if (suppressed) throw new AppError("CONFLICT", "This address cannot be emailed through MUSHIN (it bounced, complained or unsubscribed).", { reason: "recipient_suppressed" });

      const [recent] = await tx.select({ n: sql<number>`count(*)::int` }).from(outreachEmails).where(and(eq(outreachEmails.requestedBy, ctx.userId), gte(outreachEmails.createdAt, new Date(t.getTime() - HOUR))));
      if ((recent?.n ?? 0) >= SENDS_PER_USER_PER_HOUR) throw new AppError("RATE_LIMITED", `You can send up to ${SENDS_PER_USER_PER_HOUR} emails an hour. Try again later.`, { retryAfterSeconds: 600 });

      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`outreach:${ctx.workspaceId}`}, 0))`);
      const period = await deps.billing.engine.allowancePeriod(tx, ctx.workspaceId);
      const used = await usedIn(tx, ctx.workspaceId, period);
      if (limit !== null && used >= limit) {
        throw new AppError("ENTITLEMENT_REQUIRED", `You have sent this billing period's ${limit} outreach emails. The allowance renews with your plan.`, { reason: "plan_limit", key: "outreach_emails", limit, used });
      }
      const [row] = await tx
        .insert(outreachEmails)
        .values({
          workspaceId: ctx.workspaceId,
          campaignId,
          creatorId,
          contactId: contact.id ?? creatorId,
          contactSource: contact.source,
          requestedBy: ctx.userId,
          idempotencyKey,
          recipientHash: contact.hash,
          recipientMasked: contact.masked,
          subject: input.subject,
          body: input.body,
          mode: provider.mode,
          periodStart: period,
        })
        .returning();
      if (!row) throw new Error("outreach email insert returned no row");
      return { row, fresh: true, to: contact, c };
    });

    let row = claimed.row;
    if (claimed.fresh && claimed.to && claimed.c) {
      // The same rendering as the preview: transparent sender, replies to the person, footer with address and opt-out.
      const email = renderEmail({ c: claimed.c, recipient: claimed.to, subject: row.subject, body: row.body, from: deps.from, postalAddress: deps.postalAddress ?? null, unsubscribeUrl: unsubscribeUrl(row.recipientHash) });
      const result = await provider.send({ sendId: row.id, from: email.from, replyTo: email.replyTo, to: email.to, subject: email.subject, text: email.text, unsubscribeUrl: unsubscribeUrl(row.recipientHash) });
      const patch = result.ok
        ? { status: "accepted" as const, providerMessageId: result.messageId, statusAt: now() }
        : { status: "failed" as const, failureReason: result.reason, statusAt: now() };
      if (!result.ok) deps.logger.warn({ sendId: row.id, reason: result.reason }, "outreach email refused by the provider; the allowance slot is free again");
      const [updated] = await deps.db.withTenant(tenant(ctx), (tx) => tx.update(outreachEmails).set(patch).where(and(eq(outreachEmails.workspaceId, ctx.workspaceId), eq(outreachEmails.id, row.id))).returning());
      if (updated) row = updated;
    }
    const name = await deps.db.withTenant(tenant(ctx), async (tx) => (await tx.execute<{ n: string | null }>(sql`select display_name n from platform.workspace_people() where id = ${row.requestedBy}`))[0]?.n ?? "Former member");
    return toApi({ ...row, sentByName: name });
  }

  /** A ready-to-edit email for one creator in one campaign, from its real brand and name. Nothing is stored or sent. */
  async function draft(ctx: TenantContext, campaignId: string, creatorId: string): Promise<OutreachDraft> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const c = await composeContext(tx, ctx, campaignId, creatorId);
      const text = draftText(c);
      // Values only through the reveal function; the status column is readable to the app role (0032).
      const statuses = new Map((await tx.execute<{ id: string; status: string }>(sql`select id, status from gcp.creator_contacts where creator_id = ${creatorId} and kind = 'email'`)).map((r) => [r.id, r.status]));
      const revealed = (await tx.execute<{ id: string; kind: string; value_encrypted: string }>(sql`select id, kind, value_encrypted from gcp.revealed_contacts(${creatorId})`))
        .filter((r) => r.kind === "email")
        .map((r) => {
          const value = decryptSecret(r.value_encrypted, deps.encryptionKey);
          return { id: r.id, value_encrypted: r.value_encrypted, value_hash: sha256Hex(value.trim().toLowerCase()), status: statuses.get(r.id) ?? "unverified" };
        });
      const typed = await tx.execute<{ id: string; value_encrypted: string; value_hash: string }>(
        sql`select id, value_encrypted, value_hash from wp.workspace_contacts where workspace_id = ${ctx.workspaceId} and creator_id = ${creatorId} order by created_at`,
      );
      const hashes = [...revealed.map((r) => r.value_hash), ...typed.map((r) => r.value_hash)];
      const suppressed = new Set(
        hashes.length === 0
          ? []
          : (await tx.execute<{ h: string }>(sql`select recipient_hash h from platform.email_suppressions where recipient_hash in (${sql.join(hashes.map((h) => sql`${h}`), sql`, `)})`)).map((r) => r.h),
      );
      // The creator has an email this workspace has not revealed (revealing costs credits; it is never done here).
      const [hidden] = await tx.execute<{ n: number }>(
        sql`select count(*)::int n from gcp.creator_contacts c where c.creator_id = ${creatorId} and c.kind = 'email' and c.status <> 'invalid'
            and not exists (select 1 from wp.contact_reveals r where r.workspace_id = ${ctx.workspaceId} and r.creator_id = ${creatorId})`,
      );
      const links = await tx.execute<{ platform: "instagram" | "tiktok" | "youtube"; url: string }>(
        sql`select platform, canonical_url url from gcp.creator_profiles where creator_id = ${creatorId} order by followers desc nulls last`,
      );
      const usable = revealed.filter((r) => r.status !== "invalid" && !suppressed.has(r.value_hash));
      return {
        ...text,
        sender: { fromName: `${c.workspaceName} via MUSHIN`, fromAddress: deps.from ? senderAddress(deps.from) : "", replyTo: c.senderEmail, postalAddress: deps.postalAddress ?? null },
        recipients: [
          ...usable.map((r) => ({ id: r.id, source: "creator_contact" as const, value: decryptSecret(r.value_encrypted, deps.encryptionKey), status: r.status as "unverified" | "domain_ok" | "verified" })),
          ...typed
            .filter((r) => !suppressed.has(r.value_hash))
            .map((r) => ({ id: r.id, source: "workspace_contact" as const, value: decryptSecret(r.value_encrypted, deps.encryptionKey), status: "user_provided" as const })),
        ],
        revealNeeded: (hidden?.n ?? 0) > 0,
        profileLinks: [...links],
        manualMessage: `${text.subject}\n\n${text.body}`,
      };
    });
  }

  /** The complete email exactly as a send would deliver it, with what to know first. Nothing is stored or sent. */
  async function preview(ctx: TenantContext, campaignId: string, creatorId: string, input: OutreachCompose): Promise<OutreachPreview> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const c = await composeContext(tx, ctx, campaignId, creatorId);
      const recipient = await resolveRecipient(tx, ctx, creatorId, input, { encryptionKey: deps.encryptionKey, persist: false });
      const [suppressed] = await tx.execute<{ reason: string }>(sql`select reason from platform.email_suppressions where recipient_hash = ${recipient.hash}`);
      const email = renderEmail({ c, recipient, subject: input.subject, body: input.body, from: deps.from || "outreach@roster.invalid", postalAddress: deps.postalAddress ?? null, unsubscribeUrl: unsubscribeUrl(recipient.hash) });
      const warnings = [...email.warnings];
      if (recipient.status === "invalid") warnings.unshift("This address is known to be invalid: sending is refused.");
      if (suppressed) warnings.unshift("This address bounced, complained or unsubscribed: MUSHIN will not email it.");
      // The same refusals send() applies, decided here so the UI never guesses from warning text.
      const blockedReason = !deps.provider
        ? "Sending email through MUSHIN is not available yet."
        : recipient.status === "invalid"
          ? "This address is known to be invalid."
          : suppressed
            ? "This address bounced, complained or unsubscribed."
            : c.campaign.status === "archived"
              ? "This campaign is archived."
              : deps.provider.mode === "resend" && !deps.postalAddress
                ? "No sender postal address is configured."
                : null;
      return { from: email.from, replyTo: email.replyTo, to: email.to, subject: email.subject, text: email.text, warnings, sendable: blockedReason === null, blockedReason };
    });
  }

  /** One-click unsubscribe from a link in an email: suppresses the address for every workspace. */
  async function unsubscribe(token: string): Promise<void> {
    const [hash, sig] = token.split(".", 2);
    const expected = hash && /^[0-9a-f]{64}$/.test(hash) ? sign(hash) : null;
    if (!hash || !sig || !expected || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new AppError("VALIDATION_FAILED", "This unsubscribe link is not valid.");
    }
    await deps.db.withSystem((tx) => tx.execute(sql`select platform.suppress_email(${hash}, 'unsubscribed')`));
  }

  /**
   * A signed provider webhook (Resend, Svix signature). Applied once per provider event id; a status only moves
   * forward (accepted → delivered → bounced/complained); bounces and complaints suppress the address.
   */
  async function handleWebhook(headers: { id?: string; timestamp?: string; signature?: string }, raw: string): Promise<"applied" | "duplicate" | "ignored"> {
    if (!deps.webhookSecret) throw new AppError("NOT_FOUND", "Not found");
    verifyEmailWebhook(headers, raw, deps.webhookSecret, now());
    const event = parseEmailEvent(JSON.parse(raw) as unknown);
    const eventId = headers.id ?? "";
    const record = (tx: TenantTx | SystemTx, type: string) =>
      tx.execute<{ id: string }>(sql`insert into platform.email_webhook_events (provider_event_id, event_type) values (${eventId}, ${type}) on conflict do nothing returning provider_event_id id`);
    const workspaceId =
      "ignored" in event ? null : ((await deps.db.withSystem((tx) => tx.execute<{ w: string | null }>(sql`select platform.outreach_email_owner(${event.messageId}) w`)))[0]?.w ?? null);
    if ("ignored" in event || !workspaceId) {
      const [fresh] = await deps.db.withSystem((tx) => record(tx, "ignored" in event ? event.ignored : event.type));
      return fresh ? "ignored" : "duplicate";
    }
    // Recording the delivery and applying it happen in one transaction: an event is never marked seen but not applied.
    return deps.db.withWorkspace(workspaceId, async (tx) => {
      const [fresh] = await record(tx, event.type);
      if (!fresh) return "duplicate" as const;
      const [e] = await tx.execute<{ id: string; status: OutreachEmail["status"]; recipient_hash: string }>(sql`select id, status, recipient_hash from wp.outreach_emails where provider_message_id = ${event.messageId} for update`);
      if (!e) return "ignored" as const;
      if (RANK[event.status] > RANK[e.status]) await tx.execute(sql`update wp.outreach_emails set status = ${event.status}, status_at = now() where id = ${e.id}`);
      if (event.status === "bounced" || event.status === "complained") await tx.execute(sql`select platform.suppress_email(${e.recipient_hash}, ${event.status})`);
      return "applied" as const;
    });
  }

  return { mode, usage, list, draft, preview, send, unsubscribe, handleWebhook, unsubscribeUrl };
}

export type OutreachEmailService = ReturnType<typeof createOutreachEmailService>;
