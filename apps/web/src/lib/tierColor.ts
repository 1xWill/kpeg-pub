const TIER_COLOR_VARS: Record<string, string> = {
  COMMON: "var(--tier-common)",
  UNCOMMON: "var(--tier-uncommon)",
  RARE: "var(--tier-rare)",
  EPIC: "var(--tier-epic)",
  LEGENDARY: "var(--tier-legendary)",
};

const METALLIC_TIER_VARIANTS: Record<string, "rare" | "epic" | "legendary"> = {
  RARE: "rare",
  EPIC: "epic",
  LEGENDARY: "legendary",
};

export function getTierColor(tierLabel: string): string | undefined {
  return TIER_COLOR_VARS[tierLabel.trim().toUpperCase()];
}

export function getMetallicTierVariant(
  tierLabel: string,
): "rare" | "epic" | "legendary" | undefined {
  return METALLIC_TIER_VARIANTS[tierLabel.trim().toUpperCase()];
}
