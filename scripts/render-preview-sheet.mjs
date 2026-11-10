import fs from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { BREEDS, renderKPEGSvg } from "../packages/core/dist/index.js";

const mode = process.argv[2];
const output = process.argv[3];

if (!mode || !output) {
  console.error("usage: node scripts/render-preview-sheet.mjs <mode> <output>");
  process.exit(1);
}

const BASE = {
  background: "Sky",
  breed: "American Shorthair",
  clothes: "Red Bandana",
  mood: "None",
  marks: "None",
  mouth: "Happy V",
  eyes: "Blue Eyes",
  accessory: "None"
};

function kittyForBreed(breed) {
  return { ...BASE, breed };
}

function modeTraits(kind, breed) {
  const kitty = kittyForBreed(breed);

  switch (kind) {
    case "eyes-blue":
      return { ...kitty, clothes: "None", mouth: "Stoic", eyes: "Blue Eyes" };
    case "mouth-happy":
      return { ...kitty, clothes: "None", mouth: "Happy V", eyes: "Happy ^_^" };
    case "bowtie":
      return { ...kitty, clothes: "Blue Bowtie", mouth: "Stoic", eyes: "Blue Eyes" };
    case "neckcharm":
      return { ...kitty, clothes: "Gold Collar", accessory: "Heart Charm", mouth: "Stoic", eyes: "Blue Eyes" };
    case "glasses":
      return { ...kitty, clothes: "None", accessory: "Round Glasses", mouth: "Stoic", eyes: "Blue Eyes" };
    case "helmet":
      return { ...kitty, clothes: "Space Helmet", accessory: "None", mouth: "Stoic", eyes: "Blue Eyes" };
    case "critical":
      return { ...kitty, clothes: "Red Bandana", accessory: "Gold Crown", mouth: "Tongue Out", eyes: "Blue Eyes" };
    default:
      throw new Error(`unknown mode ${kind}`);
  }
}

const cellWidth = 320;
const cellHeight = 290;
const columns = 4;
const rows = Math.ceil(BREEDS.length / columns);
const width = columns * cellWidth;
const height = rows * cellHeight;

let svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>`;
svg += "<rect width='100%' height='100%' fill='#111111'/>";

BREEDS.forEach((breed, index) => {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = column * cellWidth;
  const y = row * cellHeight;
  const artSvg = renderKPEGSvg(modeTraits(mode, breed));
  const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(artSvg)}`;

  svg += `<rect x='${x}' y='${y}' width='${cellWidth}' height='${cellHeight}' fill='#b9d4f1'/>`;
  svg += `<image href="${dataUri}" x='${x + 48}' y='${y + 20}' width='224' height='224' image-rendering='pixelated'/>`;
  svg += `<text x='${x + cellWidth / 2}' y='${y + 258}' text-anchor='middle' font-family='ui-sans-serif, system-ui, sans-serif' font-size='24' fill='#f4f4f4'>${breed}</text>`;
});

svg += "</svg>";

const png = new Resvg(svg, { background: "#111111" }).render().asPng();
fs.writeFileSync(output, png);
