import { describe, expect, it } from "vitest";
import { quote, wholeChars } from "./quote";

describe("evidence quotes", () => {
  it("never cuts an emoji in half (the database would store it as a replacement character)", () => {
    const bio = `${"x".repeat(199)}🇵🇰 shop`;
    expect(wholeChars(bio.slice(0, 200))).toBe("x".repeat(199));
    expect(wholeChars(bio.slice(200))).not.toMatch(/^[\uDC00-\uDFFF]/);
    const q = quote(`${"a".repeat(70)} Pakistan 🇵🇰${"b".repeat(300)}`, "pakistan");
    expect(q).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(q).toContain("Pakistan");
  });
});
