import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@mushin/core";
import { writeOutbox, type Db, type SystemTx } from "@mushin/db";
import { bulkRefreshProfileCountries } from "../creators/index";
import { recordStaffAudit, type StaffPrincipal } from "../staff/index";

type Meta = { ip: string | null; requestId: string | null };

/** Profiles below this many followers are not worth a staff review (owner directive 2026-11-03, addendum item 4). */
export const REVIEW_MIN_FOLLOWERS = 5_000;

export const reviewKindSchema = z.enum(["country", "minor", "assessment"]);
export type ReviewKind = z.infer<typeof reviewKindSchema>;

export const reviewQuerySchema = z.object({ kind: reviewKindSchema.default("country"), offset: z.coerce.number().int().min(0).max(100_000).default(0) });

const profileSchema = z.object({
  platform: z.string(),
  handle: z.string(),
  url: z.string(),
  followers: z.number().nullable(),
  countryStatus: z.string().nullable(),
  country: z.string().nullable(),
  countrySource: z.string().nullable(),
  bio: z.string().nullable(),
});
export const reviewItemSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  publicCountry: z.string().nullable(),
  publicCountrySource: z.string().nullable(),
  isMinor: z.boolean(),
  minorReason: z.string().nullable(),
  assessmentStatus: z.string().nullable(),
  profiles: z.array(profileSchema),
});
export const reviewListSchema = z.object({ items: z.array(reviewItemSchema), total: z.number().int(), counts: z.record(reviewKindSchema, z.number().int()) });

/** Evidence is required: a country is never set from a name, a face or a language (owner rule), only from a source. */
export const setCountrySchema = z.object({
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter country code, e.g. PK"),
  evidence: z.string().trim().min(12, "Say where this comes from (a link or a short note)").max(400),
});
export const clearMinorSchema = z.object({ reason: z.string().trim().min(12, "Say why this creator is not a minor").max(500) });

const KIND_WHERE: Record<ReviewKind, ReturnType<typeof sql>> = {
  country: sql`exists (select 1 from gcp.creator_profiles p where p.creator_id = c.id and p.followers >= ${REVIEW_MIN_FOLLOWERS} and p.country_status in ('unknown', 'conflicting'))
    and not exists (select 1 from gcp.creator_profiles p where p.creator_id = c.id and p.country_status = 'pakistan')`,
  minor: sql`c.is_minor and c.minor_override_by_staff_id is null`,
  assessment: sql`(c.assessment_status is null or c.assessment_status in ('pending', 'insufficient_data'))
    and exists (select 1 from gcp.creator_profiles p where p.creator_id = c.id and p.followers >= ${REVIEW_MIN_FOLLOWERS})`,
};

const PAGE = 50;

/**
 * Catalogue review for staff (owner directive 2026-11-03, addendum item 4): creators with a sizeable profile whose country
 * is unknown or conflicting, possible minors, and creators still awaiting an assessment. A staff country decision is a
 * public-record country with the staff member's evidence (never the creator's own confirmation); clearing a minor flag
 * records who and why. Each change re-decides the profiles' countries, re-projects search and is audited.
 */
export function createCatalogueReview(deps: { db: Db }) {
  async function counts(tx: SystemTx): Promise<Record<ReviewKind, number>> {
    const [r] = await tx.execute<Record<ReviewKind, number>>(sql`
      select
        (select count(*)::int from gcp.creators c where c.status = 'active' and ${KIND_WHERE.country}) as country,
        (select count(*)::int from gcp.creators c where c.status = 'active' and ${KIND_WHERE.minor}) as minor,
        (select count(*)::int from gcp.creators c where c.status = 'active' and ${KIND_WHERE.assessment}) as assessment`);
    return r ?? { country: 0, minor: 0, assessment: 0 };
  }

  async function active(tx: SystemTx, id: string): Promise<void> {
    const [c] = await tx.execute<{ id: string }>(sql`select id from gcp.creators where id = ${id} and status = 'active' for update`);
    if (!c) throw new AppError("NOT_FOUND", "Creator not found");
  }

  return {
    async list(q: z.infer<typeof reviewQuerySchema>): Promise<z.infer<typeof reviewListSchema>> {
      return deps.db.withSystem(async (tx) => {
        const items = await tx.execute<z.infer<typeof reviewItemSchema>>(sql`
          select c.id, c.display_name as "displayName", c.avatar_url as "avatarUrl", c.city, c.country,
            c.public_country as "publicCountry", c.public_country_source as "publicCountrySource",
            c.is_minor as "isMinor", c.minor_reason as "minorReason", c.assessment_status as "assessmentStatus",
            coalesce((select jsonb_agg(jsonb_build_object('platform', p.platform, 'handle', p.handle, 'url', p.canonical_url, 'followers', p.followers,
              'countryStatus', p.country_status, 'country', p.country, 'countrySource', p.country_source, 'bio', left(p.bio, 400)) order by p.followers desc nulls last)
              from gcp.creator_profiles p where p.creator_id = c.id), '[]'::jsonb) as profiles
          from gcp.creators c
          where c.status = 'active' and ${KIND_WHERE[q.kind]}
          order by (select max(p.followers) from gcp.creator_profiles p where p.creator_id = c.id) desc nulls last, c.id
          limit ${PAGE} offset ${q.offset}`);
        const n = await counts(tx);
        return { items: [...items], total: n[q.kind], counts: n };
      });
    },

    async setCountry(staff: StaffPrincipal, id: string, body: z.infer<typeof setCountrySchema>, meta: Meta) {
      return deps.db.withSystem(async (tx) => {
        await active(tx, id);
        const source = `Staff review: ${body.evidence}`.slice(0, 500);
        await tx.execute(sql`update gcp.creators set public_country = ${body.country}, public_country_source = ${source}, public_country_at = now(), updated_at = now() where id = ${id}`);
        const changed = await bulkRefreshProfileCountries(tx, [id], { source: "staff" });
        await writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: id, workspaceId: null, payload: { creatorId: id }, requestId: meta.requestId });
        await recordStaffAudit(tx, { staffId: staff.staffId, action: "catalogue.country_set", metadata: { creatorId: id, country: body.country, evidence: body.evidence, changed: changed.length }, ip: meta.ip, requestId: meta.requestId });
        return { changed: changed.map((c) => ({ platform: c.platform, from: c.from, to: c.to.status })) };
      });
    },

    async clearMinor(staff: StaffPrincipal, id: string, body: z.infer<typeof clearMinorSchema>, meta: Meta) {
      return deps.db.withSystem(async (tx) => {
        await active(tx, id);
        const rows = await tx.execute<{ id: string }>(sql`
          update gcp.creators set minor_override_by_staff_id = ${staff.staffId}, minor_override_reason = ${body.reason}, updated_at = now()
          where id = ${id} and is_minor and minor_override_by_staff_id is null returning id`);
        if (rows.length === 0) throw new AppError("CONFLICT", "This creator is not flagged as a possible minor.");
        await writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: id, workspaceId: null, payload: { creatorId: id }, requestId: meta.requestId });
        await recordStaffAudit(tx, { staffId: staff.staffId, action: "catalogue.minor_cleared", metadata: { creatorId: id, reason: body.reason }, ip: meta.ip, requestId: meta.requestId });
        return { cleared: true as const };
      });
    },
  };
}
