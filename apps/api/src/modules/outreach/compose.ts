import { sql } from "drizzle-orm";
import type { OutreachCompose, OutreachDraft } from "@mushin/contracts";
import { AppError, decryptSecret, encryptSecret, sha256Hex, type TenantContext } from "@mushin/core";
import type { TenantTx } from "@mushin/db";
import { isUsableEmail, maskContact } from "../creators/index";

/**
 * Outreach composition (owner instruction 2026-10-26). One function renders the email, so the preview is exactly what
 * a send delivers. The sender is transparent: "<workspace> via Roster" from Roster's verified address, replies to the
 * sending person's own account address, and a footer naming who sent it, on whose behalf, the sender's postal address
 * and how to stop emails. Nothing here sends anything.
 */
export type Recipient = { source: "creator_contact" | "workspace_contact"; id: string | null; email: string; hash: string; masked: string; status: string };
export type ComposeContext = { workspaceName: string; senderName: string; senderEmail: string; campaign: { name: string; client: string; objective: string; status: string }; creatorName: string };

const displayName = (s: string) => s.replace(/["<>\r\n\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
/** The address part of a configured sender ("Roster <outreach@roster.pk>" → outreach@roster.pk). */
export const senderAddress = (from: string) => /<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1] ?? from.trim();

export async function composeContext(tx: TenantTx, ctx: TenantContext, campaignId: string, creatorId: string): Promise<ComposeContext> {
  const [c] = await tx.execute<{ name: string; client: string; objective: string; status: string }>(
    sql`select name, client, objective, status from wp.campaigns where workspace_id = ${ctx.workspaceId} and id = ${campaignId}`,
  );
  if (!c) throw new AppError("NOT_FOUND", "Campaign not found");
  const [member] = await tx.execute<{ name: string }>(
    sql`select cr.display_name name from wp.campaign_creators m join gcp.creators cr on cr.id = m.creator_id
        where m.workspace_id = ${ctx.workspaceId} and m.campaign_id = ${campaignId} and m.creator_id = ${creatorId}`,
  );
  if (!member) throw new AppError("NOT_FOUND", "This creator is not in the campaign");
  const [w] = await tx.execute<{ name: string }>(sql`select name from wp.workspaces where id = ${ctx.workspaceId}`);
  const [u] = await tx.execute<{ email: string; name: string | null }>(sql`select email, display_name name from wp.users where id = ${ctx.userId}`);
  if (!w || !u) throw new AppError("NOT_FOUND", "Team not found");
  return { workspaceName: w.name, senderName: u.name?.trim() || u.email.split("@")[0] || "The team", senderEmail: u.email, campaign: c, creatorName: member.name };
}

/** Where the email goes: a revealed creator contact, an address this workspace stored earlier, or one typed now. */
export async function resolveRecipient(tx: TenantTx, ctx: TenantContext, creatorId: string, input: Pick<OutreachCompose, "contactId" | "manualEmail">, o: { encryptionKey: Buffer; persist: boolean }): Promise<Recipient> {
  if (input.contactId) {
    const [rc] = await tx.execute<{ id: string; value_encrypted: string; value_hash: string; masked: string; status: string }>(sql`select * from gcp.revealed_email(${creatorId}, ${input.contactId})`);
    if (rc) return { source: "creator_contact", id: rc.id, email: decryptSecret(rc.value_encrypted, o.encryptionKey), hash: rc.value_hash, masked: rc.masked, status: rc.status };
    const [wc] = await tx.execute<{ id: string; value_encrypted: string; value_hash: string; masked: string }>(
      sql`select id, value_encrypted, value_hash, masked from wp.workspace_contacts where workspace_id = ${ctx.workspaceId} and creator_id = ${creatorId} and id = ${input.contactId}`,
    );
    if (wc) return { source: "workspace_contact", id: wc.id, email: decryptSecret(wc.value_encrypted, o.encryptionKey), hash: wc.value_hash, masked: wc.masked, status: "user_provided" };
    throw new AppError("CONFLICT", "Reveal this creator's email address first, or enter an address you have for them.", { reason: "contact_not_revealed" });
  }
  const email = (input.manualEmail ?? "").trim().toLowerCase();
  if (!isUsableEmail(email)) throw new AppError("VALIDATION_FAILED", "This email address cannot receive email. Check it and try again.", { reason: "invalid_email" });
  const hash = sha256Hex(email);
  const masked = maskContact("email", email);
  if (!o.persist) return { source: "workspace_contact", id: null, email, hash, masked, status: "user_provided" };
  // Kept for this workspace only; the creator's own contacts are never changed.
  await tx.execute(sql`insert into wp.workspace_contacts (workspace_id, creator_id, value_encrypted, value_hash, masked, created_by)
    values (${ctx.workspaceId}, ${creatorId}, ${encryptSecret(email, o.encryptionKey)}, ${hash}, ${masked}, ${ctx.userId})
    on conflict (workspace_id, creator_id, value_hash) do nothing`);
  const [row] = await tx.execute<{ id: string }>(sql`select id from wp.workspace_contacts where workspace_id = ${ctx.workspaceId} and creator_id = ${creatorId} and value_hash = ${hash}`);
  return { source: "workspace_contact", id: row?.id ?? null, email, hash, masked, status: "user_provided" };
}

export function renderEmail(o: { c: ComposeContext; recipient: Recipient; subject: string; body: string; from: string; postalAddress: string | null; unsubscribeUrl: string }) {
  const brand = o.c.campaign.client.trim();
  const behalf = brand && brand.toLowerCase() !== o.c.workspaceName.toLowerCase() ? ` on behalf of ${brand}` : "";
  const footer = [
    "--",
    `Sent by ${o.c.senderName} at ${o.c.workspaceName}${behalf} through MUSHIN. Replies go to ${o.c.senderEmail}.`,
    o.postalAddress ?? "Postal address: not configured (test mode only; real sending requires it).",
    `To stop receiving emails sent through MUSHIN: ${o.unsubscribeUrl}`,
  ].join("\n");
  const warnings: string[] = [];
  if (o.recipient.status === "user_provided") warnings.push("You entered this address: MUSHIN has not checked it, and it is kept for your workspace only.");
  else if (o.recipient.status !== "verified") warnings.push(o.recipient.status === "domain_ok" ? "The address's domain accepts email, but the inbox itself is not confirmed." : "This address was found publicly and has not been checked: it may not reach the creator.");
  if (!o.postalAddress) warnings.push("No postal address is configured; real sending is refused until one is set.");
  return {
    from: `"${displayName(o.c.workspaceName)} via MUSHIN" <${senderAddress(o.from)}>`,
    replyTo: o.c.senderEmail,
    to: o.recipient.email,
    subject: o.subject.trim(),
    text: `${o.body.trim()}\n\n${footer}`,
    warnings,
  };
}

/** A neutral first message: an invitation to discuss, never a claim that anything is agreed or booked. */
export function draftText(c: ComposeContext): Pick<OutreachDraft, "subject" | "body"> {
  const brand = c.campaign.client.trim() || c.workspaceName;
  const objective = c.campaign.objective.trim() ? `\n\nAbout the campaign: ${c.campaign.objective.trim()}` : "";
  return {
    subject: `Collaboration enquiry from ${brand}: ${c.campaign.name}`.slice(0, 200),
    body:
      `Hi ${c.creatorName},\n\nI'm ${c.senderName} from ${brand}. We're planning "${c.campaign.name}" and your content looks like a good fit. ` +
      `Would you be open to discussing a possible paid collaboration? Nothing is agreed or confirmed yet; I'd like to share the details and hear about your rates and availability.` +
      `${objective}\n\nThanks,\n${c.senderName}\n${brand}`,
  };
}
