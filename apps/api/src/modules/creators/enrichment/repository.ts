import { and, desc, eq, lt, sql } from "drizzle-orm";
import { encryptSecret, sha256Hex, truncate } from "@mushin/core";
import {
  creatorAttributeEvidence,
  creatorContacts,
  creatorLinks,
  creatorProfiles,
  creators,
  enrichmentSettings,
  enrichmentSnapshots,
  profileMetricSnapshots,
  rawPayloads,
  writeOutbox,
  type SystemTx,
  type TenantTx,
} from "@mushin/db";
import { maskContact, organisationCategory, type CreatorPlatform } from "../rules";
import type { Assessment } from "./assessment";
import type { ContentPerformance } from "../eligibility-v3";
import type { AttributeDecision } from "./attribute-evidence";
import { profileCountry, resolveCountry, type ProfileCountry } from "./country-evidence";
import { wholeChars } from "./quote";
import type { ExtractedContact, ExtractedLink } from "./links";
import type { PreviousMetrics, SignalReport } from "./signals";
import type { StandardProfile } from "./standardize";

type Tx = TenantTx | SystemTx;
export type EnrichmentSettingsRow = typeof enrichmentSettings.$inferSelect;

export async function getEnrichmentSettings(tx: Tx): Promise<EnrichmentSettingsRow> {
  const [s] = await tx.select().from(enrichmentSettings).limit(1);
  if (!s) throw new Error("platform.enrichment_settings has no row");
  return s;
}

export async function findProfileByUrl(tx: Tx, canonicalUrl: string): Promise<{ profileId: string; creatorId: string; lastScrapedAt: Date | null } | null> {
  const rows = await tx
    .select({ profileId: creatorProfiles.id, creatorId: creatorProfiles.creatorId, lastScrapedAt: creatorProfiles.lastScrapedAt })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.canonicalUrl, canonicalUrl))
    .limit(1);
  return rows[0] ?? null;
}

/** What a refresh scrapes: the creator's primary profile. Only active creators can be refreshed. */
export async function profileTarget(
  tx: Tx,
  creatorId: string,
): Promise<{ platform: CreatorPlatform; handle: string; canonicalUrl: string; lastScrapedAt: Date | null } | null> {
  const rows = await tx
    .select({ platform: creatorProfiles.platform, canonicalUrl: creatorProfiles.canonicalUrl, lastScrapedAt: creatorProfiles.lastScrapedAt, status: creators.status, primary: creators.primaryPlatform })
    .from(creatorProfiles)
    .innerJoin(creators, eq(creators.id, creatorProfiles.creatorId))
    .where(eq(creatorProfiles.creatorId, creatorId))
    .orderBy(sql`(${creatorProfiles.platform} = ${creators.primaryPlatform}) desc`, desc(creatorProfiles.followers))
    .limit(1);
  const r = rows[0];
  if (!r || r.status !== "active") return null;
  return { platform: r.platform, handle: r.canonicalUrl.split("/").pop() ?? "", canonicalUrl: r.canonicalUrl, lastScrapedAt: r.lastScrapedAt };
}

export async function latestMetrics(tx: Tx, profileId: string): Promise<PreviousMetrics | null> {
  const rows = await tx
    .select({ followers: profileMetricSnapshots.followers, avgLikes: profileMetricSnapshots.avgLikes, capturedAt: profileMetricSnapshots.capturedAt })
    .from(profileMetricSnapshots)
    .where(eq(profileMetricSnapshots.profileId, profileId))
    .orderBy(desc(profileMetricSnapshots.capturedAt))
    .limit(1);
  return rows[0] ?? null;
}

export type PayloadRef = { id: string; storageKey: string; provider: "apify" | "youtube"; platform: CreatorPlatform; canonicalUrl: string; fetchedAt: Date; deleteAfter: Date };
const payloadCols = {
  id: rawPayloads.id,
  storageKey: rawPayloads.storageKey,
  provider: rawPayloads.provider,
  platform: rawPayloads.platform,
  canonicalUrl: rawPayloads.canonicalUrl,
  fetchedAt: rawPayloads.fetchedAt,
  deleteAfter: rawPayloads.deleteAfter,
};

export async function payloadForJob(tx: Tx, jobId: string): Promise<PayloadRef | null> {
  const rows = await tx.select(payloadCols).from(rawPayloads).where(eq(rawPayloads.jobId, jobId)).orderBy(desc(rawPayloads.fetchedAt)).limit(1);
  return rows[0] ?? null;
}

/** The archived response of one profile within a job (live runs archive several profiles per job). */
export async function payloadForJobProfile(tx: Tx, jobId: string, canonicalUrl: string): Promise<PayloadRef | null> {
  const rows = await tx
    .select(payloadCols)
    .from(rawPayloads)
    .where(and(eq(rawPayloads.jobId, jobId), eq(rawPayloads.canonicalUrl, canonicalUrl)))
    .orderBy(desc(rawPayloads.fetchedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function latestPayloadForCreator(tx: Tx, creatorId: string): Promise<PayloadRef | null> {
  const rows = await tx.select(payloadCols).from(rawPayloads).where(eq(rawPayloads.creatorId, creatorId)).orderBy(desc(rawPayloads.fetchedAt)).limit(1);
  return rows[0] ?? null;
}

export async function insertRawPayload(
  tx: Tx,
  row: { provider: "apify" | "youtube"; platform: CreatorPlatform; canonicalUrl: string; jobId: string; storageKey: string; bytes: number; sha256: string; deleteAfter: Date },
): Promise<string> {
  const [r] = await tx.insert(rawPayloads).values(row).returning({ id: rawPayloads.id });
  if (!r) throw new Error("raw payload insert returned no row");
  return r.id;
}

export async function expiredPayloads(tx: Tx, now: Date, limit: number): Promise<{ id: string; storageKey: string }[]> {
  return tx.select({ id: rawPayloads.id, storageKey: rawPayloads.storageKey }).from(rawPayloads).where(lt(rawPayloads.deleteAfter, now)).limit(limit);
}

export async function deletePayloadRows(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.delete(rawPayloads).where(sql`${rawPayloads.id} in ${ids}`);
}

export type SaveInput = {
  profile: StandardProfile;
  canonicalUrl: string;
  payloadId: string;
  metrics: { engagementRate: number | null; avgLikes: number | null; avgComments: number | null; avgViews: number | null };
  report: SignalReport;
  assessment: { value: Assessment; model: string } | null;
  /** Scheduled source refresh (YouTube retention): keep the current assessment and request no new one. */
  keepAssessment?: boolean;
  /** Typical content performance of this fetch (0066); null when it had no usable posts. Omitted: columns untouched. */
  performance?: ContentPerformance | null;
  modelVersion: string;
  minorReason: string | null;
  contacts: ExtractedContact[];
  links: ExtractedLink[];
  avatar: { url: string; key: string } | null;
  tags: string[];
  encryptionKey: Buffer;
  requestId: string | null;
  /** search-v2 evidence policy: city, country and niches come from evidence, and the evidence rows are kept. */
  attributes?: AttributeDecision;
};

/** 0066 columns from a fetch's performance: written as a whole, nulls included, so no older median survives a fetch. */
function performanceColumns(i: SaveInput) {
  if (i.performance === undefined) return {};
  const p = i.performance;
  return {
    medianViews: p?.medianViews === null || p?.medianViews === undefined ? null : Math.round(p.medianViews),
    medianEngagementRate: p?.medianEngagementRate ?? null,
    performanceViewsSample: p?.viewsSample ?? null,
    performanceEngagementSample: p?.engagementSample ?? null,
    performanceFormat: p?.format ?? null,
    performanceFrom: p?.sampleFrom ?? null,
    performanceTo: p?.sampleTo ?? null,
    performanceAt: new Date(),
    // Geotags of this fetch (0068): replaced each time, so an old geotag never outlives the posts it came from.
    postLocations: i.profile.recentPosts.map((x) => x.location).filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 30),
  };
}

const assessmentStatusOf = (i: SaveInput): "assessed" | "pending" | "insufficient_data" =>
  i.assessment === null ? "pending" : i.report.kind === "insufficient" ? "insufficient_data" : "assessed";

/**
 * Spec §5.1 step 5, one transaction (worker role). A refresh updates the creator the profile link belongs to; the
 * pipeline only ever sets `is_minor`, never clears it (SRS §5.5).
 */
export async function saveEnrichment(tx: Tx, i: SaveInput): Promise<{ creatorId: string; created: boolean; assessment: "assessed" | "pending" | "insufficient_data" }> {
  const p = i.profile;
  const status = assessmentStatusOf(i);
  const score = status === "assessed" ? (i.assessment?.value.score ?? null) : null;
  const existing = await findProfileByUrl(tx, i.canonicalUrl);
  const a = i.assessment?.value ?? null;
  let creatorId: string;
  let profileId: string;
  let keepNiches = false;
  // Activity evidence for eligibility: the newest dated public post in this fetch (posts arrive newest first). A fetch
  // without dated posts keeps the earlier date, which still ages out of the activity window.
  const latestPost = p.recentPosts.reduce<Date | null>((max, x) => (max === null || x.postedAt > max ? x.postedAt : max), null);
  const metricTimes = { followersUpdatedAt: sql`now()`, engagementUpdatedAt: sql`now()`, audienceUpdatedAt: a ? sql`now()` : sql`${creatorProfiles.audienceUpdatedAt}`, lastScrapedAt: sql`now()` };

  if (!existing) {
    const [c] = await tx
      .insert(creators)
      .values({
        displayName: p.displayName,
        primaryHandle: p.handle,
        primaryPlatform: p.platform,
        avatarUrl: i.avatar?.url ?? null,
        avatarKey: i.avatar?.key ?? null,
        city: i.attributes ? i.attributes.city : (a?.creatorCity ?? null),
        country: i.attributes ? i.attributes.country : (p.country ?? a?.creatorCountry ?? null),
        niches: i.attributes ? i.attributes.niches : (a?.niches ?? []),
        ...(i.attributes ? attributeColumns(i.attributes, null) : {}),
        tags: i.tags,
        verified: p.verified,
        authenticityScore: score,
        assessmentStatus: status,
        isMinor: i.minorReason !== null,
        minorReason: i.minorReason,
        minorFlaggedAt: i.minorReason !== null ? new Date() : null,
        // 0072: an Instagram category naming an organisation keeps the account out of search.
        organisationCategory: p.platform === "instagram" ? organisationCategory(p.accountCategory) : null,
        lastEnrichedAt: new Date(),
      })
      .returning({ id: creators.id });
    if (!c) throw new Error("creator insert returned no row");
    creatorId = c.id;
    const [pr] = await tx
      .insert(creatorProfiles)
      .values({
        creatorId,
        platform: p.platform,
        handle: p.handle,
        canonicalUrl: i.canonicalUrl,
        followers: p.followers,
        following: p.following,
        posts: p.posts,
        engagementRate: i.metrics.engagementRate,
        avgLikes: i.metrics.avgLikes,
        avgComments: i.metrics.avgComments,
        avgViews: i.metrics.avgViews,
        bio: p.bio,
        followersUpdatedAt: new Date(),
        engagementUpdatedAt: new Date(),
        audienceUpdatedAt: a ? new Date() : null,
        lastScrapedAt: new Date(),
        lastPostAt: latestPost,
        ...performanceColumns(i),
      })
      .returning({ id: creatorProfiles.id });
    if (!pr) throw new Error("profile insert returned no row");
    profileId = pr.id;
  } else {
    creatorId = existing.creatorId;
    profileId = existing.profileId;
    const placed = i.attributes ? await placeAttributes(tx, creatorId, i.attributes) : null;
    keepNiches = placed?.keptNiches ?? false;
    await tx
      .update(creatorProfiles)
      .set({
        handle: p.handle,
        followers: p.followers,
        following: p.following,
        posts: p.posts,
        engagementRate: i.metrics.engagementRate,
        avgLikes: i.metrics.avgLikes,
        avgComments: i.metrics.avgComments,
        avgViews: i.metrics.avgViews,
        bio: p.bio,
        ...metricTimes,
        lastPostAt: latestPost ?? sql`${creatorProfiles.lastPostAt}`,
        ...performanceColumns(i),
      })
      .where(eq(creatorProfiles.id, profileId));
    await tx
      .update(creators)
      .set({
        displayName: p.displayName,
        verified: p.verified,
        ...(i.avatar ? { avatarUrl: i.avatar.url, avatarKey: i.avatar.key } : {}),
        ...(i.tags.length > 0 ? { tags: i.tags } : {}),
        ...(placed
          ? placed.values
          : {
              ...(a && a.niches.length > 0 ? { niches: a.niches } : {}),
              city: sql`coalesce(${creators.city}, ${a?.creatorCity ?? null})`,
              country: sql`coalesce(${creators.country}, ${p.country ?? a?.creatorCountry ?? null})`,
            }),
        // A pending assessment keeps the last score until the background assessment replaces it.
        ...(status === "pending" ? {} : { authenticityScore: score }),
        assessmentStatus: status === "pending" ? sql`coalesce(${creators.assessmentStatus}, 'pending')` : status,
        ...(p.platform === "instagram" ? { organisationCategory: organisationCategory(p.accountCategory) } : {}),
        lastEnrichedAt: new Date(),
        ...(i.minorReason !== null
          ? { isMinor: true, minorReason: sql`coalesce(${creators.minorReason}, ${i.minorReason})`, minorFlaggedAt: sql`coalesce(${creators.minorFlaggedAt}, now())` }
          : {}),
      })
      .where(eq(creators.id, creatorId));
  }

  await tx.insert(profileMetricSnapshots).values({
    profileId,
    followers: p.followers,
    following: p.following,
    posts: p.posts,
    engagementRate: i.metrics.engagementRate,
    avgLikes: i.metrics.avgLikes,
    avgComments: i.metrics.avgComments,
    avgViews: i.metrics.avgViews,
    rawPayloadId: i.payloadId,
  });

  for (const k of i.contacts) {
    await tx
      .insert(creatorContacts)
      .values({
        creatorId,
        kind: k.kind,
        valueEncrypted: encryptSecret(k.value, i.encryptionKey),
        valueHash: sha256Hex(k.value.trim().toLowerCase()),
        masked: maskContact(k.kind, k.value),
        trust: k.trust,
        source: k.source,
      })
      .onConflictDoUpdate({ target: [creatorContacts.creatorId, creatorContacts.kind, creatorContacts.valueHash], set: { lastSeenAt: sql`now()` } });
  }
  for (const l of i.links) {
    await tx
      .insert(creatorLinks)
      .values({ creatorId, platform: l.platform, url: l.url, source: l.source })
      .onConflictDoUpdate({ target: [creatorLinks.creatorId, creatorLinks.url], set: { lastSeenAt: sql`now()` } });
  }
  if (a) await insertSnapshot(tx, creatorId, a, i.report, i.modelVersion, i.assessment?.model ?? "");
  if (i.attributes) await replaceAttributeEvidence(tx, creatorId, i.attributes, i.payloadId, { keepNiches });
  await refreshProfileCountries(tx, creatorId, { source: "enrichment" });
  await tx.update(rawPayloads).set({ creatorId }).where(eq(rawPayloads.id, i.payloadId));
  await writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: creatorId, workspaceId: null, payload: { creatorId }, requestId: i.requestId });
  if (status === "pending" && !i.keepAssessment) {
    await writeOutbox(tx, { eventType: "creator.assessment_requested", aggregateType: "creator", aggregateId: creatorId, workspaceId: null, payload: { creatorId }, requestId: i.requestId });
  }
  return { creatorId, created: !existing, assessment: status };
}

/** The creator columns a decision sets (0054). `confirmed` is what the creator confirmed to Roster, never derived. */
export function attributeColumns(d: AttributeDecision, confirmed: string | null) {
  return { ...countryColumns(d, confirmed), ...nicheColumns(d) };
}

function countryColumns(d: AttributeDecision, confirmed: string | null) {
  const c = resolveCountry({ confirmed, stated: d.countries.stated, statedConfidence: d.countries.statedConfidence, platform: d.countries.platform });
  return {
    country: c.country,
    countrySource: c.source,
    countryConfidence: c.confidence,
    platformCountry: d.countries.platform,
    statedCountry: d.countries.stated,
    countryCheckedAt: new Date(),
  };
}

function nicheColumns(d: AttributeDecision) {
  return {
    niches: d.niches,
    nicheMain: d.niche.main,
    nicheStatus: d.niche.status,
    nicheConfidence: d.niche.confidence,
    nicheAssessedAt: new Date(),
  };
}

/**
 * Placement on an existing creator. City: a supported value replaces the stored one; a conflict or a value only the AI
 * read clears it. Country: the documented resolution rule (confirmed, else stated, else platform-declared) from this
 * evidence; a creator confirmation is never overwritten. Niche: when today's permitted evidence is insufficient
 * ("unknown", or only a low-confidence reading), niches an earlier assessment supported with text evidence are kept rather than replaced by a weaker
 * reading (`keptNiches`); their evidence rows are kept too.
 */
export async function placeAttributes(tx: Tx, creatorId: string, d: AttributeDecision): Promise<{ values: Partial<typeof creators.$inferInsert>; keptNiches: boolean }> {
  const [cur] = await tx.select({ city: creators.city, niches: creators.niches, confirmedCountry: creators.confirmedCountry }).from(creators).where(eq(creators.id, creatorId)).limit(1);
  const conflictingCity = d.evidence.some((r) => r.attribute === "city" && r.status === "conflicting");
  const aiCities = d.evidence.filter((r) => r.attribute === "city" && r.source === "ai_assessment").map((r) => r.value.toLowerCase());
  const city = d.city ?? (conflictingCity || (cur?.city != null && aiCities.includes(cur.city.toLowerCase())) ? null : (cur?.city ?? null));
  const base: Partial<typeof creators.$inferInsert> = { city, ...countryColumns(d, cur?.confirmedCountry ?? null) };
  const values: Partial<typeof creators.$inferInsert> = { ...base, ...nicheColumns(d) };
  // A low-confidence reading is weaker than niches earlier text evidence supported, like an unknown one.
  if ((d.niche.status !== "unknown" && d.niche.confidence !== "low") || !cur?.niches.length) return { values, keptNiches: false };
  const supported = await tx
    .select({ value: creatorAttributeEvidence.value })
    .from(creatorAttributeEvidence)
    .where(and(eq(creatorAttributeEvidence.creatorId, creatorId), eq(creatorAttributeEvidence.attribute, "niche"), eq(creatorAttributeEvidence.status, "supported"), sql`${creatorAttributeEvidence.source} in ('profile_text', 'post_text', 'account_category')`));
  const kept = cur.niches.filter((n) => supported.some((r) => r.value === n));
  if (kept.length === 0) return { values, keptNiches: false };
  // The earlier classification stands (its model fields are left as they were).
  return { values: { ...base, niches: kept }, keptNiches: true };
}

/**
 * Recomputes each profile's own country (0060) from what is stored: that profile's bio, the platform country the creator
 * record holds (only YouTube supplies one), and a country the creator confirmed. Only changed rows are written, and each
 * change is logged as a "location" lifecycle event, so retries and repeated runs write nothing new.
 */
export async function refreshProfileCountries(
  tx: Tx,
  creatorId: string,
  o: { source: "enrichment" | "backfill" | "staff"; now?: Date } = { source: "enrichment" },
): Promise<{ profileId: string; platform: string; from: string; to: ProfileCountry }[]> {
  const rows = await tx.execute<{ id: string; platform: string; bio: string | null; country: string | null; country_status: string; country_source: string | null; country_reason: string | null; country_confidence: string | null; platform_country: string | null; confirmed_country: string | null; public_country: string | null; public_country_source: string | null; post_locations: string[] | null; urls: string[] | null }>(sql`
    select p.id, p.platform, p.bio, p.country, p.country_status, p.country_source, p.country_reason, p.country_confidence, c.platform_country, c.confirmed_country,
           c.public_country, c.public_country_source, p.post_locations,
           (select array_agg(l.url) from gcp.creator_links l where l.creator_id = c.id) urls
    from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id
    where p.creator_id = ${creatorId}
    for update of p`);
  const changed: { profileId: string; platform: string; from: string; to: ProfileCountry }[] = [];
  const at = (o.now ?? new Date()).toISOString();
  const input = (r: (typeof rows)[number]) => ({
    bio: r.bio,
    platformCountry: r.platform === "youtube" ? r.platform_country : null,
    confirmed: r.confirmed_country,
    extras: { urls: r.urls ?? [], postLocations: r.post_locations ?? [] },
    publicRecord: r.public_country ? { country: r.public_country, source: r.public_country_source } : null,
  });
  // Two passes: each profile on its own evidence, then a Pakistani profile may corroborate the creator's other profiles
  // that have no evidence of their own (a stated life abroad on a profile still wins there).
  const own = new Map([...rows].map((r) => [r.id, profileCountry(input(r))]));
  const pkSibling = (id: string) => {
    const s = [...rows].find((x) => x.id !== id && own.get(x.id)?.status === "pakistan" && own.get(x.id)?.source !== "linked_profile");
    return s ? { platform: s.platform, reason: own.get(s.id)?.reason ?? "" } : null;
  };
  for (const r of rows) {
    const mine = own.get(r.id) as ProfileCountry;
    const next = mine.status === "unknown" ? profileCountry({ ...input(r), linkedPakistani: pkSibling(r.id) }) : mine;
    if (next.status === r.country_status && next.country === r.country) {
      // Fresh provider data re-confirms the evidence; a recomputation from stored data does not.
      // Same decision, different evidence (source, reason, confidence): refreshed in place; no lifecycle event, because
      // whether the profile may be shown did not change.
      if (next.source !== r.country_source || next.reason.slice(0, 300) !== r.country_reason || next.confidence !== r.country_confidence) {
        await tx.execute(sql`update gcp.creator_profiles set country_source = ${next.source}, country_reason = ${next.reason.slice(0, 300)}, country_confidence = ${next.confidence} where id = ${r.id}`);
      }
      if (o.source === "enrichment") await tx.execute(sql`update gcp.creator_profiles set country_checked_at = ${at}::timestamptz where id = ${r.id} and country_checked_at is distinct from ${at}::timestamptz and country_status <> 'unknown'`);
      continue;
    }
    await tx.execute(sql`
      update gcp.creator_profiles
      set country = ${next.country}, country_source = ${next.source}, country_status = ${next.status},
          country_reason = ${next.reason.slice(0, 300)}, country_confidence = ${next.confidence}, country_checked_at = ${next.status === "unknown" ? null : at}::timestamptz, updated_at = now()
      where id = ${r.id}`);
    await tx.execute(sql`
      insert into gcp.creator_lifecycle_events (creator_id, profile_id, kind, from_state, to_state, reason, source, action)
      values (${creatorId}, ${r.id}, 'location', ${r.country_status + (r.country ? ":" + r.country : "")}, ${next.status + (next.country ? ":" + next.country : "")},
              ${next.status === "conflicting" ? "Conflicting country evidence on this profile" : next.reason.slice(0, 300)}, ${o.source}, ${next.status === "pakistan" ? "may appear in customer search" : "excluded from customer search (kept, reviewable)"})`);
    changed.push({ profileId: r.id, platform: r.platform, from: r.country_status, to: next });
  }
  return changed;
}

/** The (platform, handle) a social profile URL points at; null for anything else. */
export function socialTarget(url: string): { platform: "instagram" | "tiktok" | "youtube"; handle: string } | null {
  let u: URL;
  try {
    u = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.)/u, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  const first = parts[0] ?? "";
  if (host === "instagram.com" && first && !["p", "reel", "reels", "stories", "explore"].includes(first)) return { platform: "instagram", handle: first.toLowerCase() };
  if (host === "tiktok.com" && first.startsWith("@")) return { platform: "tiktok", handle: first.slice(1).toLowerCase() };
  if (host === "youtube.com" || host === "youtu.be") {
    if (first.startsWith("@")) return { platform: "youtube", handle: first.slice(1).toLowerCase() };
    if (["c", "user"].includes(first) && parts[1]) return { platform: "youtube", handle: parts[1].toLowerCase() };
    if (first && !["watch", "channel", "shorts", "playlist", "results", "embed"].includes(first)) return { platform: "youtube", handle: first.toLowerCase() };
  }
  return null;
}

type GraphCreator = { platform: string; handle: string; public_country: string | null; public_country_source: string | null; status: string; source: string | null; reason: string | null };
/** Creators linked to the given ones by a profile link in either direction (the links' targets must exist as profiles). */
async function linkedCreatorGraph(tx: Tx, creatorIds: string[]): Promise<{ linked: Map<string, string[]>; creators: Map<string, GraphCreator> }> {
  const profiles = await tx.execute<{ creator_id: string; platform: string; handle: string; public_country: string | null; public_country_source: string | null; country_status: string; country_source: string | null; country_reason: string | null }>(sql`
    select p.creator_id, p.platform, lower(p.handle) handle, c.public_country, c.public_country_source, p.country_status, p.country_source, p.country_reason
    from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id where c.status = 'active'`);
  const byTarget = new Map<string, string>();
  const creators = new Map<string, GraphCreator>();
  for (const p of profiles) {
    byTarget.set(`${p.platform}:${p.handle}`, p.creator_id);
    if (!creators.has(p.creator_id) || p.country_status === "pakistan") creators.set(p.creator_id, { platform: p.platform, handle: p.handle, public_country: p.public_country, public_country_source: p.public_country_source, status: p.country_status, source: p.country_source, reason: p.country_reason });
  }
  const links = await tx.execute<{ creator_id: string; url: string }>(sql`select creator_id, url from gcp.creator_links`);
  const linked = new Map<string, string[]>();
  const add = (a: string, b: string) => linked.set(a, [...new Set([...(linked.get(a) ?? []), b])]);
  const wanted = new Set(creatorIds);
  for (const l of links) {
    const t = socialTarget(l.url);
    const other = t ? byTarget.get(`${t.platform}:${t.handle}`) : undefined;
    if (!other || other === l.creator_id) continue;
    if (wanted.has(l.creator_id) || wanted.has(other)) {
      add(l.creator_id, other);
      add(other, l.creator_id);
    }
  }
  return { linked, creators };
}

/**
 * Bulk form of refreshProfileCountries for backfills (same rules, same lifecycle events): one read for the batch, decisions in
 * memory, one UPDATE (jsonb_to_recordset) and one INSERT of lifecycle events. Use batches of about 500 creators.
 */
export async function bulkRefreshProfileCountries(tx: Tx, creatorIds: string[], o: { source: "backfill" | "staff"; now?: Date } = { source: "backfill" }): Promise<{ profileId: string; platform: string; from: string; to: ProfileCountry }[]> {
  if (creatorIds.length === 0) return [];
  const rows = await tx.execute<{ id: string; creator_id: string; platform: string; bio: string | null; country: string | null; country_status: string; country_source: string | null; country_reason: string | null; country_confidence: string | null; platform_country: string | null; confirmed_country: string | null; public_country: string | null; public_country_source: string | null; post_locations: string[] | null; urls: string[] | null }>(sql`
    select p.id, p.creator_id, p.platform, p.bio, p.country, p.country_status, p.country_source, p.country_reason, p.country_confidence, c.platform_country, c.confirmed_country,
           c.public_country, c.public_country_source, p.post_locations, l.urls
    from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id
    left join (select creator_id, array_agg(url) urls from gcp.creator_links where creator_id = any(array(select jsonb_array_elements_text(${JSON.stringify(creatorIds)}::jsonb)::uuid)) group by creator_id) l on l.creator_id = c.id
    where p.creator_id = any(array(select jsonb_array_elements_text(${JSON.stringify(creatorIds)}::jsonb)::uuid))`);
  const at = (o.now ?? new Date()).toISOString();
  // Cross-platform identity without merging records: a creator whose links point at another creator's profile (either
  // direction) is the same person. Their public record carries over; a Pakistani decision corroborates an empty profile.
  const graph = await linkedCreatorGraph(tx, creatorIds);
  const input = (r: (typeof rows)[number]) => {
    const linkedPublic = (graph.linked.get(r.creator_id) ?? []).map((id) => graph.creators.get(id)).find((c) => c?.public_country);
    return {
      bio: r.bio,
      platformCountry: r.platform === "youtube" ? r.platform_country : null,
      confirmed: r.confirmed_country,
      extras: { urls: r.urls ?? [], postLocations: r.post_locations ?? [] },
      publicRecord: r.public_country
        ? { country: r.public_country, source: r.public_country_source }
        : linkedPublic?.public_country
          ? { country: linkedPublic.public_country, source: `linked ${linkedPublic.platform} profile @${linkedPublic.handle}: ${linkedPublic.public_country_source ?? ""}` }
          : null,
    };
  };
  const all = [...rows];
  const own = new Map(all.map((r) => [r.id, profileCountry(input(r))]));
  const changed: { profileId: string; platform: string; from: string; to: ProfileCountry; creatorId: string; prevCountry: string | null }[] = [];
  const updates: { id: string; country: string | null; source: string | null; status: string; reason: string; confidence: string | null; checked: string | null }[] = [];
  for (const r of all) {
    const mine = own.get(r.id) as ProfileCountry;
    const sameCreator = mine.status === "unknown" ? all.find((x) => x.creator_id === r.creator_id && x.id !== r.id && own.get(x.id)?.status === "pakistan" && own.get(x.id)?.source !== "linked_profile") : undefined;
    const linkedPk = mine.status === "unknown" && !sameCreator ? (graph.linked.get(r.creator_id) ?? []).map((id) => graph.creators.get(id)).find((c) => c?.status === "pakistan" && c.source !== "linked_profile") : undefined;
    const sib = sameCreator ? { platform: sameCreator.platform, reason: own.get(sameCreator.id)?.reason ?? "" } : linkedPk ? { platform: linkedPk.platform, reason: `@${linkedPk.handle}: ${linkedPk.reason ?? ""}` } : null;
    const next = sib ? profileCountry({ ...input(r), linkedPakistani: sib }) : mine;
    const reason = next.reason.slice(0, 300);
    const decisionChanged = next.status !== r.country_status || next.country !== r.country;
    if (!decisionChanged && next.source === r.country_source && reason === r.country_reason && next.confidence === r.country_confidence) continue;
    updates.push({ id: r.id, country: next.country, source: next.source, status: next.status, reason, confidence: next.confidence, checked: decisionChanged ? (next.status === "unknown" ? null : at) : null });
    if (decisionChanged) changed.push({ profileId: r.id, platform: r.platform, from: r.country_status, to: next, creatorId: r.creator_id, prevCountry: r.country });
  }
  if (updates.length > 0) {
    await tx.execute(sql`
      update gcp.creator_profiles p
      set country = u.country, country_source = u.source, country_status = u.status, country_reason = u.reason, country_confidence = u.confidence,
          country_checked_at = case when u.checked is null and p.country_status = u.status then p.country_checked_at else u.checked::timestamptz end,
          updated_at = case when p.country_status = u.status and p.country is not distinct from u.country then p.updated_at else now() end
      from jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) as u(id uuid, country text, source text, status text, reason text, confidence text, checked text)
      where p.id = u.id`);
  }
  if (changed.length > 0) {
    const events = changed.map((c) => ({
      creator_id: c.creatorId,
      profile_id: c.profileId,
      from_state: c.from + (c.prevCountry ? ":" + c.prevCountry : ""),
      to_state: c.to.status + (c.to.country ? ":" + c.to.country : ""),
      reason: c.to.status === "conflicting" ? "Conflicting country evidence on this profile" : c.to.reason.slice(0, 300),
      action: c.to.status === "pakistan" ? "may appear in customer search" : "excluded from customer search (kept, reviewable)",
    }));
    await tx.execute(sql`
      insert into gcp.creator_lifecycle_events (creator_id, profile_id, kind, from_state, to_state, reason, source, action)
      select e.creator_id, e.profile_id, 'location', e.from_state, e.to_state, e.reason, ${o.source}, e.action
      from jsonb_to_recordset(${JSON.stringify(events)}::jsonb) as e(creator_id uuid, profile_id uuid, from_state text, to_state text, reason text, action text)`);
  }
  return changed.map(({ profileId, platform, from, to }) => ({ profileId, platform, from, to }));
}

/** Replaces a creator's evidence rows with this decision's; with `keepNiches` the earlier niche rows stay instead. */
export async function replaceAttributeEvidence(tx: Tx, creatorId: string, d: AttributeDecision, payloadId: string | null, o: { keepNiches?: boolean } = {}): Promise<void> {
  await tx
    .delete(creatorAttributeEvidence)
    .where(and(eq(creatorAttributeEvidence.creatorId, creatorId), ...(o.keepNiches ? [sql`${creatorAttributeEvidence.attribute} <> 'niche'`] : [])));
  const rows = d.evidence.filter((r) => !(o.keepNiches && r.attribute === "niche"));
  if (rows.length === 0) return;
  await tx.insert(creatorAttributeEvidence).values(
    rows.map((r) => ({ creatorId, attribute: r.attribute, value: truncate(r.value, 80), source: r.source, status: r.status, evidence: truncate(wholeChars(r.evidence), 300), payloadId })),
  );
}

async function insertSnapshot(tx: Tx, creatorId: string, a: Assessment, report: SignalReport, modelVersion: string, model: string): Promise<void> {
  await tx.insert(enrichmentSnapshots).values({
    creatorId,
    verdict: a.verdict ?? "insufficient data",
    authenticityScore: report.kind === "scored" ? a.score : null,
    evidenceBreakdown: report.kind === "scored" ? a.evidence : [],
    audience: a.audience,
    modelVersion: `${modelVersion}/${model}`,
    confidence: report.kind === "scored" ? report.confidence : null,
  });
}

/**
 * Background re-assessment after an AI failure (spec §5.2): a new snapshot and the creator's score. Under the evidence
 * policy (`evidenceNiches`) the AI's niches never replace the evidence-based classification; under the legacy policy
 * they are stored as before.
 */
export async function saveReassessment(tx: Tx, creatorId: string, a: Assessment, report: SignalReport, modelVersion: string, model: string, minorReason: string | null, o: { evidenceNiches: boolean }): Promise<void> {
  await insertSnapshot(tx, creatorId, a, report, modelVersion, model);
  await tx
    .update(creators)
    .set({
      authenticityScore: report.kind === "scored" ? a.score : null,
      assessmentStatus: report.kind === "scored" ? "assessed" : "insufficient_data",
      ...(!o.evidenceNiches && a.niches.length > 0 ? { niches: a.niches } : {}),
      ...(minorReason !== null
        ? { isMinor: true, minorReason: sql`coalesce(${creators.minorReason}, ${minorReason})`, minorFlaggedAt: sql`coalesce(${creators.minorFlaggedAt}, now())` }
        : {}),
    })
    .where(eq(creators.id, creatorId));
  await tx
    .update(creatorProfiles)
    .set({ audienceUpdatedAt: sql`now()` })
    .where(and(eq(creatorProfiles.creatorId, creatorId)));
  await writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: creatorId, workspaceId: null, payload: { creatorId }, requestId: null });
}
