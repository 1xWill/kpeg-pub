export const BACKGROUNDS = ["White", "Sky", "Mint", "Coral", "Lilac", "Midnight"] as const;

export const BREEDS = [
  "American Shorthair",
  "British Shorthair",
  "Siamese",
  "Persian",
  "Maine Coon",
  "Bengal",
  "Scottish Fold",
  "Munchkin",
  "Ragdoll",
  "Calico",
  "Bombay",
  "Norwegian Forest",
  "Abyssinian",
  "Devon Rex",
  "Russian Blue",
  "Sphynx",
  "Turkish Van",
  "Tuxedo",
  "Nebelung",
  "Alien Cat"
] as const;

export const CLOTHES = [
  "None",
  "Red Bandana",
  "Green Bandana",
  "Blue Bowtie",
  "Cozy Hoodie",
  "Sailor Shirt",
  "Frog Onesie",
  "Dino Costume",
  "Pink Scarf",
  "Yellow Raincoat",
  "Purple Sweater",
  "Gold Collar",
  "Space Helmet",
  "Meteor Hoodie",
  "Moon Cloak",
  "Silk Sash",
  "Star Cape",
  "Wizard Hat"
] as const;

export const MOODS = [
  "None",
  "Sparkles",
  "Hearts",
  "Sleep Zzz",
  "Sweat Drop",
  "Coin Glow",
  "Purple Moon",
  "Fireflies",
  "Lucky Breeze",
  "Tiny Storm",
  "Aurora",
  "Moonlit"
] as const;

export const MARKS = ["None", "Blush", "Cream Muzzle", "Tiny Scar"] as const;

export const MOUTHS = [
  "Happy V",
  "Smiling W",
  "Pout",
  "Stoic",
  "Wonder O",
  "Tongue Out",
  "Grumpy",
  "Smirk",
  "Calm Smile",
  "Fishy Bite",
  "Tiny Fang",
  "Yawn"
] as const;

export const EYES = [
  "Happy ^_^",
  "Blue Eyes",
  "Winking",
  "Amber Eyes",
  "Bored Eyes",
  "Heterochromia",
  "Emerald Eyes",
  "Sleepy",
  "Crossed Eyes",
  "Glassy Eyes",
  "Gold Eyes",
  "Void Eyes"
] as const;

export const ACCESSORIES = [
  "None",
  "Gold Crown",
  "Fish Snack",
  "Yarn Ball",
  "Star Pin",
  "Round Glasses",
  "Heart Charm",
  "ETH Pendant",
  "BTC Tag",
  "Cat Wand",
  "Comet Charm",
  "Crystal Ball",
  "Feather Teaser",
  "Lucky Coin",
  "Magic Wand",
  "Moonfish",
  "Tiny Bell"
] as const;

export type Background = (typeof BACKGROUNDS)[number];
export type Breed = (typeof BREEDS)[number];
export type Clothes = (typeof CLOTHES)[number];
export type Mood = (typeof MOODS)[number];
export type Marks = (typeof MARKS)[number];
export type Mouth = (typeof MOUTHS)[number];
export type Eyes = (typeof EYES)[number];
export type Accessory = (typeof ACCESSORIES)[number];

export const TIER_LABELS = ["Common", "Uncommon", "Rare", "Epic", "Legendary"] as const;
export type Tier = 0 | 1 | 2 | 3 | 4;
