import {
  ACCESSORIES,
  BACKGROUNDS,
  CLOTHES,
  MARKS,
  MOODS,
  MOUTHS,
  TIER_LABELS,
  type Accessory,
  type Background,
  type Breed,
  type Clothes,
  type Eyes,
  type Marks,
  type Mood,
  type Mouth,
  type Tier
} from "./traitRegistry.js";
import {
  isAccessoryAllowed,
  isBackgroundAllowedForBreed,
  isClothesAllowedForBreed,
  isMarkAllowed,
  isMoodAllowed,
  isMouthAllowedForBreed
} from "./compatibility.js";
import {
  ACCESSORY_WEIGHTS_BY_TIER,
  BACKGROUND_WEIGHTS_BY_TIER,
  BREED_WEIGHTS_BY_TIER,
  CLOTHES_WEIGHTS_BY_TIER,
  EYES_WEIGHTS_BY_TIER,
  MARKS_WEIGHTS_BY_TIER,
  MOOD_WEIGHTS_BY_TIER,
  MOUTH_WEIGHTS_BY_TIER
} from "./rarity.js";
import type { KPEGTraits } from "./types.js";

// Calibrated from deterministic sampling using current trait tables
// after switching to exact per-kitty generation odds.
// Percentages are rarity percentages (smaller is rarer).
export const KPEG_TIER_RARITY_CUTOFFS_PCT = {
  legendary: 1.3650000000000005e-8,
  epic: 5.4756000000000004e-8,
  rare: 1.6367010309278355e-7,
  uncommon: 5.712365591397849e-7
} as const;

type RarityTraitProbabilities = {
  breed: number;
  mood: number;
  accessory: number;
  background: number;
  clothes: number;
  eyes: number;
  mouth: number;
  marks: number;
};

function probability<T extends string>(
  trait: T,
  weights: Record<T, number>,
  allowed?: readonly T[]
): number {
  const allowedSet = allowed ? new Set(allowed) : null;
  let total = 0;
  for (const [item, weight] of Object.entries(weights) as Array<[T, number]>) {
    if (allowedSet && !allowedSet.has(item)) {
      continue;
    }
    if (weight > 0) {
      total += weight;
    }
  }
  const selected = weights[trait] ?? 0;
  return total > 0 && selected > 0 ? selected / total : 0;
}

function traitProbabilitiesForMintTier(
  traits: KPEGTraits,
  mintTier: Tier
): RarityTraitProbabilities {
  const allowedClothes = CLOTHES.filter((item) =>
    isClothesAllowedForBreed(traits.breed, item)
  );
  const allowedMouths = MOUTHS.filter((item) =>
    isMouthAllowedForBreed(traits.breed, item)
  );
  const allowedAccessories = ACCESSORIES.filter((item) =>
    isAccessoryAllowed(traits.clothes, item, traits.breed)
  );
  const allowedBackgrounds = BACKGROUNDS.filter((item) =>
    isBackgroundAllowedForBreed(traits.breed, item)
  );
  const allowedMoods = MOODS.filter((item) => isMoodAllowed(item, traits.mouth, traits.background));
  const allowedMarks = MARKS.filter((item) =>
    isMarkAllowed(traits.clothes, item, traits.breed)
  );

  return {
    breed: probability(
      traits.breed as Breed,
      BREED_WEIGHTS_BY_TIER[mintTier]
    ),
    mood: probability(
      traits.mood as Mood,
      MOOD_WEIGHTS_BY_TIER[mintTier],
      allowedMoods
    ),
    accessory: probability(
      traits.accessory as Accessory,
      ACCESSORY_WEIGHTS_BY_TIER[mintTier],
      allowedAccessories
    ),
    background: probability(
      traits.background as Background,
      BACKGROUND_WEIGHTS_BY_TIER[mintTier],
      allowedBackgrounds
    ),
    clothes: probability(
      traits.clothes as Clothes,
      CLOTHES_WEIGHTS_BY_TIER[mintTier],
      allowedClothes
    ),
    eyes: probability(
      traits.eyes as Eyes,
      EYES_WEIGHTS_BY_TIER[mintTier]
    ),
    mouth: probability(
      traits.mouth as Mouth,
      MOUTH_WEIGHTS_BY_TIER[mintTier],
      allowedMouths
    ),
    marks: probability(
      traits.marks as Marks,
      MARKS_WEIGHTS_BY_TIER[mintTier],
      allowedMarks
    )
  };
}

function exactGenerationProbability(probabilities: RarityTraitProbabilities): number {
  return (
    probabilities.background *
    probabilities.breed *
    probabilities.clothes *
    probabilities.mood *
    probabilities.marks *
    probabilities.mouth *
    probabilities.eyes *
    probabilities.accessory
  );
}

export function kpegTierFromRarityPct(percentage: number): Tier {
  if (!Number.isFinite(percentage) || percentage <= 0) {
    return 4;
  }
  if (percentage <= KPEG_TIER_RARITY_CUTOFFS_PCT.legendary) {
    return 4;
  }
  if (percentage <= KPEG_TIER_RARITY_CUTOFFS_PCT.epic) {
    return 3;
  }
  if (percentage <= KPEG_TIER_RARITY_CUTOFFS_PCT.rare) {
    return 2;
  }
  if (percentage <= KPEG_TIER_RARITY_CUTOFFS_PCT.uncommon) {
    return 1;
  }
  return 0;
}

export function kpegTierLabelFromRarityPct(percentage: number): string {
  const tier = kpegTierFromRarityPct(percentage);
  return TIER_LABELS[tier];
}

export function computeGlobalRarity(input: { traits: KPEGTraits; mintTier: Tier }): {
  percentage: number;
  oneInN: number;
  score: number;
  tier: Tier;
  tierLabel: string;
} {
  const probabilities = traitProbabilitiesForMintTier(input.traits, input.mintTier);
  const probability = exactGenerationProbability(probabilities);
  const percentage = probability * 100;
  const oneInN = probability > 0 ? 1 / probability : Number.POSITIVE_INFINITY;
  const tier = kpegTierFromRarityPct(percentage);

  return {
    percentage,
    oneInN,
    score: Number.isFinite(oneInN) ? Math.log10(oneInN) * 100 : 0,
    tier,
    tierLabel: TIER_LABELS[tier]
  };
}
