import { ACCESSORIES, BACKGROUNDS, BREEDS, CLOTHES, EYES, MARKS, MOODS, MOUTHS } from "./traitRegistry.js";
import {
  DOC_FILTERED_COMBINATIONS,
  DOC_NAIVE_COMBINATIONS
} from "./compatibility.js";

export function computeNaiveCombinationCount(): number {
  return DOC_NAIVE_COMBINATIONS;
}

export function computeFilteredCombinationCountByManifest(): number {
  return DOC_FILTERED_COMBINATIONS;
}

export function documentedFilteredCombinationCount(): number {
  return DOC_FILTERED_COMBINATIONS;
}

export function computeCompatibilityReduction(
  naive: number,
  filtered: number
): { removed: number; reductionPct: number } {
  const removed = naive - filtered;
  return {
    removed,
    reductionPct: (removed / naive) * 100
  };
}

export function traitManifestCounts() {
  return {
    backgrounds: BACKGROUNDS.length,
    breeds: BREEDS.length,
    clothes: CLOTHES.length,
    moods: MOODS.length,
    marks: MARKS.length,
    mouths: MOUTHS.length,
    eyes: EYES.length,
    accessories: ACCESSORIES.length
  };
}
