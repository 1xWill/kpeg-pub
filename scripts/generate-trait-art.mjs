import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CANVAS_SIZE = 32;
const TRAIT_SOURCE_PATH = path.join(ROOT, "docs", "traits", "traits.json");
const SOURCE_FRAGMENT_CHAR_LIMIT = 14_000;
const SOURCE_CONTRACT_SOURCE_BYTE_LIMIT = 24_000;
const SOURCE_CONTRACT_NAME_PREFIX = "KPEGArtSource";
const PACKING_CONTRACT_NAME_PLACEHOLDER = `${SOURCE_CONTRACT_NAME_PREFIX}999`;

const GROUPS = [
  {
    key: "backgrounds",
    items: ["White", "Sky", "Mint", "Coral", "Lilac", "Midnight"]
  },
  {
    key: "breeds",
    items: [
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
    ]
  },
  {
    key: "clothes",
    items: [
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
    ]
  },
  {
    key: "moods",
    items: [
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
    ]
  },
  {
    key: "marks",
    items: ["None", "Blush", "Cream Muzzle", "Tiny Scar"]
  },
  {
    key: "mouths",
    items: [
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
    ]
  },
  {
    key: "eyes",
    items: [
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
    ]
  },
  {
    key: "accessories",
    items: [
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
    ]
  }
];

const GROUP_ORDER = new Map(GROUPS.map((group, index) => [group.key, index]));

function readTraitSource() {
  if (!fs.existsSync(TRAIT_SOURCE_PATH)) {
    throw new Error(`Missing ${path.relative(ROOT, TRAIT_SOURCE_PATH)} before generating art`);
  }
  const source = JSON.parse(fs.readFileSync(TRAIT_SOURCE_PATH, "utf8"));
  if (source.version !== 1 || !source.layers || typeof source.layers !== "object") {
    throw new Error("Trait source must be version 1 with a layers object");
  }
  return source;
}

function assertPixelGrid(groupKey, item, grid) {
  if (!Array.isArray(grid) || grid.length !== CANVAS_SIZE) {
    throw new Error(`Trait source ${groupKey}/${item} must have ${CANVAS_SIZE} rows`);
  }
  return grid.map((row, y) => {
    if (!Array.isArray(row) || row.length !== CANVAS_SIZE) {
      throw new Error(`Trait source ${groupKey}/${item} row ${y} must have ${CANVAS_SIZE} cells`);
    }
    return row.map((cell, x) => {
      if (cell === null) {
        return null;
      }
      if (typeof cell !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(cell)) {
        throw new Error(`Trait source ${groupKey}/${item} cell ${x}:${y} must be null or #RRGGBB`);
      }
      return cell.toUpperCase();
    });
  });
}

function traitPixels(source, groupKey, item) {
  const layer = source.layers?.[groupKey]?.[item];
  if (!layer) {
    throw new Error(`Missing trait layer ${groupKey}/${item}`);
  }
  return assertPixelGrid(groupKey, item, layer.pixels);
}

function svgPathForRun(run) {
  return `M${run.x} ${run.y}.5h${run.width}`;
}

function svgPathTag(color, pathData) {
  return `<path stroke='${color}' stroke-width='1' stroke-linecap='butt' fill='none' d='${pathData}'/>`;
}

function encodeLayer(pixels) {
  const palette = [];
  const paletteIndex = new Map();
  const runs = [];

  for (let y = 0; y < CANVAS_SIZE; y += 1) {
    let x = 0;
    while (x < CANVAS_SIZE) {
      const color = pixels[y][x];
      if (!color) {
        x += 1;
        continue;
      }

      let width = 1;
      while (x + width < CANVAS_SIZE && pixels[y][x + width] === color) {
        width += 1;
      }

      if (!paletteIndex.has(color)) {
        paletteIndex.set(color, palette.length);
        palette.push(color);
      }

      const colorIndex = paletteIndex.get(color);
      runs.push(x, y, width, Math.floor(colorIndex / 256), colorIndex % 256);
      x += width;
    }
  }

  return {
    paletteHex: palette.map((color) => color.slice(1)).join(""),
    runsHex: Buffer.from(runs).toString("hex").toUpperCase(),
    palette,
    runCount: runs.length / 5
  };
}

function buildArtManifest() {
  const source = readTraitSource();
  const manifest = {};
  for (const group of GROUPS) {
    manifest[group.key] = group.items.map((item) => encodeLayer(traitPixels(source, group.key, item)));
  }
  return manifest;
}

function solidityContract(contractName, svgFragments) {
  const branches = svgFragments
    .map((svgFragment, index) => `        if (index == ${index}) return "${svgFragment}";`)
    .join("\n");
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract ${contractName} {
    function svg(uint8 index) external pure returns (string memory) {
${branches}
        return "";
    }
}
`;
}

function hexToBytes(hex) {
  const out = [];
  for (let index = 0; index < hex.length; index += 2) {
    out.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return out;
}

function layerSvgPathFragments(entry) {
  if (!entry.paletteHex || !entry.runsHex) {
    return [""];
  }

  const paletteBytes = hexToBytes(entry.paletteHex);
  const runBytes = hexToBytes(entry.runsHex);
  const fragments = [];

  let pathByColor = new Map();
  let fragmentLength = 0;

  const colorForIndex = (colorIndex) => {
    const paletteOffset = colorIndex * 3;
    return `#${paletteBytes[paletteOffset].toString(16).padStart(2, "0")}${paletteBytes[paletteOffset + 1]
      .toString(16)
      .padStart(2, "0")}${paletteBytes[paletteOffset + 2].toString(16).padStart(2, "0")}`.toUpperCase();
  };

  const flushFragment = () => {
    if (pathByColor.size === 0) {
      return;
    }
    let out = "";
    for (const [color, pathData] of pathByColor.entries()) {
      out += svgPathTag(color, pathData);
    }
    fragments.push(out);
    pathByColor = new Map();
    fragmentLength = 0;
  };

  for (let offset = 0; offset < runBytes.length; offset += 5) {
    const run = {
      x: runBytes[offset],
      y: runBytes[offset + 1],
      width: runBytes[offset + 2]
    };
    const colorIndex = runBytes[offset + 3] * 256 + runBytes[offset + 4];
    const color = colorForIndex(colorIndex);
    const segment = svgPathForRun(run);
    const newColorOverhead = pathByColor.has(color) ? 0 : svgPathTag(color, "").length;
    const addedLength = segment.length + newColorOverhead;

    if (fragmentLength > 0 && fragmentLength + addedLength > SOURCE_FRAGMENT_CHAR_LIMIT) {
      flushFragment();
    }

    pathByColor.set(color, `${pathByColor.get(color) ?? ""}${segment}`);
    fragmentLength += addedLength;
  }
  flushFragment();

  return fragments;
}

function sourceContractBytes(svgFragments, contractName = PACKING_CONTRACT_NAME_PLACEHOLDER) {
  return Buffer.byteLength(solidityContract(contractName, svgFragments), "utf8");
}

function createFragmentRecords(manifest) {
  const layerRecordsByGroup = {};
  const fragmentRecords = [];
  let nextId = 0;

  for (const group of GROUPS) {
    layerRecordsByGroup[group.key] = manifest[group.key].map((entry, layerIndex) =>
      layerSvgPathFragments(entry).map((svgFragment, fragmentIndex) => {
        const record = {
          id: nextId,
          groupKey: group.key,
          layerIndex,
          fragmentIndex,
          svgFragment
        };
        nextId += 1;
        fragmentRecords.push(record);
        return record;
      })
    );
  }

  return {
    layerRecordsByGroup,
    fragmentRecords
  };
}

function parseContractFragments(source) {
  const matches = [...source.matchAll(/if \(index == (\d+)\) return "([^"]*)";/g)];
  if (matches.length === 0) {
    throw new Error("Generated source contract is missing indexed svg branches");
  }

  const maxIndex = Math.max(...matches.map((match) => Number.parseInt(match[1], 10)));
  const fragments = Array.from({ length: maxIndex + 1 }, () => "");
  for (const match of matches) {
    fragments[Number.parseInt(match[1], 10)] = match[2];
  }
  return fragments;
}

function loadPreviousGeneratedState() {
  const contractsDir = path.join(ROOT, "contracts", "src", "generated");
  const manifestPath = path.join(contractsDir, "artSourceManifest.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const artSourceManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const contractFragmentsByName = {};
  for (const entry of fs.readdirSync(contractsDir)) {
    if (!/^KPEGArtSource\d+\.sol$/.test(entry)) {
      continue;
    }
    const contractName = entry.replace(/\.sol$/, "");
    contractFragmentsByName[contractName] = parseContractFragments(
      fs.readFileSync(path.join(contractsDir, entry), "utf8")
    );
  }

  return {
    artSourceManifest,
    contractFragmentsByName
  };
}

function compareFragmentRecords(a, b) {
  const sizeDelta = b.svgFragment.length - a.svgFragment.length;
  if (sizeDelta !== 0) {
    return sizeDelta;
  }

  const groupDelta = (GROUP_ORDER.get(a.groupKey) ?? 0) - (GROUP_ORDER.get(b.groupKey) ?? 0);
  if (groupDelta !== 0) {
    return groupDelta;
  }

  if (a.layerIndex !== b.layerIndex) {
    return a.layerIndex - b.layerIndex;
  }

  return a.fragmentIndex - b.fragmentIndex;
}

function findBestFitBinIndex(bins, record) {
  let bestIndex = -1;
  let bestSize = -1;

  for (let index = 0; index < bins.length; index += 1) {
    const candidate = bins[index];
    const nextSize = sourceContractBytes([...candidate.fragments, record.svgFragment]);
    if (nextSize > SOURCE_CONTRACT_SOURCE_BYTE_LIMIT) {
      continue;
    }
    if (nextSize > bestSize) {
      bestIndex = index;
      bestSize = nextSize;
    }
  }

  return { bestIndex, bestSize };
}

function compactBins(bins) {
  let changed = true;

  while (changed) {
    changed = false;
    bins.sort((a, b) => a.sizeBytes - b.sizeBytes || a.records.length - b.records.length);

    for (let sourceIndex = 0; sourceIndex < bins.length; sourceIndex += 1) {
      const source = bins[sourceIndex];
      const sourceRecords = [...source.records].sort(compareFragmentRecords);
      const targetBins = bins
        .filter((_, index) => index !== sourceIndex)
        .map((bin) => ({
          fragments: [...bin.fragments],
          records: [...bin.records],
          sizeBytes: bin.sizeBytes
        }));

      let canMoveAll = true;

      for (const record of sourceRecords) {
        const { bestIndex, bestSize } = findBestFitBinIndex(targetBins, record);
        if (bestIndex === -1) {
          canMoveAll = false;
          break;
        }
        targetBins[bestIndex].fragments.push(record.svgFragment);
        targetBins[bestIndex].records.push(record);
        targetBins[bestIndex].sizeBytes = bestSize;
      }

      if (canMoveAll) {
        bins.splice(0, bins.length, ...targetBins);
        changed = true;
        break;
      }
    }
  }
}

function packFragmentRecords(fragmentRecords) {
  const bins = [];
  const sortedRecords = [...fragmentRecords].sort(compareFragmentRecords);

  for (const record of sortedRecords) {
    const { bestIndex, bestSize } = findBestFitBinIndex(bins, record);
    if (bestIndex === -1) {
      bins.push({
        fragments: [record.svgFragment],
        records: [record],
        sizeBytes: sourceContractBytes([record.svgFragment])
      });
      continue;
    }

    bins[bestIndex].fragments.push(record.svgFragment);
    bins[bestIndex].records.push(record);
    bins[bestIndex].sizeBytes = bestSize;
  }

  compactBins(bins);
  bins.sort((a, b) => b.sizeBytes - a.sizeBytes || a.records.length - b.records.length);
  return bins;
}

function tryPreservePackedArtSources(manifest) {
  const previous = loadPreviousGeneratedState();
  if (!previous) {
    return null;
  }

  const { layerRecordsByGroup } = createFragmentRecords(manifest);
  const nextManifest = {};
  const nextFragmentsByContract = Object.fromEntries(
    Object.entries(previous.contractFragmentsByName).map(([contractName, fragments]) => [
      contractName,
      [...fragments]
    ])
  );

  for (const group of GROUPS) {
    const previousLayers = previous.artSourceManifest[group.key];
    if (!Array.isArray(previousLayers) || previousLayers.length !== layerRecordsByGroup[group.key].length) {
      return null;
    }

    nextManifest[group.key] = [];
    for (let layerIndex = 0; layerIndex < layerRecordsByGroup[group.key].length; layerIndex += 1) {
      const previousRefs = previousLayers[layerIndex];
      const layerRecords = layerRecordsByGroup[group.key][layerIndex];
      if (!Array.isArray(previousRefs) || previousRefs.length !== layerRecords.length) {
        return null;
      }

      nextManifest[group.key][layerIndex] = previousRefs;
      for (let fragmentIndex = 0; fragmentIndex < layerRecords.length; fragmentIndex += 1) {
        const ref = previousRefs[fragmentIndex];
        const fragments = nextFragmentsByContract[ref.contractName];
        if (!fragments || ref.index >= fragments.length) {
          return null;
        }
        fragments[ref.index] = layerRecords[fragmentIndex].svgFragment;
      }
    }
  }

  const contractEntries = Object.entries(nextFragmentsByContract)
    .map(([contractName, fragments]) => ({
      contractName,
      fragments,
      sourceBytes: sourceContractBytes(fragments, contractName)
    }))
    .sort((a, b) => {
      const aIndex = Number.parseInt(a.contractName.slice(SOURCE_CONTRACT_NAME_PREFIX.length), 10);
      const bIndex = Number.parseInt(b.contractName.slice(SOURCE_CONTRACT_NAME_PREFIX.length), 10);
      return aIndex - bIndex;
    });

  if (contractEntries.some((entry) => entry.sourceBytes > SOURCE_CONTRACT_SOURCE_BYTE_LIMIT)) {
    return null;
  }

  return {
    artSourceManifest: nextManifest,
    contractEntries
  };
}

function buildPackedArtSources(manifest) {
  const preserved = tryPreservePackedArtSources(manifest);
  if (preserved) {
    return preserved;
  }

  const { layerRecordsByGroup, fragmentRecords } = createFragmentRecords(manifest);
  const packedBins = packFragmentRecords(fragmentRecords);
  const contractEntries = packedBins.map((bin, index) => {
    const contractName = `${SOURCE_CONTRACT_NAME_PREFIX}${index}`;
    return {
      contractName,
      fragments: bin.fragments,
      records: bin.records,
      sourceBytes: sourceContractBytes(bin.fragments, contractName)
    };
  });

  const refsByRecordId = new Map();
  for (const contract of contractEntries) {
    for (let index = 0; index < contract.records.length; index += 1) {
      refsByRecordId.set(contract.records[index].id, {
        contractName: contract.contractName,
        index
      });
    }
  }

  const artSourceManifest = {};
  for (const group of GROUPS) {
    artSourceManifest[group.key] = layerRecordsByGroup[group.key].map((layer) =>
      layer.map((record) => refsByRecordId.get(record.id))
    );
  }

  return {
    artSourceManifest,
    contractEntries
  };
}

function tsManifest(manifest) {
  const lines = [];
  lines.push("export const KPEG_CANVAS_SIZE = 32;");
  lines.push("");
  lines.push("export const KPEG_LAYER_ART = {");

  for (const group of GROUPS) {
    lines.push(`  ${group.key}: [`);
    for (const entry of manifest[group.key]) {
      lines.push(`    { paletteHex: "${entry.paletteHex}", runsHex: "${entry.runsHex}" },`);
    }
    lines.push("  ],");
  }

  lines.push("} as const;");
  lines.push("");
  lines.push("export type KPEGLayerGroup = keyof typeof KPEG_LAYER_ART;");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const manifest = buildArtManifest();
  const { artSourceManifest, contractEntries } = buildPackedArtSources(manifest);

  const tsOutPath = path.join(ROOT, "packages", "core", "src", "generated", "traitArt.ts");
  fs.mkdirSync(path.dirname(tsOutPath), { recursive: true });
  fs.writeFileSync(tsOutPath, tsManifest(manifest), "utf8");

  const contractsDir = path.join(ROOT, "contracts", "src", "generated");
  fs.rmSync(contractsDir, { recursive: true, force: true });
  fs.mkdirSync(contractsDir, { recursive: true });
  for (const contract of contractEntries) {
    const contractPath = path.join(contractsDir, `${contract.contractName}.sol`);
    fs.writeFileSync(contractPath, solidityContract(contract.contractName, contract.fragments), "utf8");
  }
  fs.writeFileSync(
    path.join(contractsDir, "artSourceManifest.json"),
    `${JSON.stringify(artSourceManifest, null, 2)}\n`,
    "utf8"
  );

  const summary = GROUPS.map((group) => ({
    group: group.key,
    layers: manifest[group.key].length,
    runs: manifest[group.key].reduce((total, entry) => total + entry.runCount, 0),
    referencedSourceContracts: new Set(artSourceManifest[group.key].flat().map((source) => source.contractName)).size,
    sourceRefs: artSourceManifest[group.key].flat().length
  }));

  console.log(
    JSON.stringify(
      {
        canvas: CANVAS_SIZE,
        source: "docs/traits/traits.json",
        sourceFragmentCharLimit: SOURCE_FRAGMENT_CHAR_LIMIT,
        sourceContractSourceByteLimit: SOURCE_CONTRACT_SOURCE_BYTE_LIMIT,
        totalUniqueSourceContracts: contractEntries.length,
        largestSourceContractBytes: Math.max(...contractEntries.map((contract) => contract.sourceBytes)),
        summary
      },
      null,
      2
    )
  );
}

main();
