import type { CreditAction, DiscoveryJob, DiscoveryJobStep, DiscoveryResult, LiveSearch } from "@mushin/contracts";

export const STEP_LABEL: Record<DiscoveryJobStep, string> = {
  searching: "Searching Google…",
  filtering: "Picking relevant profiles…",
  fetching: "Fetching public profile…",
  archiving: "Saving a copy of the data…",
  cleaning: "Reading the data…",
  assessing: "Assessing authenticity and audience…",
  saving: "Saving…",
};

export const isOpenJob = (j: DiscoveryJob) => j.status === "queued" || j.status === "running";

/** Same maximum the API reserves (spec D2): 12 + size × the per-creator price, TikTok's whenever TikTok is in scope. */
export function liveMaxCost(costs: Record<CreditAction, number>, platform: "instagram" | "tiktok" | "youtube" | undefined, maxNew: number): number {
  const perCreator = platform === "instagram" || platform === "youtube" ? costs.refresh_data : Math.max(costs.refresh_data, costs.refresh_tiktok);
  return costs.find_new + maxNew * perCreator;
}

const PLATFORM_NAMES = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" } as const;

/** The platforms a live run will search and extract, as the server scopes them (no platform = all three). */
export function livePlatformsText(s: LiveSearch): string {
  const p = s.filters.platform;
  return p ? PLATFORM_NAMES[p] : "Instagram, TikTok and YouTube (all platforms)";
}

/**
 * The results header for a live run. The chosen size caps new (charged) creators only; creators MUSHIN already
 * knew are added free on top, so "6 found" for a size-5 run must show the split rather than look like an overrun.
 */
export function liveFoundText(cards: { discovery: { isNew: boolean } }[], streaming: boolean): string {
  const fresh = cards.filter((c) => c.discovery.isNew).length;
  const known = cards.length - fresh;
  const head = `${cards.length} found by Find New Creators${streaming ? " so far" : ""}`;
  return cards.length === 0 ? head : `${head} · ${fresh} new (charged)${known ? ` · ${known} already in MUSHIN (free)` : ""}`;
}

export function liveSummary(s: LiveSearch): string {
  const parts = [s.text.trim() || s.filters.niches.join(", "), s.filters.creatorCity ?? s.filters.creatorCountry ?? ""].filter(Boolean);
  return parts.join(" · ") || "new creators";
}

export const jobTitle = (j: DiscoveryJob) =>
  j.kind === "live" && j.live ? `Finding creators: ${liveSummary(j.live.search)}` : `${j.kind === "refresh" ? "Refreshing" : "Adding"} @${j.handle ?? ""}`;

const RETURNED = "Your credits were returned.";

export function jobStatusText(j: DiscoveryJob): string {
  if (j.kind === "live" && j.live) {
    const l = j.live;
    if (j.status === "queued") return "Waiting to start…";
    if (j.status === "running") {
      const funnel = l.progress.serpResultsSeen > 0
        ? ` · ${l.progress.serpResultsSeen} searched · ${l.progress.qualifiedCreators} qualified · ${l.progress.persistedResults} saved`
        : "";
      return `${j.step ? STEP_LABEL[j.step] : "Starting…"}${funnel}`;
    }
    if (j.status === "completed") {
      if (j.outcome === "insufficient") return `Too few eligible profiles were found to continue. ${RETURNED}`;
      if (j.outcome === "completed_empty" || l.found === 0) return `No eligible creators were delivered. ${RETURNED}`;
      if (j.outcome === "partial") return `Some creators were saved. ${l.creditsCharged} credits used; remaining credits returned.`;
      return `Found ${l.found} creator${l.found === 1 ? "" : "s"} (${l.new} new) · ${l.creditsCharged} credits used, ${l.maxCost - l.creditsCharged} returned`;
    }
  }
  if (j.status === "queued") return "Waiting to start…";
  if (j.status === "running") return j.step ? STEP_LABEL[j.step] : "Starting…";
  if (j.status === "completed") {
    if (j.outcome === "reused") return `Fresh data was already available. ${RETURNED}`;
    return j.outcome === "refreshed" ? "Profile updated" : "Added to MUSHIN";
  }
  const message = j.error?.message ?? "Something went wrong.";
  return message.includes("credits were returned") ? message : `${message} ${RETURNED}`;
}

/** Jobs that were open in the previous poll and have finished in this one. */
export function newlyFinished(prev: DiscoveryJob[], next: DiscoveryJob[]): DiscoveryJob[] {
  const wasOpen = new Set(prev.filter(isOpenJob).map((j) => j.id));
  return next.filter((j) => wasOpen.has(j.id) && !isOpenJob(j));
}

/** Polled pages arrive in order of discovery; the list shows them best fit first (rank 1 first; 0 = not ranked yet, last). */
export function mergeResults(prev: DiscoveryResult[], next: DiscoveryResult[]): DiscoveryResult[] {
  const bySeq = new Map(prev.map((r) => [r.seq, r]));
  for (const r of next) bySeq.set(r.seq, r);
  return [...bySeq.values()].sort((a, b) => (a.rank || Number.MAX_SAFE_INTEGER) - (b.rank || Number.MAX_SAFE_INTEGER) || a.seq - b.seq);
}
