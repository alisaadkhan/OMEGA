import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MemoryStorage } from "@mushin/integrations";
import { deflateSync } from "node:zlib";
import { ATTACHMENT_BUCKET, basicScanner, createAttachments, sniffType } from "./attachments";
import { createSupportService } from "./index";

const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
const PDF_JS = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /OpenAction 2 0 R /JavaScript (app.alert(1)) >> endobj");

async function customer(): Promise<TenantContext> {
  const ws = await createTestWorkspace();
  return { ...ws, requestId: "req-att", role: "owner" };
}

// Owner decision 2026-11-03 (master directive Part 8, decision 2).
describe("support attachments", () => {
  it("accepts a real PNG or PDF up to 5 MB and hands out a short download link; refuses wrong types, fakes, active PDFs and other workspaces", async () => {
    const storage = new MemoryStorage();
    const att = createAttachments({ db, storage });
    const support = createSupportService({ db });
    const c = await customer();
    const t = await support.create(c, { subject: "Charged twice", category: "billing", body: "See the screenshot." });
    const who = { kind: "customer" as const, ctx: c };

    const png = await att.request(who, t.id, { fileName: "receipt.png", contentType: "image/png", sizeBytes: PNG.length });
    expect(png.uploadUrl).toContain(ATTACHMENT_BUCKET);
    const key = png.uploadUrl.split(`${ATTACHMENT_BUCKET}/`)[1] as string;
    await storage.put(ATTACHMENT_BUCKET, key, PNG, "image/png");
    expect(await att.complete(who, t.id, png.attachment.id)).toMatchObject({ status: "clean", sizeBytes: PNG.length, uploadedBy: "customer" });
    const dl = await att.downloadUrl(who, t.id, png.attachment.id);
    expect(dl).toMatchObject({ expiresInSeconds: 60 });
    expect(dl.url).toContain("download=receipt.png");

    // Declared PNG, actually HTML: rejected and the object deleted.
    const fake = await att.request(who, t.id, { fileName: "x.png", contentType: "image/png", sizeBytes: 20 });
    const fakeKey = fake.uploadUrl.split(`${ATTACHMENT_BUCKET}/`)[1] as string;
    await storage.put(ATTACHMENT_BUCKET, fakeKey, new TextEncoder().encode("<html><script>alert(1)</script>"), "image/png");
    await expect(att.complete(who, t.id, fake.attachment.id)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await storage.get(ATTACHMENT_BUCKET, fakeKey)).toBeNull();

    // A PDF with JavaScript is refused by the scan hook.
    const js = await att.request(who, t.id, { fileName: "doc.pdf", contentType: "application/pdf", sizeBytes: PDF_JS.length });
    await storage.put(ATTACHMENT_BUCKET, js.uploadUrl.split(`${ATTACHMENT_BUCKET}/`)[1] as string, PDF_JS, "application/pdf");
    await expect(att.complete(who, t.id, js.attachment.id)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    // Types, names and sizes are refused before anything is uploaded.
    await expect(att.request(who, t.id, { fileName: "a.svg", contentType: "image/svg+xml", sizeBytes: 10 })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(att.request(who, t.id, { fileName: "a.exe", contentType: "application/pdf", sizeBytes: 10 })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(att.request(who, t.id, { fileName: "big.pdf", contentType: "application/pdf", sizeBytes: 5 * 1024 * 1024 + 1 })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    // Another workspace cannot reach the ticket or its files.
    const other = { kind: "customer" as const, ctx: await customer() };
    await expect(att.list(other, t.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(att.downloadUrl(other, t.id, png.attachment.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await att.list(who, t.id)).map((a) => a.fileName)).toEqual(["receipt.png"]);
    expect(sniffType(PDF)).toBe("application/pdf");
  });

  it("sees through PDF name escapes and compressed streams, and refuses files on a closed request", async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const hidden = deflateSync(Buffer.from("<< /Type /Action /S /JavaScript /JS (app.alert(1)) >>"));
    const compressed = new Uint8Array(Buffer.concat([Buffer.from("%PDF-1.7\n5 0 obj << /Type /ObjStm /Filter /FlateDecode /Length " + hidden.length + " >>\nstream\n"), hidden, Buffer.from("\nendstream\nendobj\n%%EOF")]));
    expect((await basicScanner(enc("%PDF-1.7\n<< /OpenA#63tion 2 0 R >>"), "application/pdf")).clean).toBe(false);
    expect((await basicScanner(compressed, "application/pdf")).clean).toBe(false);
    expect((await basicScanner(enc("%PDF-1.7\n<< /Filter /FlateDecode >>\nstream\nnot zlib\nendstream"), "application/pdf")).clean).toBe(false);
    expect((await basicScanner(PDF, "application/pdf")).clean).toBe(true);

    const att = createAttachments({ db, storage: new MemoryStorage() });
    const support = createSupportService({ db });
    const c = await customer();
    const t = await support.create(c, { subject: "Done", category: "other", body: "Thanks." });
    await ownerQuery(`update wp.support_tickets set status = 'closed' where id = '${t.id}'`);
    await expect(att.request({ kind: "customer", ctx: c }, t.id, { fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "ticket_closed" } });
  });

  it("purges files 90 days after the ticket is resolved or closed, unless on legal hold", async () => {
    const storage = new MemoryStorage();
    const att = createAttachments({ db, storage });
    const support = createSupportService({ db });
    const c = await customer();
    const t = await support.create(c, { subject: "Old", category: "other", body: "Old issue." });
    const who = { kind: "customer" as const, ctx: c };
    const a = await att.request(who, t.id, { fileName: "a.pdf", contentType: "application/pdf", sizeBytes: PDF.length });
    const key = a.uploadUrl.split(`${ATTACHMENT_BUCKET}/`)[1] as string;
    await storage.put(ATTACHMENT_BUCKET, key, PDF, "application/pdf");
    await att.complete(who, t.id, a.attachment.id);
    expect(await att.purgeExpired()).toBe(0);
    await ownerQuery(`update wp.support_tickets set status = 'closed' where id = '${t.id}'`);
    // The lifecycle trigger stamps resolved_at on closing; move it back afterwards.
    await ownerQuery(`update wp.support_tickets set resolved_at = now() - interval '91 days', updated_at = now() - interval '91 days' where id = '${t.id}'`);
    await ownerQuery(`update wp.support_attachments set legal_hold = true where id = '${a.attachment.id}'`);
    expect(await att.purgeExpired()).toBe(0);
    await ownerQuery(`update wp.support_attachments set legal_hold = false where id = '${a.attachment.id}'`);
    expect(await att.purgeExpired()).toBe(1);
    expect(await storage.get(ATTACHMENT_BUCKET, key)).toBeNull();
  });

  it("removes the stored files when the team (and so its tickets) is erased", async () => {
    const storage = new MemoryStorage();
    const att = createAttachments({ db, storage });
    const c = await customer();
    const t = await createSupportService({ db }).create(c, { subject: "Bye", category: "other", body: "Erase me." });
    const who = { kind: "customer" as const, ctx: c };
    const a = await att.request(who, t.id, { fileName: "a.pdf", contentType: "application/pdf", sizeBytes: PDF.length });
    const key = a.uploadUrl.split(`${ATTACHMENT_BUCKET}/`)[1] as string;
    await storage.put(ATTACHMENT_BUCKET, key, PDF, "application/pdf");
    await att.complete(who, t.id, a.attachment.id);
    await ownerQuery(`select platform.erase_workspace('${c.workspaceId}')`);
    expect(await att.removeQueuedFiles()).toBe(1);
    expect(await storage.get(ATTACHMENT_BUCKET, key)).toBeNull();
  });
});
