import { ethers, network } from "hardhat";
import {
  computeGlobalRarity,
  decodePackedTraits,
  generateKPEGFromOnchainEntropy,
  TIER_LABELS,
  type Tier
} from "@kpeg/core";
import { readDeployment } from "./lib";

type TransferByTierArgs = {
  receiver: string;
  tier: Tier;
  limit?: number;
  batchSize: number;
  dryRun: boolean;
  logChunkSize: number;
};

type MintMeta = {
  id: bigint;
  mintTier: Tier;
  rarityTier: Tier;
  rarityTierLabel: string;
};

type BatchMintLog = {
  args: {
    owner: string;
    startKittyId: bigint;
    count: bigint;
    tier: bigint;
    batchSizeWhole: bigint;
    seedBase: string;
  };
};

type BornMintLog = {
  args: {
    owner: string;
    kittyId: bigint;
    tier: bigint;
    seedSalt: string;
    packedTraits: bigint;
  };
};

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_LOG_CHUNK_SIZE = 50_000;
const MINT_EVENT_ABI = [
  "event KittyBatchMinted(address indexed owner,uint256 indexed startKittyId,uint256 count,uint8 tier,uint256 batchSizeWhole,bytes32 seedBase)",
  "event BornKPEGMinted(address indexed owner,uint256 indexed kittyId,uint8 tier,bytes32 seedSalt,uint256 packedTraits)"
];

function readOption(name: string): string | undefined {
  const prefixed = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefixed));
  if (inline) {
    return inline.slice(prefixed.length);
  }

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) {
    return process.argv[index + 1];
  }

  return undefined;
}

function readValue(name: string): string | undefined {
  return readOption(name) ?? process.env[`KPEG_TRANSFER_KITTIES_${name.toUpperCase().replaceAll("-", "_")}`];
}

function requireValue(name: string): string {
  const value = readValue(name);
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

function parseTier(value: string): Tier {
  const normalized = value.trim().toLowerCase();
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 4) {
    return numeric as Tier;
  }

  const index = TIER_LABELS.findIndex((label) => label.toLowerCase() === normalized);
  if (index < 0) {
    throw new Error(`Invalid --tier ${value}. Use one of: 0-4, ${TIER_LABELS.join(", ")}`);
  }
  return index as Tier;
}

function parsePositiveInteger(name: string, fallback: number): number {
  const raw = readValue(name);
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

function parseArgs(): TransferByTierArgs {
  const receiver = requireValue("receiver");
  if (!ethers.isAddress(receiver)) {
    throw new Error("--receiver must be a valid address");
  }

  const limitRaw = readValue("limit");
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  return {
    receiver,
    tier: parseTier(requireValue("tier")),
    ...(limit === undefined ? {} : { limit }),
    batchSize: parsePositiveInteger("batch-size", DEFAULT_BATCH_SIZE),
    dryRun: process.argv.includes("--dry-run") || process.env.KPEG_TRANSFER_KITTIES_DRY_RUN === "1",
    logChunkSize: parsePositiveInteger("log-chunk-size", DEFAULT_LOG_CHUNK_SIZE)
  };
}

function topicForUint256(value: bigint): string {
  return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}

function rangeContainsOwnedId(ownedSet: Set<string>, startKittyId: bigint, count: bigint): boolean {
  for (let offset = 0n; offset < count; offset += 1n) {
    if (ownedSet.has((startKittyId + offset).toString())) {
      return true;
    }
  }
  return false;
}

function metaFromBatch(input: {
  kittyId: bigint;
  mintTier: Tier;
  batchSizeWhole: bigint;
  seedBase: string;
}): MintMeta {
  const seed = ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "uint256", "uint8", "uint256"],
      [input.seedBase, input.kittyId, input.mintTier, input.batchSizeWhole]
    )
  );
  const entropy = BigInt(
    ethers.keccak256(ethers.solidityPacked(["bytes32", "uint256", "uint8"], [seed, input.kittyId, input.mintTier]))
  );
  const generated = generateKPEGFromOnchainEntropy({
    seed,
    tier: input.mintTier,
    entropy
  });
  return {
    id: input.kittyId,
    mintTier: generated.mintTier,
    rarityTier: generated.kpegTier,
    rarityTierLabel: generated.kpegTierLabel
  };
}

function metaFromBorn(input: { kittyId: bigint; mintTier: Tier; packedTraits: bigint }): MintMeta {
  const rarity = computeGlobalRarity({
    traits: decodePackedTraits(input.packedTraits.toString()),
    mintTier: input.mintTier
  });
  return {
    id: input.kittyId,
    mintTier: input.mintTier,
    rarityTier: rarity.tier,
    rarityTierLabel: rarity.tierLabel
  };
}

async function readMintMetadata(input: {
  token: ethers.Contract;
  fromBlock: number;
  toBlock: number;
  ownedIds: bigint[];
  chunkSize: number;
}): Promise<Map<string, MintMeta>> {
  const ownedSet = new Set(input.ownedIds.map((id) => id.toString()));
  const byId = new Map<string, MintMeta>();
  const iface = new ethers.Interface(MINT_EVENT_ABI);
  const batchFilter = input.token.filters.KittyBatchMinted();
  const bornFilter = input.token.filters.BornKPEGMinted();

  for (let from = input.fromBlock; from <= input.toBlock; from += input.chunkSize) {
    const to = Math.min(input.toBlock, from + input.chunkSize - 1);
    console.log(`Scanning mint logs ${from}-${to} (${byId.size}/${input.ownedIds.length} owned kitties resolved)`);
    const [batchLogs, bornLogs] = await Promise.all([
      input.token.queryFilter(batchFilter, from, to),
      input.token.queryFilter(bornFilter, from, to)
    ]);

    for (const log of batchLogs) {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data }) as BatchMintLog | null;
      if (!parsed) {
        continue;
      }
      const { startKittyId, count, tier, batchSizeWhole, seedBase } = parsed.args;
      if (!rangeContainsOwnedId(ownedSet, startKittyId, count)) {
        continue;
      }
      const mintTier = Number(tier) as Tier;
      for (let offset = 0n; offset < count; offset += 1n) {
        const kittyId = startKittyId + offset;
        if (!ownedSet.has(kittyId.toString())) {
          continue;
        }
        byId.set(
          kittyId.toString(),
          metaFromBatch({
            kittyId,
            mintTier,
            batchSizeWhole,
            seedBase
          })
        );
      }
    }

    for (const log of bornLogs) {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data }) as BornMintLog | null;
      if (!parsed) {
        continue;
      }
      const { kittyId, tier, packedTraits } = parsed.args;
      if (!ownedSet.has(kittyId.toString())) {
        continue;
      }
      byId.set(
        kittyId.toString(),
        metaFromBorn({
          kittyId,
          mintTier: Number(tier) as Tier,
          packedTraits
        })
      );
    }

    if (byId.size >= input.ownedIds.length) {
      break;
    }
  }

  return byId;
}

async function main() {
  const [sender] = await ethers.getSigners();
  if (!sender) {
    throw new Error("Sender private key is required for this network");
  }

  const args = parseArgs();
  const deployment = await readDeployment(network.name);
  const token = await ethers.getContractAt("KPEGToken", deployment.token, sender);
  const senderAddress = await sender.getAddress();

  console.log(`Reading owned kitty ids for ${senderAddress}`);
  const ownedIds = Array.from(await token.getOwnerKitties(senderAddress), (id) => BigInt(id)).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  console.log(`Found ${ownedIds.length} owned kitty id(s)`);

  if (ownedIds.length === 0) {
    console.log(
      JSON.stringify(
        {
          network: network.name,
          token: deployment.token,
          sender: senderAddress,
          receiver: args.receiver,
          tier: TIER_LABELS[args.tier],
          ownedKitties: 0,
          resolvedKitties: 0,
          missingMetadataCount: 0,
          missingMetadataIds: [],
          tierCounts: Object.fromEntries(TIER_LABELS.map((label) => [label, 0])),
          selectedCount: 0,
          selectedIds: [],
          dryRun: args.dryRun
        },
        null,
        2
      )
    );
    return;
  }

  const latestBlock = await ethers.provider.getBlockNumber();
  const fromBlock = deployment.tokenDeploymentBlock ?? 0;
  const mintMetaById = await readMintMetadata({
    token,
    fromBlock,
    toBlock: latestBlock,
    ownedIds,
    chunkSize: args.logChunkSize
  });

  const matching: MintMeta[] = [];
  const missing: string[] = [];
  const tierCounts = new Map<string, number>();

  for (const id of ownedIds) {
    const meta = mintMetaById.get(id.toString());
    if (!meta) {
      missing.push(id.toString());
      continue;
    }
    tierCounts.set(meta.rarityTierLabel, (tierCounts.get(meta.rarityTierLabel) ?? 0) + 1);
    if (meta.rarityTier === args.tier) {
      matching.push(meta);
    }
  }

  matching.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const selected = args.limit === undefined ? matching : matching.slice(0, args.limit);
  const selectedIds = selected.map((kitty) => kitty.id);

  console.log(
    JSON.stringify(
      {
        network: network.name,
        token: deployment.token,
        sender: senderAddress,
        receiver: args.receiver,
        tier: TIER_LABELS[args.tier],
        ownedKitties: ownedIds.length,
        resolvedKitties: mintMetaById.size,
        missingMetadataCount: missing.length,
        missingMetadataIds: missing.slice(0, 20),
        tierCounts: Object.fromEntries(TIER_LABELS.map((label) => [label, tierCounts.get(label) ?? 0])),
        selectedCount: selectedIds.length,
        selectedIds: selectedIds.map((id) => id.toString()),
        dryRun: args.dryRun
      },
      null,
      2
    )
  );

  if (missing.length > 0) {
    throw new Error(
      `Could not resolve mint metadata for ${missing.length} owned kitty id(s). Try a smaller --log-chunk-size or verify tokenDeploymentBlock.`
    );
  }

  if (selectedIds.length === 0 || args.dryRun) {
    return;
  }

  for (let start = 0; start < selectedIds.length; start += args.batchSize) {
    const batch = selectedIds.slice(start, start + args.batchSize);
    const tx = await token.directTransferKittiesList(args.receiver, batch);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`transfer batch failed: ${tx.hash}`);
    }
    console.log(
      JSON.stringify(
        {
          batchStart: start,
          batchCount: batch.length,
          kittyIds: batch.map((id) => id.toString()),
          txHash: tx.hash
        },
        null,
        2
      )
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
