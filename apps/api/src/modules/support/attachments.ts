import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { AppError, type TenantContext } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { ObjectStorage } from "@mushin/integrations";
import { pdfScan } from "./pdf-scan";

/**
 * Support ticket attachments (owner decision 2026-11-03, master directive Part 8 decision 2; migration 0076).
 *   1. request: the caller names the file; MUSHIN checks access, type and size and returns a short-lived signed upload
 *      URL into the private bucket (the file never passes through the API, which serverless body limits would refuse);
 *   2. complete: MUSHIN downloads the object, checks its real signature (magic bytes) and size, runs the malware-scan
 *      hook, then marks it clean or rejects it and deletes the object;
 *   3. download: a 60-second signed URL that downloads the file (never rendered inline).
 * Only the ticket's own workspace and support staff reach an attachment; every id is checked against the ticket.
 */
export const ATTACHMENT_BUCKET = "support-attachments";
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
const EXTENSIONS: Record<AttachmentType, RegExp> = { "image/jpeg": /\.(jpe?g)$/i, "image/png": /\.png$/i, "image/webp": /\.webp$/i, "application/pdf": /\.pdf$/i };
export const ATTACHMENT_RETENTION_DAYS = 90;

/** The file's real type from its first bytes; null for anything else (HTML, SVG, executables, archives...). */
export function sniffType(b: Uint8Array): AttachmentType | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, j) => b[i + j] === x);
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (b.length >= 5 && at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  return null;
}

/** Malware-scan hook: a real scanner (e.g. ClamAV) can replace this; the built-in one refuses active content in PDFs. */
export type AttachmentScanner = (bytes: Uint8Array, type: AttachmentType) => Promise<{ clean: boolean; detail: string }>;
const ACTIVE_PDF = /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA|SubmitForm|ImportData|GoToR|GoToE)(?![A-Za-z0-9])/;
export const basicScanner: AttachmentScanner = async (bytes, type) => {
  if (type !== "application/pdf") return { clean: true, detail: "Signature checked" };
  const scan = pdfScan(bytes);
  if (!scan.ok) return { clean: false, detail: `PDF with content that could not be checked is not accepted (${scan.reason.slice(0, 120)})` };
  const active = ACTIVE_PDF.exec(scan.text);
  return active ? { clean: false, detail: `PDF with active content (${active[1]}) is not accepted` } : { clean: true, detail: "Signature checked; no active PDF content" };
};

export type Attachment = { id: string; fileName: string; contentType: AttachmentType; sizeBytes: number | null; status: "pending" | "clean" | "rejected"; uploadedBy: "customer" | "staff"; createdAt: string };
type Row = { id: string; ticket_id: string; workspace_id: string; file_name: string; content_type: AttachmentType; size_bytes: number | null; storage_key: string; status: Attachment["status"]; uploaded_by_staff_id: string | null; created_at: string | Date };
const toApi = (r: Row): Attachment => ({ id: r.id, fileName: r.file_name, contentType: r.content_type, sizeBytes: r.size_bytes, status: r.status, uploadedBy: r.uploaded_by_staff_id ? "staff" : "customer", createdAt: new Date(r.created_at).toISOString() });

export type Uploader = { kind: "customer"; ctx: TenantContext } | { kind: "staff"; staffId: string };

export function createAttachments(deps: { db: Db; storage: ObjectStorage | null; scanner?: AttachmentScanner; now?: () => Date }) {
  const scan = deps.scanner ?? basicScanner;
  const storage = (): ObjectStorage => {
    if (!deps.storage) throw new AppError("PROVIDER_UNAVAILABLE", "File storage is not configured, so attachments are unavailable right now.");
    return deps.storage;
  };

  /** The ticket's workspace when the caller may use it: the customer's own workspace, or any ticket for staff. */
  async function ticket(who: Uploader, ticketId: string): Promise<{ ws: string; status: string }> {
    const rows =
      who.kind === "customer"
        ? await deps.db.withTenant({ userId: who.ctx.userId, workspaceId: who.ctx.workspaceId }, (tx) => tx.execute<{ workspace_id: string; status: string }>(sql`select workspace_id, status from wp.support_tickets where id = ${ticketId}`))
        : // Staff see every ticket through the staff ticket function (tickets are workspace-scoped by row-level security).
          await deps.db.withSystem((tx) => tx.execute<{ workspace_id: string | null; status: string | null }>(sql`select t ->> 'workspaceId' as workspace_id, t ->> 'status' as status from platform.staff_ticket(${ticketId}) t`));
    const ws = rows[0]?.workspace_id;
    if (!ws) throw new AppError("NOT_FOUND", "Ticket not found");
    return { ws, status: rows[0]?.status ?? "open" };
  }
  const ticketWorkspace = async (who: Uploader, ticketId: string) => (await ticket(who, ticketId)).ws;

  async function row(ws: string, ticketId: string, id: string): Promise<Row> {
    const [r] = await deps.db.withWorkspace(ws, (tx) => tx.execute<Row>(sql`select * from wp.support_attachments where id = ${id} and ticket_id = ${ticketId}`));
    if (!r) throw new AppError("NOT_FOUND", "Attachment not found");
    return r;
  }

  return {
    async request(who: Uploader, ticketId: string, body: { fileName: string; contentType: string; sizeBytes: number }): Promise<{ attachment: Attachment; uploadUrl: string }> {
      const type = ATTACHMENT_TYPES.find((t) => t === body.contentType);
      if (!type) throw new AppError("VALIDATION_FAILED", "Only JPG, PNG, WebP or PDF files can be attached.", { reason: "type_not_allowed" });
      if (!EXTENSIONS[type].test(body.fileName)) throw new AppError("VALIDATION_FAILED", "The file name does not match its type.", { reason: "extension_mismatch" });
      if (!Number.isInteger(body.sizeBytes) || body.sizeBytes < 1 || body.sizeBytes > MAX_ATTACHMENT_BYTES) throw new AppError("VALIDATION_FAILED", "Files can be at most 5 MB.", { reason: "too_large" });
      const t = await ticket(who, ticketId);
      // As with replies, a customer reopens a closed request before adding to it.
      if (who.kind === "customer" && t.status === "closed") throw new AppError("CONFLICT", "This request is closed. Reopen it to add a file.", { reason: "ticket_closed" });
      const ws = t.ws;
      const id = randomUUID();
      const key = `${ws}/${ticketId}/${id}`;
      const fileName = body.fileName.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 160);
      const [r] = await deps.db.withWorkspace(ws, (tx) =>
        tx.execute<Row>(sql`
          insert into wp.support_attachments (id, ticket_id, workspace_id, uploaded_by_user_id, uploaded_by_staff_id, file_name, content_type, storage_key)
          values (${id}, ${ticketId}, ${ws}, ${who.kind === "customer" ? who.ctx.userId : null}, ${who.kind === "staff" ? who.staffId : null}, ${fileName}, ${type}, ${key})
          returning *`),
      );
      // The storage service itself refuses larger files and other types on upload.
      await storage().ensureBucket(ATTACHMENT_BUCKET, { public: false, fileSizeLimit: MAX_ATTACHMENT_BYTES, allowedMimeTypes: [...ATTACHMENT_TYPES] });
      return { attachment: toApi(r as Row), uploadUrl: await storage().signedUploadUrl(ATTACHMENT_BUCKET, key) };
    },

    /** Checks what was actually uploaded; only a clean file becomes downloadable. */
    async complete(who: Uploader, ticketId: string, id: string): Promise<Attachment> {
      const ws = await ticketWorkspace(who, ticketId);
      const r = await row(ws, ticketId, id);
      if (r.status !== "pending") return toApi(r);
      const bytes = await storage().get(ATTACHMENT_BUCKET, r.storage_key, { maxBytes: MAX_ATTACHMENT_BYTES });
      let verdict: { clean: boolean; detail: string };
      if (!bytes) verdict = { clean: false, detail: "Nothing was uploaded" };
      else if (bytes.length > MAX_ATTACHMENT_BYTES) verdict = { clean: false, detail: "Larger than 5 MB" };
      else if (sniffType(bytes) !== r.content_type) verdict = { clean: false, detail: "The file's contents are not the declared type" };
      else verdict = await scan(bytes, r.content_type);
      if (!verdict.clean && bytes) await storage().remove(ATTACHMENT_BUCKET, [r.storage_key]);
      const [u] = await deps.db.withWorkspace(ws, (tx) =>
        tx.execute<Row>(sql`update wp.support_attachments set status = ${verdict.clean ? "clean" : "rejected"}, size_bytes = ${bytes?.length ?? null}, scan_detail = ${verdict.detail}, checked_at = now() where id = ${id} returning *`),
      );
      if (!verdict.clean) throw new AppError("VALIDATION_FAILED", `This file was not accepted: ${verdict.detail}.`, { reason: "rejected" });
      return toApi(u as Row);
    },

    async list(who: Uploader, ticketId: string): Promise<Attachment[]> {
      const ws = await ticketWorkspace(who, ticketId);
      const rows = await deps.db.withWorkspace(ws, (tx) => tx.execute<Row>(sql`select * from wp.support_attachments where ticket_id = ${ticketId} and status = 'clean' order by created_at`));
      return [...rows].map(toApi);
    },

    async downloadUrl(who: Uploader, ticketId: string, id: string): Promise<{ url: string; expiresInSeconds: number }> {
      const ws = await ticketWorkspace(who, ticketId);
      const r = await row(ws, ticketId, id);
      if (r.status !== "clean") throw new AppError("NOT_FOUND", "Attachment not found");
      return { url: await storage().signedDownloadUrl(ATTACHMENT_BUCKET, r.storage_key, 60, r.file_name), expiresInSeconds: 60 };
    },

    /**
     * Worker job: deletes attachments of tickets resolved or closed more than 90 days ago (no legal hold), then removes
     * every queued file. Deleting a row (here, or by cascade when a ticket or team is erased) queues its file (0076).
     */
    async purgeExpired(): Promise<number> {
      const rows = [...(await deps.db.withSystem((tx) => tx.execute<{ id: string; workspace_id: string; storage_key: string }>(sql`select * from platform.support_attachments_expired(${ATTACHMENT_RETENTION_DAYS}, 500)`)))];
      for (const ws of new Set(rows.map((r) => r.workspace_id))) {
        const ids = rows.filter((r) => r.workspace_id === ws).map((r) => r.id);
        await deps.db.withWorkspace(ws, (tx) => tx.execute(sql`delete from wp.support_attachments where id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)`));
      }
      await this.removeQueuedFiles();
      return rows.length;
    },

    /** Removes stored files whose attachment rows are gone; a file stays queued until storage confirms the removal. */
    async removeQueuedFiles(): Promise<number> {
      if (!deps.storage) return 0;
      let removed = 0;
      for (;;) {
        const q = [...(await deps.db.withSystem((tx) => tx.execute<{ id: string; bucket: string; storage_key: string }>(sql`select * from platform.storage_deletions_pending(500)`)))];
        if (q.length === 0) return removed;
        for (const bucket of new Set(q.map((r) => r.bucket))) await deps.storage.remove(bucket, q.filter((r) => r.bucket === bucket).map((r) => r.storage_key));
        await deps.db.withSystem((tx) => tx.execute(sql`select platform.storage_deletions_done(array(select jsonb_array_elements_text(${JSON.stringify(q.map((r) => String(r.id)))}::jsonb)::bigint))`));
        removed += q.length;
        if (q.length < 500) return removed;
      }
    },
  };
}
export type Attachments = ReturnType<typeof createAttachments>;
