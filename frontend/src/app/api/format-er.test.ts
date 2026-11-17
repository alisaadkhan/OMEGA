import { describe, expect, it } from "vitest";
import { formatEr } from "./search-mapping";

describe("engagement rate display matches the stored value", () => {
  it("shows two decimals below 1%, one from 1%, and <0.01% only for the truly tiny", () => {
    expect([0.02, 0.43, 0.06, 0.5, 0.004, 3.63, 49.76, 0].map(formatEr)).toEqual(["0.02%", "0.43%", "0.06%", "0.50%", "<0.01%", "3.6%", "49.8%", "0.00%"]);
  });
});
