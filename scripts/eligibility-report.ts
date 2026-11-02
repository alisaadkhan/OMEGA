/**
 * Creator eligibility coverage (policy elig-2: includes the per-profile Pakistan rule): how many catalogue creators and profiles qualify, per platform, and the
 * reasons the others do not. Counts only; no creator names, handles or contact data are printed.
 *
 *   node --import tsx scripts/eligibility-report.ts <postgres-url> [--json]
 * Read-only: one SELECT. Use a local database (mushin_local, mushin_eval_disposable, a staging copy).
 */
import postgres from "postgres";
import { creatorEligibility, DEFAULT_ELIGIBILITY, ELIGIBILITY_VERSION, type EligibilityProfile } from "../apps/api/src/modules/creators/index";

const url = process.argv[2];
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error("usage: eligibility-report.ts <postgres-url> [--json]");
  process.exit(2);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
type Row = { id: string; status: string; is_minor: boolean; minor_override_by_staff_id: string | null; profiles: (Omit<EligibilityProfile, "followers"> & { followers: number | null })[] };
const hasLastPost = (await sql`select 1 from information_schema.columns where table_schema = 'gcp' and table_name = 'creator_profiles' and column_name = 'last_post_at'`).length > 0;
const hasCountry = (await sql`select 1 from information_schema.columns where table_schema = 'gcp' and table_name = 'creator_profiles' and column_name = 'country_status'`).length > 0;
const rows = await sql.unsafe<Row[]>(`
  select c.id, c.status, c.is_minor, c.minor_override_by_staff_id,
    coalesce((select jsonb_agg(jsonb_build_object('platform', p.platform, 'canonicalUrl', p.canonical_url,
      'followers', case when p.platform = 'youtube' and p.followers = 0 then null else p.followers end,
      'followersUpdatedAt', p.followers_updated_at, 'lastPostAt', ${hasLastPost ? "p.last_post_at" : "null"}${hasCountry ? ", 'availability', p.availability, 'country', jsonb_build_object('code', p.country, 'status', p.country_status, 'checkedAt', p.country_checked_at)" : ""}))
      from gcp.creator_profiles p where p.creator_id = c.id), '[]'::jsonb) as profiles
  from gcp.creators c`);
await sql.end();

const now = new Date();
const byPlatform: Record<string, { profiles: number; qualifying: number; reasons: Record<string, number> }> = {};
const creators = { total: 0, active: 0, eligible: 0, flaggedActivityUnverified: 0, reasons: {} as Record<string, number> };
for (const r of rows) {
  const e = creatorEligibility({ status: r.status, isMinor: r.is_minor, minorOverrideByStaffId: r.minor_override_by_staff_id }, r.profiles, now);
  creators.total++;
  if (r.status === "active") creators.active++;
  if (e.eligible) creators.eligible++;
  if (e.eligible && e.flags.includes("activity_unverified")) creators.flaggedActivityUnverified++;
  for (const reason of e.reasons) creators.reasons[reason] = (creators.reasons[reason] ?? 0) + 1;
  if (r.status !== "active") continue;
  for (const p of e.profiles) {
    const b = (byPlatform[p.platform] ??= { profiles: 0, qualifying: 0, reasons: {} });
    b.profiles++;
    if (p.qualifies) b.qualifying++;
    for (const reason of p.reasons) b.reasons[reason] = (b.reasons[reason] ?? 0) + 1;
  }
}
const report = { policy: ELIGIBILITY_VERSION, settings: DEFAULT_ELIGIBILITY, at: now.toISOString(), postDatesStored: hasLastPost, creators, byPlatform };
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 1));
else {
  console.log(`Eligibility ${ELIGIBILITY_VERSION} (min ${DEFAULT_ELIGIBILITY.minFollowers} followers, counts ≤ ${DEFAULT_ELIGIBILITY.maxFollowerAgeDays} days old)`);
  console.log(`Creators: ${creators.eligible} eligible of ${creators.active} active (${creators.total} stored); eligible with activity unverified: ${creators.flaggedActivityUnverified}`);
  console.log(`Creator reasons: ${JSON.stringify(creators.reasons)}`);
  for (const [platform, b] of Object.entries(byPlatform)) console.log(`  ${platform}: ${b.qualifying} of ${b.profiles} active profiles qualify; ${JSON.stringify(b.reasons)}`);
}
