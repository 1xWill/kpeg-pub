import { ACCESSORIES, BACKGROUNDS, BREEDS, CLOTHES, EYES, MARKS, MOODS, MOUTHS } from "./traitRegistry.js";
import type { KPEGTraits } from "./types.js";

type PackedTraitsInput = bigint | number | string;

function toBigIntValue(packedTraits: PackedTraitsInput): bigint {
  if (typeof packedTraits === "bigint") {
    return packedTraits;
  }
  if (typeof packedTraits === "number") {
    if (!Number.isFinite(packedTraits) || packedTraits < 0 || !Number.isInteger(packedTraits)) {
      throw new Error(`Invalid packed traits number: ${packedTraits}`);
    }
    return BigInt(packedTraits);
  }
  if (typeof packedTraits === "string") {
    try {
      return BigInt(packedTraits);
    } catch {
      throw new Error(`Invalid packed traits string: ${packedTraits}`);
    }
  }
  throw new Error("Unsupported packed traits input type");
}

function traitIdAt(packed: bigint, shift: bigint): number {
  return Number((packed >> shift) & 0xffn);
}

function byId<T extends string>(groupName: string, traits: readonly T[], id: number): T {
  const value = traits[id];
  if (value === undefined) {
    throw new Error(`Packed trait id out of range for ${groupName}: ${id}`);
  }
  return value;
}

export function decodePackedTraits(packedTraits: PackedTraitsInput): KPEGTraits {
  const packed = toBigIntValue(packedTraits);
  return {
    background: byId("background", BACKGROUNDS, traitIdAt(packed, 0n)),
    breed: byId("breed", BREEDS, traitIdAt(packed, 8n)),
    clothes: byId("clothes", CLOTHES, traitIdAt(packed, 16n)),
    mood: byId("mood", MOODS, traitIdAt(packed, 24n)),
    marks: byId("marks", MARKS, traitIdAt(packed, 32n)),
    mouth: byId("mouth", MOUTHS, traitIdAt(packed, 40n)),
    eyes: byId("eyes", EYES, traitIdAt(packed, 48n)),
    accessory: byId("accessory", ACCESSORIES, traitIdAt(packed, 56n))
  };
}
