import type { TraitChance } from "./types.js";

type WeightedItem<T extends string> = {
  trait: T;
  weight: number;
};

export function toWeightedItems<T extends string>(
  weights: Record<T, number>,
  allowedTraits?: readonly T[]
): WeightedItem<T>[] {
  const allowedSet = allowedTraits ? new Set(allowedTraits) : null;
  const out: WeightedItem<T>[] = [];
  for (const [trait, weight] of Object.entries(weights) as Array<[T, number]>) {
    if (allowedSet && !allowedSet.has(trait)) {
      continue;
    }
    if (weight <= 0) {
      continue;
    }
    out.push({ trait, weight });
  }
  return out;
}

export function pickWeightedTrait<T extends string>(
  rng: () => number,
  items: WeightedItem<T>[]
): TraitChance<T> {
  if (items.length === 0) {
    throw new Error("Cannot sample from an empty weighted set");
  }
  const total = items.reduce((acc, item) => acc + item.weight, 0);
  const target = rng() * total;
  let running = 0;
  for (const item of items) {
    running += item.weight;
    if (target <= running) {
      return {
        trait: item.trait,
        selectedWeight: item.weight,
        contextTotalWeight: total,
        probabilityPct: (item.weight / total) * 100
      };
    }
  }
  const fallback = items[items.length - 1];
  if (!fallback) {
    throw new Error("Cannot sample from an empty weighted set");
  }
  return {
    trait: fallback.trait,
    selectedWeight: fallback.weight,
    contextTotalWeight: total,
    probabilityPct: (fallback.weight / total) * 100
  };
}
