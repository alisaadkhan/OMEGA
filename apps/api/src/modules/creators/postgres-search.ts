import { sql } from "drizzle-orm";
import type { SearchFilters } from "@mushin/contracts";
import type { TenantContext } from "@mushin/core";
import type { Db } from "@mushin/db";
import type { SearchHit } from "@mushin/integrations";

export type CatalogSearchQuery = { text: string; filters: SearchFilters; freshCurrentDays: number; now: Date; limit: number };
export type CatalogSearch = { search(query: CatalogSearchQuery, ctx: Pick<TenantContext, "userId" | "workspaceId">): Promise<{ hits: SearchHit[]; total: number }> };

/** Search the worker-maintained global creator projection. Hydration and visibility checks still run under tenant RLS. */
export function createPostgresCatalogSearch(db: Db): CatalogSearch {
  async function search(query: CatalogSearchQuery, ctx: Pick<TenantContext, "userId" | "workspaceId">) {
    const limit = Math.max(1, Math.min(1000, Math.trunc(query.limit)));
    const text = query.text.trim();
    const conditions = [sql`c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null)`];
    if (text) conditions.push(sql`(d.search_vector @@ websearch_to_tsquery('simple', ${text}) or d.search_text % ${text})`);

    const f = query.filters;
    if (f.platform) conditions.push(sql`d.platforms @> array[${f.platform}]::text[]`);
    if (f.creatorCountry) conditions.push(sql`d.country = ${f.creatorCountry}`);
    if (f.creatorCity) conditions.push(sql`lower(d.city) = lower(${f.creatorCity})`);
    if (f.followersMin !== undefined) conditions.push(sql`d.followers >= ${f.followersMin}`);
    if (f.followersMax !== undefined) conditions.push(sql`d.followers <= ${f.followersMax}`);
    if (f.engagementMin !== undefined) conditions.push(sql`d.engagement_rate >= ${f.engagementMin}`);
    if (f.engagementMax !== undefined) conditions.push(sql`d.engagement_rate <= ${f.engagementMax}`);
    if (f.niches.length) conditions.push(sql`d.niches && array[${sql.join(f.niches.map((niche) => sql`${niche}`), sql`, `)}]::text[]`);
    if (f.verifiedOnly) conditions.push(sql`d.verified`);
    if (f.minAuthenticity !== undefined) conditions.push(sql`d.authenticity_score >= ${f.minAuthenticity}`);
    if (f.hasContact) conditions.push(sql`d.has_contact`);
    if (f.freshOnly) conditions.push(sql`d.followers_updated_epoch >= ${Math.floor(query.now.getTime() / 1000) - query.freshCurrentDays * 86_400}`);

    const predicate = sql.join(conditions, sql` and `);
    const ranked = text
      ? sql`greatest(least(ts_rank_cd(d.search_vector, websearch_to_tsquery('simple', ${text})) * 8, 1), similarity(d.search_text, ${text}))`
      : sql`0::real`;
    const rows = await db.withTenant(ctx, (tx) => tx.execute<{ id: string; rankingScore: number; exactTotal: number | string }>(sql`
      select d.creator_id as id, ${ranked}::real as "rankingScore", count(*) over() as "exactTotal"
      from gcp.creator_search_documents d
      join gcp.creators c on c.id = d.creator_id
      where ${predicate}
      order by ${text ? sql`"rankingScore" desc, d.updated_epoch desc` : sql`d.engagement_rate desc nulls last, d.authenticity_score desc nulls last, d.followers desc nulls last, d.creator_id`}
      limit ${limit + 1}
    `));
    const total = Number(rows[0]?.exactTotal ?? 0);
    const hits = rows.slice(0, limit).map((row) => ({ id: row.id, rankingScore: Number(row.rankingScore) }));
    return { hits, total };
  }

  return { search };
}
