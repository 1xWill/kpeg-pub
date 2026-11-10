import type { Accessory, Background, Breed, Clothes, Eyes, Marks, Mood, Mouth, Tier } from "./traitRegistry.js";

export interface KPEGTraits {
  background: Background;
  breed: Breed;
  clothes: Clothes;
  mood: Mood;
  marks: Marks;
  mouth: Mouth;
  eyes: Eyes;
  accessory: Accessory;
}

export interface TraitChance<T extends string> {
  trait: T;
  selectedWeight: number;
  contextTotalWeight: number;
  probabilityPct: number;
}

export type TraitOdds = {
  [K in keyof KPEGTraits]: TraitChance<KPEGTraits[K]>;
};

export interface GeneratedKPEG {
  seed: string;
  // Legacy fields kept for compatibility with existing consumers; both represent mint tier.
  tier: Tier;
  tierLabel: string;
  // Explicit mint-tier fields.
  mintTier: Tier;
  mintTierLabel: string;
  // Final rarity tier derived from Rarity Probability.
  kpegTier: Tier;
  kpegTierLabel: string;
  traits: KPEGTraits;
  traitOdds: TraitOdds;
  kpegRarityPct: number;
  kpegRarityOneInN: number;
  kpegRarityBasis: "Rarity Probability";
}

export interface GenerateKPEGInput {
  wholeBought: number;
  walletAddress?: string;
  mintNonce?: number;
  seedHint?: string | number;
}
