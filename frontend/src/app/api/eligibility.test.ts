import { describe, expect, it } from "vitest";
import type { CreatorEligibilityView } from "@mushin/contracts";
import { blockedReasonFor, eligibilityNote, ineligibleText } from "../lib/eligibility";

const e = (over: Partial<CreatorEligibilityView> = {}): CreatorEligibilityView => ({ eligible: true, version: "elig-1", reasons: [], qualifyingPlatforms: ["instagram"], flags: [], ...over });

describe("creator eligibility wording (elig-1)", () => {
  it("says nothing for an eligible creator and names the reason otherwise", () => {
    expect(ineligibleText(e())).toBeNull();
    expect(ineligibleText(e({ eligible: false, reasons: ["below_follower_minimum"] }))).toBe("Below MUSHIN's 10,000-follower minimum");
    expect(ineligibleText(e({ eligible: false, reasons: ["followers_unknown", "inactive"] }))).toBe("Follower count unknown (+1 more)");
    expect(ineligibleText(e({ eligible: false, reasons: ["something_new"] }))).toBe("Doesn't meet MUSHIN's creator minimum");
  });

  it("notes unverified activity without claiming the creator is active", () => {
    expect(eligibilityNote(e({ flags: ["activity_unverified"] }))).toBe("Recent activity not verified");
    expect(eligibilityNote(e())).toBeNull();
  });

  it("blocks adding when any selected creator is ineligible, and explains why", () => {
    expect(blockedReasonFor([e(), e()])).toBeNull();
    expect(blockedReasonFor([e({ eligible: false, reasons: ["below_follower_minimum"] })])).toBe("Can't be added: below MUSHIN's 10,000-follower minimum.");
    expect(blockedReasonFor([e(), e({ eligible: false, reasons: ["inactive"] })])).toBe("1 of the selected creators don't meet MUSHIN's creator minimum and can't be added.");
  });
});
