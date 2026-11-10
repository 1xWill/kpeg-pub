import {
  ACCESSORIES,
  BREEDS,
  CLOTHES,
  EYES,
  MOODS,
  MOUTHS,
  type Tier
} from "./traitRegistry.js";
import type { KPEGTraits } from "./types.js";

export type BreedingParentProfile = {
  tier: Tier;
  traits: KPEGTraits;
};

export type BreedingGroupPools = {
  parentInheritancePct: number;
  mutationPct: number;
  fallbackPct: number;
};

export type BreedingPreview = {
  parentACycleDays: number;
  parentBCycleDays: number;
  pairCycleDays: number;
  parentSimilarity: number;
  expectedMutations: number;
  childTierOddsPct: Record<Tier, number>;
  expectedSuccessPct: number;
  expectedSuccessBp: number;
  tierPenaltyBp: Record<Tier, number>;
  groupPools: {
    background: BreedingGroupPools;
    breed: BreedingGroupPools;
    clothes: BreedingGroupPools;
    mood: BreedingGroupPools;
    marks: BreedingGroupPools;
    mouth: BreedingGroupPools;
    eyes: BreedingGroupPools;
    accessory: BreedingGroupPools;
  };
};

type GroupPoolBps = {
  parent: number;
  mutation: number;
};

const GROUP_POOLS_BPS: Record<keyof KPEGTraits, GroupPoolBps> = {
  background: { parent: 2200, mutation: 2500 },
  breed: { parent: 7200, mutation: 800 },
  clothes: { parent: 3500, mutation: 2200 },
  mood: { parent: 3200, mutation: 2000 },
  marks: { parent: 5200, mutation: 1200 },
  mouth: { parent: 5400, mutation: 1000 },
  eyes: { parent: 6400, mutation: 800 },
  accessory: { parent: 2800, mutation: 1800 }
};

const TIER_PENALTY_BPS: Record<Tier, number> = {
  0: 0,
  1: 300,
  2: 700,
  3: 1200,
  4: 1800
};

const CHILD_TIER_WEIGHTS: Record<Tier, [number, number, number, number, number]> = {
  0: [70, 22, 7, 1, 0],
  1: [35, 42, 18, 4, 1],
  2: [15, 30, 38, 14, 3],
  3: [6, 18, 32, 34, 10],
  4: [2, 8, 22, 38, 30]
};

const TRAIT_CYCLE_MODIFIERS: {
  plus2: {
    clothes: Set<number>;
    accessory: Set<number>;
    eyes: Set<number>;
  };
  plus1: {
    clothes: Set<number>;
    mood: Set<number>;
    accessory: Set<number>;
  };
  minus1: {
    accessory: Set<number>;
    mood: Set<number>;
    mouth: Set<number>;
  };
} = {
  plus2: {
    clothes: new Set([12]), // Space Helmet
    accessory: new Set([1]), // Gold Crown
    eyes: new Set([11]) // Void Eyes
  },
  plus1: {
    clothes: new Set([16, 14, 17, 13]), // Star Cape / Moon Cloak / Wizard Hat / Meteor Hoodie
    mood: new Set([6, 9]), // Purple Moon / Tiny Storm
    accessory: new Set([11, 15, 10]) // Crystal Ball / Moonfish / Comet Charm
  },
  minus1: {
    accessory: new Set([2, 3, 6, 16, 12, 13]), // Fish Snack / Yarn Ball / Heart Charm / Tiny Bell / Feather Teaser / Lucky Coin
    mood: new Set([2, 7, 8]), // Hearts / Fireflies / Lucky Breeze
    mouth: new Set([8]) // Calm Smile
  }
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function avgTier(a: Tier, b: Tier): Tier {
  return Math.floor((a + b) / 2) as Tier;
}

function indexOfOrThrow<T extends readonly string[]>(items: T, value: string, label: string): number {
  const index = items.indexOf(value);
  if (index < 0) {
    throw new Error(`Unknown ${label} trait: ${value}`);
  }
  return index;
}

function breedCycleModifier(breedIndex: number): number {
  if (breedIndex === 19) return 4;
  if (breedIndex === 4 || breedIndex === 11) return 2;
  if (breedIndex === 1 || breedIndex === 3 || breedIndex === 8 || breedIndex === 15 || breedIndex === 18) return 1;
  if (breedIndex === 7 || breedIndex === 13) return -1;
  return 0;
}

function baseCycleByTier(tier: Tier): number {
  if (tier === 0) return 6;
  if (tier === 1) return 8;
  if (tier === 2) return 10;
  if (tier === 3) return 14;
  return 18;
}

function traitCycleModifier(input: {
  clothesIndex: number;
  moodIndex: number;
  mouthIndex: number;
  eyesIndex: number;
  accessoryIndex: number;
}): number {
  let modifier = 0;
  if (
    TRAIT_CYCLE_MODIFIERS.plus2.clothes.has(input.clothesIndex) ||
    TRAIT_CYCLE_MODIFIERS.plus2.accessory.has(input.accessoryIndex) ||
    TRAIT_CYCLE_MODIFIERS.plus2.eyes.has(input.eyesIndex)
  ) {
    modifier += 2;
  }
  if (
    TRAIT_CYCLE_MODIFIERS.plus1.clothes.has(input.clothesIndex) ||
    TRAIT_CYCLE_MODIFIERS.plus1.mood.has(input.moodIndex) ||
    TRAIT_CYCLE_MODIFIERS.plus1.accessory.has(input.accessoryIndex)
  ) {
    modifier += 1;
  }
  if (
    TRAIT_CYCLE_MODIFIERS.minus1.accessory.has(input.accessoryIndex) ||
    TRAIT_CYCLE_MODIFIERS.minus1.mood.has(input.moodIndex) ||
    TRAIT_CYCLE_MODIFIERS.minus1.mouth.has(input.mouthIndex)
  ) {
    modifier -= 1;
  }
  return modifier;
}

function cycleDaysForParent(parent: BreedingParentProfile): number {
  const breedIndex = indexOfOrThrow(BREEDS, parent.traits.breed, "breed");
  const clothesIndex = indexOfOrThrow(CLOTHES, parent.traits.clothes, "clothes");
  const moodIndex = indexOfOrThrow(MOODS, parent.traits.mood, "mood");
  const mouthIndex = indexOfOrThrow(MOUTHS, parent.traits.mouth, "mouth");
  const eyesIndex = indexOfOrThrow(EYES, parent.traits.eyes, "eyes");
  const accessoryIndex = indexOfOrThrow(ACCESSORIES, parent.traits.accessory, "accessory");
  const base = baseCycleByTier(parent.tier);
  const modifier = clamp(
    breedCycleModifier(breedIndex) +
      traitCycleModifier({
        clothesIndex,
        moodIndex,
        mouthIndex,
        eyesIndex,
        accessoryIndex
      }),
    -3,
    5
  );
  return clamp(base + modifier, 3, 21);
}

function similarityCount(a: KPEGTraits, b: KPEGTraits): number {
  let same = 0;
  if (a.background === b.background) same += 1;
  if (a.breed === b.breed) same += 1;
  if (a.clothes === b.clothes) same += 1;
  if (a.mood === b.mood) same += 1;
  if (a.marks === b.marks) same += 1;
  if (a.mouth === b.mouth) same += 1;
  if (a.eyes === b.eyes) same += 1;
  if (a.accessory === b.accessory) same += 1;
  return same;
}

function childTierWeights(parentTierA: Tier, parentTierB: Tier): [number, number, number, number, number] {
  const parentAverageTier = avgTier(parentTierA, parentTierB);
  const highTier = Math.max(parentTierA, parentTierB) as Tier;
  const row = [...CHILD_TIER_WEIGHTS[parentAverageTier]] as [number, number, number, number, number];
  if (highTier > parentAverageTier) {
    let shift = 5;
    for (let tier = 0; tier < highTier && shift > 0; tier += 1) {
      const available = row[tier as Tier];
      const take = Math.min(available, shift);
      row[tier as Tier] -= take;
      row[highTier] += take;
      shift -= take;
    }
  }
  return row;
}

function expectedMutationCount(): number {
  return (
    Object.values(GROUP_POOLS_BPS).reduce((sum, pools) => sum + pools.mutation, 0) / 10_000
  );
}

function toPct(inputBps: number): number {
  return Math.round((inputBps / 100) * 100) / 100;
}

function groupPoolsToPct(pools: GroupPoolBps): BreedingGroupPools {
  const parentInheritancePct = toPct(pools.parent);
  const mutationPct = toPct(pools.mutation);
  return {
    parentInheritancePct,
    mutationPct,
    fallbackPct: Math.max(0, 100 - parentInheritancePct - mutationPct)
  };
}

export function estimateBreedingPreview(input: {
  parentA: BreedingParentProfile;
  parentB: BreedingParentProfile;
  pairBirthCount?: number;
}): BreedingPreview {
  const parentACycleDays = cycleDaysForParent(input.parentA);
  const parentBCycleDays = cycleDaysForParent(input.parentB);
  const pairCycleDays = Math.max(parentACycleDays, parentBCycleDays);
  const parentSimilarity = similarityCount(input.parentA.traits, input.parentB.traits);
  const mutationEstimate = expectedMutationCount();
  const weights = childTierWeights(input.parentA.tier, input.parentB.tier);
  const pairBirthCount = input.pairBirthCount ?? 0;
  const lineagePenalty = pairBirthCount > 0 ? 800 : 0;
  const childTierOddsPct: Record<Tier, number> = {
    0: weights[0],
    1: weights[1],
    2: weights[2],
    3: weights[3],
    4: weights[4]
  };

  const dominantTier = weights.indexOf(Math.max(...weights)) as Tier;
  const diversityBonus = Math.min(
    1800,
    (8 - parentSimilarity) * 150 + Math.round(mutationEstimate * 75)
  );
  const penalty = TIER_PENALTY_BPS[dominantTier] + lineagePenalty;
  const successBp = clamp(4200 + diversityBonus - penalty, 1000, 7200);

  return {
    parentACycleDays,
    parentBCycleDays,
    pairCycleDays,
    parentSimilarity,
    expectedMutations: Math.round(mutationEstimate * 100) / 100,
    childTierOddsPct,
    expectedSuccessPct: Math.round(toPct(successBp) * 100) / 100,
    expectedSuccessBp: successBp,
    tierPenaltyBp: TIER_PENALTY_BPS,
    groupPools: {
      background: groupPoolsToPct(GROUP_POOLS_BPS.background),
      breed: groupPoolsToPct(GROUP_POOLS_BPS.breed),
      clothes: groupPoolsToPct(GROUP_POOLS_BPS.clothes),
      mood: groupPoolsToPct(GROUP_POOLS_BPS.mood),
      marks: groupPoolsToPct(GROUP_POOLS_BPS.marks),
      mouth: groupPoolsToPct(GROUP_POOLS_BPS.mouth),
      eyes: groupPoolsToPct(GROUP_POOLS_BPS.eyes),
      accessory: groupPoolsToPct(GROUP_POOLS_BPS.accessory)
    }
  };
}
