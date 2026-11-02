import { describe, expect, it } from "vitest";
import { csvCell } from "./csv";

// Security hardening 2026-11-03: customer-written text in a CSV staff open must never run as a spreadsheet formula.
describe("csvCell", () => {
  it.each(["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "  =1+1", " =1", "＝cmd", "＋1", "\tx", "\rx"])("neutralises %j", (v) => {
    expect(csvCell(v).startsWith("\"'")).toBe(true);
  });
  it("leaves ordinary text alone and doubles quotes", () => {
    expect(csvCell("Great tool, said \"wow\"")).toBe("\"Great tool, said \"\"wow\"\"\"");
    expect(csvCell("Lahore")).toBe("\"Lahore\"");
    expect(csvCell(null)).toBe("\"\"");
  });
});
