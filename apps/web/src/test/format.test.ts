import { describe, expect, it } from "vitest";
import { formatOneInN, formatPct, formatPctCompact, formatRarityScore, rarityScoreFromOneInN } from "../lib/format.js";

describe("format helpers", () => {
  it("formats percentages with adaptive precision", () => {
    expect(formatPct(12.3456)).toBe("12.35%");
    expect(formatPct(0.34567)).toBe("0.3457%");
    expect(formatPct(0.0004)).toBe("0.0004%");
    expect(formatPct(0.00000031)).toBe("0.00000031%");
  });

  it("compacts very small percentages with a zero-count marker", () => {
    expect(formatPctCompact(0.0004)).toEqual({
      text: "0.0004%",
      zeroCount: null,
      significantText: null
    });
    expect(formatPctCompact(0.00000303)).toEqual({
      text: "0.0",
      zeroCount: 5,
      significantText: "303%"
    });
  });

  it("formats one-in-n labels", () => {
    expect(formatOneInN(99.5)).toBe("1 in 99.5");
    expect(formatOneInN(12345)).toBe("1 in 12,345");
  });

  it("formats rarity score as a rounded grouped integer", () => {
    expect(rarityScoreFromOneInN(33_052_885)).toBeCloseTo(751.92, 2);
    expect(formatRarityScore(2334111.2)).toBe("2,334,111");
  });
});
