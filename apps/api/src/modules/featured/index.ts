import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@mushin/db";
import type { AppModule } from "../../http/types";
import { sendOk } from "../../http/validate";
import { CREATOR_VISIBLE } from "../creators/visibility";

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
type Row = { id: string; display_name: string; handle: string; platform: string; avatar_url: string | null; city: string | null; niches: string[]; followers: string | null; engagement_rate: number | null; authenticity_score: number | null; verified: boolean; has_contact: boolean };

/** The best customer-visible creators: engagement weighted by authenticity, at most `perNiche` per main niche. */
async function bestCreators(db: Db, at: number, perNiche: number, limit: number) {
  const rows = await db.withSystem((tx) =>
    tx.execute<Row>(sql`
      select id, display_name, handle, platform, avatar_url, city, niches, followers, engagement_rate, authenticity_score, verified, has_contact from (
        select d.creator_id id, d.display_name, d.primary_handle handle, d.platforms[1] platform, c.avatar_url, d.city, d.niches, d.followers,
          d.engagement_rate, d.authenticity_score, d.verified, d.has_contact,
          d.engagement_rate * coalesce(d.authenticity_score, 70) / 100.0 quality,
          row_number() over (partition by coalesce(d.niches[1], '') order by d.engagement_rate * coalesce(d.authenticity_score, 70) desc) rn
        from gcp.creator_search_documents d join gcp.creators c on c.id = d.creator_id
        where d.eligible and d.eligible_until_epoch > ${at} and ${CREATOR_VISIBLE}
          and d.engagement_rate between 0.5 and 20 and d.followers >= 10000 and d.platforms[1] in ('instagram', 'tiktok', 'youtube')) t
      where rn <= ${perNiche} order by quality desc limit ${limit}`),
  );
  return rows.map((r) => ({
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
  }));
}

/** The landing page's scrolling row (owner, 23 Nov: real creators, not mock-ups). Public, so no id and no contact flag. */
export const showcaseCreatorSchema = featuredCreatorSchema.omit({ id: true, hasContact: true });
export const showcaseCreatorsSchema = z.object({ creators: z.array(showcaseCreatorSchema) });

export function createFeaturedModule(o: { db: Db; now?: () => Date }): AppModule {
  const nowSec = () => Math.floor((o.now?.() ?? new Date()).getTime() / 1000);
  // One shared copy for every signed-out visitor, refreshed every ten minutes: the landing page never loads the database.
  let showcase: { at: number; creators: z.infer<typeof showcaseCreatorSchema>[] } | null = null;
  return {
    name: "featured",
    register(app, guards) {
      app.get("/v1/creators/featured", { preHandler: guards.customer }, async (_req, reply) =>
        sendOk(reply, featuredCreatorsSchema, { creators: await bestCreators(o.db, nowSec(), 2, 12) }),
      );
      app.get("/v1/public/creators/showcase", async (_req, reply) => {
        const at = nowSec();
        if (!showcase || at - showcase.at > 600) {
          const rows = await bestCreators(o.db, at, 3, 24);
          showcase = { at, creators: rows.map(({ id: _id, hasContact: _c, ...rest }) => rest) };
        }
        void reply.header("cache-control", "public, max-age=600");
        return sendOk(reply, showcaseCreatorsSchema, { creators: showcase.creators });
      });
    },
  };
}
