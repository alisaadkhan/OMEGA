import { and, desc, eq, sql } from "drizzle-orm";
import { encryptSecret, sha256Hex } from "@mushin/core";
import { refreshProfileCountries } from "./enrichment/repository";
import {
  audienceViews,
  contactReveals,
  creatorAttributeEvidence,
  creatorContacts,
  creatorLinks,
  creatorProfiles,
  creators,
  enrichmentSnapshots,
  niches,
  savedSearches,
  searchSettings,
  writeOutbox,
  type AudienceRow,
  type EvidenceRow,
  type SystemTx,
  type TenantTx,
} from "@mushin/db";
import type { CreatorDocument } from "@mushin/integrations";
import type { MatchFields } from "./match-reasons";
import { creatorEligibility, ELIGIBILITY_VERSION, type CreatorEligibility, type EligibilityProfile, countryLocked } from "./eligibility";
import { isMinorProtected, maskContact, type FitWeights, type FreshnessThresholds, type LabelThresholds, type SummarySource } from "./rules";

type Tx = TenantTx | SystemTx;
type Platform = "instagram" | "tiktok" | "youtube";

/** Visible to customers: active, and not a possible minor without a staff override (SRS §5.2). */
const VISIBLE = sql`c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null)`;

// ── config ──────────────────────────────────────────────────────────────────
export type SearchSettings = {
  weights: FitWeights;
  labels: LabelThresholds;
  fresh: FreshnessThresholds;
  candidatePool: number;
  pageSize: number;
  fewResults: number;
};

export async function getSearchSettings(tx: Tx): Promise<SearchSettings> {
  const [s] = await tx.select().from(searchSettings).limit(1);
  if (!s) throw new Error("platform.search_settings has no row");
  return {
    weights: { text: s.weightText, filters: s.weightFilters, engagement: s.weightEngagement, authenticity: s.weightAuthenticity, freshness: s.weightFreshness },
    labels: { best: s.labelBest, strong: s.labelStrong, possible: s.labelPossible },
    fresh: { currentDays: s.freshCurrentDays, agingDays: s.freshAgingDays },
    candidatePool: s.candidatePool,
    pageSize: s.pageSize,
    fewResults: s.fewResults,
  };
}

export async function activeNiches(tx: Tx): Promise<string[]> {
  const rows = await tx.select({ label: niches.label }).from(niches).where(eq(niches.active, true)).orderBy(niches.sortOrder);
  return rows.map((r) => r.label);
}

// ── search hydration ────────────────────────────────────────────────────────
export type CardRow = {
  id: string;
  displayName: string;
  primaryHandle: string;
  primaryPlatform: Platform;
  avatarUrl: string | null;
  city: string | null;
  country: string | null;
  niches: string[];
  tags: string[];
  verified: boolean;
  authenticityScore: number | null;
  fakeFollowerPct: number | null;
  followers: number | null;
  engagementRate: number | null;
  followersUpdatedAt: Date | null;
  /** Kind and status of each stored contact (never the value). */
  contactStates: { kind: "email" | "phone"; status: string }[];
  /** Creator eligibility (elig-1) from the stored creator and profiles, as of the read (the same function builds the index). */
  eligibility: CreatorEligibility;
};

/** Card data straight from Postgres; creators the index still lists but Postgres now hides are dropped here. */
export async function cardRows(tx: Tx, ids: string[]): Promise<CardRow[]> {
  if (ids.length === 0) return [];
  const rows = await tx.execute<Omit<CardRow, "followersUpdatedAt" | "eligibility"> & { followersUpdatedAt: string | Date | null }>(sql`
    select c.id, c.display_name as "displayName", c.primary_handle as "primaryHandle", c.primary_platform as "primaryPlatform",
      c.avatar_url as "avatarUrl", c.city, c.country, c.niches, c.tags, c.verified,
      c.authenticity_score as "authenticityScore", c.fake_follower_pct as "fakeFollowerPct",
      case when p.platform = 'youtube' and p.followers = 0 then null else p.followers end as followers,
      p.engagement_rate as "engagementRate", p.followers_updated_at as "followersUpdatedAt",
      coalesce((select jsonb_agg(jsonb_build_object('kind', k.kind, 'status', k.status)) from gcp.creator_contacts k where k.creator_id = c.id), '[]'::jsonb) as "contactStates"
    from gcp.creators c
    left join lateral (
      select pr.platform, pr.followers, pr.engagement_rate, pr.followers_updated_at from gcp.creator_profiles pr
      where pr.creator_id = c.id order by (pr.platform = c.primary_platform) desc, pr.followers desc limit 1
    ) p on true
    where c.id in ${ids} and ${VISIBLE}`);
  // Raw queries return timestamps as text.
  const eligibility = await eligibilityOf(tx, rows.map((r) => r.id), new Date());
  return rows.map((r) => ({ ...r, followersUpdatedAt: r.followersUpdatedAt === null ? null : new Date(r.followersUpdatedAt), eligibility: eligibility.get(r.id) ?? notEvaluated() }));
}

/** The text the search projection indexed for these creators (to explain matches on one page of results). */
export async function matchFieldRows(tx: Tx, ids: string[]): Promise<(MatchFields & { id: string })[]> {
  if (ids.length === 0) return [];
  return tx.execute<MatchFields & { id: string }>(sql`
    select d.creator_id as id, d.display_name as "displayName", d.name_variants as "nameVariants", d.handles, d.niches, d.tags, d.city, d.bio
    from gcp.creator_search_documents d
    where d.creator_id in ${ids}`);
}

export async function findIdByCanonicalUrl(tx: Tx, canonicalUrl: string): Promise<string | null> {
  const rows = await tx.select({ id: creatorProfiles.creatorId }).from(creatorProfiles).where(eq(creatorProfiles.canonicalUrl, canonicalUrl)).limit(1);
  return rows[0]?.id ?? null;
}

// ── profile ─────────────────────────────────────────────────────────────────
export type CreatorRow = Pick<
  typeof creators.$inferSelect,
  | "id"
  | "displayName"
  | "primaryHandle"
  | "primaryPlatform"
  | "avatarUrl"
  | "city"
  | "country"
  | "niches"
  | "nicheMain"
  | "nicheStatus"
  | "nicheConfidence"
  | "countrySource"
  | "tags"
  | "verified"
  | "authenticityScore"
  | "fakeFollowerPct"
  | "aiSummary"
  | "aiSummaryModel"
  | "aiSummaryAt"
  | "aiSummarySourceHash"
  | "aiSummaryFailedAt"
  | "isMinor"
  | "minorOverrideByStaffId"
  | "status"
  | "mergedIntoId"
  | "assessmentStatus"
> & { /** 0072: an organisation account not overridden by staff (excluded from search). */ organisation: boolean };

export async function getCreator(tx: Tx, id: string): Promise<CreatorRow | null> {
  const rows = await tx
    .select({
      id: creators.id,
      displayName: creators.displayName,
      primaryHandle: creators.primaryHandle,
      primaryPlatform: creators.primaryPlatform,
      avatarUrl: creators.avatarUrl,
      city: creators.city,
      country: creators.country,
      niches: creators.niches,
      nicheMain: creators.nicheMain,
      nicheStatus: creators.nicheStatus,
      nicheConfidence: creators.nicheConfidence,
      countrySource: creators.countrySource,
      tags: creators.tags,
      verified: creators.verified,
      authenticityScore: creators.authenticityScore,
      fakeFollowerPct: creators.fakeFollowerPct,
      aiSummary: creators.aiSummary,
      aiSummaryModel: creators.aiSummaryModel,
      aiSummaryAt: creators.aiSummaryAt,
      aiSummarySourceHash: creators.aiSummarySourceHash,
      aiSummaryFailedAt: creators.aiSummaryFailedAt,
      isMinor: creators.isMinor,
      minorOverrideByStaffId: creators.minorOverrideByStaffId,
      organisation: sql<boolean>`(${creators.organisationCategory} is not null and ${creators.organisationOverrideByStaffId} is null)`,
      status: creators.status,
      mergedIntoId: creators.mergedIntoId,
      assessmentStatus: creators.assessmentStatus,
    })
    .from(creators)
    .where(eq(creators.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Other accounts and websites found in the creator's bio (recorded, merged later: spec D7). */
export function linkedAccounts(tx: Tx, creatorId: string) {
  return tx
    .select({ platform: creatorLinks.platform, url: creatorLinks.url })
    .from(creatorLinks)
    .where(eq(creatorLinks.creatorId, creatorId))
    .orderBy(creatorLinks.firstSeenAt)
    .limit(10);
}

/** Why city, country, niches and languages are known (0052): every observation with its source and status. */
export function attributeEvidence(tx: Tx, creatorId: string) {
  return tx
    .select({ attribute: creatorAttributeEvidence.attribute, value: creatorAttributeEvidence.value, source: creatorAttributeEvidence.source, status: creatorAttributeEvidence.status, quote: creatorAttributeEvidence.evidence, observedAt: creatorAttributeEvidence.observedAt })
    .from(creatorAttributeEvidence)
    .where(eq(creatorAttributeEvidence.creatorId, creatorId))
    .orderBy(creatorAttributeEvidence.attribute, creatorAttributeEvidence.status, creatorAttributeEvidence.value)
    .limit(60);
}

export type ProfileRow = typeof creatorProfiles.$inferSelect;
export type ProfileViewRow = Omit<ProfileRow, "followers"> & { followers: number | null };
export async function getProfiles(tx: Tx, creatorId: string): Promise<ProfileViewRow[]> {
  const rows = await tx.select().from(creatorProfiles).where(eq(creatorProfiles.creatorId, creatorId)).orderBy(desc(creatorProfiles.followers));
  // Earlier normalizers stored a hidden YouTube subscriber count as zero. Without the original payload,
  // that legacy zero is ambiguous; expose it as unknown instead of claiming an audience of zero.
  return rows.map((p) => (p.platform === "youtube" && p.followers === 0 ? { ...p, followers: null } : p));
}

export type SnapshotRow = typeof enrichmentSnapshots.$inferSelect;
export async function latestSnapshot(tx: Tx, creatorId: string): Promise<SnapshotRow | null> {
  const rows = await tx.select().from(enrichmentSnapshots).where(eq(enrichmentSnapshots.creatorId, creatorId)).orderBy(desc(enrichmentSnapshots.createdAt)).limit(1);
  return rows[0] ?? null;
}

/** Masked contact rows only: these columns are all the API role may read (migration 0009). */
export function contactSummaries(tx: Tx, creatorId: string) {
  return tx
    .select({
      id: creatorContacts.id, kind: creatorContacts.kind, masked: creatorContacts.masked, trust: creatorContacts.trust, source: creatorContacts.source,
      firstSeenAt: creatorContacts.firstSeenAt, lastSeenAt: creatorContacts.lastSeenAt, status: creatorContacts.status, checkedAt: creatorContacts.checkedAt, checkDetail: creatorContacts.checkDetail,
    })
    .from(creatorContacts)
    .where(eq(creatorContacts.creatorId, creatorId));
}

export function revealedContacts(tx: TenantTx, creatorId: string) {
  return tx.execute<{ id: string; kind: "email" | "phone"; value_encrypted: string; trust: string }>(
    sql`select id, kind, value_encrypted, trust from gcp.revealed_contacts(${creatorId})`,
  );
}

// ── reveals and audience views (workspace data: always filtered by workspace) ─
export async function hasReveal(tx: TenantTx, workspaceId: string, creatorId: string): Promise<boolean> {
  const rows = await tx
    .select({ c: contactReveals.creatorId })
    .from(contactReveals)
    .where(and(eq(contactReveals.workspaceId, workspaceId), eq(contactReveals.creatorId, creatorId)))
    .limit(1);
  return rows.length === 1;
}

/** True when this call created the reveal. A concurrent duplicate waits on the primary key and then gets false. */
export async function insertReveal(tx: TenantTx, workspaceId: string, creatorId: string, userId: string): Promise<boolean> {
  const rows = await tx.insert(contactReveals).values({ workspaceId, creatorId, revealedBy: userId }).onConflictDoNothing().returning({ c: contactReveals.creatorId });
  return rows.length === 1;
}

export async function setRevealReservation(tx: TenantTx, workspaceId: string, creatorId: string, reservationId: string): Promise<void> {
  await tx
    .update(contactReveals)
    .set({ ledgerReservationId: reservationId })
    .where(and(eq(contactReveals.workspaceId, workspaceId), eq(contactReveals.creatorId, creatorId)));
}

export async function insertAudienceView(tx: TenantTx, workspaceId: string, creatorId: string, month: string, userId: string): Promise<boolean> {
  const rows = await tx.insert(audienceViews).values({ workspaceId, creatorId, month, viewedBy: userId }).onConflictDoNothing().returning({ c: audienceViews.creatorId });
  return rows.length === 1;
}

// ── saved searches ──────────────────────────────────────────────────────────
export type SavedSearchRow = typeof savedSearches.$inferSelect;
export function listSavedSearches(tx: TenantTx, workspaceId: string): Promise<SavedSearchRow[]> {
  return tx.select().from(savedSearches).where(eq(savedSearches.workspaceId, workspaceId)).orderBy(desc(savedSearches.createdAt)).limit(50);
}

export async function countSavedSearches(tx: TenantTx, workspaceId: string): Promise<number> {
  const rows = await tx.select({ n: sql<number>`count(*)::int` }).from(savedSearches).where(eq(savedSearches.workspaceId, workspaceId));
  return rows[0]?.n ?? 0;
}

export async function insertSavedSearch(tx: TenantTx, row: typeof savedSearches.$inferInsert): Promise<SavedSearchRow> {
  const rows = await tx.insert(savedSearches).values(row).returning();
  const saved = rows[0];
  if (!saved) throw new Error("saved search insert returned no row");
  return saved;
}

export async function deleteSavedSearch(tx: TenantTx, workspaceId: string, id: string): Promise<boolean> {
  const rows = await tx.delete(savedSearches).where(and(eq(savedSearches.workspaceId, workspaceId), eq(savedSearches.id, id))).returning({ id: savedSearches.id });
  return rows.length === 1;
}

// ── AI summaries ────────────────────────────────────────────────────────────
/** True when a new request should be sent: first time for this version, or the last attempt is over an hour old. */
export async function requestSummary(tx: Tx, creatorId: string, hash: string): Promise<boolean> {
  const rows = await tx.execute<{ creator_id: string }>(sql`
    insert into platform.summary_requests (creator_id, source_hash) values (${creatorId}, ${hash})
    on conflict (creator_id, source_hash) do update set requested_at = now()
      where platform.summary_requests.requested_at < now() - interval '1 hour'
    returning creator_id`);
  return rows.length === 1;
}

/** The public data a summary is written from (also used to tell when a summary is out of date). */
export function buildSummarySource(c: CreatorRow, profiles: ProfileViewRow[], snap: SnapshotRow | null): SummarySource {
  return {
    displayName: c.displayName,
    niches: c.niches,
    tags: c.tags,
    city: c.city,
    country: c.country,
    verdict: snap?.verdict ?? null,
    evidence: (snap?.evidenceBreakdown ?? []).map((e) => ({ signal: e.signal, detail: e.detail })),
    profiles: profiles.map((p) => ({
      platform: p.platform,
      followers: p.followers,
      engagementRate: p.engagementRate,
      posts: p.posts,
      avgLikes: p.avgLikes,
      avgComments: p.avgComments,
      avgViews: p.avgViews,
      bio: p.bio,
    })),
  };
}

/** Null for creators customers cannot see: their data is never sent to the AI (SRS §5.2, §5.5). */
export async function summarySource(tx: Tx, creatorId: string): Promise<{ source: SummarySource; currentHash: string | null } | null> {
  const c = await getCreator(tx, creatorId);
  if (!c || c.status !== "active" || isMinorProtected(c)) return null;
  return { currentHash: c.aiSummarySourceHash, source: buildSummarySource(c, await getProfiles(tx, creatorId), await latestSnapshot(tx, creatorId)) };
}

export async function latestAudience(tx: Tx, creatorId: string): Promise<{ audience: AudienceRow; at: Date } | null> {
  const rows = await tx
    .select({ audience: enrichmentSnapshots.audience, at: enrichmentSnapshots.createdAt })
    .from(enrichmentSnapshots)
    .where(and(eq(enrichmentSnapshots.creatorId, creatorId), sql`${enrichmentSnapshots.audience} is not null`))
    .orderBy(desc(enrichmentSnapshots.createdAt))
    .limit(1);
  const r = rows[0];
  return r?.audience ? { audience: r.audience, at: r.at } : null;
}

export async function saveSummary(tx: SystemTx, creatorId: string, text: string, model: string, hash: string): Promise<void> {
  await tx
    .update(creators)
    .set({ aiSummary: text, aiSummaryModel: model, aiSummaryAt: sql`now()`, aiSummarySourceHash: hash, aiSummaryFailedAt: null })
    .where(eq(creators.id, creatorId));
}

export async function markSummaryFailed(tx: SystemTx, creatorId: string): Promise<void> {
  await tx.update(creators).set({ aiSummaryFailedAt: sql`now()` }).where(eq(creators.id, creatorId));
}

// ── index projection (worker) ───────────────────────────────────────────────
export type IndexRow = {
  id: string;
  status: string;
  isMinor: boolean;
  minorOverrideByStaffId: string | null;
  organisation: boolean;
  displayName: string;
  nameVariants: string[];
  primaryHandle: string;
  primaryPlatform: Platform;
  city: string | null;
  country: string | null;
  niches: string[];
  tags: string[];
  verified: boolean;
  authenticityScore: number | null;
  hasContact: boolean;
  profiles: { platform: Platform; handle: string; canonicalUrl: string; followers: number | null; engagementRate: number | null; bio: string | null; followersUpdatedAt: string | null; lastPostAt: string | null; availability?: EligibilityProfile["availability"]; country?: EligibilityProfile["country"] }[];
  audience: AudienceRow | null;
  updatedEpoch: number;
};

/** Last change to anything the index document is built from. */
const UPDATED_EPOCH = sql`extract(epoch from greatest(
  c.updated_at,
  coalesce((select max(p.updated_at) from gcp.creator_profiles p where p.creator_id = c.id), c.updated_at),
  coalesce((select max(s.created_at) from gcp.enrichment_snapshots s where s.creator_id = c.id), c.updated_at)
))::int`;

export async function indexRows(tx: SystemTx, ids: string[]): Promise<IndexRow[]> {
  if (ids.length === 0) return [];
  return tx.execute<IndexRow>(sql`
    select c.id, c.status, c.is_minor as "isMinor", c.minor_override_by_staff_id as "minorOverrideByStaffId", (c.organisation_category is not null and c.organisation_override_by_staff_id is null) as organisation,
      c.display_name as "displayName", c.name_variants as "nameVariants", c.primary_handle as "primaryHandle",
      c.primary_platform as "primaryPlatform", c.city, c.country, c.niches, c.tags, c.verified,
      c.authenticity_score as "authenticityScore",
      -- A contact shown not to work is not a way to reach the creator (the "has contact" filter).
      exists (select 1 from gcp.creator_contacts k where k.creator_id = c.id and k.status <> 'invalid') as "hasContact",
      coalesce((
        select jsonb_agg(jsonb_build_object('platform', p.platform, 'handle', p.handle, 'canonicalUrl', p.canonical_url, 'lastPostAt', p.last_post_at,
          'followers', case when p.platform = 'youtube' and p.followers = 0 then null else p.followers end,
          'engagementRate', p.engagement_rate, 'bio', p.bio, 'followersUpdatedAt', p.followers_updated_at, 'availability', p.availability, 'country', jsonb_build_object('code', p.country, 'status', p.country_status, 'checkedAt', p.country_checked_at)) order by p.followers desc)
        from gcp.creator_profiles p where p.creator_id = c.id), '[]'::jsonb) as profiles,
      (select s.audience from gcp.enrichment_snapshots s where s.creator_id = c.id and s.audience is not null order by s.created_at desc limit 1) as audience,
      ${UPDATED_EPOCH} as "updatedEpoch"
    from gcp.creators c where c.id in ${ids}`);
}

/** Dual-write the PostgreSQL-native search projection; Meilisearch remains a rollback option during cutover. */
export async function upsertPostgresSearchDocuments(tx: SystemTx, docs: CreatorDocument[]): Promise<void> {
  if (docs.length === 0) return;
  const records = JSON.stringify(docs);
  await tx.execute(sql`
    insert into gcp.creator_search_documents (
      creator_id, display_name, name_variants, primary_handle, handles, platforms, city, country, niches, tags, bio,
      followers, engagement_rate, verified, authenticity_score, has_contact, followers_updated_epoch, updated_epoch,
      eligible, eligible_until_epoch, eligibility_version, eligibility_reasons, eligibility_flags, qualifying_platforms, search_text, search_vector
    )
    select d.id, d.display_name, d.name_variants, d.primary_handle, d.handles, d.platforms, d.city, d.country,
      d.niches, d.tags, d.bio, d.followers, d.engagement_rate, d.verified, d.authenticity_score, d.has_contact,
      d.followers_updated_epoch, d.updated_epoch,
      d.eligible, d.eligible_until, d.eligibility_version, d.eligibility_reasons, d.eligibility_flags, d.qualifying_platforms,
      coalesce(d.display_name, '') || ' ' || coalesce(array_to_string(d.name_variants, ' '), '') || ' ' || coalesce(d.primary_handle, '') || ' ' ||
        coalesce(array_to_string(d.handles, ' '), '') || ' ' || coalesce(array_to_string(d.handle_words, ' '), '') || ' ' || coalesce(array_to_string(d.niches, ' '), '') || ' ' ||
        coalesce(array_to_string(d.tags, ' '), '') || ' ' || coalesce(d.bio, ''),
      setweight(to_tsvector('simple'::regconfig, d.display_name), 'A') ||
        setweight(to_tsvector('simple'::regconfig, array_to_string(d.name_variants, ' ')), 'B') ||
        setweight(to_tsvector('simple'::regconfig, coalesce(d.primary_handle, '') || ' ' || coalesce(array_to_string(d.handles, ' '), '') || ' ' || coalesce(array_to_string(d.handle_words, ' '), '')), 'B') ||
        setweight(to_tsvector('simple'::regconfig, coalesce(array_to_string(d.niches, ' '), '') || ' ' || coalesce(array_to_string(d.tags, ' '), '')), 'C') ||
        setweight(to_tsvector('simple'::regconfig, d.bio), 'D')
    from jsonb_to_recordset(${records}::jsonb) as d(
      id uuid, display_name text, name_variants text[], primary_handle text, handles text[], handle_words text[], platforms text[], city text,
      country text, niches text[], tags text[], bio text, followers bigint, engagement_rate double precision,
      verified boolean, authenticity_score smallint, has_contact boolean, followers_updated_epoch bigint, updated_epoch bigint,
      eligible boolean, eligible_until bigint, eligibility_version text, eligibility_reasons text[], eligibility_flags text[], qualifying_platforms text[]
    )
    on conflict (creator_id) do update set
      display_name = excluded.display_name, name_variants = excluded.name_variants, primary_handle = excluded.primary_handle,
      handles = excluded.handles, platforms = excluded.platforms, city = excluded.city, country = excluded.country,
      niches = excluded.niches, tags = excluded.tags, bio = excluded.bio, followers = excluded.followers,
      engagement_rate = excluded.engagement_rate, verified = excluded.verified, authenticity_score = excluded.authenticity_score,
      has_contact = excluded.has_contact, followers_updated_epoch = excluded.followers_updated_epoch, updated_epoch = excluded.updated_epoch,
      eligible = excluded.eligible, eligible_until_epoch = excluded.eligible_until_epoch, eligibility_version = excluded.eligibility_version,
      eligibility_reasons = excluded.eligibility_reasons, eligibility_flags = excluded.eligibility_flags, qualifying_platforms = excluded.qualifying_platforms,
      search_text = excluded.search_text, search_vector = excluded.search_vector
  `);
}

export async function removePostgresSearchDocuments(tx: SystemTx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.execute(sql`delete from gcp.creator_search_documents where creator_id in ${ids}`);
}

/** With `eligibilityVersion`, a document built under another eligibility policy reports -1, so the reconcile rebuilds it. */
export async function postgresSearchState(tx: SystemTx, eligibilityVersion?: string): Promise<{ id: string; updatedEpoch: number }[]> {
  const rows = await tx.execute<{ id: string; updatedEpoch: number | string }>(
    eligibilityVersion
      ? sql`select creator_id as id, case when eligibility_version is distinct from ${eligibilityVersion} then -1 else updated_epoch end as "updatedEpoch" from gcp.creator_search_documents`
      : sql`select creator_id as id, updated_epoch as "updatedEpoch" from gcp.creator_search_documents`,
  );
  return rows.map((row) => ({ id: row.id, updatedEpoch: Number(row.updatedEpoch) }));
}

/** Every creator that belongs in the index, with its last-change time (nightly reconcile). */
export function indexState(tx: SystemTx): Promise<{ id: string; updatedEpoch: number }[]> {
  return tx.execute<{ id: string; updatedEpoch: number }>(sql`select c.id, ${UPDATED_EPOCH} as "updatedEpoch" from gcp.creators c where ${VISIBLE}`);
}

/** Whether customers can see this creator (active, and not a possible minor without a staff override). */
export async function isVisibleCreator(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`select c.id from gcp.creators c where c.id = ${id} and ${VISIBLE}`);
  return rows.length === 1;
}

/** Of the given creators, those customers can currently see. */
export async function visibleIds(tx: SystemTx, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.execute<{ id: string }>(sql`select c.id from gcp.creators c where c.id in ${ids} and ${VISIBLE}`);
  return rows.map((r) => r.id);
}

// ── writing creators (worker role: seed script, tests, sub-project 4) ───────
export type NewProfile = {
  platform: Platform;
  handle: string;
  followers: number | null;
  engagementRate: number | null;
  following?: number | null;
  posts?: number | null;
  avgLikes?: number | null;
  avgComments?: number | null;
  avgViews?: number | null;
  bio?: string | null;
  updatedAt?: Date;
};

export type NewCreator = {
  /** Only for restoring a recorded corpus with its original ids (search-eval); normally generated by the database. */
  id?: string;
  displayName: string;
  primaryHandle: string;
  primaryPlatform: Platform;
  avatarUrl?: string | null;
  city?: string | null;
  country?: string | null;
  /** A country the creator confirmed to MUSHIN (applies to all their profiles); test fixtures use "PK". */
  confirmedCountry?: string | null;
  /** The country the platform declares (YouTube channel country), used for the YouTube profile. */
  platformCountry?: string | null;
  niches: string[];
  tags: string[];
  nameVariants?: string[];
  verified?: boolean;
  isMinor?: boolean;
  profiles: NewProfile[];
  contacts?: { kind: "email" | "phone"; value: string; trust: "verified" | "likely" | "unverified"; source: string }[];
  snapshot?: { verdict: string; authenticityScore: number; fakeFollowerPct: number | null; evidence: EvidenceRow[]; audience: AudienceRow | null; modelVersion: string; confidence: number };
};

const PROFILE_URL: Record<Platform, (handle: string) => string> = {
  instagram: (h) => `https://instagram.com/${h.toLowerCase()}`,
  tiktok: (h) => `https://tiktok.com/@${h.toLowerCase()}`,
  youtube: (h) => `https://youtube.com/@${h.toLowerCase()}`,
};

export async function insertCreator(tx: SystemTx, c: NewCreator, encryptionKey: Buffer): Promise<string> {
  const [row] = await tx
    .insert(creators)
    .values({
      ...(c.id ? { id: c.id } : {}),
      displayName: c.displayName,
      primaryHandle: c.primaryHandle,
      primaryPlatform: c.primaryPlatform,
      avatarUrl: c.avatarUrl ?? null,
      city: c.city ?? null,
      country: c.country ?? c.confirmedCountry ?? null,
      confirmedCountry: c.confirmedCountry ?? null,
      platformCountry: c.platformCountry ?? null,
      ...(c.confirmedCountry ? { countrySource: "creator_confirmed" as const } : {}),
      niches: c.niches,
      tags: c.tags,
      nameVariants: c.nameVariants ?? [],
      verified: c.verified ?? false,
      isMinor: c.isMinor ?? false,
      authenticityScore: c.snapshot?.authenticityScore ?? null,
      fakeFollowerPct: c.snapshot?.fakeFollowerPct ?? null,
      lastEnrichedAt: c.snapshot ? new Date() : null,
    })
    .returning({ id: creators.id });
  if (!row) throw new Error("creator insert returned no row");
  for (const p of c.profiles) {
    const at = p.updatedAt ?? new Date();
    await tx.insert(creatorProfiles).values({
      creatorId: row.id,
      platform: p.platform,
      handle: p.handle,
      canonicalUrl: PROFILE_URL[p.platform](p.handle),
      followers: p.followers,
      following: p.following ?? null,
      posts: p.posts ?? null,
      engagementRate: p.engagementRate,
      avgLikes: p.avgLikes ?? null,
      avgComments: p.avgComments ?? null,
      avgViews: p.avgViews ?? null,
      bio: p.bio ?? null,
      followersUpdatedAt: at,
      engagementUpdatedAt: at,
      audienceUpdatedAt: c.snapshot?.audience ? at : null,
      lastScrapedAt: at,
    });
  }
  // Each profile's own country from what was just stored (0060): never left unknown when evidence exists.
  await refreshProfileCountries(tx, row.id, { source: "enrichment" });
  for (const k of c.contacts ?? []) {
    await tx.insert(creatorContacts).values({
      creatorId: row.id,
      kind: k.kind,
      valueEncrypted: encryptSecret(k.value, encryptionKey),
      valueHash: sha256Hex(k.value.trim().toLowerCase()),
      masked: maskContact(k.kind, k.value),
      trust: k.trust,
      source: k.source,
    });
  }
  if (c.snapshot) {
    await tx.insert(enrichmentSnapshots).values({
      creatorId: row.id,
      verdict: c.snapshot.verdict,
      authenticityScore: c.snapshot.authenticityScore,
      evidenceBreakdown: c.snapshot.evidence,
      audience: c.snapshot.audience,
      modelVersion: c.snapshot.modelVersion,
      confidence: c.snapshot.confidence,
    });
  }
  await writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: row.id, workspaceId: null, payload: { creatorId: row.id }, requestId: null });
  return row.id;
}

/**
 * Whether the current workspace already holds this creator (row-level security scopes every table to it): on a list or
 * campaign, revealed, imported, or delivered by its Live Discovery. A creator who no longer meets the catalogue rules
 * stays visible there, labelled, so saved work is never broken; nobody else can open or look it up (elig-2).
 */
export async function workspaceHasCreator(tx: TenantTx, creatorId: string): Promise<boolean> {
  const [row] = await tx.execute<{ held: boolean }>(sql`
    select exists (select 1 from wp.list_members where creator_id = ${creatorId})
        or exists (select 1 from wp.campaign_creators where creator_id = ${creatorId})
        or exists (select 1 from wp.contact_reveals where creator_id = ${creatorId})
        or exists (select 1 from wp.discovery_results where creator_id = ${creatorId})
        or exists (select 1 from wp.creator_import_rows where creator_id = ${creatorId}) as held`);
  return row?.held === true;
}

/** True when the creator is locked by the Pakistan-only rule and this workspace does not already hold it (BUG-32). */
export async function lockedForWorkspace(tx: TenantTx, creatorId: string, now: Date): Promise<boolean> {
  const e = (await eligibilityOf(tx, [creatorId], now)).get(creatorId);
  return e !== undefined && countryLocked(e) && !(await workspaceHasCreator(tx, creatorId));
}

/** Eligibility (elig-1) of each creator from its stored record and profiles, as of `now`. */
export async function eligibilityOf(tx: Tx, ids: string[], now: Date): Promise<Map<string, CreatorEligibility>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; status: string; isMinor: boolean; minorOverrideByStaffId: string | null; organisation: boolean; profiles: EligibilityProfile[] }>(sql`
    select c.id, c.status, c.is_minor as "isMinor", c.minor_override_by_staff_id as "minorOverrideByStaffId", (c.organisation_category is not null and c.organisation_override_by_staff_id is null) as organisation,
      coalesce((select jsonb_agg(jsonb_build_object('platform', p.platform, 'canonicalUrl', p.canonical_url,
        'followers', case when p.platform = 'youtube' and p.followers = 0 then null else p.followers end,
        'followersUpdatedAt', p.followers_updated_at, 'lastPostAt', p.last_post_at, 'availability', p.availability, 'country', jsonb_build_object('code', p.country, 'status', p.country_status, 'checkedAt', p.country_checked_at)))
        from gcp.creator_profiles p where p.creator_id = c.id), '[]'::jsonb) as profiles
    from gcp.creators c where c.id in ${ids}`);
  return new Map(rows.map((r) => [r.id, creatorEligibility(r, r.profiles, now)]));
}

/** Of these creators, the ones that may not be added to a list or campaign (elig-1); unknown ids count as not eligible. */
export async function ineligibleCreatorIds(tx: Tx, ids: string[], now: Date): Promise<string[]> {
  const e = await eligibilityOf(tx, ids, now);
  return ids.filter((id) => !e.get(id)?.eligible);
}

const notEvaluated = (): CreatorEligibility => ({ version: ELIGIBILITY_VERSION, eligible: false, reasons: ["no_profile"], eligibleUntil: null, qualifyingPlatforms: [], flags: [], profiles: [] });

/** Catalogue coverage under the eligibility policy, counts only (no creator data): for the staff coverage report. */
export async function eligibilityCoverage(tx: Tx, now: Date): Promise<{
  total: number;
  eligible: number;
  activityUnverified: number;
  byReason: { reason: string; creators: number }[];
  byPlatform: { platform: string; eligibleCreators: number }[];
}> {
  const at = Math.floor(now.getTime() / 1000);
  const [totals] = await tx.execute<{ total: number; eligible: number; activity_unverified: number }>(sql`
    select count(*)::int as total,
      count(*) filter (where eligible and eligible_until_epoch > ${at})::int as eligible,
      count(*) filter (where eligible and eligible_until_epoch > ${at} and 'activity_unverified' = any (eligibility_flags))::int as activity_unverified
    from gcp.creator_search_documents`);
  const byReason = await tx.execute<{ reason: string; creators: number }>(sql`
    select reason, count(*)::int as creators from (
      select unnest(case when eligible and eligible_until_epoch <= ${at} then array['evidence_expired'] else eligibility_reasons end) as reason
      from gcp.creator_search_documents) r
    group by reason order by creators desc, reason`);
  const byPlatform = await tx.execute<{ platform: string; eligibleCreators: number }>(sql`
    select p as platform, count(*)::int as "eligibleCreators" from gcp.creator_search_documents d, unnest(d.qualifying_platforms) p
    where d.eligible and d.eligible_until_epoch > ${at} group by p order by p`);
  return { total: totals?.total ?? 0, eligible: totals?.eligible ?? 0, activityUnverified: totals?.activity_unverified ?? 0, byReason: [...byReason], byPlatform: [...byPlatform] };
}
