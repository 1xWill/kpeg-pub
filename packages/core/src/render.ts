import { ACCESSORIES, BACKGROUNDS, BREEDS, CLOTHES, EYES, MARKS, MOODS, MOUTHS } from "./traitRegistry.js";
import {
  isAccessoryAllowed,
  isBackgroundAllowedForBreed,
  isClothesAllowedForBreed,
  isMarkAllowed,
  isMoodAllowed,
  isMouthAllowedForBreed
} from "./compatibility.js";
import { KPEG_LAYER_ART } from "./generated/traitArt.js";
import { type GeneratedKPEG, type KPEGTraits } from "./types.js";

type TraitPreviewKey = keyof KPEGTraits;

const CANONICAL_TRAITS: KPEGTraits = {
  background: "Sky",
  breed: "American Shorthair",
  clothes: "Red Bandana",
  mood: "None",
  marks: "None",
  mouth: "Happy V",
  eyes: "Blue Eyes",
  accessory: "None"
};

const byteCache = new Map<string, Uint8Array>();
const layerCache = new Map<string, string>();

function assertDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

function hexToBytes(hex: string): Uint8Array {
  const cached = byteCache.get(hex);
  if (cached) {
    return cached;
  }

  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    out[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  byteCache.set(hex, out);
  return out;
}

function layerSvg(paletteHex: string, runsHex: string): string {
  const cacheKey = `${paletteHex}:${runsHex}`;
  const cached = layerCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const paletteBytes = hexToBytes(paletteHex);
  const runBytes = hexToBytes(runsHex);
  let out = "";

  for (let offset = 0; offset < runBytes.length; offset += 5) {
    const x = assertDefined(runBytes[offset], `Missing x byte at ${offset}`);
    const y = assertDefined(runBytes[offset + 1], `Missing y byte at ${offset + 1}`);
    const width = assertDefined(runBytes[offset + 2], `Missing width byte at ${offset + 2}`);
    const colorIndex =
      (assertDefined(runBytes[offset + 3], `Missing color index high byte at ${offset + 3}`) * 256 +
        assertDefined(runBytes[offset + 4], `Missing color index low byte at ${offset + 4}`)) *
      3;
    const red = assertDefined(paletteBytes[colorIndex], `Missing red palette byte at ${colorIndex}`);
    const green = assertDefined(paletteBytes[colorIndex + 1], `Missing green palette byte at ${colorIndex + 1}`);
    const blue = assertDefined(paletteBytes[colorIndex + 2], `Missing blue palette byte at ${colorIndex + 2}`);
    const color = `#${red.toString(16).padStart(2, "0")}${green
      .toString(16)
      .padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`.toUpperCase();
    out += `<rect x='${x}' y='${y}' width='${width}' height='1' fill='${color}'/>`;
  }

  layerCache.set(cacheKey, out);
  return out;
}

function renderWithTraits(traits: KPEGTraits): string {
  const background = assertDefined(
    KPEG_LAYER_ART.backgrounds[BACKGROUNDS.indexOf(traits.background)],
    `Unknown background layer: ${traits.background}`
  );
  const mood = assertDefined(KPEG_LAYER_ART.moods[MOODS.indexOf(traits.mood)], `Unknown mood layer: ${traits.mood}`);
  const breed = assertDefined(KPEG_LAYER_ART.breeds[BREEDS.indexOf(traits.breed)], `Unknown breed layer: ${traits.breed}`);
  const clothes = assertDefined(
    KPEG_LAYER_ART.clothes[CLOTHES.indexOf(traits.clothes)],
    `Unknown clothes layer: ${traits.clothes}`
  );
  const marks = assertDefined(KPEG_LAYER_ART.marks[MARKS.indexOf(traits.marks)], `Unknown marks layer: ${traits.marks}`);
  const mouth = assertDefined(KPEG_LAYER_ART.mouths[MOUTHS.indexOf(traits.mouth)], `Unknown mouth layer: ${traits.mouth}`);
  const eyes = assertDefined(KPEG_LAYER_ART.eyes[EYES.indexOf(traits.eyes)], `Unknown eyes layer: ${traits.eyes}`);
  const accessory = assertDefined(
    KPEG_LAYER_ART.accessories[ACCESSORIES.indexOf(traits.accessory)],
    `Unknown accessory layer: ${traits.accessory}`
  );

  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' shape-rendering='crispEdges'>${layerSvg(
    background.paletteHex,
    background.runsHex
  )}${traits.mood === "Sweat Drop" ? "" : layerSvg(mood.paletteHex, mood.runsHex)}${layerSvg(
    breed.paletteHex,
    breed.runsHex
  )}${traits.mood === "Sweat Drop" ? layerSvg(mood.paletteHex, mood.runsHex) : ""}${layerSvg(clothes.paletteHex, clothes.runsHex)}${layerSvg(
    marks.paletteHex,
    marks.runsHex
  )}${layerSvg(
    mouth.paletteHex,
    mouth.runsHex
  )}${layerSvg(eyes.paletteHex, eyes.runsHex)}${layerSvg(accessory.paletteHex, accessory.runsHex)}</svg>`;
}

function previewTraits(key: TraitPreviewKey, value: string): KPEGTraits {
  const next: KPEGTraits = { ...CANONICAL_TRAITS, [key]: value } as KPEGTraits;

  if (!isClothesAllowedForBreed(next.breed, next.clothes)) {
    next.clothes = "None";
  }
  if (!isMouthAllowedForBreed(next.breed, next.mouth)) {
    next.mouth = "Stoic";
  }
  if (next.clothes === "Space Helmet") {
    next.accessory = "None";
    next.marks = "None";
  }
  if (!isAccessoryAllowed(next.clothes, next.accessory, next.breed)) {
    next.accessory = "None";
  }
  if (!isMarkAllowed(next.clothes, next.marks, next.breed)) {
    next.marks = "None";
  }
  if (!isBackgroundAllowedForBreed(next.breed, next.background)) {
    next.background = "Sky";
  }
  if (!isMoodAllowed(next.mood, next.mouth, next.background)) {
    next.mood = "None";
  }
  return next;
}

export function renderKPEGSvg(traits: KPEGTraits): string {
  return renderWithTraits(traits);
}

export function renderKPEGSvgDataUri(traits: KPEGTraits): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(renderKPEGSvg(traits))}`;
}

export function renderGeneratedKPEGSvg(kitty: Pick<GeneratedKPEG, "traits"> & { id?: number }): string {
  return renderKPEGSvg(kitty.traits);
}

export function renderKPEGTraitPreviewSvg(key: TraitPreviewKey, value: string): string {
  return renderWithTraits(previewTraits(key, value));
}
