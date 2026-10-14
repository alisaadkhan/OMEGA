import { describe, expect, it } from "vitest";
import type { CampaignDetail } from "@mushin/contracts";
import { applyCreatorUpdate } from "./campaigns-mapping";

const member = (id: string, version: number) => ({ creator: { id }, stage: "identified", feeMinor: null, version }) as unknown as CampaignDetail["creators"][number];
const detail = { id: "k", creators: [member("a", 1), member("b", 4)] } as unknown as CampaignDetail;

describe("applyCreatorUpdate", () => {
  it("stores the saved change and the server's new version, so the next quick edit is not refused as stale", () => {
    const next = applyCreatorUpdate(detail, "a", { expectedVersion: 1, stage: "negotiating" }, 2);
    expect(next?.creators[0]).toMatchObject({ stage: "negotiating", version: 2 });
    // The following edit by the same person now carries version 2, which the server accepts.
    expect(next?.creators[0]?.version).toBe(2);
    expect(next?.creators[1]).toBe(detail.creators[1]);
    expect(next?.creators[0]).not.toHaveProperty("expectedVersion");
  });
  it("leaves an unloaded campaign alone", () => {
    expect(applyCreatorUpdate(undefined, "a", { expectedVersion: 1, note: "x" }, 2)).toBeUndefined();
  });
});
