import { sql } from "drizzle-orm";
import { writeOutbox, type Db, type SystemTx } from "@mushin/db";
import { creatorEligibility, type CreatorEligibility, type EligibilityProfile } from "./eligibility";

/**
 * Creator lifecycle policy (owner instruction 2026-10-26). One place decides what may happen to a creator; search,
 * Live Discovery delivery, list and campaign additions and the profile all read eligibility from eligibility.ts, which
 * this extends with profile availability. Concepts stay apart:
 *   - creator status (active / removal_requested / merged / erased): identity and removal;
 *   - each platform profile's availability: a provider failure or one "not found" concludes nothing; "not found" twice,
 *     24 hours apart, is a confirmed removal of that profile only;
 *   - eligibility per profile (10,000 followers on that profile, fresh count, activity): one platform falling below the
 *     threshold never affects another;
 *   - location state (confirmed / stated / platform-reported / conflicting / stale / unknown), never a guess;
 *   - retention: provider data is deleted on its schedule (retention.ts), whatever the creator's state.
 * Hiding is never deletion: ineligible or unavailable creators stay stored and labelled. Every transition is logged in
 * gcp.creator_lifecycle_events with its reason, source and action.
 */
export type Availability = NonNullable<EligibilityProfile["availability"]>;
export type Observation = "found" | "not_found" | "private" | "provider_error";
export type LifecycleSource = "enrichment" | "refresh_job" | "lifecycle_sweep" | "retention_job" | "staff" | "backfill";

/** How long a single "not found" waits for a second one before the profile counts as removed. */
export const MISSING_CONFIRM_MS = 24 * 3_600_000;

/** The next availability state after one observation (pure; the caller records it). */
export function nextAvailability(current: Availability, missingSince: Date | null, observed: Observation, now: Date): { state: Availability; missingSince: Date | null } {
  if (observed === "found") return { state: "available", missingSince: null };
  if (observed === "private") return { state: "private", missingSince: null };
  if (observed === "provider_error") {
    // An outage says nothing about the account: an already concluded state stays, anything else is "temporarily unavailable".
    return current === "not_found" || current === "private" || current === "missing_unconfirmed" ? { state: current, missingSince } : { state: "temporarily_unavailable", missingSince };
  }
  if (current === "not_found") return { state: "not_found", missingSince };
  if (current === "missing_unconfirmed" && missingSince && now.getTime() - missingSince.getTime() >= MISSING_CONFIRM_MS) return { state: "not_found", missingSince };
  return { state: "missing_unconfirmed", missingSince: current === "missing_unconfirmed" && missingSince ? missingSince : now };
}

const ACTION: Record<Availability, string> = {
  available: "profile counts again with its latest data",
  temporarily_unavailable: "kept as it was; the next refresh checks again",
  missing_unconfirmed: "kept as it was until a second check, at least 24 hours later",
  not_found: "profile no longer qualifies; records kept",
  private: "profile no longer qualifies; records kept",
};

/** Records one provider observation of a stored profile; a change of state is logged and re-indexes the creator. */
export async function recordAvailability(tx: SystemTx, o: { canonicalUrl: string; observed: Observation; source: LifecycleSource; reason: string; now: Date }): Promise<{ from: Availability; to: Availability } | null> {
  const [p] = await tx.execute<{ id: string; creator_id: string; availability: Availability; missing_since: string | null }>(
    sql`select id, creator_id, availability, missing_since from gcp.creator_profiles where canonical_url = ${o.canonicalUrl} for update`,
  );
  if (!p) return null;
  const missingSince = p.missing_since ? new Date(p.missing_since) : null;
  const next = nextAvailability(p.availability, missingSince, o.observed, o.now);
  await tx.execute(
    sql`update gcp.creator_profiles set availability = ${next.state}, availability_checked_at = ${o.now.toISOString()}::timestamptz,
        missing_since = ${next.missingSince ? next.missingSince.toISOString() : null}::timestamptz where id = ${p.id}`,
  );
  if (next.state === p.availability) return { from: p.availability, to: next.state };
  await tx.execute(sql`insert into gcp.creator_lifecycle_events (creator_id, profile_id, kind, from_state, to_state, reason, source, action)
    values (${p.creator_id}, ${p.id}, 'availability', ${p.availability}, ${next.state}, ${o.reason.slice(0, 300)}, ${o.source}, ${ACTION[next.state]})`);
  await writeOutbox(tx, { eventType: "creator.changed", aggregateType: "creator", aggregateId: p.creator_id, workspaceId: null, payload: { creatorId: p.creator_id }, requestId: null });
  return { from: p.availability, to: next.state };
}

export type LocationState = "creator_confirmed" | "creator_stated" | "platform_reported" | "conflicting" | "stale" | "unknown";
/** Location evidence older than this is stale (a re-check is due); platform data is also bound by provider retention. */
export const LOCATION_STALE_DAYS = 365;

/**
 * The location state shown with a country. A country-specific search or campaign counts a creator as a match only for
 * creator_confirmed, creator_stated or platform_reported (labelled as such); conflicting, stale and unknown are never
 * shown as a confirmed match.
 */
export function locationState(c: { country: string | null; countrySource: string | null; platformCountry: string | null; statedCountry: string | null; countryCheckedAt: Date | string | null }, now: Date): LocationState {
  if (!c.country) return "unknown";
  if (c.countrySource === "creator_confirmed") return "creator_confirmed";
  const checked = c.countryCheckedAt ? new Date(c.countryCheckedAt).getTime() : null;
  if (checked !== null && now.getTime() - checked > LOCATION_STALE_DAYS * 86_400_000) return "stale";
  if (c.statedCountry && c.platformCountry && c.statedCountry !== c.platformCountry) return "conflicting";
  if (c.countrySource === "creator_stated") return "creator_stated";
  if (c.countrySource === "platform_declared") return "platform_reported";
  return checked === null ? "stale" : "unknown";
}

/** What may be done with a creator now (one decision for every feature). */
export type PermittedActions = { showInSearch: boolean; addToListOrCampaign: boolean; revealContact: boolean; sendOutreach: boolean; refresh: boolean; qualifyingPlatforms: string[] };
export function permittedActions(c: { status: string; isMinor: boolean; minorOverrideByStaffId: string | null }, e: CreatorEligibility): PermittedActions {
  const active = c.status === "active";
  return {
    showInSearch: e.eligible,
    addToListOrCampaign: e.eligible,
    // Reaching a creator who is already saved stays possible while their record is active, even if no longer eligible.
    revealContact: active && !(c.isMinor && c.minorOverrideByStaffId === null),
    sendOutreach: active && !(c.isMinor && c.minorOverrideByStaffId === null),
    refresh: active,
    qualifyingPlatforms: e.qualifyingPlatforms,
  };
}

export type SweepReport = {
  dryRun: boolean;
  at: string;
  refreshDue: { platform: string; n: number }[];
  unavailable: { availability: string; n: number }[];
  missingToConfirm: number;
  locationStates: Record<string, number>;
  pendingRemovals: number;
  oldestRemovalDays: number | null;
  eligibilityChanges: number;
};

/**
 * Daily lifecycle check. It changes nothing that costs money or deletes data: it reports profiles due a refresh (paid
 * refreshes are started by people, not by the sweep), unavailable profiles, removal requests waiting, location states,
 * and how many search documents disagree with the current eligibility; with `apply`, those documents are re-projected
 * (a hide/show change, never a deletion). Retention purges run as their own jobs.
 */
export async function lifecycleSweep(o: { db: Db; now?: () => Date; apply: boolean; reproject?: (ids: string[]) => Promise<unknown> }): Promise<SweepReport> {
  const now = (o.now ?? (() => new Date()))();
  return o.db.withSystem(async (tx) => {
    const refreshDue = await tx.execute<{ platform: string; n: number }>(
      sql`select platform, count(*)::int n from gcp.creator_profiles p join gcp.creators c on c.id = p.creator_id and c.status = 'active'
          where p.followers_updated_at is null or p.followers_updated_at < ${now.toISOString()}::timestamptz - interval '75 days' group by 1 order by 1`,
    );
    const unavailable = await tx.execute<{ availability: string; n: number }>(sql`select availability, count(*)::int n from gcp.creator_profiles where availability <> 'available' group by 1 order by 1`);
    const [missing] = await tx.execute<{ n: number }>(
      sql`select count(*)::int n from gcp.creator_profiles where availability = 'missing_unconfirmed' and missing_since < ${now.toISOString()}::timestamptz - interval '24 hours'`,
    );
    const creators = await tx.execute<{ country: string | null; country_source: string | null; platform_country: string | null; stated_country: string | null; country_checked_at: string | null }>(
      sql`select country, country_source, platform_country, stated_country, country_checked_at from gcp.creators where status = 'active'`,
    );
    const locationStates: Record<string, number> = {};
    for (const c of creators) {
      const s = locationState({ country: c.country, countrySource: c.country_source, platformCountry: c.platform_country, statedCountry: c.stated_country, countryCheckedAt: c.country_checked_at }, now);
      locationStates[s] = (locationStates[s] ?? 0) + 1;
    }
    const [removals] = await tx.execute<{ n: number; oldest: number | null }>(
      sql`select count(*)::int n, extract(day from ${now.toISOString()}::timestamptz - min(created_at))::int oldest from gcp.removal_requests where status = 'received'`,
    );
    // Search documents whose stored eligibility no longer matches the policy as of now.
    const docs = await tx.execute<{ id: string; eligible: boolean; status: string; is_minor: boolean; minor_override_by_staff_id: string | null; organisation: boolean; profiles: EligibilityProfile[] }>(sql`
      select c.id, d.eligible, c.status, c.is_minor, c.minor_override_by_staff_id, (c.organisation_category is not null and c.organisation_override_by_staff_id is null) as organisation,
        coalesce((select jsonb_agg(jsonb_build_object('platform', p.platform, 'canonicalUrl', p.canonical_url,
          'followers', case when p.platform = 'youtube' and p.followers = 0 then null else p.followers end,
          'followersUpdatedAt', p.followers_updated_at, 'lastPostAt', p.last_post_at, 'availability', p.availability, 'country', jsonb_build_object('code', p.country, 'status', p.country_status, 'checkedAt', p.country_checked_at)))
          from gcp.creator_profiles p where p.creator_id = c.id), '[]'::jsonb) profiles
      from gcp.creators c join gcp.creator_search_documents d on d.creator_id = c.id`);
    const changed = docs.filter((d) => creatorEligibility({ status: d.status, isMinor: d.is_minor, minorOverrideByStaffId: d.minor_override_by_staff_id, organisation: d.organisation }, d.profiles, now).eligible !== d.eligible).map((d) => d.id);
    if (o.apply && changed.length > 0 && o.reproject) await o.reproject(changed);
    return {
      dryRun: !o.apply,
      at: now.toISOString(),
      refreshDue: [...refreshDue],
      unavailable: [...unavailable],
      missingToConfirm: missing?.n ?? 0,
      locationStates,
      pendingRemovals: removals?.n ?? 0,
      oldestRemovalDays: removals?.oldest ?? null,
      eligibilityChanges: changed.length,
    };
  });
}
