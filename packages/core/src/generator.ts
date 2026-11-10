import {
  ACCESSORIES,
  BACKGROUNDS,
  BREEDS,
  CLOTHES,
  EYES,
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
import { createDeterministicRng } from "./random.js";
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
import { computeGlobalRarity } from "./globalRarity.js";
import { pickWeightedTrait, toWeightedItems } from "./sampling.js";
import type { GenerateKPEGInput, GeneratedKPEG, TraitChance, TraitOdds, KPEGTraits } from "./types.js";

const ONE_TOKEN_WHOLE = 1;

export function tierFromWholeBought(wholeBought: number): Tier {
  if (!Number.isFinite(wholeBought) || wholeBought < ONE_TOKEN_WHOLE) {
    throw new Error("wholeBought must be a finite number >= 1");
  }
  if (wholeBought <= 9) {
    return 0;
  }
  if (wholeBought <= 49) {
    return 1;
  }
  if (wholeBought <= 99) {
    return 2;
  }
  if (wholeBought <= 249) {
    return 3;
  }
  return 4;
}

function buildSeed(input: GenerateKPEGInput): string {
  const walletAddress = input.walletAddress ?? "0x0000000000000000000000000000000000000000";
  const mintNonce = input.mintNonce ?? 0;
  const hint = String(input.seedHint ?? "seed");
  const whole = Math.floor(input.wholeBought);
  return `${walletAddress.toLowerCase()}:${whole}:${mintNonce}:${hint}`;
}

function pickFromMap<T extends string>(
  rng: () => number,
  weights: Record<T, number>,
  allowed?: readonly T[]
): TraitChance<T> {
  const items = toWeightedItems(weights, allowed);
  return pickWeightedTrait(rng, items);
}

function chanceForTrait<T extends string>(
  trait: T,
  weights: Record<T, number>,
  allowed?: readonly T[]
): TraitChance<T> {
  const selectedWeight = weights[trait] ?? 0;
  const allowedSet = allowed ? new Set(allowed) : null;
  let contextTotalWeight = 0;
  for (const [key, weight] of Object.entries(weights) as Array<[T, number]>) {
    if (allowedSet && !allowedSet.has(key)) {
      continue;
    }
    if (weight <= 0) {
      continue;
    }
    contextTotalWeight += weight;
  }
  return {
    trait,
    selectedWeight,
    contextTotalWeight,
    probabilityPct: contextTotalWeight > 0 ? (selectedWeight / contextTotalWeight) * 100 : 0
  };
}

function pickFromEntropy<T extends string>(
  entropy: bigint,
  orderedTraits: readonly T[],
  weights: Record<T, number>,
  fallback: T,
  allowed?: readonly T[]
): TraitChance<T> {
  const allowedSet = allowed ? new Set(allowed) : null;
  const multiplier = orderedTraits.some((trait) => !Number.isInteger(weights[trait] ?? 0)) ? 2 : 1;
  let total = 0;
  for (const trait of orderedTraits) {
    if (allowedSet && !allowedSet.has(trait)) {
      continue;
    }
    total += Math.round((weights[trait] ?? 0) * multiplier);
  }
  if (total <= 0) {
    return chanceForTrait(fallback, weights, allowed);
  }

  const roll = entropy % BigInt(total);
  let cursor = 0n;
  for (const trait of orderedTraits) {
    if (allowedSet && !allowedSet.has(trait)) {
      continue;
    }
    const weight = Math.round((weights[trait] ?? 0) * multiplier);
    if (weight <= 0) {
      continue;
    }
    cursor += BigInt(weight);
    if (roll < cursor) {
      return chanceForTrait(trait, weights, allowed);
    }
  }

  return chanceForTrait(fallback, weights, allowed);
}

function generateFromTierAndSeed(tier: Tier, seed: string): GeneratedKPEG {
  const rng = createDeterministicRng(seed);

  const breedRoll = pickFromMap(rng.nextFloat, BREED_WEIGHTS_BY_TIER[tier]);
  const breed = breedRoll.trait as Breed;

  const allowedClothes = CLOTHES.filter((item) => isClothesAllowedForBreed(breed, item));
  const clothesRoll = pickFromMap(rng.nextFloat, CLOTHES_WEIGHTS_BY_TIER[tier], allowedClothes);
  const clothes = clothesRoll.trait as Clothes;

  const allowedMouths = MOUTHS.filter((item) => isMouthAllowedForBreed(breed, item));
  const mouthRoll = pickFromMap(rng.nextFloat, MOUTH_WEIGHTS_BY_TIER[tier], allowedMouths);
  const mouth = mouthRoll.trait as Mouth;

  const eyesRoll = pickFromMap(rng.nextFloat, EYES_WEIGHTS_BY_TIER[tier]);
  const eyes = eyesRoll.trait as Eyes;

  const allowedAccessories = ACCESSORIES.filter((item) => isAccessoryAllowed(clothes, item, breed));
  const accessoryRoll = pickFromMap(rng.nextFloat, ACCESSORY_WEIGHTS_BY_TIER[tier], allowedAccessories);
  const accessory = accessoryRoll.trait as Accessory;

  const allowedBackgrounds = BACKGROUNDS.filter((item) => isBackgroundAllowedForBreed(breed, item));
  const backgroundRoll = pickFromMap(rng.nextFloat, BACKGROUND_WEIGHTS_BY_TIER[tier], allowedBackgrounds);
  const background = backgroundRoll.trait as Background;

  const allowedMoods = MOODS.filter((item) => isMoodAllowed(item, mouth, background));
  const moodRoll = pickFromMap(rng.nextFloat, MOOD_WEIGHTS_BY_TIER[tier], allowedMoods);
  const mood = moodRoll.trait as Mood;

  const allowedMarks = MARKS.filter((item) => isMarkAllowed(clothes, item, breed));
  const marksRoll = pickFromMap(rng.nextFloat, MARKS_WEIGHTS_BY_TIER[tier], allowedMarks);
  const marks = marksRoll.trait as Marks;

  const traits: KPEGTraits = {
    background,
    breed,
    clothes,
    mood,
    marks,
    mouth,
    eyes,
    accessory
  };

  const traitOdds: TraitOdds = {
    background: backgroundRoll as TraitChance<Background>,
    breed: breedRoll as TraitChance<Breed>,
    clothes: clothesRoll as TraitChance<Clothes>,
    mood: moodRoll as TraitChance<Mood>,
    marks: marksRoll as TraitChance<Marks>,
    mouth: mouthRoll as TraitChance<Mouth>,
    eyes: eyesRoll as TraitChance<Eyes>,
    accessory: accessoryRoll as TraitChance<Accessory>
  };
  const globalRarity = computeGlobalRarity({ traits, mintTier: tier });

  return {
    seed,
    tier,
    tierLabel: TIER_LABELS[tier],
    mintTier: tier,
    mintTierLabel: TIER_LABELS[tier],
    kpegTier: globalRarity.tier,
    kpegTierLabel: globalRarity.tierLabel,
    traits,
    traitOdds,
    kpegRarityPct: globalRarity.percentage,
    kpegRarityOneInN: globalRarity.oneInN,
    kpegRarityBasis: "Rarity Probability"
  };
}

export function generateKPEG(input: GenerateKPEGInput): GeneratedKPEG {
  const tier = tierFromWholeBought(input.wholeBought);
  const seed = buildSeed(input);
  return generateFromTierAndSeed(tier, seed);
}

export function generateKPEGFromSeed(input: { seed: string; tier: Tier }): GeneratedKPEG {
  return generateFromTierAndSeed(input.tier, input.seed);
}

export function generateKPEGFromOnchainEntropy(input: { seed: string; tier: Tier; entropy: bigint }): GeneratedKPEG {
  const tier = input.tier > 4 ? 4 : input.tier;
  const breedRoll = pickFromEntropy(input.entropy, BREEDS, BREED_WEIGHTS_BY_TIER[tier], "American Shorthair");
  const breed = breedRoll.trait as Breed;

  const allowedClothes = CLOTHES.filter((item) => isClothesAllowedForBreed(breed, item));
  const clothesRoll = pickFromEntropy(input.entropy >> 32n, CLOTHES, CLOTHES_WEIGHTS_BY_TIER[tier], "None", allowedClothes);
  const clothes = clothesRoll.trait as Clothes;

  const allowedMouths = MOUTHS.filter((item) => isMouthAllowedForBreed(breed, item));
  const mouthRoll = pickFromEntropy(input.entropy >> 64n, MOUTHS, MOUTH_WEIGHTS_BY_TIER[tier], "Stoic", allowedMouths);
  const mouth = mouthRoll.trait as Mouth;

  const eyesRoll = pickFromEntropy(input.entropy >> 96n, EYES, EYES_WEIGHTS_BY_TIER[tier], "Happy ^_^");
  const eyes = eyesRoll.trait as Eyes;

  const allowedAccessories = ACCESSORIES.filter((item) => isAccessoryAllowed(clothes, item, breed));
  const accessoryRoll = pickFromEntropy(
    input.entropy >> 128n,
    ACCESSORIES,
    ACCESSORY_WEIGHTS_BY_TIER[tier],
    "None",
    allowedAccessories
  );
  const accessory = accessoryRoll.trait as Accessory;

  const allowedBackgrounds = BACKGROUNDS.filter((item) => isBackgroundAllowedForBreed(breed, item));
  const backgroundRoll = pickFromEntropy(
    input.entropy >> 224n,
    BACKGROUNDS,
    BACKGROUND_WEIGHTS_BY_TIER[tier],
    "Sky",
    allowedBackgrounds
  );
  const background = backgroundRoll.trait as Background;

  const allowedMoods = MOODS.filter((item) => isMoodAllowed(item, mouth, background));
  const moodRoll = pickFromEntropy(input.entropy >> 160n, MOODS, MOOD_WEIGHTS_BY_TIER[tier], "None", allowedMoods);
  const mood = moodRoll.trait as Mood;

  const allowedMarks = MARKS.filter((item) => isMarkAllowed(clothes, item, breed));
  const marksRoll = pickFromEntropy(input.entropy >> 192n, MARKS, MARKS_WEIGHTS_BY_TIER[tier], "None", allowedMarks);
  const marks = marksRoll.trait as Marks;

  const traits: KPEGTraits = {
    background,
    breed,
    clothes,
    mood,
    marks,
    mouth,
    eyes,
    accessory
  };
  const traitOdds: TraitOdds = {
    background: backgroundRoll as TraitChance<Background>,
    breed: breedRoll as TraitChance<Breed>,
    clothes: clothesRoll as TraitChance<Clothes>,
    mood: moodRoll as TraitChance<Mood>,
    marks: marksRoll as TraitChance<Marks>,
    mouth: mouthRoll as TraitChance<Mouth>,
    eyes: eyesRoll as TraitChance<Eyes>,
    accessory: accessoryRoll as TraitChance<Accessory>
  };
  const globalRarity = computeGlobalRarity({ traits, mintTier: tier });

  return {
    seed: input.seed,
    tier,
    tierLabel: TIER_LABELS[tier],
    mintTier: tier,
    mintTierLabel: TIER_LABELS[tier],
    kpegTier: globalRarity.tier,
    kpegTierLabel: globalRarity.tierLabel,
    traits,
    traitOdds,
    kpegRarityPct: globalRarity.percentage,
    kpegRarityOneInN: globalRarity.oneInN,
    kpegRarityBasis: "Rarity Probability"
  };
}
