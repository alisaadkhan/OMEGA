/**
 * Source-specific display and use rules (DATA-004). Data obtained through the YouTube API may be shown as observed
 * (subscribers, views, posts) within its retention period, but metrics MUSHIN derives from it (engagement rate,
 * averages, authenticity and metric-based fit) stay off until the owner confirms eligibility under YouTube's
 * derived-metrics policy. `YOUTUBE_DERIVED_METRICS=on` turns them back on; off is the default.
 * After switching, rebuild the search projection (`npm run search:reindex`) so filters follow the new rule.
 */
export type SourcePolicy = { youtubeDerivedMetrics: boolean };

export const DEFAULT_SOURCE_POLICY: SourcePolicy = { youtubeDerivedMetrics: false };

export const restrictsDerived = (platform: string | null | undefined, policy: SourcePolicy): boolean => platform === "youtube" && !policy.youtubeDerivedMetrics;

/** A search document without derived metrics, so engagement and authenticity filters cannot use them either. */
export function applyDocumentPolicy<D extends { primary_platform: string; engagement_rate: number | null; authenticity_score: number | null }>(doc: D, policy: SourcePolicy): D {
  return restrictsDerived(doc.primary_platform, policy) ? { ...doc, engagement_rate: null, authenticity_score: null } : doc;
}
