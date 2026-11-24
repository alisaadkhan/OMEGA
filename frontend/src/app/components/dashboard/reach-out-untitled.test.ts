import { describe, expect, it } from "vitest";
import { nextUntitled } from "./CreatorProfilePanel";

describe("Reach out names a new campaign Untitled N (owner, 24 Nov)", () => {
  it("starts at 1 and counts up from the highest number used", () => {
    expect(nextUntitled([])).toBe("Untitled 1");
    expect(nextUntitled(["Eid launch", "Untitled 1"])).toBe("Untitled 2");
    expect(nextUntitled(["Untitled 1", "Untitled 4", "Untitled 2"])).toBe("Untitled 5");
    expect(nextUntitled(["Untitled campaign", "untitled 3"])).toBe("Untitled 1");
  });
});
