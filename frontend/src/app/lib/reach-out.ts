/**
 * "Reach out" on a creator profile (owner, 22 Nov) opens the campaign's Outreach page with that creator selected.
 * Emails always go out from a campaign, so the conversation is logged there. The dashboard listens for this event.
 */
export const REACH_OUT_EVENT = "mushin:reach-out";
export type ReachOut = { campaignId: string; creatorId: string };
export function requestReachOut(detail: ReachOut): void {
  window.dispatchEvent(new CustomEvent<ReachOut>(REACH_OUT_EVENT, { detail }));
}
