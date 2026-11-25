/**
 * Update rules for creators the live catalogue already has (owner directive 2026-11-15, "live catalogue sync"):
 *   - fresher data wins: a live profile is replaced only by a local reading at least as recent (last_scraped_at), and a
 *     creator's assessed fields only when no live profile of that creator was read more recently than the local ones,
 *     so a customer's live "Update info" is never overwritten by older local data;
 *   - staff decisions: a local staff account type (owner overrides) is applied whatever the freshness; a live staff
 *     account type, a live organisation override, a live minor override and a live confirmed country are kept;
 *   - YouTube API data older than 30 days is never copied (a YouTube-primary creator whose channel was read more than
 *     30 days ago keeps only staff decisions), and the live retention function runs in the same transaction;
 *   - contacts are never copied (encrypted with the local key); photos follow with sync-avatars.ts; generated columns
 *     (pakistani_diaspora) follow from the copied ones.
 * Identity merges made locally are replayed with platform.merge_creator, which moves the absorbed creator's profiles and
 * every row pointing at it (lists, campaigns, reveals) as the worker would.
 */
import type postgres from "postgres";

type Tx = postgres.TransactionSql;
const CHUNK = 500;
export const YT_CUTOFF = "now() - interval '30 days'";

const PROFILE_DATA = [
  "followers", "following", "posts", "engagement_rate", "engagement_per_view", "avg_likes", "avg_comments", "avg_views", "bio", "followers_updated_at",
  "engagement_updated_at", "audience_updated_at", "last_scraped_at", "last_post_at", "availability", "availability_checked_at",
  "missing_since", "median_views", "median_engagement_rate", "performance_views_sample", "performance_engagement_sample",
  "performance_format", "performance_from", "performance_to", "performance_at", "post_locations", "verified",
  "caption_country_evidence", "posts_per_week", "posting_measured_at",
];
const PROFILE_COUNTRY = ["country", "country_source", "country_status", "country_reason", "country_checked_at", "country_confidence"];
const CREATOR_DATA = [
  "display_name", "name_variants", "tags", "verified", "niches", "niche_main", "niche_status", "niche_confidence", "niche_assessed_at",
  "niche_source", "niche_posts_assessed", "authenticity_score", "fake_follower_pct", "assessment_status", "city",
];
const CREATOR_COUNTRY = [
  "country", "platform_country", "stated_country", "confirmed_country", "country_source", "country_confidence", "country_checked_at",
  "public_country", "public_country_source", "public_country_at",
];
const ACCOUNT = ["account_type", "account_type_source", "account_type_confidence", "account_type_evidence", "account_type_assessed_at"];

/** Column assignments, and the value each column gets, keeping the live value where `keepLive` holds. */
function assign(cols: string[], keepLive: string | null) {
  const value = (c: string) => (keepLive ? `case when ${keepLive} then d.${c} else s.${c} end` : `s.${c}`);
  return {
    set: cols.map((c) => `${c} = ${value(c)}`).join(", "),
    changes: `(${cols.map((c) => `d.${c}`).join(", ")}) is distinct from (${cols.map(value).join(", ")})`,
  };
}

async function stage(tx: Tx, name: string, like: string, rows: unknown[]) {
  await tx.unsafe(`create temp table ${name} (like ${like}) on commit drop`);
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx.unsafe(`insert into ${name} select * from jsonb_populate_recordset(null::${like}, ($1::text)::jsonb)`, [JSON.stringify(rows.slice(i, i + CHUNK))]);
  }
}

const tally = async (tx: Tx, q: string) => Object.fromEntries((await tx.unsafe(q)).map((r) => [String(r["k"]), Number(r["n"])]));

export async function syncExisting(tx: Tx, local: { creators: unknown[]; profiles: unknown[] }) {
  await stage(tx, "s_creators", "gcp.creators", local.creators);
  await stage(tx, "s_profiles", "gcp.creator_profiles", local.profiles);
  // Per live creator: is the local reading at least as recent, and is it a YouTube-primary creator with expired data?
  await tx.unsafe(`create temp table s_rule on commit drop as
    select s.id,
      coalesce((select max(p.last_scraped_at) from s_profiles p where p.creator_id = s.id), '-infinity')
        >= coalesce((select max(p.last_scraped_at) from gcp.creator_profiles p where p.creator_id = s.id), '-infinity') as fresh,
      (s.primary_platform = 'youtube' and exists (select 1 from s_profiles y where y.creator_id = s.id and y.platform = 'youtube'
        and coalesce(y.last_scraped_at, y.created_at) < ${YT_CUTOFF})) as yt_expired
    from s_creators s join gcp.creators d on d.id = s.id`);
  const out: Record<string, unknown> = {};
  out["liveCreatorsMatched"] = await tally(tx, `select case when fresh and not yt_expired then 'local at least as fresh' when yt_expired then 'YouTube data expired: staff decisions only' else 'live fresher: staff decisions only' end k, count(*) n from s_rule group by 1`);

  // 1. Identity merges: both creators active live, the absorbed one merged locally.
  const merges = await tx.unsafe(`select s.id absorb, s.merged_into_id keep from s_creators s
    join gcp.creators d on d.id = s.id and d.status = 'active' join gcp.creators k on k.id = s.merged_into_id and k.status = 'active'
    where s.status = 'merged'`);
  const mergeOutcomes: Record<string, number> = {};
  for (const m of merges) {
    const [r] = await tx.unsafe(`select platform.merge_creator($1::uuid, $2::uuid, 'Catalogue sync: merged in the operational catalogue') r`, [m["keep"], m["absorb"]]);
    const res = r?.["r"] as { merged?: boolean; reason?: string } | undefined;
    const k = res?.merged ? "merged" : `refused: ${res?.reason ?? "unknown"}`;
    mergeOutcomes[k] = (mergeOutcomes[k] ?? 0) + 1;
  }
  out["identityMerges"] = mergeOutcomes;
  out["profilesOnAnotherCreatorLocally"] = Number((await tx.unsafe(`select count(*) n from gcp.creator_profiles d join s_profiles s on s.id = d.id where d.creator_id <> s.creator_id`))[0]?.["n"]);

  // 2. Profiles: fresher-or-equal local readings, never expired YouTube data; a confirmed live country stays.
  const pData = assign(PROFILE_DATA, null);
  const pCountry = assign(PROFILE_COUNTRY, "d.country_source = 'creator_confirmed'");
  const profileWhere = `d.id = s.id and coalesce(s.last_scraped_at, '-infinity') >= coalesce(d.last_scraped_at, '-infinity')
    and not (s.platform = 'youtube' and coalesce(s.last_scraped_at, s.created_at) < ${YT_CUTOFF})`;
  out["profileChanges"] = {
    engagementRate: Number((await tx.unsafe(`select count(*) n from gcp.creator_profiles d, s_profiles s where ${profileWhere} and (d.engagement_rate, d.median_engagement_rate) is distinct from (s.engagement_rate, s.median_engagement_rate)`))[0]?.["n"]),
    followers: Number((await tx.unsafe(`select count(*) n from gcp.creator_profiles d, s_profiles s where ${profileWhere} and d.followers is distinct from s.followers`))[0]?.["n"]),
    verifiedTick: Number((await tx.unsafe(`select count(*) n from gcp.creator_profiles d, s_profiles s where ${profileWhere} and d.verified is distinct from s.verified`))[0]?.["n"]),
  };
  const profiles = await tx.unsafe(`update gcp.creator_profiles d set ${pData.set}, ${pCountry.set}, updated_at = now()
    from s_profiles s where ${profileWhere} and (${pData.changes} or ${pCountry.changes}) returning d.platform`);
  out["profilesUpdated"] = profiles.reduce<Record<string, number>>((m, r) => ((m[String(r["platform"])] = (m[String(r["platform"])] ?? 0) + 1), m), {});
  out["profilesKeptLiveFresher"] = Number((await tx.unsafe(`select count(*) n from gcp.creator_profiles d join s_profiles s on s.id = d.id where coalesce(s.last_scraped_at, '-infinity') < coalesce(d.last_scraped_at, '-infinity')`))[0]?.["n"]);

  // 3. Creators: assessed fields where local is at least as fresh; live staff decisions and confirmed countries stay.
  const cData = assign(CREATOR_DATA, null);
  const cCountry = assign(CREATOR_COUNTRY, "d.confirmed_country is not null");
  const cOrg = assign(["organisation_category"], "d.organisation_override_by_staff_id is not null");
  const cAccount = assign(ACCOUNT, "d.account_type_source = 'staff'");
  const freshWhere = `d.id = s.id and f.id = s.id and f.fresh and not f.yt_expired`;
  out["accountTypeChanges"] = await tally(tx, `select coalesce(d.account_type, 'none') || ' -> ' || coalesce(s.account_type, 'none') || ' (' || coalesce(s.account_type_source, '-') || ')' k, count(*) n
    from gcp.creators d, s_creators s, s_rule f where ${freshWhere} and d.account_type_source is distinct from 'staff' and d.account_type is distinct from s.account_type group by 1 order by 2 desc`);
  out["mainNicheChanges"] = Number((await tx.unsafe(`select count(*) n from gcp.creators d, s_creators s, s_rule f where ${freshWhere} and d.niche_main is distinct from s.niche_main`))[0]?.["n"]);
  const creators = await tx.unsafe(`update gcp.creators d set ${cData.set}, ${cCountry.set}, ${cOrg.set}, ${cAccount.set},
      last_enriched_at = greatest(d.last_enriched_at, s.last_enriched_at), updated_at = now()
    from s_creators s, s_rule f where ${freshWhere} and (${cData.changes} or ${cCountry.changes} or ${cOrg.changes} or ${cAccount.changes}) returning d.id`);
  out["creatorsUpdated"] = creators.length;

  // 4. Local staff account types (owner overrides) whatever the freshness; a different live staff decision is reported.
  const staff = await tx.unsafe(`update gcp.creators d set ${ACCOUNT.map((c) => `${c} = s.${c}`).join(", ")}, updated_at = now()
    from s_creators s where d.id = s.id and s.account_type_source = 'staff' and d.account_type_source is distinct from 'staff'
      and (${ACCOUNT.map((c) => `d.${c}`).join(", ")}) is distinct from (${ACCOUNT.map((c) => `s.${c}`).join(", ")}) returning d.id`);
  out["staffAccountTypesApplied"] = staff.length;
  out["staffConflictsKeptLive"] = Number((await tx.unsafe(`select count(*) n from gcp.creators d join s_creators s on s.id = d.id where d.account_type_source = 'staff' and s.account_type_source = 'staff' and d.account_type is distinct from s.account_type`))[0]?.["n"]);

  // 5. Possible-minor flags only escalate; a creator no longer active locally (other than merged) is hidden live too.
  const minors = await tx.unsafe(`update gcp.creators d set is_minor = true, minor_reason = coalesce(d.minor_reason, s.minor_reason),
      minor_flagged_at = coalesce(d.minor_flagged_at, s.minor_flagged_at), updated_at = now()
    from s_creators s where d.id = s.id and s.is_minor and not d.is_minor returning d.id`);
  const hidden = await tx.unsafe(`update gcp.creators d set status = s.status, updated_at = now()
    from s_creators s where d.id = s.id and s.status in ('removal_requested', 'erased') and d.status = 'active' returning d.id`);
  // Staff Trash and Hide (0095/0096; owner, 24 Nov: "copy the catalogue clean-up"): a creator trashed or hidden locally
  // is trashed or hidden live with the same reason and date; a ban also puts its live profile links on the do-not-re-add
  // list. Never the other way: a creator active locally does not restore one trashed or hidden live (a live staff
  // decision stands).
  const trashed = await tx.unsafe(`update gcp.creators d set status = 'trashed', trashed_at = coalesce(s.trashed_at, now()), trash_reason = s.trash_reason,
      trash_banned = coalesce(s.trash_banned, false), updated_at = now()
    from s_creators s where d.id = s.id and s.status = 'trashed' and d.status in ('active', 'hidden') returning d.id`);
  const bans = await tx.unsafe(`insert into gcp.creator_suppressions (url_hash, platform, banned_creator_id)
    select encode(sha256(convert_to(lower(trim(p.canonical_url)), 'UTF8')), 'hex'), p.platform, d.id
    from gcp.creators d join s_creators s on s.id = d.id join gcp.creator_profiles p on p.creator_id = d.id
    where d.status = 'trashed' and d.trash_banned and s.trash_banned
    on conflict (url_hash) do nothing returning url_hash`);
  const staffHidden = await tx.unsafe(`update gcp.creators d set status = 'hidden', hidden_reason = s.hidden_reason, hidden_at = coalesce(s.hidden_at, now()), updated_at = now()
    from s_creators s where d.id = s.id and s.status = 'hidden' and d.status = 'active' returning d.id`);
  out["minorsFlagged"] = minors.length;
  out["hidden"] = hidden.length;
  out["trashed"] = trashed.length;
  out["bannedLinks"] = bans.length;
  out["staffHidden"] = staffHidden.length;
  out["mergedLocallyStillActiveLive"] = Number((await tx.unsafe(`select count(*) n from gcp.creators d join s_creators s on s.id = d.id where s.status = 'merged' and d.status = 'active'`))[0]?.["n"]);

  // 6. Retention backstop: whatever is older than 30 days in live YouTube data is cleared now (the worker's daily job).
  const expired = await tx.unsafe(`select creator_id, avatar_key from platform.expire_youtube_api_data(30)`);
  out["youtubeRetentionCleared"] = new Set(expired.map((r) => r["creator_id"])).size;
  return { report: out, expiredAvatarKeys: expired.map((r) => r["avatar_key"]).filter((k): k is string => typeof k === "string") };
}
