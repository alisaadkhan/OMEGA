import type { CampaignDetail, UpdateCampaignCreator } from "@mushin/contracts";

/**
 * A saved change applied to the cached campaign at once, with the server's new version. Without it a second quick edit
 * by the same person was sent with the old version and refused as "updated by someone else" (found in E2E testing).
 */
export function applyCreatorUpdate(detail: CampaignDetail | undefined, creatorId: string, patch: UpdateCampaignCreator, version: number): CampaignDetail | undefined {
  if (!detail) return detail;
  const { expectedVersion: _ignored, ...fields } = patch;
  const changes = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  return { ...detail, creators: detail.creators.map((m) => (m.creator.id === creatorId ? { ...m, ...changes, version } : m)) };
}
