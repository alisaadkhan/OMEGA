import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createImportSchema, IMPORT_MAX_ROWS, type CreateImport, type ImportDetail, type ImportSummary } from "@mushin/contracts";
import { AppError, encryptSecret, sha256Hex, type TenantContext } from "@mushin/core";
import type { Db, TenantTx } from "@mushin/db";
import { conceptsOf, countryCode, isUsableEmail, lockedForWorkspace, maskContact, NICHE_TAXONOMY, normalizeProfileUrl, suppressedUrls } from "../creators/index";

/**
 * Creator list imports (owner instruction 2026-10-26). Each row is checked (link, platform, duplicates, suppression)
 * and matched to the catalogue by canonical link. The organisation's niche, country and email are kept for this
 * workspace only: the shared catalogue is never changed, so imported values can never overwrite better evidence.
 * Profiles MUSHIN does not have are listed, not fetched. A retried upload (same Idempotency-Key) returns the first import.
 */
type Parsed = { header: string[]; rows: string[][] };

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF/LF). Formula-like cells are data here; they are never evaluated. */
export function parseCsv(text: string): Parsed {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) out.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) out.push(row);
  const [header = [], ...rows] = out;
  return { header: header.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_")), rows };
}

const URL_COLUMNS = ["profile_url", "url", "profile", "link"];
/** A niche name the organisation used, mapped to the canonical taxonomy (exact label, or a reviewed equivalent). */
function nicheLabel(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  const exact = NICHE_TAXONOMY.find((l) => l.toLowerCase() === t.toLowerCase());
  return exact ?? conceptsOf(t).find((c) => c.kind === "niche")?.niche ?? null;
}

export function createImportsService(deps: { db: Db; encryptionKey: Buffer }) {
  const tenant = (ctx: TenantContext) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });

  async function summaryOf(tx: TenantTx, workspaceId: string, id: string): Promise<ImportSummary | null> {
    const [r] = await tx.execute<{ id: string; source: string; reviewed_on: string | null; file_name: string | null; created_at: string; rows_total: number; rows_matched: number; rows_not_in_catalogue: number; rows_invalid: number; rows_duplicate: number }>(
      sql`select * from wp.creator_imports where workspace_id = ${workspaceId} and id = ${id}`,
    );
    if (!r) return null;
    return {
      id: r.id,
      source: r.source,
      reviewedOn: r.reviewed_on ? String(r.reviewed_on).slice(0, 10) : null,
      fileName: r.file_name,
      createdAt: new Date(r.created_at).toISOString(),
      counts: { total: r.rows_total, matched: r.rows_matched, notInCatalogue: r.rows_not_in_catalogue, invalid: r.rows_invalid, duplicate: r.rows_duplicate },
    };
  }

  async function detail(ctx: TenantContext, id: string): Promise<ImportDetail> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const s = await summaryOf(tx, ctx.workspaceId, id);
      if (!s) throw new AppError("NOT_FOUND", "Import not found");
      const rows = await tx.execute<{ row_no: number; input_url: string; status: ImportDetail["rows"][number]["status"]; problem: string | null; creator_id: string | null; platform: "instagram" | "tiktok" | "youtube" | null; declared_niche: string | null; declared_country: string | null; contact_id: string | null }>(
        sql`select row_no, input_url, status, problem, creator_id, platform, declared_niche, declared_country, contact_id from wp.creator_import_rows where workspace_id = ${ctx.workspaceId} and import_id = ${id} order by row_no`,
      );
      return { ...s, rows: rows.map((r) => ({ rowNo: r.row_no, inputUrl: r.input_url, status: r.status, problem: r.problem, creatorId: r.creator_id, platform: r.platform, declaredNiche: r.declared_niche, declaredCountry: r.declared_country, emailStored: r.contact_id !== null })) };
    });
  }

  async function list(ctx: TenantContext): Promise<ImportSummary[]> {
    return deps.db.withTenant(tenant(ctx), async (tx) => {
      const ids = await tx.execute<{ id: string }>(sql`select id from wp.creator_imports where workspace_id = ${ctx.workspaceId} order by created_at desc limit 50`);
      const out: ImportSummary[] = [];
      for (const { id } of ids) {
        const s = await summaryOf(tx, ctx.workspaceId, id);
        if (s) out.push(s);
      }
      return out;
    });
  }

  async function create(ctx: TenantContext, input: CreateImport, idempotencyKey: string): Promise<ImportDetail> {
    const body = createImportSchema.parse(input);
    const { header, rows } = parseCsv(body.csv);
    const urlCol = header.findIndex((h) => URL_COLUMNS.includes(h));
    if (urlCol < 0) throw new AppError("VALIDATION_FAILED", "The file needs a profile_url column (the creator's profile link).", { reason: "missing_url_column" });
    if (rows.length === 0) throw new AppError("VALIDATION_FAILED", "The file has no rows below its header.", { reason: "no_rows" });
    if (rows.length > IMPORT_MAX_ROWS) throw new AppError("VALIDATION_FAILED", `Import up to ${IMPORT_MAX_ROWS.toLocaleString("en-US")} creators at a time.`, { reason: "too_many_rows" });
    const col = (name: string) => header.indexOf(name);
    const [cPlatform, cNiche, cCountry, cEmail] = [col("platform"), col("niche"), col("country"), col("email")];

    const id = await deps.db.withTenant(tenant(ctx), async (tx) => {
      const [existing] = await tx.execute<{ id: string }>(sql`select id from wp.creator_imports where workspace_id = ${ctx.workspaceId} and idempotency_key = ${idempotencyKey}`);
      if (existing) return existing.id;
      const urls = rows.map((r) => normalizeProfileUrl(r[urlCol] ?? "")?.canonicalUrl).filter((u): u is string => Boolean(u));
      const suppressed = await suppressedUrls(tx, urls);
      const seen = new Set<string>();
      const counts = { matched: 0, not_in_catalogue: 0, invalid: 0, duplicate: 0 };
      // The import row is written once, with its counts, after every row is checked (imports are write-once).
      const importId = randomUUID();
      const outcomes: { rowNo: number; input: string; canonical: string | null; platform: string | null; creatorId: string | null; status: string; problem: string | null; niche: string | null; country: string | null; contactId: string | null }[] = [];
      for (const [i, r] of rows.entries()) {
        const input = (r[urlCol] ?? "").trim().slice(0, 300);
        const url = normalizeProfileUrl(input);
        const declaredPlatform = cPlatform >= 0 ? (r[cPlatform] ?? "").trim().toLowerCase() : "";
        const niche = cNiche >= 0 ? nicheLabel(r[cNiche] ?? "") : null;
        const country = cCountry >= 0 && (r[cCountry] ?? "").trim() ? countryCode(r[cCountry] ?? "") : null;
        const email = cEmail >= 0 ? (r[cEmail] ?? "").trim().toLowerCase() : "";
        let status: "matched" | "not_in_catalogue" | "invalid" | "duplicate";
        let problem: string | null = null;
        let creatorId: string | null = null;
        if (!url) [status, problem] = ["invalid", "Not an Instagram, TikTok or YouTube profile link"];
        else if (declaredPlatform && declaredPlatform !== url.platform) [status, problem] = ["invalid", `The link is a ${url.platform} profile, not ${declaredPlatform}`];
        else if (seen.has(url.canonicalUrl)) [status, problem] = ["duplicate", "The same profile appears earlier in this file"];
        else if (suppressed.has(url.canonicalUrl)) [status, problem] = ["invalid", "This profile can't be added"];
        else {
          const [c] = await tx.execute<{ id: string }>(sql`select p.creator_id id from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id where p.canonical_url = ${url.canonicalUrl} and c.status = 'active'`);
          creatorId = c?.id ?? null;
          // Pakistan-only lock (BUG-36): a locked creator this workspace does not already hold is answered like an unknown
          // profile. A matched import row would otherwise count as holding it and unlock it for this workspace.
          if (creatorId && (await lockedForWorkspace(tx, creatorId, new Date()))) creatorId = null;
          status = creatorId ? "matched" : "not_in_catalogue";
          if (!creatorId) problem = "Not in MUSHIN yet: add it by link to fetch it (uses credits)";
        }
        if (url) seen.add(url.canonicalUrl);
        const notes: string[] = [];
        if (cNiche >= 0 && (r[cNiche] ?? "").trim() && !niche) notes.push("niche not recognised");
        if (cCountry >= 0 && (r[cCountry] ?? "").trim() && !country) notes.push("country not recognised");
        let contactId: string | null = null;
        if (email) {
          if (!isUsableEmail(email)) notes.push("email not usable");
          else if (status !== "matched" || !creatorId) notes.push("email kept only for profiles in MUSHIN");
          else {
            const hash = sha256Hex(email);
            await tx.execute(sql`insert into wp.workspace_contacts (workspace_id, creator_id, value_encrypted, value_hash, masked, source, created_by)
              values (${ctx.workspaceId}, ${creatorId}, ${encryptSecret(email, deps.encryptionKey)}, ${hash}, ${maskContact("email", email)}, 'imported', ${ctx.userId})
              on conflict (workspace_id, creator_id, value_hash) do nothing`);
            const [wc] = await tx.execute<{ id: string }>(sql`select id from wp.workspace_contacts where workspace_id = ${ctx.workspaceId} and creator_id = ${creatorId} and value_hash = ${hash}`);
            contactId = wc?.id ?? null;
          }
        }
        if (notes.length) problem = [problem, ...notes].filter(Boolean).join("; ").slice(0, 200);
        counts[status]++;
        outcomes.push({ rowNo: i + 1, input: input || "(empty)", canonical: url?.canonicalUrl ?? null, platform: url?.platform ?? null, creatorId, status, problem, niche: status === "invalid" ? null : niche, country: status === "invalid" ? null : country, contactId });
      }
      await tx.execute(sql`insert into wp.creator_imports (id, workspace_id, created_by, idempotency_key, source, reviewed_on, file_name, rows_total, rows_matched, rows_not_in_catalogue, rows_invalid, rows_duplicate)
        values (${importId}, ${ctx.workspaceId}, ${ctx.userId}, ${idempotencyKey}, ${body.source}, ${body.reviewedOn}, ${body.fileName}, ${rows.length}, ${counts.matched}, ${counts.not_in_catalogue}, ${counts.invalid}, ${counts.duplicate})`);
      for (const o of outcomes) {
        await tx.execute(sql`insert into wp.creator_import_rows (import_id, workspace_id, row_no, input_url, canonical_url, platform, creator_id, status, problem, declared_niche, declared_country, contact_id)
          values (${importId}, ${ctx.workspaceId}, ${o.rowNo}, ${o.input}, ${o.canonical}, ${o.platform}, ${o.creatorId}, ${o.status}, ${o.problem}, ${o.niche}, ${o.country}, ${o.contactId})`);
      }
      return importId;
    });
    return detail(ctx, id);
  }

  return { create, detail, list };
}
export type ImportsService = ReturnType<typeof createImportsService>;
