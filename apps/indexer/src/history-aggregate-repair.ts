import { createPublicClient, defineChain, fallback, http, parseAbiItem, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import { compareChainEvents, getLogsInChunks, type ChainSyncConfig } from "./chain.js";
import type {
  KPEGRepository,
  MarketSaleRepairInput,
  OwnerKittyHistoryRepairInput,
  RepairJobState
} from "./repository.js";

export const HISTORY_AGGREGATE_REPAIR_JOB_NAME = "history-aggregates";
export const HISTORY_AGGREGATE_REPAIR_VERSION = 1;

type RepairEventKind =
  | "batch-mint"
  | "born-mint"
  | "batch-move"
  | "move"
  | "market-created"
  | "market-params"
  | "market-deleted"
  | "market-bought";

type RepairEvent = {
  kind: RepairEventKind;
  log: {
    blockNumber?: bigint;
    transactionIndex?: number;
    logIndex?: number;
    transactionHash?: `0x${string}`;
    args?: unknown;
  };
};

export type HistoryAggregateRepairRunResult = {
  job: RepairJobState;
  processedFromBlock: number | null;
  processedToBlock: number | null;
  scannedEventCount: number;
  ownerHistoryRows: number;
  marketSalesRows: number;
  finalized: boolean;
  skipped: boolean;
  reason?: string;
};

const KITTY_BATCH_MINTED_EVENT = parseAbiItem(
  "event KittyBatchMinted(address indexed owner, uint256 indexed startKittyId, uint256 count, uint8 tier, uint256 batchSizeWhole, bytes32 seedBase)"
);
const BORN_KPEG_MINTED_EVENT = parseAbiItem(
  "event BornKPEGMinted(address indexed owner, uint256 indexed kittyId, uint8 tier, bytes32 seedSalt, uint256 packedTraits)"
);
const KITTY_BATCH_MOVED_EVENT = parseAbiItem(
  "event KittyBatchMoved(address indexed from, address indexed to, uint256 indexed startKittyId, uint256 count)"
);
const KITTY_MOVED_EVENT = parseAbiItem(
  "event KittyMoved(uint256 indexed kittyId, address indexed from, address indexed to)"
);
const POSITION_CREATED_EVENT = parseAbiItem(
  "event PositionCreated(uint256 indexed tradeId, address indexed seller, address indexed escrowAddress, address paymentToken, uint256 price, uint256[] kittyIds, uint256 feeBps)"
);
const POSITION_DELETED_EVENT = parseAbiItem(
  "event PositionDeleted(uint256 indexed tradeId, address indexed seller)"
);
const POSITION_BOUGHT_EVENT = parseAbiItem(
  "event PositionBought(uint256 indexed tradeId, address indexed buyer, address indexed seller, uint256 price, uint256 feeAmount)"
);
const POSITION_PARAMS_SET_EVENT = parseAbiItem(
  "event PositionParamsSet(uint256 indexed tradeId, address indexed paymentToken, uint256 price)"
);

function buildClient(config: ChainSyncConfig) {
  const rpcUrls = [...new Set([config.rpcUrl, ...(config.rpcFallbackUrls ?? [])].filter(Boolean))];
  const chain =
    config.chainId === base.id
      ? base
      : config.chainId === baseSepolia.id
        ? baseSepolia
        : defineChain({
            id: config.chainId,
            name: `chain-${config.chainId}`,
            network: `chain-${config.chainId}`,
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: { default: { http: rpcUrls } }
          });
  return createPublicClient({
    chain,
    transport:
      rpcUrls.length > 1
        ? fallback(rpcUrls.map((url) => http(url)), { rank: true })
        : http(config.rpcUrl)
  });
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function startBlockForHistoryRepair(config: ChainSyncConfig): number {
  return Number.isInteger(config.startBlock) && (config.startBlock ?? 0) > 0
    ? (config.startBlock as number)
    : 1;
}

async function blockTimestampMs(
  client: ReturnType<typeof buildClient>,
  cache: Map<number, number>,
  blockNumber: number
): Promise<number> {
  const cached = cache.get(blockNumber);
  if (cached !== undefined) {
    return cached;
  }
  const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
  const timestampMs = Number(block.timestamp) * 1000;
  cache.set(blockNumber, timestampMs);
  return timestampMs;
}

export async function runHistoryAggregateRepairChunk(input: {
  repo: KPEGRepository;
  syncConfig: ChainSyncConfig;
  maxBlocksPerRun: number;
}): Promise<HistoryAggregateRepairRunResult> {
  const client = buildClient(input.syncConfig);
  const headBlock = Number(await client.getBlockNumber());
  const maxBlocks = Number.isInteger(input.maxBlocksPerRun) && input.maxBlocksPerRun > 0
    ? input.maxBlocksPerRun
    : 5_000;
  const job = await input.repo.ensureRepairJob({
    jobName: HISTORY_AGGREGATE_REPAIR_JOB_NAME,
    version: HISTORY_AGGREGATE_REPAIR_VERSION,
    fromBlock: startBlockForHistoryRepair(input.syncConfig),
    targetBlock: headBlock
  });

  if (job.status === "done") {
    return {
      job,
      processedFromBlock: null,
      processedToBlock: null,
      scannedEventCount: 0,
      ownerHistoryRows: 0,
      marketSalesRows: 0,
      finalized: false,
      skipped: true,
      reason: "already-done"
    };
  }

  let targetBlock = Math.max(job.targetBlock ?? headBlock, headBlock);
  const fromBlock = Math.max(job.nextBlock, job.fromBlock);
  if (fromBlock > targetBlock) {
    const finalizedJob = await input.repo.finalizeHistoryAggregateRepair(HISTORY_AGGREGATE_REPAIR_JOB_NAME);
    return {
      job: finalizedJob,
      processedFromBlock: null,
      processedToBlock: null,
      scannedEventCount: 0,
      ownerHistoryRows: 0,
      marketSalesRows: 0,
      finalized: true,
      skipped: true,
      reason: "already-caught-up"
    };
  }

  await input.repo.markRepairJobRunning(HISTORY_AGGREGATE_REPAIR_JOB_NAME);
  targetBlock = Math.max(targetBlock, fromBlock);
  const toBlock = Math.min(targetBlock, fromBlock + maxBlocks - 1);
  const fromBlockBigInt = BigInt(fromBlock);
  const toBlockBigInt = BigInt(toBlock);

  const marketAddress = input.syncConfig.marketAddress;
  const [
    batchMintLogs,
    bornMintLogs,
    batchMoveLogs,
    moveLogs,
    marketCreatedLogs,
    marketParamsLogs,
    marketDeletedLogs,
    marketBoughtLogs
  ] = await Promise.all([
    getLogsInChunks<RepairEvent["log"]>(client, {
      address: input.syncConfig.tokenAddress,
      event: KITTY_BATCH_MINTED_EVENT,
      fromBlock: fromBlockBigInt,
      toBlock: toBlockBigInt
    }),
    getLogsInChunks<RepairEvent["log"]>(client, {
      address: input.syncConfig.tokenAddress,
      event: BORN_KPEG_MINTED_EVENT,
      fromBlock: fromBlockBigInt,
      toBlock: toBlockBigInt
    }),
    getLogsInChunks<RepairEvent["log"]>(client, {
      address: input.syncConfig.tokenAddress,
      event: KITTY_BATCH_MOVED_EVENT,
      fromBlock: fromBlockBigInt,
      toBlock: toBlockBigInt
    }),
    getLogsInChunks<RepairEvent["log"]>(client, {
      address: input.syncConfig.tokenAddress,
      event: KITTY_MOVED_EVENT,
      fromBlock: fromBlockBigInt,
      toBlock: toBlockBigInt
    }),
    marketAddress
      ? getLogsInChunks<RepairEvent["log"]>(client, {
          address: marketAddress,
          event: POSITION_CREATED_EVENT,
          fromBlock: fromBlockBigInt,
          toBlock: toBlockBigInt
        })
      : Promise.resolve([]),
    marketAddress
      ? getLogsInChunks<RepairEvent["log"]>(client, {
          address: marketAddress,
          event: POSITION_PARAMS_SET_EVENT,
          fromBlock: fromBlockBigInt,
          toBlock: toBlockBigInt
        })
      : Promise.resolve([]),
    marketAddress
      ? getLogsInChunks<RepairEvent["log"]>(client, {
          address: marketAddress,
          event: POSITION_DELETED_EVENT,
          fromBlock: fromBlockBigInt,
          toBlock: toBlockBigInt
        })
      : Promise.resolve([]),
    marketAddress
      ? getLogsInChunks<RepairEvent["log"]>(client, {
          address: marketAddress,
          event: POSITION_BOUGHT_EVENT,
          fromBlock: fromBlockBigInt,
          toBlock: toBlockBigInt
        })
      : Promise.resolve([])
  ]);

  const orderedEvents = [
    ...batchMintLogs.map((log) => ({ kind: "batch-mint" as const, log })),
    ...bornMintLogs.map((log) => ({ kind: "born-mint" as const, log })),
    ...batchMoveLogs.map((log) => ({ kind: "batch-move" as const, log })),
    ...moveLogs.map((log) => ({ kind: "move" as const, log })),
    ...marketCreatedLogs.map((log) => ({ kind: "market-created" as const, log })),
    ...marketParamsLogs.map((log) => ({ kind: "market-params" as const, log })),
    ...marketDeletedLogs.map((log) => ({ kind: "market-deleted" as const, log })),
    ...marketBoughtLogs.map((log) => ({ kind: "market-bought" as const, log }))
  ].sort(compareChainEvents as (a: RepairEvent, b: RepairEvent) => number);

  const ownerRows: OwnerKittyHistoryRepairInput[] = [];
  const marketRows: MarketSaleRepairInput[] = [];
  const timestampCache = new Map<number, number>();

  for (const event of orderedEvents) {
    const blockNumber = event.log.blockNumber ? Number(event.log.blockNumber) : null;
    if (blockNumber === null) {
      continue;
    }
    if (event.kind === "batch-mint") {
      const args = event.log.args as { owner?: Address; startKittyId?: bigint; count?: bigint } | undefined;
      if (!args?.owner || args.startKittyId === undefined || args.count === undefined) {
        continue;
      }
      const firstSeenAt = await blockTimestampMs(client, timestampCache, blockNumber);
      for (let offset = 0n; offset < args.count; offset += 1n) {
        ownerRows.push({
          owner: normalizeAddress(String(args.owner)),
          kittyId: Number(args.startKittyId + offset),
          firstSeenAt
        });
      }
      continue;
    }
    if (event.kind === "born-mint") {
      const args = event.log.args as { owner?: Address; kittyId?: bigint } | undefined;
      if (!args?.owner || args.kittyId === undefined) {
        continue;
      }
      ownerRows.push({
        owner: normalizeAddress(String(args.owner)),
        kittyId: Number(args.kittyId),
        firstSeenAt: await blockTimestampMs(client, timestampCache, blockNumber)
      });
      continue;
    }
    if (event.kind === "batch-move") {
      const args = event.log.args as { to?: Address; startKittyId?: bigint; count?: bigint } | undefined;
      if (!args?.to || args.startKittyId === undefined || args.count === undefined) {
        continue;
      }
      const firstSeenAt = await blockTimestampMs(client, timestampCache, blockNumber);
      for (let offset = 0n; offset < args.count; offset += 1n) {
        ownerRows.push({
          owner: normalizeAddress(String(args.to)),
          kittyId: Number(args.startKittyId + offset),
          firstSeenAt
        });
      }
      continue;
    }
    if (event.kind === "move") {
      const args = event.log.args as { to?: Address; kittyId?: bigint } | undefined;
      if (!args?.to || args.kittyId === undefined) {
        continue;
      }
      ownerRows.push({
        owner: normalizeAddress(String(args.to)),
        kittyId: Number(args.kittyId),
        firstSeenAt: await blockTimestampMs(client, timestampCache, blockNumber)
      });
      continue;
    }
    if (event.kind === "market-bought") {
      const args = event.log.args as
        | { tradeId?: bigint; buyer?: Address; seller?: Address; price?: bigint; feeAmount?: bigint }
        | undefined;
      if (
        !args ||
        args.tradeId === undefined ||
        !args.buyer ||
        !args.seller ||
        args.price === undefined ||
        args.feeAmount === undefined ||
        !event.log.transactionHash
      ) {
        continue;
      }
      marketRows.push({
        tradeId: Number(args.tradeId),
        seller: normalizeAddress(String(args.seller)),
        buyer: normalizeAddress(String(args.buyer)),
        priceWei: args.price.toString(),
        feeWei: args.feeAmount.toString(),
        soldBlock: blockNumber,
        soldTxHash: event.log.transactionHash,
        soldAt: await blockTimestampMs(client, timestampCache, blockNumber)
      });
    }
  }

  await input.repo.appendOwnerKittyHistoryRepair(ownerRows);
  await input.repo.upsertMarketSalesRepair(marketRows);

  const nextBlock = toBlock + 1;
  if (nextBlock > targetBlock) {
    const finalizedJob = await input.repo.finalizeHistoryAggregateRepair(HISTORY_AGGREGATE_REPAIR_JOB_NAME);
    return {
      job: finalizedJob,
      processedFromBlock: fromBlock,
      processedToBlock: toBlock,
      scannedEventCount: orderedEvents.length,
      ownerHistoryRows: ownerRows.length,
      marketSalesRows: marketRows.length,
      finalized: true,
      skipped: false
    };
  }
  const progressJob = await input.repo.updateRepairJobProgress({
    jobName: HISTORY_AGGREGATE_REPAIR_JOB_NAME,
    nextBlock,
    targetBlock,
    done: false
  });
  return {
    job: progressJob,
    processedFromBlock: fromBlock,
    processedToBlock: toBlock,
    scannedEventCount: orderedEvents.length,
    ownerHistoryRows: ownerRows.length,
    marketSalesRows: marketRows.length,
    finalized: false,
    skipped: false
  };
}
