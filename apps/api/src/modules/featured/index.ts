import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@mushin/db";
import type { AppModule } from "../../http/types";
import { sendOk } from "../../http/validate";

export const featuredCreatorSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  handle: z.string(),
  platform: z.enum(["instagram", "tiktok", "youtube"]),
  avatarUrl: z.string().nullable(),
  city: z.string().nullable(),
  niches: z.array(z.string()),
  followers: z.number().int().nullable(),
  engagementRate: z.number().nullable(),
  authenticityScore: z.number().int().nullable(),
  verified: z.boolean(),
  hasContact: z.boolean(),
});
export const featuredCreatorsSchema = z.object({ creators: z.array(featuredCreatorSchema) });

/**
 * A few of the best creators to explore on the customer home page (owner, 22 Nov: "the best creators, not the top in
 * followers"): only creators customers can find, ranked by engagement weighted by authenticity, at most two per main
 * niche so the row is varied. Free: it is not a search and charges nothing. Engagement outside 0.5–20% is left out as
 * too thin or too unusual to recommend.
 */
export function createFeaturedModule(o: { db: Db; now?: () => Date }): AppModule {
  return {
    name: "featured",
    register(app, guards) {
      app.get("/v1/creators/featured", { preHandler: guards.customer }, async (_req, reply) => {
        const at = Math.floor((o.now?.() ?? new Date()).getTime() / 1000);
        const rows = await o.db.withSystem((tx) =>
          tx.execute<{ id: string; display_name: string; handle: string; platform: string; avatar_url: string | null; city: string | null; niches: string[]; followers: string | null; engagement_rate: number | null; authenticity_score: number | null; verified: boolean; has_contact: boolean }>(sql`
            select id, display_name, handle, platform, avatar_url, city, niches, followers, engagement_rate, authenticity_score, verified, has_contact from (
              select d.creator_id id, d.display_name, d.primary_handle handle, d.platforms[1] platform, c.avatar_url, d.city, d.niches, d.followers,
                d.engagement_rate, d.authenticity_score, d.verified, d.has_contact,
                d.engagement_rate * coalesce(d.authenticity_score, 70) / 100.0 quality,
                row_number() over (partition by coalesce(d.niches[1], '') order by d.engagement_rate * coalesce(d.authenticity_score, 70) desc) rn
              from gcp.creator_search_documents d join gcp.creators c on c.id = d.creator_id
              where d.eligible and d.eligible_until_epoch > ${at} and c.status = 'active'
                and d.engagement_rate between 0.5 and 20 and d.followers >= 10000 and d.platforms[1] in ('instagram', 'tiktok', 'youtube')) t
            where rn <= 2 order by quality desc limit 12`),
        );
        return sendOk(reply, featuredCreatorsSchema, {
          creators: rows.map((r) => ({
            id: r.id,
            displayName: r.display_name,
            handle: r.handle,
            platform: r.platform as "instagram" | "tiktok" | "youtube",
            avatarUrl: r.avatar_url,
            city: r.city,
            niches: r.niches ?? [],
            followers: r.followers === null ? null : Number(r.followers),
            engagementRate: r.engagement_rate === null ? null : Number(r.engagement_rate),
            authenticityScore: r.authenticity_score === null ? null : Math.round(Number(r.authenticity_score)),
            verified: r.verified,
            hasContact: r.has_contact,
          })),
        });
      });
    },
  };
}
