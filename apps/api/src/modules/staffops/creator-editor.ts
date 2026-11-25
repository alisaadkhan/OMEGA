import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@mushin/core";
import { writeOutbox, type Db, type SystemTx } from "@mushin/db";
import { ACCOUNT_TYPES } from "../creators/account-type";
import { NICHE_TAXONOMY } from "../creators/terminology";
import { recordStaffAudit, type StaffPrincipal } from "../staff/index";

type Meta = { ip: string | null; requestId: string | null };
const reason = z.string().trim().min(12, "Give a reason of at least 12 characters").max(500);

export const creatorFilterSchema = z.enum(["qualified", "unreachable", "unqualified", "refresh", "all", "reported", "country", "minor", "organisation", "assessment", "hidden", "trash"]);
export const creatorListQuerySchema = z.object({
  q: z.string().trim().max(80).default(""),
  filter: creatorFilterSchema.default("qualified"),
  /** One problem (an eligibility reason) to review on its own (owner, 25 Nov: "categories of creators based on problem"). */
  problem: z.string().regex(/^[a-z_]{3,40}$/).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const profile = z.object({ platform: z.string(), handle: z.string(), url: z.string(), followers: z.number().nullable(), countryStatus: z.string().nullable(), country: z.string().nullable(), countrySource: z.string().nullable(), bio: z.string().nullable(), verified: z.boolean().nullable() });
export const staffCreatorSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  publicCountry: z.string().nullable(),
  publicCountrySource: z.string().nullable(),
  status: z.string(),
  hiddenReason: z.string().nullable(),
  trashedAt: z.string().nullable(),
  trashBanned: z.boolean(),
  trashReason: z.string().nullable(),
  isMinor: z.boolean(),
  minorReason: z.string().nullable(),
  organisationCategory: z.string().nullable(),
  accountType: z.string().nullable(),
  nicheMain: z.string().nullable(),
  niches: z.array(z.string()),
  assessmentStatus: z.string().nullable(),
  eligible: z.boolean(),
  hiddenBecause: z.array(z.string()),
  reports: z.number().int(),
  reportReasons: z.array(z.string()),
  profiles: z.array(profile),
  /** Links from the bio and About sections (shown as icons in Creator Checks, owner 24 Nov). */
  links: z.array(z.string()).default([]),
});
export const staffCreatorListSchema = z.object({
  items: z.array(staffCreatorSchema),
  total: z.number().int(),
  counts: z.record(creatorFilterSchema, z.number().int()),
  /** Creators that do not qualify, counted per problem; a creator with two problems counts under both. */
  problems: z.record(z.string(), z.number().int()).default({}),
});

/** What staff may change on a creator; each change needs a reason and is audited. */
export const creatorEditSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    city: z.string().trim().max(100).nullable().optional(),
    nicheMain: z.enum(NICHE_TAXONOMY).nullable().optional(),
    accountType: z.enum(ACCOUNT_TYPES).optional(),
    reason,
  })
  .refine((b) => b.displayName !== undefined || b.city !== undefined || b.nicheMain !== undefined || b.accountType !== undefined, { message: "Change at least one field" });
export const creatorReasonSchema = z.object({ reason });
export const creatorTrashSchema = z.object({ reason, ban: z.boolean().default(false) });

const PAGE = 50;
const ORG_TYPES = sql`('CELEBRITY_PUBLIC_FIGURE', 'COMPANY_CORPORATE', 'BRAND_ACCOUNT', 'BUSINESS_STORE', 'MEDIA_PUBLICATION', 'FAN_PAGE_AGGREGATOR')`;
const WHERE: Record<z.infer<typeof creatorFilterSchema>, ReturnType<typeof sql>> = {
  // Sub-pages (owner, 23 Nov): each active creator is on exactly one of the first three.
  qualified: sql`c.status = 'active' and coalesce(d.eligible, false) and coalesce(d.has_contact, false)`,
  unreachable: sql`c.status = 'active' and coalesce(d.eligible, false) and not coalesce(d.has_contact, false)`,
  unqualified: sql`c.status = 'active' and not coalesce(d.eligible, false)`,
  refresh: sql`c.status = 'active' and not coalesce(d.eligible, false) and 'followers_unknown' = any(d.eligibility_reasons)`,
  all: sql`c.status in ('active', 'hidden')`,
  reported: sql`c.status in ('active', 'hidden') and r.pending > 0`,
  country: sql`c.status = 'active' and exists (select 1 from gcp.creator_profiles p where p.creator_id = c.id and p.followers >= 5000 and p.country_status in ('unknown', 'conflicting'))
    and not exists (select 1 from gcp.creator_profiles p where p.creator_id = c.id and p.country_status = 'pakistan')`,
  minor: sql`c.status = 'active' and c.is_minor and c.minor_override_by_staff_id is null`,
  organisation: sql`c.status = 'active' and (c.organisation_category is not null or (c.account_type in ${ORG_TYPES} and c.account_type_confidence in ('high', 'medium'))) and c.organisation_override_by_staff_id is null`,
  assessment: sql`c.status = 'active' and (c.assessment_status is null or c.assessment_status in ('pending', 'insufficient_data'))
    and exists (select 1 from gcp.creator_profiles p where p.creator_id = c.id and p.followers >= 5000)`,
  hidden: sql`c.status = 'hidden'`,
  trash: sql`c.status = 'trashed'`,
};
// Creators who meet every rule except proof of Pakistan (owner, 25 Nov: "they qualify, the problem is location; I will
// review each one myself"). A proven non-Pakistan country is not here: that is a decided fact, not a missing one.
export const LOCATION_ONLY = "location_only";
const ONLY_LOCATION = sql`cardinality(d.eligibility_reasons) > 0 and d.eligibility_reasons <@ array['country_unknown', 'country_conflicting', 'country_stale']::text[]`;
// Creators who qualify but miss something (owner, 25 Nov: "categories for creators that qualify but are missing info,
// they still qualify"). They stay searchable; these are only staff to-do lists.
export const GAPS: Record<string, ReturnType<typeof sql>> = {
  gap_niche: sql`c.niche_main is null`,
  gap_city: sql`c.city is null`,
  gap_contact: sql`not coalesce(d.has_contact, false)`,
  gap_assessment: sql`(c.assessment_status is null or c.assessment_status <> 'assessed')`,
};
const FROM = sql`gcp.creators c left join platform.staff_creator_report_counts() r on r.creator_id = c.id left join gcp.creator_search_documents d on d.creator_id = c.id`;

function nameOrHandle(text: string) {
  const term = text.replace(/^@/, "").replace(/[%_\\]/g, (m) => `\\${m}`);
  return term ? sql`(c.display_name ilike ${`%${term}%`} or exists (select 1 from gcp.creator_profiles p where p.creator_id = c.id and p.handle ilike ${`%${term}%`}))` : sql`true`;
}

/**
 * Every creator for staff, with what customers see and the open customer reports (owner, 22 Nov: "Creator Checks is
 * where all our creators show; edit every detail; highlight reported profiles"). Edits, hiding and removal are audited
 * and re-project the creator into search at once (no worker needed).
 */
export function createCreatorEditor(deps: { db: Db; reindex: (ids: string[]) => Promise<unknown>; remove: (creatorId: string, staff: StaffPrincipal, reason: string, meta: Meta) => Promise<unknown> }) {
  const changed = async (tx: SystemTx, id: string, meta: Meta) =>
    writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: id, workspaceId: null, payload: { creatorId: id }, requestId: meta.requestId });
  const exists = async (tx: SystemTx, id: string) => {
    const [c] = await tx.execute<{ status: string }>(sql`select status from gcp.creators where id = ${id} for update`);
    if (!c || !["active", "hidden"].includes(c.status)) throw new AppError("NOT_FOUND", "Creator not found");
    return c.status;
  };

  return {
    async list(q: z.infer<typeof creatorListQuerySchema>): Promise<z.infer<typeof staffCreatorListSchema>> {
      const gap = q.problem ? GAPS[q.problem] : undefined;
      const where = !q.problem ? WHERE[q.filter] : gap ? sql`${WHERE[q.filter]} and ${gap}` : q.problem === LOCATION_ONLY ? sql`${WHERE[q.filter]} and ${ONLY_LOCATION}` : sql`${WHERE[q.filter]} and ${q.problem} = any(d.eligibility_reasons)`;
      const gapBase = q.filter === "unreachable" ? WHERE.unreachable : WHERE.qualified;
      return deps.db.withSystem(async (tx) => {
        const items = await tx.execute<z.infer<typeof staffCreatorSchema>>(sql`
          select c.id, c.display_name as "displayName", c.avatar_url as "avatarUrl", c.city, c.country, c.public_country as "publicCountry",
            c.public_country_source as "publicCountrySource", c.status, c.hidden_reason as "hiddenReason", to_char(c.trashed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "trashedAt", c.trash_banned as "trashBanned", c.trash_reason as "trashReason", c.is_minor as "isMinor", c.minor_reason as "minorReason",
            coalesce(c.organisation_category, case when c.account_type in ${ORG_TYPES} then initcap(replace(lower(c.account_type), '_', ' ')) end) as "organisationCategory",
            c.account_type as "accountType", c.niche_main as "nicheMain", c.niches, c.assessment_status as "assessmentStatus",
            coalesce(d.eligible, false) as eligible, coalesce(d.eligibility_reasons, '{}') as "hiddenBecause",
            coalesce(r.pending, 0) as reports, coalesce(r.reasons, '{}') as "reportReasons",
            coalesce((select jsonb_agg(jsonb_build_object('platform', p.platform, 'handle', p.handle, 'url', p.canonical_url, 'followers', p.followers, 'countryStatus', p.country_status,
              'country', p.country, 'countrySource', p.country_source, 'bio', left(p.bio, 400), 'verified', p.verified) order by p.followers desc nulls last)
              from gcp.creator_profiles p where p.creator_id = c.id), '[]'::jsonb) as profiles,
            coalesce((select array_agg(l.url order by l.first_seen_at, l.url) from gcp.creator_links l where l.creator_id = c.id), '{}') as links
          from ${FROM}
          where ${where} and ${nameOrHandle(q.q)}
          order by coalesce(r.pending, 0) desc, (select max(p.followers) from gcp.creator_profiles p where p.creator_id = c.id) desc nulls last, c.id
          limit ${PAGE} offset ${q.offset}`);
        const [t] = await tx.execute<{ n: number }>(sql`select count(*)::int n from ${FROM} where ${where} and ${nameOrHandle(q.q)}`);
        const [cnt] = await tx.execute<Record<z.infer<typeof creatorFilterSchema>, number>>(sql`select
          ${sql.join(creatorFilterSchema.options.map((f) => sql`(select count(*)::int from ${FROM} where ${WHERE[f]}) as ${sql.identifier(f)}`), sql`, `)}`);
        const problems = await tx.execute<{ r: string; n: number }>(sql`
          select r, count(*)::int n from (select d.eligibility_reasons rs from ${FROM} where ${WHERE.unqualified}) x, unnest(x.rs) r group by r
          union all select ${LOCATION_ONLY}, count(*)::int from ${FROM} where ${WHERE.unqualified} and ${ONLY_LOCATION}
          ${sql.join(Object.entries(GAPS).map(([k, g]) => sql`union all select ${k}, count(*)::int from ${FROM} where ${gapBase} and ${g}`), sql` `)}`);
        return { items: [...items], total: t?.n ?? 0, problems: Object.fromEntries(problems.map((p) => [p.r, p.n])), counts: cnt ?? { qualified: 0, unreachable: 0, unqualified: 0, refresh: 0, all: 0, reported: 0, country: 0, minor: 0, organisation: 0, assessment: 0, hidden: 0, trash: 0 } };
      });
    },

    async update(staff: StaffPrincipal, id: string, body: z.infer<typeof creatorEditSchema>, meta: Meta) {
      await deps.db.withSystem(async (tx) => {
        await exists(tx, id);
        const sets = [
          body.displayName !== undefined ? sql`display_name = ${body.displayName}` : null,
          body.city !== undefined ? sql`city = ${body.city || null}` : null,
          // A staff niche is classified with high confidence; who set it and why is in the audit log.
          body.nicheMain !== undefined
            ? body.nicheMain === null
              ? sql`niche_main = null, niche_status = 'unknown', niches = '{}'`
              : sql`niche_main = ${body.nicheMain}, niche_status = 'classified', niche_confidence = 'high', niche_source = null, niches = array[${body.nicheMain}]::text[], niche_assessed_at = now()`
            : null,
          body.accountType !== undefined ? sql`account_type = ${body.accountType}, account_type_source = 'staff', account_type_confidence = 'high'` : null,
        ].filter((s): s is ReturnType<typeof sql> => s !== null);
        await tx.execute(sql`update gcp.creators set ${sql.join(sets, sql`, `)}, updated_at = now() where id = ${id}`);
        await changed(tx, id, meta);
        const { reason: why, ...fields } = body;
        await recordStaffAudit(tx, { staffId: staff.staffId, action: "catalogue.creator_edited", metadata: { creatorId: id, fields, reason: why }, ip: meta.ip, requestId: meta.requestId });
      });
      await deps.reindex([id]);
    },

    async setHidden(staff: StaffPrincipal, id: string, hidden: boolean, why: string, meta: Meta) {
      await deps.db.withSystem(async (tx) => {
        const status = await exists(tx, id);
        if ((status === "hidden") === hidden) throw new AppError("CONFLICT", hidden ? "This creator is already hidden." : "This creator is not hidden.");
        await tx.execute(
          hidden
            ? sql`update gcp.creators set status = 'hidden', hidden_by_staff_id = ${staff.staffId}, hidden_reason = ${why}, hidden_at = now(), updated_at = now() where id = ${id}`
            : sql`update gcp.creators set status = 'active', hidden_by_staff_id = null, hidden_reason = null, hidden_at = null, reports_reviewed_at = now(), updated_at = now() where id = ${id}`,
        );
        await changed(tx, id, meta);
        await recordStaffAudit(tx, { staffId: staff.staffId, action: hidden ? "catalogue.creator_hidden" : "catalogue.creator_unhidden", metadata: { creatorId: id, reason: why }, ip: meta.ip, requestId: meta.requestId });
      });
      await deps.reindex([id]);
    },

    /**
     * Trash (owner, 23 Nov): out of every customer view now, restorable for 45 days, then erased by the daily job.
     * Ban also puts the creator's profile links on the do-not-re-add list at once, so no search or import adds it back.
     */
    async trash(staff: StaffPrincipal, id: string, body: z.infer<typeof creatorTrashSchema>, meta: Meta) {
      await deps.db.withSystem(async (tx) => {
        await exists(tx, id);
        await tx.execute(sql`update gcp.creators set status = 'trashed', trashed_at = now(), trashed_by_staff_id = ${staff.staffId}, trash_reason = ${body.reason},
          trash_banned = ${body.ban}, updated_at = now() where id = ${id}`);
        if (body.ban)
          await tx.execute(sql`insert into gcp.creator_suppressions (url_hash, platform, banned_creator_id)
            select encode(sha256(convert_to(lower(trim(p.canonical_url)), 'UTF8')), 'hex'), p.platform, ${id}::uuid from gcp.creator_profiles p where p.creator_id = ${id}
            on conflict (url_hash) do nothing`);
        await changed(tx, id, meta);
        await recordStaffAudit(tx, { staffId: staff.staffId, action: body.ban ? "catalogue.creator_banned" : "catalogue.creator_trashed", metadata: { creatorId: id, reason: body.reason }, ip: meta.ip, requestId: meta.requestId });
      });
      await deps.reindex([id]);
    },

    /** Restore from Trash within 45 days: the creator is active again and a ban on its links is lifted. */
    async restore(staff: StaffPrincipal, id: string, why: string, meta: Meta) {
      await deps.db.withSystem(async (tx) => {
        const [c] = await tx.execute<{ status: string }>(sql`select status from gcp.creators where id = ${id} for update`);
        if (!c || c.status !== "trashed") throw new AppError("NOT_FOUND", "This creator is not in Trash.");
        await tx.execute(sql`select platform.staff_lift_ban(${id}::uuid)`);
        await tx.execute(sql`update gcp.creators set status = 'active', trashed_at = null, trashed_by_staff_id = null, trash_reason = null, trash_banned = false, updated_at = now() where id = ${id}`);
        await changed(tx, id, meta);
        await recordStaffAudit(tx, { staffId: staff.staffId, action: "catalogue.creator_restored", metadata: { creatorId: id, reason: why }, ip: meta.ip, requestId: meta.requestId });
      });
      await deps.reindex([id]);
    },

    async remove(staff: StaffPrincipal, id: string, why: string, meta: Meta) {
      await deps.db.withSystem((tx) => exists(tx, id));
      await deps.remove(id, staff, why, meta);
      await deps.reindex([id]);
    },
  };
}
