import type { AudienceEstimate, AudienceShare, AudienceState } from "@mushin/contracts";

type AudienceSample = AudienceEstimate["sample"];

export type AudienceView = "loading" | "unavailable" | "idle" | "running" | "failed" | "result";

export function isAudienceRunning(s: AudienceState | undefined): boolean {
  return s?.job?.status === "queued" || s?.job?.status === "running";
}

/** What the audience section shows: a running request first, then any valid result, then the latest failure. */
export function audienceView(s: AudienceState | undefined): AudienceView {
  if (!s) return "loading";
  if (isAudienceRunning(s)) return "running";
  if (s.estimate) return "result";
  if (s.availability !== "available") return "unavailable";
  if (s.job?.status === "failed") return "failed";
  return "idle";
}

/** A share rounded to what the sample supports (5 points for small samples), never "0%" for a present category. */
export function percentText(share: AudienceShare, step: 1 | 5): string {
  const pct = Math.round((share.share * 100) / step) * step;
  if (pct === 0 && share.count > 0) return `<${step}%`;
  return `${pct}%`;
}

export function rangeText(share: AudienceShare): string {
  return `${Math.round(share.low * 100)}–${Math.round(share.high * 100)}%`;
}

let regions: Intl.DisplayNames | null = null;
export function countryName(code: string): string {
  if (code === "OTHER") return "Other countries";
  try {
    regions ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}

export function sampleText(s: AudienceSample): string {
  const videos = `${s.videosSampled} recent video${s.videosSampled === 1 ? "" : "s"}`;
  return `${s.uniqueCommenters - s.excludedLikelySpam} commenters on ${videos} · ${s.classifiable} state a country (${Math.round(s.coverage * 100)}% coverage)`;
}

/** Describes how precise the sample is, not how accurate the method is (it is not validated yet). */
export function confidenceText(c: "low" | "moderate"): string {
  return c === "moderate" ? "Moderate sampling precision" : "Low sampling precision";
}
