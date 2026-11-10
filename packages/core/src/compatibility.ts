import {
  ACCESSORIES,
  BACKGROUNDS,
  BREEDS,
  CLOTHES,
  EYES,
  MARKS,
  MOODS,
  MOUTHS,
  type Accessory,
  type Background,
  type Breed,
  type Clothes,
  type Marks,
  type Mood,
  type Mouth
} from "./traitRegistry.js";

export const BREED_ALLOWED_BACKGROUNDS: Record<Breed, readonly Background[]> = {
  "American Shorthair": BACKGROUNDS,
  "British Shorthair": BACKGROUNDS,
  Siamese: ["Sky", "Mint", "Coral", "Lilac", "Midnight"],
  Persian: BACKGROUNDS,
  "Maine Coon": BACKGROUNDS,
  Bengal: BACKGROUNDS,
  "Scottish Fold": BACKGROUNDS,
  Munchkin: BACKGROUNDS,
  Ragdoll: ["Sky", "Mint", "Coral", "Lilac", "Midnight"],
  Calico: ["Sky", "Mint", "Coral", "Lilac", "Midnight"],
  Bombay: ["White", "Sky", "Mint", "Coral", "Lilac"],
  "Norwegian Forest": BACKGROUNDS,
  Abyssinian: BACKGROUNDS,
  "Devon Rex": BACKGROUNDS,
  "Russian Blue": BACKGROUNDS,
  Sphynx: BACKGROUNDS,
  "Turkish Van": BACKGROUNDS,
  Tuxedo: BACKGROUNDS,
  Nebelung: BACKGROUNDS,
  "Alien Cat": BACKGROUNDS
};

export const CROWN_BLOCKED_CLOTHES: readonly Clothes[] = ["Frog Onesie", "Dino Costume", "Space Helmet"];
export const NECK_ACCESSORIES: readonly Accessory[] = ["Star Pin", "Heart Charm", "ETH Pendant", "BTC Tag"];
export const NECK_ACCESSORY_BLOCKED_CLOTHES: readonly Clothes[] = [
  "Red Bandana",
  "Green Bandana",
  "Blue Bowtie",
  "Pink Scarf",
  "Gold Collar"
];
export const SPACE_HELMET_ONLY_ACCESSORY: readonly Accessory[] = ["None"];
export const SPACE_HELMET_ALLOWED_MARKS: readonly Marks[] = ["None", "Blush", "Cream Muzzle"];
export const SLEEP_ZZZ_BLOCKED_MOUTHS: readonly Mouth[] = ["Happy V", "Tongue Out"];
export const ABYSSINIAN_BLOCKED_CLOTHES: readonly Clothes[] = ["Frog Onesie"];
export const SPHYNX_BLOCKED_CLOTHES: readonly Clothes[] = [
  "Cozy Hoodie",
  "Sailor Shirt",
  "Frog Onesie",
  "Pink Scarf",
  "Yellow Raincoat",
  "Purple Sweater"
];
export const SPHYNX_BLOCKED_MOUTHS: readonly Mouth[] = ["Happy V", "Grumpy"];
export const SPHYNX_BLOCKED_MARKS: readonly Marks[] = ["Cream Muzzle"];
export const SPHYNX_BLOCKED_ACCESSORIES: readonly Accessory[] = ["Star Pin", "Heart Charm"];
export const TUXEDO_BLOCKED_MARKS: readonly Marks[] = ["Cream Muzzle"];

export const AURORA_ALLOWED_BACKGROUNDS: readonly Background[] = ["Lilac", "Midnight"];
export const ALIEN_CAT_BLOCKED_CLOTHES: readonly Clothes[] = [
  "Cozy Hoodie",
  "Sailor Shirt",
  "Frog Onesie",
  "Dino Costume",
  "Yellow Raincoat",
  "Purple Sweater"
];
export const ALIEN_CAT_BLOCKED_MOUTHS: readonly Mouth[] = ["Happy V"];
export const ALIEN_CAT_BLOCKED_MARKS: readonly Marks[] = ["Cream Muzzle"];
export const NEBELUNG_BLOCKED_CLOTHES: readonly Clothes[] = ["Frog Onesie"];
export const METEOR_HOODIE_BLOCKED_BREEDS: readonly Breed[] = ["Siamese", "Persian", "Ragdoll", "Sphynx", "Alien Cat"];
export const MOON_GARMENT_BLOCKED_BREEDS: readonly Breed[] = ["Siamese", "Persian", "Ragdoll", "Alien Cat"];
export const WIZARD_HAT_BLOCKED_BREEDS: readonly Breed[] = ["Bombay", "Devon Rex", "Sphynx", "Alien Cat"];

function isMoonGarment(clothes: Clothes): boolean {
  return clothes === "Moon Cloak" || clothes === "Star Cape" || clothes === "Silk Sash";
}

export function isBackgroundAllowedForBreed(breed: Breed, background: Background): boolean {
  return BREED_ALLOWED_BACKGROUNDS[breed].includes(background);
}

export function isClothesAllowedForBreed(breed: Breed, clothes: Clothes): boolean {
  if (breed === "Abyssinian" && ABYSSINIAN_BLOCKED_CLOTHES.includes(clothes)) {
    return false;
  }
  if (breed === "Sphynx" && SPHYNX_BLOCKED_CLOTHES.includes(clothes)) {
    return false;
  }
  if (breed === "Nebelung" && NEBELUNG_BLOCKED_CLOTHES.includes(clothes)) {
    return false;
  }
  if (breed === "Alien Cat" && ALIEN_CAT_BLOCKED_CLOTHES.includes(clothes)) {
    return false;
  }
  if (clothes === "Meteor Hoodie" && METEOR_HOODIE_BLOCKED_BREEDS.includes(breed)) {
    return false;
  }
  if (isMoonGarment(clothes) && MOON_GARMENT_BLOCKED_BREEDS.includes(breed)) {
    return false;
  }
  if (clothes === "Wizard Hat" && WIZARD_HAT_BLOCKED_BREEDS.includes(breed)) {
    return false;
  }
  return CLOTHES.includes(clothes);
}

export function isMouthAllowedForBreed(breed: Breed, mouth: Mouth): boolean {
  if (breed === "Sphynx" && SPHYNX_BLOCKED_MOUTHS.includes(mouth)) {
    return false;
  }
  if (breed === "Alien Cat" && ALIEN_CAT_BLOCKED_MOUTHS.includes(mouth)) {
    return false;
  }
  return MOUTHS.includes(mouth);
}

export function isAccessoryAllowed(clothes: Clothes, accessory: Accessory, breed?: Breed): boolean {
  if (clothes === "Space Helmet") {
    return SPACE_HELMET_ONLY_ACCESSORY.includes(accessory);
  }

  if (accessory === "Gold Crown" && CROWN_BLOCKED_CLOTHES.includes(clothes)) {
    return false;
  }

  if (NECK_ACCESSORIES.includes(accessory) && NECK_ACCESSORY_BLOCKED_CLOTHES.includes(clothes)) {
    return false;
  }

  if (breed === "Sphynx" && SPHYNX_BLOCKED_ACCESSORIES.includes(accessory)) {
    return false;
  }

  return ACCESSORIES.includes(accessory);
}

export function isMoodAllowed(mood: Mood, mouth: Mouth, background?: Background): boolean {
  if (mood === "Sleep Zzz" && SLEEP_ZZZ_BLOCKED_MOUTHS.includes(mouth)) {
    return false;
  }
  if (mood === "Aurora" && background && !AURORA_ALLOWED_BACKGROUNDS.includes(background)) {
    return false;
  }
  return MOODS.includes(mood);
}

export function isMarkAllowed(clothes: Clothes, marks: Marks, breed?: Breed): boolean {
  if (breed === "Sphynx" && SPHYNX_BLOCKED_MARKS.includes(marks)) {
    return false;
  }
  if (breed === "Tuxedo" && TUXEDO_BLOCKED_MARKS.includes(marks)) {
    return false;
  }
  if (breed === "Alien Cat" && ALIEN_CAT_BLOCKED_MARKS.includes(marks)) {
    return false;
  }
  if (clothes === "Space Helmet") {
    return SPACE_HELMET_ALLOWED_MARKS.includes(marks);
  }
  return MARKS.includes(marks);
}

export function compatibilitySummaryCounts(): {
  breedBackgroundPairs: number;
  totalClothes: number;
  totalMoods: number;
  totalMarks: number;
  totalMouths: number;
  totalEyes: number;
} {
  const breedBackgroundPairs = BREEDS.reduce((acc, breed) => acc + BREED_ALLOWED_BACKGROUNDS[breed].length, 0);
  return {
    breedBackgroundPairs,
    totalClothes: CLOTHES.length,
    totalMoods: MOODS.length,
    totalMarks: MARKS.length,
    totalMouths: MOUTHS.length,
    totalEyes: EYES.length
  };
}

export function countClothesAccessoryPairs(): number {
  let count = 0;
  for (const breed of BREEDS) {
    for (const clothes of CLOTHES) {
      if (!isClothesAllowedForBreed(breed, clothes)) {
        continue;
      }
      const allowedAccessories = ACCESSORIES.filter((item) => isAccessoryAllowed(clothes, item, breed));
      count += allowedAccessories.length;
    }
  }
  return count;
}

export function countClothesAccessoryMarkCombos(): number {
  let count = 0;
  for (const breed of BREEDS) {
    for (const clothes of CLOTHES) {
      if (!isClothesAllowedForBreed(breed, clothes)) {
        continue;
      }
      const allowedAccessories = ACCESSORIES.filter((item) => isAccessoryAllowed(clothes, item, breed));
      const allowedMarks = MARKS.filter((item) => isMarkAllowed(clothes, item, breed));
      count += allowedAccessories.length * allowedMarks.length;
    }
  }
  return count;
}

export function countMouthMoodPairs(): number {
  let count = 0;
  for (const breed of BREEDS) {
    const allowedBackgrounds = BACKGROUNDS.filter((item) => isBackgroundAllowedForBreed(breed, item));
    for (const background of allowedBackgrounds) {
      for (const mouth of MOUTHS) {
        if (!isMouthAllowedForBreed(breed, mouth)) {
          continue;
        }
        for (const mood of MOODS) {
          if (isMoodAllowed(mood, mouth, background)) {
            count += 1;
          }
        }
      }
    }
  }
  return count;
}

export const DOC_NAIVE_COMBINATIONS =
  BACKGROUNDS.length * BREEDS.length * CLOTHES.length * MOODS.length * MARKS.length * MOUTHS.length * EYES.length * ACCESSORIES.length;

export const DOC_FILTERED_COMBINATIONS =
  BREEDS.reduce((total, breed) => {
    let clothesAccessoryMarks = 0;
    for (const clothes of CLOTHES) {
      if (!isClothesAllowedForBreed(breed, clothes)) {
        continue;
      }
      const accessories = ACCESSORIES.filter((item) => isAccessoryAllowed(clothes, item, breed)).length;
      const marks = MARKS.filter((item) => isMarkAllowed(clothes, item, breed)).length;
      clothesAccessoryMarks += accessories * marks;
    }

    let breedTotal = 0;
    const allowedBackgrounds = BACKGROUNDS.filter((item) => isBackgroundAllowedForBreed(breed, item));
    for (const background of allowedBackgrounds) {
      let mouthMoods = 0;
      for (const mouth of MOUTHS) {
        if (!isMouthAllowedForBreed(breed, mouth)) {
          continue;
        }
        mouthMoods += MOODS.filter((item) => isMoodAllowed(item, mouth, background)).length;
      }
      breedTotal += clothesAccessoryMarks * mouthMoods * EYES.length;
    }

    return total + breedTotal;
  }, 0);
