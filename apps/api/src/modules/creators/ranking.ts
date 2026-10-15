import type { CreatorCard, SearchFilters } from "@mushin/contracts";
import type { SystemTx, TenantTx } from "@mushin/db";
import * as repo from "./repository";
import { contactAvailability, fitLabel, fitScore, freshnessOf, isContactable } from "./rules";
import { DEFAULT_SOURCE_POLICY, restrictsDerived, type SourcePolicy } from "./source-policy";

type Tx = TenantTx | SystemTx;

/** Letters and digits only, so "Fashion Club", "fashion.club" and "@FashionClub" compare equal. */
const nameKey = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * A search for someone by name finds them first (SRS REQ-02.03, relevance to the query): 0 = name or handle is the search,
 * 1 = starts with a search of two or more words, 2 = everyone else. One-word topic searches ("fashion") keep fit order.
 */
function nameTier(text: string, name: string, handle: string): number {
  const q = nameKey(text);
  if (!q) return 2;
  const keys = [nameKey(name), nameKey(handle)];
  if (keys.includes(q)) return 0;
  if (text.trim().split(/\s+/).length >= 2 && keys.some((k) => k.startsWith(q))) return 1;
  return 2;
}

/** Brain 1's cards and order (spec D2 of sub-project 3); live results use the same scoring (sub-project 4B D5). */
export function toCards(rows: repo.CardRow[], req: { text: string; filters: SearchFilters }, settings: repo.SearchSettings, now: Date, relevance: Map<string, number>, policy: SourcePolicy = DEFAULT_SOURCE_POLICY): CreatorCard[] {
  const tier = new Map(rows.map((r) => [r.id, nameTier(req.text, r.displayName, r.primaryHandle)]));
  return rows
    .map((r) => {
      const followersFreshness = freshnessOf(r.followersUpdatedAt, now, settings.fresh);
      // Derived metrics of restricted sources are neither shown nor used for the score (DATA-004).
      const restricted = restrictsDerived(r.primaryPlatform, policy);
      const engagementRate = restricted ? null : r.engagementRate;
      const authenticityScore = restricted ? null : r.authenticityScore;
      const score = fitScore(
        { textScore: req.text ? (relevance.get(r.id) ?? 0) : null, followers: r.followers, engagementRate, authenticityScore, followersFreshness },
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
        engagementRate,
        authenticityScore,
        fakeFollowerPct: restricted ? null : r.fakeFollowerPct,
        hasContact: isContactable(contactAvailability(r.contactStates)),
        contactAvailability: contactAvailability(r.contactStates),
        followersFreshness,
        fitScore: score,
        fitLabel: fitLabel(score, settings.labels),
        eligibility: cardEligibility(r.eligibility),
      };
    })
    // An unknown count cannot satisfy an explicit numeric follower filter.
    .filter((card) => (req.filters.followersMin === undefined && req.filters.followersMax === undefined) || card.followers !== null)
    .sort((a, b) => (tier.get(a.id) ?? 2) - (tier.get(b.id) ?? 2) || b.fitScore - a.fitScore || (a.followers === null ? 1 : b.followers === null ? -1 : b.followers - a.followers) || a.id.localeCompare(b.id));
}

/** Cards for a live run's creators: hidden creators are left out (card rows apply the visibility rule); the AI already judged relevance, so text counts as matched. */
export async function rankCards(tx: Tx, ids: string[], filters: SearchFilters, now: Date, policy: SourcePolicy = DEFAULT_SOURCE_POLICY): Promise<CreatorCard[]> {
  if (ids.length === 0) return [];
  const settings = await repo.getSearchSettings(tx);
  return toCards(await repo.cardRows(tx, ids), { text: "", filters }, settings, now, new Map(), policy);
}

/** The customer-facing part of a creator's eligibility (no per-profile detail). */
export function cardEligibility(e: repo.CardRow["eligibility"]): CreatorCard["eligibility"] {
  return { eligible: e.eligible, version: e.version, reasons: e.reasons, qualifyingPlatforms: e.qualifyingPlatforms, flags: e.flags };
}
