import { and, eq, isNull, sql } from "drizzle-orm";
import { decryptSecret, type Logger } from "@mushin/core";
import { contactChecks, contactReveals, creatorContacts, writeOutbox, type Db, type TenantTx } from "@mushin/db";
import { checkEmail, type MailResolver } from "./email-check";

const EVENT = "outreach.contact_check_requested";

/**
 * API side, inside the caller's tenant transaction: a workspace is about to use a creator's email in a campaign. If it
 * has revealed the creator's contacts (so it holds the address; nothing new is revealed) and an email was never
 * checked, the check is queued for the worker. Returns whether a check was queued.
 */
export async function requestContactCheck(tx: TenantTx, o: { workspaceId: string; creatorId: string; requestId: string | null }): Promise<boolean> {
  const [revealed] = await tx.select({ n: sql<number>`1` }).from(contactReveals).where(and(eq(contactReveals.workspaceId, o.workspaceId), eq(contactReveals.creatorId, o.creatorId))).limit(1);
  if (!revealed) return false;
  const [unchecked] = await tx
    .select({ id: creatorContacts.id })
    .from(creatorContacts)
    .where(and(eq(creatorContacts.creatorId, o.creatorId), eq(creatorContacts.kind, "email"), isNull(creatorContacts.checkedAt)))
    .limit(1);
  if (!unchecked) return false;
  await writeOutbox(tx, { eventType: EVENT, aggregateType: "creator", aggregateId: o.creatorId, workspaceId: o.workspaceId, payload: { creatorId: o.creatorId, workspaceId: o.workspaceId }, requestId: o.requestId });
  return true;
}

/**
 * Worker side: checks every never-checked email of the creator (format, domain, MX; nothing is sent), stores each
 * attempt as evidence and, unless DNS failed, the contact's new status. A failed lookup leaves the contact unchecked so
 * a later use tries again. An address shown not to work changes the creator's "has contact" state, so it is re-indexed.
 */
export function createContactChecker(deps: { db: Db; encryptionKey: Buffer; resolver: MailResolver; logger: Logger }) {
  async function check(creatorId: string, workspaceId: string | null): Promise<{ checked: number; invalid: number; failed: number }> {
    const emails = await deps.db.withSystem((tx) =>
      tx
        .select({ id: creatorContacts.id, valueEncrypted: creatorContacts.valueEncrypted })
        .from(creatorContacts)
        .where(and(eq(creatorContacts.creatorId, creatorId), eq(creatorContacts.kind, "email"), isNull(creatorContacts.checkedAt))),
    );
    const out = { checked: 0, invalid: 0, failed: 0 };
    for (const e of emails) {
      // The lookup happens outside any transaction; the address itself is never logged.
      const r = await checkEmail(decryptSecret(e.valueEncrypted, deps.encryptionKey), deps.resolver);
      await deps.db.withSystem(async (tx) => {
        await tx.insert(contactChecks).values({ contactId: e.id, creatorId, requestedByWorkspaceId: workspaceId, method: "format_domain_mx", result: r.result, detail: r.detail });
        if (r.result === "check_failed") return;
        await tx.update(creatorContacts).set({ status: r.result, checkedAt: sql`now()`, checkDetail: r.detail }).where(and(eq(creatorContacts.id, e.id), isNull(creatorContacts.checkedAt)));
        if (r.result === "invalid") await writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: creatorId, workspaceId: null, payload: { creatorId }, requestId: null });
      });
      if (r.result === "check_failed") out.failed++;
      else out.checked++;
      if (r.result === "invalid") out.invalid++;
    }
    deps.logger.info({ creatorId, ...out }, "contact emails checked (format, domain, MX; no message sent)");
    return out;
  }
  return { check };
}

export type ContactChecker = ReturnType<typeof createContactChecker>;
