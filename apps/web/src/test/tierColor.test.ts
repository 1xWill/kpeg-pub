import { describe, expect, it } from "vitest";
import { getMetallicTierVariant, getTierColor } from "../lib/tierColor.js";

describe("tier colors", () => {
  it("maps all rarity tiers to the shared CSS variables", () => {
    expect(getTierColor("Common")).toBe("var(--tier-common)");
    expect(getTierColor("UNCOMMON")).toBe("var(--tier-uncommon)");
    expect(getTierColor("rare")).toBe("var(--tier-rare)");
    expect(getTierColor(" Epic ")).toBe("var(--tier-epic)");
    expect(getTierColor("Legendary")).toBe("var(--tier-legendary)");
  });

  it("ignores non-tier labels", () => {
    expect(getTierColor("BUNDLE")).toBeUndefined();
  });

  it("marks only rare and above tiers as metallic variants", () => {
    expect(getMetallicTierVariant("rare")).toBe("rare");
    expect(getMetallicTierVariant(" EPIC ")).toBe("epic");
    expect(getMetallicTierVariant("Legendary")).toBe("legendary");
    expect(getMetallicTierVariant("Common")).toBeUndefined();
    expect(getMetallicTierVariant("Uncommon")).toBeUndefined();
    expect(getMetallicTierVariant("BUNDLE")).toBeUndefined();
  });
});
