import { describe, expect, it } from "vitest";

import { formatTableLabel } from "./format-table-label";

describe("formatTableLabel", () => {
  it("returns label when set", () => {
    expect(formatTableLabel({ tableNum: 1, label: "赤卓" })).toBe("赤卓");
  });

  it("falls back to Table N when label is null", () => {
    expect(formatTableLabel({ tableNum: 2, label: null })).toBe("Table 2");
  });

  it("falls back to Table N when label is empty string", () => {
    expect(formatTableLabel({ tableNum: 3, label: "" })).toBe("Table 3");
  });

  it("falls back to Table N when label is whitespace only", () => {
    expect(formatTableLabel({ tableNum: 4, label: "   " })).toBe("Table 4");
  });

  it("falls back to Table N when label is undefined (legacy doc)", () => {
    expect(formatTableLabel({ tableNum: 5 })).toBe("Table 5");
  });

  it("trims surrounding whitespace before returning", () => {
    expect(formatTableLabel({ tableNum: 6, label: "  赤卓  " })).toBe("赤卓");
  });
});
