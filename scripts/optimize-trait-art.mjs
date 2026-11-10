import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const TRAIT_SOURCE_PATH = path.join(ROOT, "docs", "traits", "traits.json");
const COLOR_STEP = 16;

function quantizeChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value / COLOR_STEP) * COLOR_STEP));
}

function quantizeColor(color) {
  if (color === null) {
    return null;
  }
  const red = quantizeChannel(Number.parseInt(color.slice(1, 3), 16));
  const green = quantizeChannel(Number.parseInt(color.slice(3, 5), 16));
  const blue = quantizeChannel(Number.parseInt(color.slice(5, 7), 16));
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function main() {
  const source = JSON.parse(fs.readFileSync(TRAIT_SOURCE_PATH, "utf8"));
  let changedPixels = 0;

  for (const group of Object.values(source.layers)) {
    for (const layer of Object.values(group)) {
      layer.pixels = layer.pixels.map((row) =>
        row.map((pixel) => {
          const next = quantizeColor(pixel);
          if (next !== pixel) {
            changedPixels += 1;
          }
          return next;
        })
      );
    }
  }

  source.optimization = {
    colorStep: COLOR_STEP,
    purpose: "Reduce antialias/color noise while preserving 32x32 pixel positions and basic colors."
  };
  source.savedAt = new Date().toISOString();

  fs.writeFileSync(TRAIT_SOURCE_PATH, `${JSON.stringify(source, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ path: path.relative(ROOT, TRAIT_SOURCE_PATH), colorStep: COLOR_STEP, changedPixels }, null, 2));
}

main();
