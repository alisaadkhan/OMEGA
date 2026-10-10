import type { CreatorCard, SearchFilters } from "@mushin/contracts";
import type { SystemTx, TenantTx } from "@mushin/db";
import * as repo from "./repository";
import { fitLabel, fitScore, freshnessOf } from "./rules";

type Tx = TenantTx | SystemTx;

/** Brain 1's cards and order (spec D2 of sub-project 3); live results use the same scoring (sub-project 4B D5). */
export function toCards(rows: repo.CardRow[], req: { text: string; filters: SearchFilters }, settings: repo.SearchSettings, now: Date, relevance: Map<string, number>): CreatorCard[] {
  return rows
    .map((r) => {
      const followersFreshness = freshnessOf(r.followersUpdatedAt, now, settings.fresh);
      const score = fitScore(
        { textScore: req.text ? (relevance.get(r.id) ?? 0) : null, followers: r.followers, engagementRate: r.engagementRate, authenticityScore: r.authenticityScore, followersFreshness },
        req.filters,
        settings.weights,
      );
      return {
        id: r.id,
        displayName: r.displayName,
        handle: r.primaryHandle,
        platform: r.primaryPlatform,
        avatarUrl: r.avatarUrl,
        city: r.city,
        country: r.country,
        niches: r.niches,
        tags: r.tags,
        verified: r.verified,
        followers: r.followers,
        engagementRate: r.engagementRate,
        authenticityScore: r.authenticityScore,
        fakeFollowerPct: r.fakeFollowerPct,
        hasContact: r.hasContact,
        followersFreshness,
        fitScore: score,
        fitLabel: fitLabel(score, settings.labels),
      };
    })
    .sort((a, b) => b.fitScore - a.fitScore || b.followers - a.followers || a.id.localeCompare(b.id));
}

/** Cards for a live run's creators: hidden creators are left out (card rows apply the visibility rule); the AI already judged relevance, so text counts as matched. */
export async function rankCards(tx: Tx, ids: string[], filters: SearchFilters, now: Date): Promise<CreatorCard[]> {
  if (ids.length === 0) return [];
  const settings = await repo.getSearchSettings(tx);
  return toCards(await repo.cardRows(tx, ids), { text: "", filters }, settings, now, new Map());
}
