import { describe, expect, it } from "vitest";
import {
  DOC_FILTERED_COMBINATIONS,
  BREED_ALLOWED_BACKGROUNDS,
  compatibilitySummaryCounts,
  computeCompatibilityReduction,
  computeFilteredCombinationCountByManifest,
  computeGlobalRarity,
  computeNaiveCombinationCount,
  decodePackedTraits,
  generateKPEGFromOnchainEntropy,
  generateKPEG,
  kpegTierFromRarityPct,
  isAccessoryAllowed,
  isBackgroundAllowedForBreed,
  isClothesAllowedForBreed,
  isMarkAllowed,
  isMoodAllowed,
  isMouthAllowedForBreed,
  tierFromWholeBought
} from "../src/index.js";

describe("tierFromWholeBought", () => {
  it("maps thresholds exactly", () => {
    expect(tierFromWholeBought(1)).toBe(0);
    expect(tierFromWholeBought(9)).toBe(0);
    expect(tierFromWholeBought(10)).toBe(1);
    expect(tierFromWholeBought(49)).toBe(1);
    expect(tierFromWholeBought(50)).toBe(2);
    expect(tierFromWholeBought(99)).toBe(2);
    expect(tierFromWholeBought(100)).toBe(3);
    expect(tierFromWholeBought(249)).toBe(3);
    expect(tierFromWholeBought(250)).toBe(4);
  });
});

describe("generateKPEG", () => {
  it("is deterministic for the same seed inputs", () => {
    const a = generateKPEG({ wholeBought: 7, walletAddress: "0xabc", mintNonce: 3, seedHint: "same" });
    const b = generateKPEG({ wholeBought: 7, walletAddress: "0xabc", mintNonce: 3, seedHint: "same" });
    expect(a).toEqual(b);
  });

  it("respects compatibility constraints across many samples", () => {
    for (let i = 0; i < 1000; i += 1) {
      const result = generateKPEG({
        wholeBought: (i % 1005) + 1,
        walletAddress: `0x${String(i).padStart(40, "0")}`,
        mintNonce: i,
        seedHint: `seed-${i}`
      });
      expect(BREED_ALLOWED_BACKGROUNDS[result.traits.breed]).toContain(result.traits.background);
      expect(isBackgroundAllowedForBreed(result.traits.breed, result.traits.background)).toBe(true);
      expect(isClothesAllowedForBreed(result.traits.breed, result.traits.clothes)).toBe(true);
      expect(isMouthAllowedForBreed(result.traits.breed, result.traits.mouth)).toBe(true);
      expect(isAccessoryAllowed(result.traits.clothes, result.traits.accessory, result.traits.breed)).toBe(true);
      expect(isMarkAllowed(result.traits.clothes, result.traits.marks, result.traits.breed)).toBe(true);
      if (result.traits.mood === "Sleep Zzz") {
        expect(result.traits.mouth).not.toBe("Happy V");
        expect(result.traits.mouth).not.toBe("Tongue Out");
      }
      if (result.traits.mood === "Aurora") {
        expect(result.traits.background === "Lilac" || result.traits.background === "Midnight").toBe(true);
      }
      if (result.traits.clothes === "Space Helmet") {
        expect(result.traits.marks === "None" || result.traits.marks === "Blush" || result.traits.marks === "Cream Muzzle").toBe(true);
      }
    }
  });

  it("enforces the explicit neck-accessory exclusions", () => {
    expect(isAccessoryAllowed("Red Bandana", "Star Pin")).toBe(false);
    expect(isAccessoryAllowed("Green Bandana", "Heart Charm")).toBe(false);
    expect(isAccessoryAllowed("Blue Bowtie", "ETH Pendant")).toBe(false);
    expect(isAccessoryAllowed("Pink Scarf", "BTC Tag")).toBe(false);
    expect(isAccessoryAllowed("Gold Collar", "Heart Charm")).toBe(false);
    expect(isAccessoryAllowed("Sailor Shirt", "Heart Charm")).toBe(true);
  });

  it("enforces the staged breed-specific exclusions", () => {
    expect(isClothesAllowedForBreed("Abyssinian", "Frog Onesie")).toBe(false);
    expect(isClothesAllowedForBreed("Sphynx", "Cozy Hoodie")).toBe(false);
    expect(isClothesAllowedForBreed("Sphynx", "Sailor Shirt")).toBe(false);
    expect(isClothesAllowedForBreed("Sphynx", "Frog Onesie")).toBe(false);
    expect(isClothesAllowedForBreed("Sphynx", "Pink Scarf")).toBe(false);
    expect(isClothesAllowedForBreed("Sphynx", "Yellow Raincoat")).toBe(false);
    expect(isClothesAllowedForBreed("Sphynx", "Purple Sweater")).toBe(false);
    expect(isMouthAllowedForBreed("Sphynx", "Happy V")).toBe(false);
    expect(isMouthAllowedForBreed("Sphynx", "Grumpy")).toBe(false);
    expect(isAccessoryAllowed("None", "Star Pin", "Sphynx")).toBe(false);
    expect(isAccessoryAllowed("None", "Heart Charm", "Sphynx")).toBe(false);
    expect(isMarkAllowed("None", "Cream Muzzle", "Sphynx")).toBe(false);
    expect(isMarkAllowed("None", "Cream Muzzle", "Tuxedo")).toBe(false);

    expect(isClothesAllowedForBreed("Nebelung", "Frog Onesie")).toBe(false);
    expect(isClothesAllowedForBreed("Alien Cat", "Cozy Hoodie")).toBe(false);
    expect(isClothesAllowedForBreed("Alien Cat", "Dino Costume")).toBe(false);
    expect(isClothesAllowedForBreed("Siamese", "Meteor Hoodie")).toBe(false);
    expect(isClothesAllowedForBreed("Persian", "Moon Cloak")).toBe(false);
    expect(isClothesAllowedForBreed("Alien Cat", "Silk Sash")).toBe(false);
    expect(isClothesAllowedForBreed("Sphynx", "Wizard Hat")).toBe(false);
    expect(isMouthAllowedForBreed("Alien Cat", "Happy V")).toBe(false);
    expect(isMarkAllowed("None", "Cream Muzzle", "Alien Cat")).toBe(false);
    expect(isMoodAllowed("Aurora", "Stoic", "Lilac")).toBe(true);
    expect(isMoodAllowed("Aurora", "Stoic", "Sky")).toBe(false);
  });

  it("keeps trait odds normalized and computes exact generation-odds KPEG rarity", () => {
    const kitty = generateKPEG({
      wholeBought: 12,
      walletAddress: "0x0000000000000000000000000000000000001111",
      mintNonce: 44,
      seedHint: "rarity"
    });

    for (const chance of Object.values(kitty.traitOdds)) {
      expect(chance.contextTotalWeight).toBeGreaterThan(0);
      const expectedProbability = (chance.selectedWeight / chance.contextTotalWeight) * 100;
      expect(Math.abs(chance.probabilityPct - expectedProbability)).toBeLessThan(1e-12);
      expect(chance.probabilityPct).toBeGreaterThan(0);
      expect(chance.probabilityPct).toBeLessThanOrEqual(100);
    }

    expect(kitty.kpegRarityPct).toBeGreaterThan(0);
    expect(kitty.kpegRarityBasis).toBe("Rarity Probability");
    expect(kitty.kpegRarityOneInN).toBeCloseTo(100 / kitty.kpegRarityPct, 10);
    expect(kitty.mintTier).toBe(kitty.tier);
    expect(kitty.mintTierLabel).toBe(kitty.tierLabel);
    expect(kitty.kpegTier).toBe(kpegTierFromRarityPct(kitty.kpegRarityPct));
  });

  it("derives onchain-compatible traits from packed entropy", () => {
    const kitty = generateKPEGFromOnchainEntropy({
      seed: "0x1111111111111111111111111111111111111111111111111111111111111111",
      tier: 3,
      entropy: 0x123456789abcdef123456789abcdef123456789abcdef123456789abcdef1234n
    });

    expect(kitty.traits).toEqual({
      background: "Midnight",
      breed: "Scottish Fold",
      clothes: "Sailor Shirt",
      mood: "Coin Glow",
      marks: "None",
      mouth: "Wonder O",
      eyes: "Emerald Eyes",
      accessory: "ETH Pendant"
    });
    const expectedRarity = computeGlobalRarity({ traits: kitty.traits, mintTier: kitty.mintTier });
    expect(kitty.kpegRarityPct).toBeCloseTo(expectedRarity.percentage, 15);
    expect(kitty.kpegTier).toBe(expectedRarity.tier);
    expect(kitty.kpegTierLabel).toBe(expectedRarity.tierLabel);
  });

  it("decodes packed trait ids into registry traits", () => {
    const packed =
      5n | // background: Midnight
      (19n << 8n) | // breed: Alien Cat
      (17n << 16n) | // clothes: Wizard Hat
      (11n << 24n) | // mood: Moonlit
      (3n << 32n) | // marks: Tiny Scar
      (10n << 40n) | // mouth: Tiny Fang
      (9n << 48n) | // eyes: Glassy Eyes
      (14n << 56n); // accessory: Magic Wand

    expect(decodePackedTraits(packed)).toEqual({
      background: "Midnight",
      breed: "Alien Cat",
      clothes: "Wizard Hat",
      mood: "Moonlit",
      marks: "Tiny Scar",
      mouth: "Tiny Fang",
      eyes: "Glassy Eyes",
      accessory: "Magic Wand"
    });
  });

  it("keeps final kPEG tiers globally dominated by common > uncommon > rare > epic > legendary", () => {
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < 25_000; i += 1) {
      const kitty = generateKPEG({
        wholeBought: (i % 320) + 1,
        walletAddress: `0x${String(i).padStart(40, "0")}`,
        mintNonce: i,
        seedHint: `tier-shape-${i}`
      });
      counts[kitty.kpegTier] += 1;
    }

    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(counts[2]).toBeGreaterThan(counts[3]);
    expect(counts[3]).toBeGreaterThan(counts[4]);
  });

  it("still allows low-buy mints to occasionally hit higher final kPEG tiers", () => {
    let foundRareOrHigher = false;
    for (let i = 0; i < 5_000; i += 1) {
      const kitty = generateKPEG({
        wholeBought: (i % 9) + 1,
        walletAddress: `0x${String(i).padStart(40, "0")}`,
        mintNonce: i,
        seedHint: `low-buy-${i}`
      });
      if (kitty.kpegTier >= 2) {
        foundRareOrHigher = true;
        break;
      }
    }
    expect(foundRareOrHigher).toBe(true);
  });
});

describe("computeGlobalRarity", () => {
  it("varies by actual trait combination instead of returning the static combination count", () => {
    const commonLooking = computeGlobalRarity({
      traits: {
        background: "Sky",
        breed: "American Shorthair",
        clothes: "None",
        mood: "None",
        marks: "None",
        mouth: "Happy V",
        eyes: "Blue Eyes",
        accessory: "None"
      },
      mintTier: 2
    });
    const scarceLooking = computeGlobalRarity({
      traits: {
        background: "Midnight",
        breed: "Norwegian Forest",
        clothes: "Space Helmet",
        mood: "Purple Moon",
        marks: "Cream Muzzle",
        mouth: "Wonder O",
        eyes: "Heterochromia",
        accessory: "None"
      },
      mintTier: 2
    });

    expect(commonLooking.percentage).toBeGreaterThan(0);
    expect(scarceLooking.percentage).toBeGreaterThan(0);
    expect(scarceLooking.percentage).toBeLessThan(commonLooking.percentage);
    expect(scarceLooking.score).toBeGreaterThan(commonLooking.score);
  });
});

describe("combination counts", () => {
  it("matches the documented naive count and a close manifest filtered count", () => {
    const naive = computeNaiveCombinationCount();
    const filteredByManifest = computeFilteredCombinationCountByManifest();
    const summary = compatibilitySummaryCounts();

    expect(naive).toBe(253_808_640);
    expect(summary.breedBackgroundPairs).toBe(116);
    expect(summary.totalMoods).toBe(12);
    expect(summary.totalMarks).toBe(4);
    expect(summary.totalMouths).toBe(12);
    expect(summary.totalEyes).toBe(12);

    const delta = Math.abs(filteredByManifest - DOC_FILTERED_COMBINATIONS);
    const deltaPct = (delta / DOC_FILTERED_COMBINATIONS) * 100;
    expect(deltaPct).toBe(0);

    const reduction = computeCompatibilityReduction(naive, DOC_FILTERED_COMBINATIONS);
    expect(reduction.removed).toBe(81_411_120);
    expect(reduction.reductionPct).toBeCloseTo(32.08, 2);
  });
});
