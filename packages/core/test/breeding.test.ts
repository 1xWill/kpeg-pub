import { describe, expect, it } from "vitest";
import { estimateBreedingPreview, type BreedingParentProfile } from "../src/breeding.js";

const parentA: BreedingParentProfile = {
  tier: 2,
  traits: {
    background: "Sky",
    breed: "Bengal",
    clothes: "Star Cape",
    mood: "Purple Moon",
    marks: "None",
    mouth: "Calm Smile",
    eyes: "Void Eyes",
    accessory: "Moonfish"
  }
};

const parentB: BreedingParentProfile = {
  tier: 3,
  traits: {
    background: "Midnight",
    breed: "Nebelung",
    clothes: "Cozy Hoodie",
    mood: "None",
    marks: "Blush",
    mouth: "Smirk",
    eyes: "Glassy Eyes",
    accessory: "Heart Charm"
  }
};

describe("estimateBreedingPreview", () => {
  it("keeps pair cycle within 3-21d and uses max(parentA,parentB)", () => {
    const preview = estimateBreedingPreview({ parentA, parentB });
    expect(preview.parentACycleDays).toBeGreaterThanOrEqual(3);
    expect(preview.parentACycleDays).toBeLessThanOrEqual(21);
    expect(preview.parentBCycleDays).toBeGreaterThanOrEqual(3);
    expect(preview.parentBCycleDays).toBeLessThanOrEqual(21);
    expect(preview.pairCycleDays).toBe(Math.max(preview.parentACycleDays, preview.parentBCycleDays));
  });

  it("keeps child tier odds normalized to 100%", () => {
    const preview = estimateBreedingPreview({ parentA, parentB });
    const total =
      preview.childTierOddsPct[0] +
      preview.childTierOddsPct[1] +
      preview.childTierOddsPct[2] +
      preview.childTierOddsPct[3] +
      preview.childTierOddsPct[4];
    expect(total).toBe(100);
  });

  it("returns contract-aligned bounds for success chance and inheritance pools", () => {
    const preview = estimateBreedingPreview({ parentA, parentB, pairBirthCount: 1 });
    expect(preview.expectedSuccessBp).toBeGreaterThanOrEqual(1000);
    expect(preview.expectedSuccessBp).toBeLessThanOrEqual(7200);
    expect(preview.expectedSuccessPct).toBeCloseTo(preview.expectedSuccessBp / 100, 2);

    const pools = preview.groupPools;
    expect(pools.breed.parentInheritancePct).toBe(72);
    expect(pools.breed.mutationPct).toBe(8);
    expect(pools.breed.fallbackPct).toBe(20);
    expect(pools.background.parentInheritancePct).toBe(22);
    expect(pools.background.mutationPct).toBe(25);
    expect(pools.background.fallbackPct).toBe(53);
  });
});
