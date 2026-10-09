import type { DiscoveryJob, DiscoveryJobStep } from "@mushin/contracts";

export const STEP_LABEL: Record<DiscoveryJobStep, string> = {
  fetching: "Fetching public profile…",
  archiving: "Saving a copy of the data…",
  cleaning: "Reading the data…",
  assessing: "Assessing authenticity and audience…",
  saving: "Saving…",
};

export const isOpenJob = (j: DiscoveryJob) => j.status === "queued" || j.status === "running";

export const jobTitle = (j: DiscoveryJob) => `${j.kind === "refresh" ? "Refreshing" : "Adding"} @${j.handle}`;

const RETURNED = "Your credits were returned.";

export function jobStatusText(j: DiscoveryJob): string {
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
