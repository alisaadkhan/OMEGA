/**
 * Pilot report (owner plan 2026-11-14, Phase 8): for named handles, what the creator profile shows, computed with the
 * API's own functions from the local catalogue (contact state, collab line, location outcome, freshness, badge), next
 * to each platform profile's link for checking by hand. Read-only.
 *
 *   node --import tsx scripts/catalog/pilot-report.ts --db mushin_catalog_v4 --handles duckybhai,sajalaly [--out file.json]
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createDatabase } from "@mushin/db";
import { sql } from "drizzle-orm";
import { hasCollabRoute } from "../../apps/api/src/modules/creators/contact-routes";
import { locationOutcome, performanceAssessment } from "../../apps/api/src/modules/creators/profile-states";
import { contactAvailability, freshnessOf, isMinorProtected, maskBioContacts } from "../../apps/api/src/modules/creators/rules";

const { values } = parseArgs({ options: { db: { type: "string" }, handles: { type: "string" }, out: { type: "string" } } });
const dbName = values.db ?? "";
if (!/^mushin_catalog_[a-z0-9_]+$/.test(dbName)) throw new Error("--db must name a local catalogue (mushin_catalog_*)");
const handles = (values.handles ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
if (handles.length === 0) throw new Error("--handles a,b,c is required");
const db = createDatabase(`postgres://postgres@127.0.0.1:54330/${dbName}`, { max: 1, applicationName: "pilot-report", caPem: null });

// The frontend's words for each state (frontend/src/app/api/search-mapping.ts CONTACT_AVAILABILITY_TEXT).
const LABEL: Record<string, string> = {
  email_and_phone: "Email & mobile available", email_unverified: "Email available · Unverified", email_verified: "Email available · Verified",
  email_invalid: "Email invalid", phone_unverified: "Mobile available · Unverified", collab_route: "Collab route in bio", none: "Not publicly listed",
};
const SOURCE: Record<string, string> = { bio: "bio/About", business_field: "business button", video_description: "video descriptions" };

type Creator = { id: string; display_name: string; primary_platform: string; account_type: string | null; account_type_evidence: string | null; niche_main: string | null; niche_status: string | null; niche_source: string | null; niche_posts_assessed: number | null; city: string | null; is_minor: boolean; minor_override_by_staff_id: string | null; status: string };
type Profile = Record<string, unknown> & { creator_id: string; platform: "instagram" | "tiktok" | "youtube"; handle: string; canonical_url: string; bio: string | null };

const now = new Date();
const out = await db.withSystem(async (tx) => {
  const creators = await tx.execute<Creator>(sql`
    select distinct c.id, c.display_name, c.primary_platform, c.account_type, c.account_type_evidence, c.niche_main, c.niche_status, c.niche_source,
      c.niche_posts_assessed, c.city, c.is_minor, c.minor_override_by_staff_id, c.status
    from gcp.creators c join gcp.creator_profiles p on p.creator_id = c.id
    where c.status = 'active' and lower(p.handle) in (select jsonb_array_elements_text(${JSON.stringify(handles)}::jsonb))`);
  const rows = [];
  for (const c of creators) {
    const profiles = await tx.execute<Profile>(sql`select * from gcp.creator_profiles where creator_id = ${c.id} order by (platform = ${c.primary_platform}) desc, followers desc nulls last`);
    const contacts = await tx.execute<{ kind: "email" | "phone"; status: string; source: string }>(sql`select kind, status, source from gcp.creator_contacts where creator_id = ${c.id}`);
    const minor = isMinorProtected({ isMinor: c.is_minor, minorOverrideByStaffId: c.minor_override_by_staff_id });
    const state = contactAvailability(contacts, { collabRoute: !minor && hasCollabRoute(profiles.map((p) => maskBioContacts(p.bio ?? ""))) });
    rows.push({
      name: c.display_name,
      mainPlatform: c.primary_platform,
      accountType: c.account_type,
      accountTypeEvidence: c.account_type_evidence,
      niche: c.niche_main,
      nicheStatus: c.niche_status,
      nicheSource: c.niche_source,
      nichePostsAssessed: c.niche_posts_assessed,
      city: c.city,
      contactState: state,
      contactLabel: LABEL[state],
      contactSources: [...new Set(contacts.filter((k) => k.status !== "invalid").map((k) => `${k.kind} (${SOURCE[k.source] ?? k.source})`))],
      profiles: profiles.map((p) => {
        const followersUpdatedAt = p["followers_updated_at"] ? new Date(String(p["followers_updated_at"])) : null;
        const { badge, signals } = performanceAssessment(
          {
            platform: p.platform, followers: (p["followers"] as number | null) ?? null, following: (p["following"] as number | null) ?? null, followersUpdatedAt,
            countryStatus: (p["country_status"] as string | null) ?? null, medianViews: (p["median_views"] as number | null) ?? null,
            medianEngagementRate: (p["median_engagement_rate"] as number | null) ?? null, performanceViewsSample: (p["performance_views_sample"] as number | null) ?? null,
            performanceEngagementSample: (p["performance_engagement_sample"] as number | null) ?? null, performanceFormat: (p["performance_format"] as string | null) ?? null,
          },
          { restricted: false, now },
        );
        return {
          platform: p.platform,
          handle: p.handle,
          url: p.canonical_url,
          tick: p["verified"] === true,
          followers: p["followers"],
          er: p["engagement_rate"],
          typicalViews: p["median_views"] === null ? null : Math.round(Number(p["median_views"])),
          typicalViewsSample: p["performance_views_sample"],
          location: locationOutcome((p["country_status"] as string | null) ?? null, p.bio, (p["pakistani_diaspora"] as boolean | null) ?? null),
          fetched: p["last_scraped_at"],
          freshness: freshnessOf(followersUpdatedAt, now, { currentDays: 7, agingDays: 30 }),
          photo: p["avatar_key"] !== null,
          badge,
          signals,
        };
      }),
    });
  }
  return rows;
});
if (values.out) writeFileSync(values.out, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out));
process.exit(0);
