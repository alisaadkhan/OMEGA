import { sql } from "drizzle-orm";
import { encryptSecret, sha256Hex } from "@mushin/core";
import type { Db } from "@mushin/db";
import { extractContacts, extractLinks } from "./enrichment/links";
import { maskContact } from "./rules";
import { classifyAccountType } from "./account-type";
import { contentPerformance } from "./eligibility-v3";
import { standardize } from "./enrichment/standardize";
import { storedEngagementRate } from "./enrichment/signals";
import { captionCountryEvidence } from "./enrichment/country-evidence";
import { bulkRefreshProfileCountries } from "./enrichment/repository";

/**
 * Continuous, versioned catalogue reassessment (owner master directive 2026-11-03, Phase 5; migration 0079).
 * Bump REASSESSMENT_VERSION whenever the deterministic rules below change: the worker then works through every active
 * creator again, a batch at a time, resuming from its cursor after a restart. Each creator is re-derived from its
 * stored provider answers only: account type (never over a staff decision), content performance (median views and
 * engagement; not YouTube while derived YouTube metrics are restricted) and each profile's country. No provider or AI
 * call, nothing deleted. scripts/catalog/reassess-catalogue.ts is the same rules with an impact report for a dry run.
 */
export const REASSESSMENT_VERSION = "reassess-2026-11-14";
export const REASSESSMENT_BATCH = 200;

export type ReadPayload = (storageKey: string) => Promise<unknown | null>;
type Row = {
  creator_id: string; profile_id: string; platform: "instagram" | "tiktok" | "youtube"; handle: string; display_name: string; bio: string | null;
  primary_platform: string; account_type_source: string | null; key: string | null; canonical_url: string; youtube_expired: boolean;
};
/**
 * Contacts recovery (execution directive 2026-11-04, Stage 1 sections 2 and 5): emails, mobile numbers and links the
 * stored answer holds but the database missed (also YouTube channel-description contacts, now permitted). Added only,
 * never removed; stored encrypted and masked exactly as enrichment stores them. Needs the data encryption key.
 */
export type ContactRecovery = { encryptionKey: Buffer; youtubeDescriptionContacts: boolean };

/** Re-derives the given creators; returns how many creator or profile values changed. */
export async function reassessCreators(db: Db, creatorIds: string[], readPayload: ReadPayload, o: { youtubeDerived?: boolean; contacts?: ContactRecovery | null } = {}): Promise<number> {
  if (creatorIds.length === 0) return 0;
  const rows = await db.withSystem((tx) =>
    tx.execute<Row>(sql`
      select p.creator_id, p.id profile_id, p.platform, p.handle, p.canonical_url, c.display_name, p.bio, c.primary_platform, c.account_type_source,
        -- Only answers still inside their retention period (YouTube API data: 30 days) are read (security review).
        (select r.storage_key from platform.raw_payloads r where r.creator_id = p.creator_id and r.platform = p.platform and r.delete_after > now() order by r.fetched_at desc limit 1) key,
        (p.platform = 'youtube' and coalesce(p.last_scraped_at, p.created_at) < now() - interval '30 days') youtube_expired
      from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id
      where c.status = 'active' and c.id in (select jsonb_array_elements_text(${JSON.stringify(creatorIds)}::jsonb)::uuid)`),
  );
  const accounts: { id: string; type: string; source: string | null; confidence: string | null; evidence: string | null }[] = [];
  const perf: { id: string; mv: number | null; mer: number | null; vs: number; es: number; fmt: string; f: string | null; t: string | null; er: number | null }[] = [];
  const contacts: { creator_id: string; kind: string; enc: string; hash: string; masked: string; trust: string; source: string }[] = [];
  const links: { creator_id: string; platform: string; url: string; source: string }[] = [];
  const ticks: { id: string; v: boolean }[] = [];
  const captionEvidence: { id: string; e: string | null }[] = [];
  for (const r of rows) {
    // A missing or expired answer leaves this profile as it is.
    // YouTube data past its 30 days is never re-derived: retention (0063/0078) cleared it and only a refresh brings it back.
    const raw = r.key && !r.youtube_expired ? await readPayload(r.key).catch(() => null) : null;
    const std = raw ? standardize(r.platform, r.handle, raw, { maxPosts: 30 }) : null;
    if (std?.kind === "ok" && r.platform !== "youtube") ticks.push({ id: r.profile_id, v: std.profile.verified });
    // Location evidence from the last 5 descriptions / captions (0087); YouTube text only while it may be used.
    if (std?.kind === "ok" && (r.platform !== "youtube" || o.youtubeDerived)) {
      captionEvidence.push({ id: r.profile_id, e: captionCountryEvidence(std.profile.recentPosts.slice(0, 5).map((x) => [x.caption, x.description ?? ""].join("\n"))) });
    }
    if (r.platform === r.primary_platform && r.account_type_source !== "staff") {
      const d = classifyAccountType({ category: std?.kind === "ok" ? (std.profile.accountCategory ?? null) : null, bio: r.bio ?? "", handle: r.handle, displayName: r.display_name });
      accounts.push({ id: r.creator_id, ...d });
    }
    if (std?.kind === "ok" && (r.platform !== "youtube" || o.youtubeDerived)) {
      const p = contentPerformance(std.profile, { youtubeDerived: o.youtubeDerived ?? false });
      if (p) perf.push({ id: r.profile_id, mv: p.medianViews, mer: p.medianEngagementRate, vs: p.viewsSample, es: p.engagementSample, fmt: p.format, f: p.sampleFrom?.toISOString() ?? null, t: p.sampleTo?.toISOString() ?? null, er: storedEngagementRate(std.profile) });
    }
    if (std?.kind === "ok" && o.contacts && (r.platform !== "youtube" || o.contacts.youtubeDescriptionContacts)) {
      for (const k of extractContacts(std.profile)) contacts.push({ creator_id: r.creator_id, kind: k.kind, enc: encryptSecret(k.value, o.contacts.encryptionKey), hash: sha256Hex(k.value.trim().toLowerCase()), masked: maskContact(k.kind, k.value), trust: k.trust, source: k.source });
      for (const l of extractLinks(std.profile, r.canonical_url)) links.push({ creator_id: r.creator_id, platform: l.platform, url: l.url, source: l.source });
    }
  }
  let changed = 0;
  // Checked in the writing statement itself: a creator removed or put on the do-not-re-add list while this batch read
  // its payloads gets nothing back (security review: no resurrection after erasure).
  const writable = sql`exists (select 1 from gcp.creators c where c.id = u.creator_id and c.status = 'active')
    and not exists (select 1 from gcp.creator_profiles pp join gcp.creator_suppressions s on s.url_hash = encode(sha256(convert_to(lower(trim(pp.canonical_url)), 'UTF8')), 'hex') where pp.creator_id = u.creator_id)`;
  await db.withSystem(async (tx) => {
    if (accounts.length) {
      const res = await tx.execute(sql`
        update gcp.creators c set account_type = u.type, account_type_source = u.source, account_type_confidence = u.confidence, account_type_evidence = left(u.evidence, 300), account_type_assessed_at = now(), updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(accounts)}::jsonb) as u(id uuid, type text, source text, confidence text, evidence text)
        where c.id = u.id and c.status = 'active' and c.account_type_source is distinct from 'staff'
          and (c.account_type, c.account_type_source, c.account_type_confidence) is distinct from (u.type, u.source, u.confidence)`);
      changed += res.count ?? 0;
    }
    if (perf.length) {
      const res = await tx.execute(sql`
        update gcp.creator_profiles p set engagement_rate = u.er, median_views = u.mv, median_engagement_rate = u.mer, performance_views_sample = u.vs, performance_engagement_sample = u.es, performance_format = u.fmt, performance_from = u.f::timestamptz, performance_to = u.t::timestamptz, performance_at = now(), updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(perf)}::jsonb) as u(id uuid, mv double precision, mer double precision, vs integer, es integer, fmt text, f text, t text, er double precision)
        where p.id = u.id and exists (select 1 from gcp.creators c where c.id = p.creator_id and c.status = 'active') and (p.engagement_rate, p.median_views, p.median_engagement_rate, p.performance_views_sample, p.performance_engagement_sample) is distinct from (u.er, u.mv::integer, u.mer, u.vs::smallint, u.es::smallint)`);
      changed += res.count ?? 0;
    }
    if (contacts.length) {
      const res = await tx.execute(sql`
        insert into gcp.creator_contacts (creator_id, kind, value_encrypted, value_hash, masked, trust, source)
        select u.creator_id, u.kind, u.enc, u.hash, u.masked, u.trust, u.source
        from jsonb_to_recordset(${JSON.stringify(contacts)}::jsonb) as u(creator_id uuid, kind text, enc text, hash text, masked text, trust text, source text)
        where ${writable}
        on conflict (creator_id, kind, value_hash) do nothing`);
      changed += res.count ?? 0;
    }
    if (links.length) {
      const res = await tx.execute(sql`
        insert into gcp.creator_links (creator_id, platform, url, source)
        select u.creator_id, u.platform, u.url, u.source from jsonb_to_recordset(${JSON.stringify(links)}::jsonb) as u(creator_id uuid, platform text, url text, source text)
        where ${writable}
        on conflict (creator_id, url) do nothing`);
      changed += res.count ?? 0;
    }
    // Blue tick per profile (0086); the creator is verified when any profile is. YouTube has no badge in its API.
    if (ticks.length) {
      const res = await tx.execute(sql`
        update gcp.creator_profiles p set verified = u.v from jsonb_to_recordset(${JSON.stringify(ticks)}::jsonb) as u(id uuid, v boolean)
        where p.id = u.id and p.verified is distinct from u.v`);
      changed += res.count ?? 0;
      await tx.execute(sql`update gcp.creators c set verified = exists (select 1 from gcp.creator_profiles p where p.creator_id = c.id and p.verified)
        where c.id in (select jsonb_array_elements_text(${JSON.stringify(creatorIds)}::jsonb)::uuid)`);
    }
    if (captionEvidence.length) {
      const res = await tx.execute(sql`
        update gcp.creator_profiles p set caption_country_evidence = u.e from jsonb_to_recordset(${JSON.stringify(captionEvidence)}::jsonb) as u(id uuid, e text)
        where p.id = u.id and p.caption_country_evidence is distinct from u.e`);
      changed += res.count ?? 0;
    }
    // Countries last: recovered links can carry a linked profile's Pakistani evidence.
    changed += (await bulkRefreshProfileCountries(tx, creatorIds, { source: "backfill" })).length;
  });
  return changed;
}

export type ReassessmentReport = { version: string; processed: number; changed: number; finished: boolean; creatorIds: string[] };

/**
 * One step of the run for the current version: the next batch after the cursor, then the cursor moves. Returns the
 * creators it touched (for the search projection). A finished version does nothing until the version changes.
 */
export async function reassessNextBatch(o: { db: Db; readPayload: ReadPayload; version?: string; batch?: number; youtubeDerived?: boolean; contacts?: ContactRecovery | null }): Promise<ReassessmentReport> {
  const version = o.version ?? REASSESSMENT_VERSION;
  const [run] = await o.db.withSystem((tx) =>
    tx.execute<{ cursor_id: string | null; processed: number; changed: number; finished_at: string | null }>(sql`
      insert into platform.reassessment_runs (version) values (${version}) on conflict (version) do update set version = excluded.version
      returning cursor_id, processed, changed, finished_at`),
  );
  if (!run || run.finished_at) return { version, processed: run?.processed ?? 0, changed: run?.changed ?? 0, finished: true, creatorIds: [] };
  const ids = [
    ...(await o.db.withSystem((tx) =>
      tx.execute<{ id: string }>(sql`select id from gcp.creators where status = 'active' and (${run.cursor_id}::uuid is null or id > ${run.cursor_id}::uuid) order by id limit ${o.batch ?? REASSESSMENT_BATCH}`),
    )),
  ].map((r) => r.id);
  const changed = await reassessCreators(o.db, ids, o.readPayload, { youtubeDerived: o.youtubeDerived ?? false, contacts: o.contacts ?? null });
  const finished = ids.length < (o.batch ?? REASSESSMENT_BATCH);
  await o.db.withSystem((tx) =>
    tx.execute(sql`
      update platform.reassessment_runs set cursor_id = coalesce(${ids.at(-1) ?? null}::uuid, cursor_id), processed = processed + ${ids.length}, changed = changed + ${changed},
        updated_at = now(), finished_at = case when ${finished} then now() else null end
      where version = ${version}`),
  );
  return { version, processed: run.processed + ids.length, changed: run.changed + changed, finished, creatorIds: ids };
}
