import type { RemovalRequest, StaffRemovalRequest } from "@mushin/contracts";
import { AppError, decryptSecret, encryptSecret } from "@mushin/core";
import { writeOutbox, type Db, type SystemTx } from "@mushin/db";
import type { StaffPrincipal } from "../../staff/index";
import { cleanText } from "../enrichment/standardize";
import { findIdByCanonicalUrl } from "../repository";
import { maskContact, normalizeProfileUrl } from "../rules";
import * as repo from "./repository";

type Audit = (tx: SystemTx, e: { staffId: string | null; action: string; metadata?: Record<string, unknown>; ip: string | null; requestId: string | null }) => Promise<void>;
type Meta = { ip: string | null; requestId: string | null };

export function createRemovalService(deps: { db: Db; encryptionKey: Buffer; audit: Audit }) {
  /** Spec §7 steps 1–2. Valid input always gets the same answer, so the form cannot reveal who is in MUSHIN. */
  async function submit(input: RemovalRequest): Promise<void> {
    if (input.website) return; // the bot trap: people never fill it
    const urls = [...new Set(input.urls.map((u) => normalizeProfileUrl(u)?.canonicalUrl).filter((u): u is string => u !== undefined))];
    if (urls.length === 0) throw new AppError("VALIDATION_FAILED", "Paste the link to your public Instagram, TikTok or YouTube profile.", { field: "urls" });
    const emailEncrypted = encryptSecret(input.email.trim().toLowerCase(), deps.encryptionKey);
    const reason = input.reason ? cleanText(input.reason, 500) || null : null;
    await deps.db.withSystem(async (tx) => {
      const byCreator = new Map<string | null, string[]>();
      for (const u of urls) {
        const id = await findIdByCanonicalUrl(tx, u);
        byCreator.set(id, [...(byCreator.get(id) ?? []), u]);
      }
      for (const [creatorId, list] of byCreator) {
        await repo.insertRequest(tx, { urls: list, creatorId, emailEncrypted, reason });
        if (creatorId) await repo.hideCreator(tx, creatorId);
      }
    });
  }

  async function list(status: "received" | "processed" | "rejected"): Promise<StaffRemovalRequest[]> {
    const rows = await deps.db.withSystem((tx) => repo.listRequests(tx, status));
    return rows.map(({ r, creator }) => {
      let emailMasked: string | null = null;
      if (r.requesterEmailEncrypted) emailMasked = maskContact("email", decryptSecret(r.requesterEmailEncrypted, deps.encryptionKey));
      return {
        id: r.id,
        urls: r.urls,
        creator: creator?.id ? { id: creator.id, displayName: creator.displayName, handle: creator.handle, platform: creator.platform } : null,
        emailMasked,
        reason: r.reason,
        status: r.status,
        staffNote: r.staffNote,
        createdAt: r.createdAt.toISOString(),
        processedAt: r.processedAt?.toISOString() ?? null,
      };
    });
  }

  async function open(tx: SystemTx, id: string): Promise<repo.RemovalRow> {
    const r = await repo.requestForUpdate(tx, id);
    if (!r) throw new AppError("NOT_FOUND", "Removal request not found");
    if (r.status !== "received") throw new AppError("CONFLICT", "This request was already handled");
    return r;
  }

  /** Approval erases the creator (worker, queue `erasure`). */
  async function approve(id: string, staff: StaffPrincipal, meta: Meta): Promise<void> {
    await deps.db.withSystem(async (tx) => {
      const r = await open(tx, id);
      await repo.finishRequest(tx, id, "processed", staff.staffId, null);
      await writeOutbox(tx, { eventType: "erasure.creator_requested", aggregateType: "removal_request", aggregateId: id, workspaceId: null, payload: { removalRequestId: id }, requestId: meta.requestId });
      await deps.audit(tx, { staffId: staff.staffId, action: "creators.removal.approved", metadata: { removalRequestId: id, creatorId: r.creatorId }, ip: meta.ip, requestId: meta.requestId });
    });
  }

  /** Rejecting restores the creator unless another open request still names them (Review Focus 5). */
  async function reject(id: string, note: string, staff: StaffPrincipal, meta: Meta): Promise<void> {
    await deps.db.withSystem(async (tx) => {
      const r = await open(tx, id);
      await repo.finishRequest(tx, id, "rejected", staff.staffId, cleanText(note, 300));
      if (r.creatorId && (await repo.otherOpenRequests(tx, r.creatorId, id)) === 0) await repo.restoreCreator(tx, r.creatorId);
      await deps.audit(tx, { staffId: staff.staffId, action: "creators.removal.rejected", metadata: { removalRequestId: id, creatorId: r.creatorId }, ip: meta.ip, requestId: meta.requestId });
    });
  }

  return { submit, list, approve, reject };
}

export type RemovalService = ReturnType<typeof createRemovalService>;
