import { sql } from "drizzle-orm";
import type { Db } from "@mushin/db";
import { classifyAccountType } from "./account-type";
import { contentPerformance } from "./eligibility-v3";
import { standardize } from "./enrichment/standardize";
import { bulkRefreshProfileCountries } from "./enrichment/repository";

/**
 * Continuous, versioned catalogue reassessment (owner master directive 2026-11-03, Phase 5; migration 0079).
 * Bump REASSESSMENT_VERSION whenever the deterministic rules below change: the worker then works through every active
 * creator again, a batch at a time, resuming from its cursor after a restart. Each creator is re-derived from its
 * stored provider answers only: account type (never over a staff decision), content performance (median views and
 * engagement; not YouTube while derived YouTube metrics are restricted) and each profile's country. No provider or AI
 * call, nothing deleted. scripts/catalog/reassess-catalogue.ts is the same rules with an impact report for a dry run.
 */
export const REASSESSMENT_VERSION = "reassess-2026-11-04";
export const REASSESSMENT_BATCH = 200;

export type ReadPayload = (storageKey: string) => Promise<unknown | null>;
type Row = {
  creator_id: string; profile_id: string; platform: "instagram" | "tiktok" | "youtube"; handle: string; display_name: string; bio: string | null;
  primary_platform: string; account_type_source: string | null; key: string | null;
};

/** Re-derives the given creators; returns how many creator or profile values changed. */
export async function reassessCreators(db: Db, creatorIds: string[], readPayload: ReadPayload): Promise<number> {
  if (creatorIds.length === 0) return 0;
  const rows = await db.withSystem((tx) =>
    tx.execute<Row>(sql`
      select p.creator_id, p.id profile_id, p.platform, p.handle, c.display_name, p.bio, c.primary_platform, c.account_type_source,
        (select r.storage_key from platform.raw_payloads r where r.creator_id = p.creator_id and r.platform = p.platform order by r.fetched_at desc limit 1) key
      from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id
      where c.status = 'active' and c.id in (select jsonb_array_elements_text(${JSON.stringify(creatorIds)}::jsonb)::uuid)`),
  );
  const accounts: { id: string; type: string; source: string | null; confidence: string | null; evidence: string | null }[] = [];
  const perf: { id: string; mv: number | null; mer: number | null; vs: number; es: number; fmt: string; f: string | null; t: string | null }[] = [];
  for (const r of rows) {
    // A missing or expired answer leaves this profile as it is.
    const raw = r.key ? await readPayload(r.key).catch(() => null) : null;
    const std = raw ? standardize(r.platform, r.handle, raw, { maxPosts: 30 }) : null;
    if (r.platform === r.primary_platform && r.account_type_source !== "staff") {
      const d = classifyAccountType({ category: std?.kind === "ok" ? (std.profile.accountCategory ?? null) : null, bio: r.bio ?? "", handle: r.handle, displayName: r.display_name });
      accounts.push({ id: r.creator_id, ...d });
    }
    if (std?.kind === "ok" && r.platform !== "youtube") {
      const p = contentPerformance(std.profile);
      if (p) perf.push({ id: r.profile_id, mv: p.medianViews, mer: p.medianEngagementRate, vs: p.viewsSample, es: p.engagementSample, fmt: p.format, f: p.sampleFrom?.toISOString() ?? null, t: p.sampleTo?.toISOString() ?? null });
    }
  }
  let changed = 0;
  await db.withSystem(async (tx) => {
    if (accounts.length) {
      const res = await tx.execute(sql`
        update gcp.creators c set account_type = u.type, account_type_source = u.source, account_type_confidence = u.confidence, account_type_evidence = left(u.evidence, 300), account_type_assessed_at = now(), updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(accounts)}::jsonb) as u(id uuid, type text, source text, confidence text, evidence text)
        where c.id = u.id and c.account_type_source is distinct from 'staff'
          and (c.account_type, c.account_type_source, c.account_type_confidence) is distinct from (u.type, u.source, u.confidence)`);
      changed += res.count ?? 0;
    }
    if (perf.length) {
      const res = await tx.execute(sql`
        update gcp.creator_profiles p set median_views = u.mv, median_engagement_rate = u.mer, performance_views_sample = u.vs, performance_engagement_sample = u.es, performance_format = u.fmt, performance_from = u.f::timestamptz, performance_to = u.t::timestamptz, performance_at = now(), updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(perf)}::jsonb) as u(id uuid, mv double precision, mer double precision, vs integer, es integer, fmt text, f text, t text)
        where p.id = u.id and (p.median_views, p.median_engagement_rate, p.performance_views_sample, p.performance_engagement_sample) is distinct from (u.mv::integer, u.mer, u.vs::smallint, u.es::smallint)`);
      changed += res.count ?? 0;
    }
    changed += (await bulkRefreshProfileCountries(tx, creatorIds, { source: "backfill" })).length;
  });
  return changed;
}

export type ReassessmentReport = { version: string; processed: number; changed: number; finished: boolean; creatorIds: string[] };

/**
 * One step of the run for the current version: the next batch after the cursor, then the cursor moves. Returns the
 * creators it touched (for the search projection). A finished version does nothing until the version changes.
 */
export async function reassessNextBatch(o: { db: Db; readPayload: ReadPayload; version?: string; batch?: number }): Promise<ReassessmentReport> {
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
  const changed = await reassessCreators(o.db, ids, o.readPayload);
  const finished = ids.length < (o.batch ?? REASSESSMENT_BATCH);
  await o.db.withSystem((tx) =>
    tx.execute(sql`
      update platform.reassessment_runs set cursor_id = coalesce(${ids.at(-1) ?? null}::uuid, cursor_id), processed = processed + ${ids.length}, changed = changed + ${changed},
        updated_at = now(), finished_at = case when ${finished} then now() else null end
      where version = ${version}`),
  );
  return { version, processed: run.processed + ids.length, changed: run.changed + changed, finished, creatorIds: ids };
}
