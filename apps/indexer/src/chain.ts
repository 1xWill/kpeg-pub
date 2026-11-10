import { createPublicClient, defineChain, encodePacked, fallback, http, keccak256, parseAbiItem, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import { KPEG_TOKEN_ABI, decodePackedTraits, generateKPEGFromOnchainEntropy } from "@kpeg/core";
import type { KPEGRepository, SyncFailurePhase } from "./repository.js";

export type ChainSyncConfig = {
  rpcUrl: string;
  rpcFallbackUrls?: string[];
  tokenAddress: Address;
  marketAddress?: Address | undefined;
  breedingAddress?: Address | undefined;
  chainId: number;
  startBlock?: number;
  deployedAtHint?: string;
  maxBlocksPerRun?: number;
  targetBlock?: number;
};

export type ChainSyncRunResult = {
  latestIndexedBlock: number;
  headBlock: number;
  tokenBalanceIndexedBlock?: number;
  fromBlock?: number;
  toBlock?: number;
  tokenBalanceFromBlock?: number;
  tokenBalanceToBlock?: number;
  targetReached?: boolean;
};

type ChainLog = {
  blockNumber?: bigint;
  transactionIndex?: number;
  logIndex?: number;
};

type ChainEvent<T = unknown> = {
  kind:
    | "batch-mint"
    | "born-mint"
    | "batch-burn"
    | "batch-move"
    | "move"
    | "market-created"
    | "market-deleted"
    | "market-bought"
    | "market-params"
    | "breeding-pool-created"
    | "breeding-pool-joined"
    | "breeding-pool-left"
    | "breeding-cycle-reset"
    | "breeding-settled"
    | "breeding-lineage"
    | "breeding-cooldown-set"
    | "breeding-claimed"
    | "breeding-backing-staked"
    | "breeding-backing-withdrawn"
    | "breeding-backing-consumed"
    | "breeding-backing-promoted";
  log: ChainLog & {
    args?: T;
    transactionHash?: `0x${string}`;
    blockNumber?: bigint;
  };
};

type SyncFailureReporter = (input: {
  phase: SyncFailurePhase;
  fromBlock?: number | null;
  toBlock?: number | null;
  eventKind?: string | null;
  txHash?: string | null;
  logIndex?: number | null;
  error: string;
}) => Promise<void>;

class ChainSyncFailure extends Error {
  constructor(
    readonly detail: {
      phase: SyncFailurePhase;
      fromBlock: number | null;
      toBlock: number | null;
      eventKind: string | null;
      txHash: string | null;
      logIndex: number | null;
      error: string;
    }
  ) {
    super(formatChainSyncFailure(detail));
  }
}

export type IndexedTransactionCheck = {
  trusted: boolean;
  blockNumber?: number;
};

type LogClient = {
  getLogs: (params: Record<string, unknown>) => Promise<unknown[]>;
};

type LogQuery = Record<string, unknown> & {
  fromBlock: bigint;
  toBlock: bigint;
};

const LOG_RANGE_LIMIT = 5_000n;

const KITTY_BATCH_MINTED_EVENT = parseAbiItem(
  "event KittyBatchMinted(address indexed owner, uint256 indexed startKittyId, uint256 count, uint8 tier, uint256 batchSizeWhole, bytes32 seedBase)"
);
const BORN_KPEG_MINTED_EVENT = parseAbiItem(
  "event BornKPEGMinted(address indexed owner, uint256 indexed kittyId, uint8 tier, bytes32 seedSalt, uint256 packedTraits)"
);
const KITTY_BATCH_BURNED_EVENT = parseAbiItem(
  "event KittyBatchBurned(address indexed owner, uint256 indexed startKittyId, uint256 count)"
);
const KITTY_BATCH_MOVED_EVENT = parseAbiItem(
  "event KittyBatchMoved(address indexed from, address indexed to, uint256 indexed startKittyId, uint256 count)"
);
const KITTY_MOVED_EVENT = parseAbiItem(
  "event KittyMoved(uint256 indexed kittyId, address indexed from, address indexed to)"
);
const TOKEN_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 amount)"
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
const BREEDING_POOL_CREATED_EVENT = parseAbiItem(
  "event BreedingPoolCreated(uint256 indexed poolId, address indexed host, uint8 poolType, uint256 parentA, uint256 parentB, uint64 cycleStartedAt, uint16 cycleDays, uint8 filterCount, uint8[5] filterGroups, uint8[5] filterTraits)"
);
const BREEDING_POOL_JOINED_EVENT = parseAbiItem(
  "event BreedingPoolJoined(uint256 indexed poolId, address indexed joiner, uint256 parentB, uint64 cycleStartedAt, uint16 cycleDays)"
);
const BREEDING_POOL_LEFT_EVENT = parseAbiItem(
  "event BreedingPoolLeft(uint256 indexed poolId, address indexed account, uint256 returnedParentA, uint256 returnedParentB, uint8 nextStatus)"
);
const BREEDING_CYCLE_RESET_EVENT = parseAbiItem(
  "event BreedingCycleReset(uint256 indexed poolId, uint64 cycleStartedAt, uint16 cycleDays, uint8 status)"
);
const BREEDING_SETTLED_EVENT = parseAbiItem(
  "event BreedingSettled(uint256 indexed poolId, uint8 result, uint8 childTier, uint256 childKittyId, uint256 claimId, address childOwner, bytes32 childSeedSalt, uint256 childPackedTraits)"
);
const BREEDING_LINEAGE_EVENT = parseAbiItem(
  "event BreedingLineage(uint256 indexed childKittyId, uint256 indexed parentA, uint256 indexed parentB, uint256 poolId, address childOwner)"
);
const BREEDING_COOLDOWN_SET_EVENT = parseAbiItem(
  "event BreedingCooldownSet(uint256 indexed parentId, uint64 cooldownUntil)"
);
const BREEDING_CLAIMED_EVENT = parseAbiItem(
  "event BreedingClaimed(uint256 indexed claimId, uint256 indexed poolId, uint256 indexed childKittyId, address owner)"
);
const BREEDING_BACKING_STAKED_EVENT = parseAbiItem(
  "event BreedingBackingStaked(uint256 indexed poolId, address indexed provider, uint256 indexed backingKittyId, uint8 side, bool queued)"
);
const BREEDING_BACKING_WITHDRAWN_EVENT = parseAbiItem(
  "event BreedingBackingWithdrawn(uint256 indexed poolId, address indexed provider, uint256 indexed backingKittyId, uint8 side, bool queued)"
);
const BREEDING_BACKING_CONSUMED_EVENT = parseAbiItem(
  "event BreedingBackingConsumed(uint256 indexed poolId, address indexed provider, uint256 indexed backingKittyId, uint8 side)"
);
const BREEDING_BACKING_PROMOTED_EVENT = parseAbiItem(
  "event BreedingBackingPromoted(uint256 indexed poolId, address indexed provider, uint256 indexed backingKittyId, uint8 side)"
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
            rpcUrls: {
              default: { http: rpcUrls }
            }
          });
  return createPublicClient({
    chain,
    transport:
      rpcUrls.length > 1
        ? fallback(rpcUrls.map((url) => http(url)), { rank: true })
        : http(config.rpcUrl)
  });
}

export async function readChainHeadBlock(config: ChainSyncConfig): Promise<number> {
  return Number(await buildClient(config).getBlockNumber());
}

export async function readOnchainKittyCounts(
  config: ChainSyncConfig,
  blockNumber?: bigint
): Promise<{ blockNumber: number; kittiesLive: number; kittiesEverMinted: number }> {
  const client = buildClient(config);
  const snapshotBlock = blockNumber ?? (await client.getBlockNumber());
  const [kittiesLiveRaw, kittiesEverMintedRaw] = await Promise.all([
    client.readContract({
      address: config.tokenAddress,
      abi: KPEG_TOKEN_ABI,
      functionName: "kittiesLive",
      blockNumber: snapshotBlock
    }),
    client.readContract({
      address: config.tokenAddress,
      abi: KPEG_TOKEN_ABI,
      functionName: "kittiesEverMinted",
      blockNumber: snapshotBlock
    })
  ]);
  return {
    blockNumber: Number(snapshotBlock),
    kittiesLive: Number(kittiesLiveRaw),
    kittiesEverMinted: Number(kittiesEverMintedRaw)
  };
}

export async function getLogsInChunks<TEvent extends { args?: unknown }>(
  client: LogClient,
  params: LogQuery,
  rangeLimit: bigint = LOG_RANGE_LIMIT
): Promise<TEvent[]> {
  const fromBlock = params.fromBlock;
  const toBlock = params.toBlock;
  const logs: TEvent[] = [];

  for (let start = fromBlock; start <= toBlock; start += rangeLimit) {
    const end = start + rangeLimit - 1n;
    const chunk = await client.getLogs({
      ...params,
      fromBlock: start,
      toBlock: end < toBlock ? end : toBlock
    });
    logs.push(...(chunk as unknown as TEvent[]));
  }

  return logs;
}

function compareChainLogs(a: ChainLog, b: ChainLog): number {
  const aBlock = a.blockNumber ?? 0n;
  const bBlock = b.blockNumber ?? 0n;
  if (aBlock !== bBlock) {
    return aBlock < bBlock ? -1 : 1;
  }
  if (a.transactionIndex !== b.transactionIndex) {
    return (a.transactionIndex ?? 0) - (b.transactionIndex ?? 0);
  }
  return (a.logIndex ?? 0) - (b.logIndex ?? 0);
}

function eventPriority(event: ChainEvent): number {
  if (event.kind === "batch-move" || event.kind === "move") {
    return 0;
  }
  if (event.kind.startsWith("market-")) {
    return 1;
  }
  return 0;
}

export function compareChainEvents(a: ChainEvent, b: ChainEvent): number {
  const base = compareChainLogs(a.log, b.log);
  if (base !== 0) {
    if (
      a.log.transactionHash &&
      a.log.transactionHash === b.log.transactionHash &&
      (a.kind.startsWith("market-") || b.kind.startsWith("market-"))
    ) {
      const priority = eventPriority(a) - eventPriority(b);
      if (priority !== 0) {
        return priority;
      }
    }
    return base;
  }
  return eventPriority(a) - eventPriority(b);
}

function formatChainSyncFailure(detail: {
  phase: SyncFailurePhase;
  fromBlock: number | null;
  toBlock: number | null;
  eventKind: string | null;
  txHash: string | null;
  logIndex: number | null;
  error: string;
}): string {
  return [
    `chain sync failed during ${detail.phase}`,
    detail.fromBlock === null ? null : `from=${detail.fromBlock}`,
    detail.toBlock === null ? null : `to=${detail.toBlock}`,
    detail.eventKind === null ? null : `event=${detail.eventKind}`,
    detail.txHash === null ? null : `tx=${detail.txHash}`,
    detail.logIndex === null ? null : `logIndex=${detail.logIndex}`,
    `cause=${detail.error}`
  ]
    .filter(Boolean)
    .join(" ");
}

async function reportChainSyncFailure(
  reportFailure: SyncFailureReporter | undefined,
  failure: ChainSyncFailure
): Promise<never> {
  await reportFailure?.(failure.detail);
  throw failure;
}

async function estimateStartBlockFromTimestamp(
  client: ReturnType<typeof buildClient>,
  deployedAtHint: string
): Promise<bigint> {
  const targetTimestampSec = Math.floor(new Date(deployedAtHint).getTime() / 1000);
  if (!Number.isFinite(targetTimestampSec) || targetTimestampSec <= 0) {
    return 1n;
  }

  let low = 0n;
  let high = await client.getBlockNumber();

  while (low < high) {
    const mid = (low + high) / 2n;
    const block = await client.getBlock({ blockNumber: mid });
    if (Number(block.timestamp) < targetTimestampSec) {
      low = mid + 1n;
    } else {
      high = mid;
    }
  }

  return low > 1_000n ? low - 1_000n : 1n;
}

export async function runSingleChainSync(
  repo: KPEGRepository,
  config: ChainSyncConfig,
  reportFailure?: SyncFailureReporter
): Promise<ChainSyncRunResult> {
  const client = buildClient(config);
  const latestIndexedBlock = await repo.getLatestIndexedBlock();
  const headBlock = await client.getBlockNumber();
  const hasTargetBlock = Number.isInteger(config.targetBlock) && config.targetBlock! > 0;
  const syncHeadBlock =
    hasTargetBlock && BigInt(config.targetBlock!) < headBlock
      ? BigInt(config.targetBlock!)
      : headBlock;
  const latestTokenBalanceIndexedBlock = await repo.getLatestTokenBalanceIndexedBlock();
  const configuredStartBlock =
    config.startBlock && config.startBlock > 0
      ? BigInt(config.startBlock)
      : (latestIndexedBlock === 0 || latestTokenBalanceIndexedBlock === 0) && config.deployedAtHint
        ? await estimateStartBlockFromTimestamp(client, config.deployedAtHint)
        : 1n;
  if (
    latestIndexedBlock >= Number(syncHeadBlock) &&
    latestTokenBalanceIndexedBlock >= Number(syncHeadBlock)
  ) {
    return {
      latestIndexedBlock,
      headBlock: Number(headBlock),
      tokenBalanceIndexedBlock: latestTokenBalanceIndexedBlock,
      ...(hasTargetBlock ? { targetReached: true } : {})
    };
  }
  const fromBlock = BigInt(Math.max(latestIndexedBlock + 1, Number(configuredStartBlock)));
  const tokenBalanceFromBlock = BigInt(
    Math.max(latestTokenBalanceIndexedBlock + 1, Number(configuredStartBlock))
  );
  const maxBlocks =
    Number.isInteger(config.maxBlocksPerRun) && config.maxBlocksPerRun! > 0
      ? BigInt(config.maxBlocksPerRun!)
      : null;
  const toBlock =
    maxBlocks && fromBlock + maxBlocks - 1n < syncHeadBlock
      ? fromBlock + maxBlocks - 1n
      : syncHeadBlock;
  const tokenBalanceToBlock =
    maxBlocks && tokenBalanceFromBlock + maxBlocks - 1n < syncHeadBlock
      ? tokenBalanceFromBlock + maxBlocks - 1n
      : syncHeadBlock;
  const hasMainRange = toBlock >= fromBlock;
  const hasTokenBalanceRange = tokenBalanceToBlock >= tokenBalanceFromBlock;
  const failureContext = async (input: {
    phase: SyncFailurePhase;
    fromBlock?: number | null;
    toBlock?: number | null;
    eventKind?: string | null;
    txHash?: string | null;
    logIndex?: number | null;
    error: unknown;
  }): Promise<never> => {
    const cause = input.error instanceof Error ? input.error.message : String(input.error);
    throw new ChainSyncFailure({
      phase: input.phase,
      fromBlock: input.fromBlock ?? null,
      toBlock: input.toBlock ?? null,
      eventKind: input.eventKind ?? null,
      txHash: input.txHash ?? null,
      logIndex: input.logIndex ?? null,
      error: cause
    });
  };
  const receiptCache = new Map<string, Awaited<ReturnType<typeof client.getTransactionReceipt>>>();
  const blockCache = new Map<string, Awaited<ReturnType<typeof client.getBlock>>>();
  let tokenTransferLogs: ChainEvent["log"][] = [];
  try {
    tokenTransferLogs = await getLogsInChunks<ChainEvent["log"]>(client, {
      address: config.tokenAddress,
      event: TOKEN_TRANSFER_EVENT,
      fromBlock: tokenBalanceFromBlock,
      toBlock: tokenBalanceToBlock
    });
  } catch (error) {
    await failureContext({
      phase: "token-transfer-log-read",
      fromBlock: Number(tokenBalanceFromBlock),
      toBlock: Number(tokenBalanceToBlock),
      error
    });
  }

  let batchMintLogs: ChainEvent["log"][] = [];
  let batchBurnLogs: ChainEvent["log"][] = [];
  let batchMoveLogs: ChainEvent["log"][] = [];
  let moveLogs: ChainEvent["log"][] = [];
  let bornMintLogs: ChainEvent["log"][] = [];
  let marketCreatedLogs: ChainEvent["log"][] = [];
  let marketDeletedLogs: ChainEvent["log"][] = [];
  let marketBoughtLogs: ChainEvent["log"][] = [];
  let marketParamsLogs: ChainEvent["log"][] = [];
  let breedingPoolCreatedLogs: ChainEvent["log"][] = [];
  let breedingPoolJoinedLogs: ChainEvent["log"][] = [];
  let breedingPoolLeftLogs: ChainEvent["log"][] = [];
  let breedingCycleResetLogs: ChainEvent["log"][] = [];
  let breedingSettledLogs: ChainEvent["log"][] = [];
  let breedingLineageLogs: ChainEvent["log"][] = [];
  let breedingCooldownLogs: ChainEvent["log"][] = [];
  let breedingClaimedLogs: ChainEvent["log"][] = [];
  let breedingBackingStakedLogs: ChainEvent["log"][] = [];
  let breedingBackingWithdrawnLogs: ChainEvent["log"][] = [];
  let breedingBackingConsumedLogs: ChainEvent["log"][] = [];
  let breedingBackingPromotedLogs: ChainEvent["log"][] = [];
  try {
    batchMintLogs = await getLogsInChunks<ChainEvent["log"]>(client, {
      address: config.tokenAddress,
      event: KITTY_BATCH_MINTED_EVENT,
      fromBlock,
      toBlock
    });

    batchBurnLogs = await getLogsInChunks<ChainEvent["log"]>(client, {
      address: config.tokenAddress,
      event: KITTY_BATCH_BURNED_EVENT,
      fromBlock,
      toBlock
    });

    batchMoveLogs = await getLogsInChunks<ChainEvent["log"]>(client, {
      address: config.tokenAddress,
      event: KITTY_BATCH_MOVED_EVENT,
      fromBlock,
      toBlock
    });

    moveLogs = await getLogsInChunks<ChainEvent["log"]>(client, {
      address: config.tokenAddress,
      event: KITTY_MOVED_EVENT,
      fromBlock,
      toBlock
    });
    bornMintLogs = await getLogsInChunks<ChainEvent["log"]>(client, {
      address: config.tokenAddress,
      event: BORN_KPEG_MINTED_EVENT,
      fromBlock,
      toBlock
    });

    marketCreatedLogs = config.marketAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.marketAddress,
          event: POSITION_CREATED_EVENT,
          fromBlock,
          toBlock
        })
      : [];
    marketDeletedLogs = config.marketAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.marketAddress,
          event: POSITION_DELETED_EVENT,
          fromBlock,
          toBlock
        })
      : [];
    marketBoughtLogs = config.marketAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.marketAddress,
          event: POSITION_BOUGHT_EVENT,
          fromBlock,
          toBlock
        })
      : [];
    marketParamsLogs = config.marketAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.marketAddress,
          event: POSITION_PARAMS_SET_EVENT,
          fromBlock,
          toBlock
        })
      : [];

    breedingPoolCreatedLogs = config.breedingAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.breedingAddress,
          event: BREEDING_POOL_CREATED_EVENT,
          fromBlock,
          toBlock
        })
      : [];
    breedingPoolJoinedLogs = config.breedingAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.breedingAddress,
          event: BREEDING_POOL_JOINED_EVENT,
          fromBlock,
          toBlock
        })
      : [];
    breedingPoolLeftLogs = config.breedingAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.breedingAddress,
          event: BREEDING_POOL_LEFT_EVENT,
          fromBlock,
          toBlock
        })
      : [];
    breedingCycleResetLogs = config.breedingAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.breedingAddress,
          event: BREEDING_CYCLE_RESET_EVENT,
          fromBlock,
          toBlock
        })
      : [];
    breedingSettledLogs = config.breedingAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.breedingAddress,
          event: BREEDING_SETTLED_EVENT,
          fromBlock,
          toBlock
        })
      : [];
    breedingLineageLogs = config.breedingAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.breedingAddress,
          event: BREEDING_LINEAGE_EVENT,
          fromBlock,
          toBlock
        })
      : [];
    breedingCooldownLogs = config.breedingAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.breedingAddress,
          event: BREEDING_COOLDOWN_SET_EVENT,
          fromBlock,
          toBlock
        })
      : [];
    breedingClaimedLogs = config.breedingAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.breedingAddress,
          event: BREEDING_CLAIMED_EVENT,
          fromBlock,
          toBlock
        })
      : [];
    breedingBackingStakedLogs = config.breedingAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.breedingAddress,
          event: BREEDING_BACKING_STAKED_EVENT,
          fromBlock,
          toBlock
        })
      : [];
    breedingBackingWithdrawnLogs = config.breedingAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.breedingAddress,
          event: BREEDING_BACKING_WITHDRAWN_EVENT,
          fromBlock,
          toBlock
        })
      : [];
    breedingBackingConsumedLogs = config.breedingAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.breedingAddress,
          event: BREEDING_BACKING_CONSUMED_EVENT,
          fromBlock,
          toBlock
        })
      : [];
    breedingBackingPromotedLogs = config.breedingAddress
      ? await getLogsInChunks<ChainEvent["log"]>(client, {
          address: config.breedingAddress,
          event: BREEDING_BACKING_PROMOTED_EVENT,
          fromBlock,
          toBlock
        })
      : [];
  } catch (error) {
    await failureContext({
      phase: "main-log-read",
      fromBlock: Number(fromBlock),
      toBlock: Number(toBlock),
      error
    });
  }

  const tokenTransferInputs = tokenTransferLogs
    .map((log) => {
      const args = log.args as
        | { from?: Address; to?: Address; amount?: bigint }
        | undefined;
      if (!args?.from || !args.to || args.amount === undefined || !log.blockNumber) {
        return null;
      }
      return {
        from: String(args.from),
        to: String(args.to),
        amountWei: args.amount.toString(),
        blockNumber: Number(log.blockNumber)
      };
    })
    .filter((input): input is NonNullable<typeof input> => Boolean(input));

  const orderedEvents: ChainEvent[] = [
    ...batchMintLogs.map((log) => ({ kind: "batch-mint" as const, log })),
    ...bornMintLogs.map((log) => ({ kind: "born-mint" as const, log })),
    ...batchBurnLogs.map((log) => ({ kind: "batch-burn" as const, log })),
    ...batchMoveLogs.map((log) => ({ kind: "batch-move" as const, log })),
    ...moveLogs.map((log) => ({ kind: "move" as const, log })),
    ...marketCreatedLogs.map((log) => ({ kind: "market-created" as const, log })),
    ...marketDeletedLogs.map((log) => ({ kind: "market-deleted" as const, log })),
    ...marketBoughtLogs.map((log) => ({ kind: "market-bought" as const, log })),
    ...marketParamsLogs.map((log) => ({ kind: "market-params" as const, log })),
    ...breedingPoolCreatedLogs.map((log) => ({ kind: "breeding-pool-created" as const, log })),
    ...breedingPoolJoinedLogs.map((log) => ({ kind: "breeding-pool-joined" as const, log })),
    ...breedingPoolLeftLogs.map((log) => ({ kind: "breeding-pool-left" as const, log })),
    ...breedingCycleResetLogs.map((log) => ({ kind: "breeding-cycle-reset" as const, log })),
    ...breedingSettledLogs.map((log) => ({ kind: "breeding-settled" as const, log })),
    ...breedingLineageLogs.map((log) => ({ kind: "breeding-lineage" as const, log })),
    ...breedingCooldownLogs.map((log) => ({ kind: "breeding-cooldown-set" as const, log })),
    ...breedingClaimedLogs.map((log) => ({ kind: "breeding-claimed" as const, log })),
    ...breedingBackingStakedLogs.map((log) => ({ kind: "breeding-backing-staked" as const, log })),
    ...breedingBackingWithdrawnLogs.map((log) => ({ kind: "breeding-backing-withdrawn" as const, log })),
    ...breedingBackingConsumedLogs.map((log) => ({ kind: "breeding-backing-consumed" as const, log })),
    ...breedingBackingPromotedLogs.map((log) => ({ kind: "breeding-backing-promoted" as const, log }))
  ].sort(compareChainEvents);

  const applyMainEvent = async (event: ChainEvent): Promise<void> => {
    const log = event.log;
    if (event.kind === "batch-mint") {
      const args = log.args as
        | {
            owner?: Address;
            startKittyId?: bigint;
            count?: bigint;
            tier?: number;
            batchSizeWhole?: bigint;
            seedBase?: `0x${string}`;
          }
        | undefined;
      if (
        !args ||
        !args.owner ||
        args.startKittyId === undefined ||
        args.count === undefined ||
        args.tier === undefined ||
        args.batchSizeWhole === undefined ||
        !args.seedBase ||
        !log.transactionHash ||
        !log.blockNumber
      ) {
        return;
      }
      const txHash = String(log.transactionHash) as `0x${string}`;
      const blockNumber = log.blockNumber;
      const [receipt, block] = await Promise.all([
        receiptCache.get(txHash) ??
          client.getTransactionReceipt({ hash: txHash }).then((value) => {
            receiptCache.set(txHash, value);
            return value;
          }),
        blockCache.get(blockNumber.toString()) ??
          client.getBlock({ blockNumber }).then((value) => {
            blockCache.set(blockNumber.toString(), value);
            return value;
          })
      ]);
      const startKittyId = args.startKittyId;
      const count = args.count;
      const mintInputs = [];
      for (let offset = 0n; offset < count; offset += 1n) {
        const kittyId = startKittyId + offset;
        const seed = keccak256(
          encodePacked(
            ["bytes32", "uint256", "uint8", "uint256"],
            [args.seedBase, kittyId, Number(args.tier), args.batchSizeWhole]
          )
        );
        const entropy = BigInt(
          keccak256(encodePacked(["bytes32", "uint256", "uint8"], [seed, kittyId, Number(args.tier)]))
        );
        const generated = generateKPEGFromOnchainEntropy({
          seed,
          tier: Number(args.tier) as 0 | 1 | 2 | 3 | 4,
          entropy
        });
        mintInputs.push({
          kittyId: Number(kittyId),
          owner: String(args.owner),
          mintedBy: String(args.owner),
          tier: Number(args.tier) as 0 | 1 | 2 | 3 | 4,
          batchSizeWhole: Number(args.batchSizeWhole),
          seed,
          blockNumber: Number(blockNumber),
          txHash,
          mintedAt: Number(block.timestamp) * 1000,
          gasUsed: Number(receipt.gasUsed),
          baseFeeWei: block.baseFeePerGas?.toString() ?? null,
          traits: generated.traits
        });
      }
      await repo.ingestMintEvents(mintInputs);
    } else if (event.kind === "born-mint") {
      const args = log.args as { kittyId?: bigint; packedTraits?: bigint } | undefined;
      if (!args || args.kittyId === undefined || args.packedTraits === undefined || !log.transactionHash || !log.blockNumber) {
        return;
      }
      await repo.applyBornMintTraits({
        kittyId: Number(args.kittyId),
        traits: decodePackedTraits(args.packedTraits),
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash
      });
      // Lineage source is still indexed from BreedingLineage events emitted by KPEGBreeding.
      return;
    } else if (event.kind === "batch-burn") {
      const args = log.args as { startKittyId?: bigint; count?: bigint; owner?: Address } | undefined;
      if (!args || args.startKittyId === undefined || args.count === undefined || !args.owner || !log.blockNumber) {
        return;
      }
      await repo.ingestBurnRange({
        startKittyId: Number(args.startKittyId),
        count: Number(args.count),
        owner: String(args.owner),
        blockNumber: Number(log.blockNumber)
      });
    } else if (event.kind === "batch-move") {
      const args = log.args as { startKittyId?: bigint; count?: bigint; from?: Address; to?: Address } | undefined;
      if (!args || args.startKittyId === undefined || args.count === undefined || !args.from || !args.to || !log.blockNumber) {
        return;
      }
      await repo.ingestMoveRange({
        startKittyId: Number(args.startKittyId),
        count: Number(args.count),
        from: String(args.from),
        to: String(args.to),
        blockNumber: Number(log.blockNumber)
      });
    } else if (event.kind === "move") {
      const args = log.args as { kittyId?: bigint; from?: Address; to?: Address } | undefined;
      if (!args || args.kittyId === undefined || !args.from || !args.to || !log.blockNumber) {
        return;
      }
      await repo.ingestMoveEvent({
        kittyId: Number(args.kittyId),
        from: String(args.from),
        to: String(args.to),
        blockNumber: Number(log.blockNumber)
      });
    } else if (event.kind === "market-created") {
      const args = log.args as
        | {
            tradeId?: bigint;
            seller?: Address;
            escrowAddress?: Address;
            paymentToken?: Address;
            price?: bigint;
            kittyIds?: readonly bigint[];
            feeBps?: bigint;
          }
        | undefined;
      if (
        !args ||
        args.tradeId === undefined ||
        !args.seller ||
        !args.escrowAddress ||
        !args.paymentToken ||
        args.price === undefined ||
        !args.kittyIds ||
        args.feeBps === undefined ||
        !log.transactionHash ||
        !log.blockNumber
      ) {
        return;
      }
      const block =
        blockCache.get(log.blockNumber.toString()) ??
        (await client.getBlock({ blockNumber: log.blockNumber }).then((value) => {
          blockCache.set(log.blockNumber!.toString(), value);
          return value;
        }));
      await repo.ingestMarketPositionCreated({
        tradeId: Number(args.tradeId),
        seller: String(args.seller),
        escrowAddress: String(args.escrowAddress),
        paymentToken: String(args.paymentToken),
        priceWei: args.price.toString(),
        feeBps: Number(args.feeBps),
        kittyIds: args.kittyIds.map((kittyId) => Number(kittyId)),
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        createdAt: Number(block!.timestamp) * 1000
      });
    } else if (event.kind === "market-deleted") {
      const args = log.args as { tradeId?: bigint; seller?: Address } | undefined;
      if (!args || args.tradeId === undefined || !args.seller || !log.transactionHash || !log.blockNumber) {
        return;
      }
      const block =
        blockCache.get(log.blockNumber.toString()) ??
        (await client.getBlock({ blockNumber: log.blockNumber }).then((value) => {
          blockCache.set(log.blockNumber!.toString(), value);
          return value;
        }));
      await repo.ingestMarketPositionDeleted({
        tradeId: Number(args.tradeId),
        seller: String(args.seller),
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        closedAt: Number(block!.timestamp) * 1000
      });
    } else if (event.kind === "market-bought") {
      const args = log.args as
        | { tradeId?: bigint; buyer?: Address; seller?: Address; price?: bigint; feeAmount?: bigint }
        | undefined;
      if (
        !args ||
        args.tradeId === undefined ||
        !args.buyer ||
        !args.seller ||
        args.price === undefined ||
        args.feeAmount === undefined ||
        !log.transactionHash ||
        !log.blockNumber
      ) {
        return;
      }
      const block =
        blockCache.get(log.blockNumber.toString()) ??
        (await client.getBlock({ blockNumber: log.blockNumber }).then((value) => {
          blockCache.set(log.blockNumber!.toString(), value);
          return value;
        }));
      await repo.ingestMarketPositionBought({
        tradeId: Number(args.tradeId),
        buyer: String(args.buyer),
        seller: String(args.seller),
        priceWei: args.price.toString(),
        feeWei: args.feeAmount.toString(),
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        soldAt: Number(block!.timestamp) * 1000
      });
    } else if (event.kind === "market-params") {
      const args = log.args as { tradeId?: bigint; paymentToken?: Address; price?: bigint } | undefined;
      if (!args || args.tradeId === undefined || !args.paymentToken || args.price === undefined) {
        return;
      }
      await repo.ingestMarketPositionParams({
        tradeId: Number(args.tradeId),
        paymentToken: String(args.paymentToken),
        priceWei: args.price.toString()
      });
    } else if (event.kind === "breeding-pool-created") {
      const args = log.args as
        | {
            poolId?: bigint;
            host?: Address;
            poolType?: number;
            parentA?: bigint;
            parentB?: bigint;
            cycleStartedAt?: bigint;
            cycleDays?: number;
            filterCount?: number;
            filterGroups?: readonly number[];
            filterTraits?: readonly number[];
          }
        | undefined;
      if (!args || args.poolId === undefined || !args.host || args.poolType === undefined || !log.transactionHash || !log.blockNumber) {
        return;
      }
      const filterCount = args.filterCount === undefined ? 0 : Number(args.filterCount);
      const filterGroups = (args.filterGroups ?? []).map((value) => Number(value)).slice(0, 5);
      const filterTraits = (args.filterTraits ?? []).map((value) => Number(value)).slice(0, 5);
      await repo.ingestBreedingEvent({
        eventKind: "POOL_CREATED",
        poolId: Number(args.poolId),
        poolType: Number(args.poolType),
        host: String(args.host),
        parentAKittyId: args.parentA === undefined ? null : Number(args.parentA),
        parentBKittyId: args.parentB === undefined ? null : Number(args.parentB),
        cycleStartedAt: args.cycleStartedAt === undefined ? null : Number(args.cycleStartedAt),
        cycleDays: args.cycleDays === undefined ? null : Number(args.cycleDays),
        filterCount,
        filterGroups,
        filterTraits,
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        logIndex: log.logIndex ?? 0,
        payload: {
          poolType: Number(args.poolType),
          parentA: args.parentA === undefined ? null : Number(args.parentA),
          parentB: args.parentB === undefined ? null : Number(args.parentB),
          cycleStartedAt: args.cycleStartedAt === undefined ? null : Number(args.cycleStartedAt),
          cycleDays: args.cycleDays === undefined ? null : Number(args.cycleDays),
          filterCount,
          filterGroups,
          filterTraits
        }
      });
    } else if (event.kind === "breeding-pool-joined") {
      const args = log.args as
        | { poolId?: bigint; joiner?: Address; parentB?: bigint; cycleStartedAt?: bigint; cycleDays?: number }
        | undefined;
      if (!args || args.poolId === undefined || !args.joiner || !log.transactionHash || !log.blockNumber) {
        return;
      }
      await repo.ingestBreedingEvent({
        eventKind: "POOL_JOINED",
        poolId: Number(args.poolId),
        joiner: String(args.joiner),
        parentBKittyId: args.parentB === undefined ? null : Number(args.parentB),
        cycleStartedAt: args.cycleStartedAt === undefined ? null : Number(args.cycleStartedAt),
        cycleDays: args.cycleDays === undefined ? null : Number(args.cycleDays),
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        logIndex: log.logIndex ?? 0,
        payload: {
          parentB: args.parentB === undefined ? null : Number(args.parentB),
          cycleStartedAt: args.cycleStartedAt === undefined ? null : Number(args.cycleStartedAt),
          cycleDays: args.cycleDays === undefined ? null : Number(args.cycleDays)
        }
      });
    } else if (event.kind === "breeding-pool-left") {
      const args = log.args as
        | { poolId?: bigint; account?: Address; returnedParentA?: bigint; returnedParentB?: bigint; nextStatus?: number }
        | undefined;
      if (!args || args.poolId === undefined || !args.account || args.nextStatus === undefined || !log.transactionHash || !log.blockNumber) {
        return;
      }
      await repo.ingestBreedingEvent({
        eventKind: "POOL_LEFT",
        poolId: Number(args.poolId),
        host: String(args.account),
        parentAKittyId: args.returnedParentA === undefined ? null : Number(args.returnedParentA),
        parentBKittyId: args.returnedParentB === undefined ? null : Number(args.returnedParentB),
        nextStatus: Number(args.nextStatus),
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        logIndex: log.logIndex ?? 0,
        payload: {
          account: String(args.account),
          returnedParentA: args.returnedParentA === undefined ? null : Number(args.returnedParentA),
          returnedParentB: args.returnedParentB === undefined ? null : Number(args.returnedParentB),
          nextStatus: Number(args.nextStatus)
        }
      });
    } else if (event.kind === "breeding-cycle-reset") {
      const args = log.args as { poolId?: bigint; cycleStartedAt?: bigint; cycleDays?: number; status?: number } | undefined;
      if (!args || args.poolId === undefined || args.status === undefined || !log.transactionHash || !log.blockNumber) {
        return;
      }
      await repo.ingestBreedingEvent({
        eventKind: "CYCLE_RESET",
        poolId: Number(args.poolId),
        cycleStartedAt: args.cycleStartedAt === undefined ? null : Number(args.cycleStartedAt),
        cycleDays: args.cycleDays === undefined ? null : Number(args.cycleDays),
        nextStatus: Number(args.status),
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        logIndex: log.logIndex ?? 0,
        payload: {
          cycleStartedAt: args.cycleStartedAt === undefined ? null : Number(args.cycleStartedAt),
          cycleDays: args.cycleDays === undefined ? null : Number(args.cycleDays),
          nextStatus: Number(args.status)
        }
      });
    } else if (event.kind === "breeding-settled") {
      const args = log.args as
        | {
            poolId?: bigint;
            result?: number;
            childTier?: number;
            childKittyId?: bigint;
            claimId?: bigint;
            childOwner?: Address;
            childSeedSalt?: `0x${string}`;
            childPackedTraits?: bigint;
          }
        | undefined;
      if (!args || args.poolId === undefined || args.result === undefined || !log.transactionHash || !log.blockNumber) {
        return;
      }
      await repo.ingestBreedingEvent({
        eventKind: "SETTLED",
        poolId: Number(args.poolId),
        result: Number(args.result),
        childTier: args.childTier === undefined ? null : Number(args.childTier),
        childKittyId: args.childKittyId === undefined ? null : Number(args.childKittyId),
        claimId: args.claimId === undefined ? null : Number(args.claimId),
        childOwner: args.childOwner ? String(args.childOwner) : null,
        childSeedSalt: args.childSeedSalt ? String(args.childSeedSalt) : null,
        childPackedTraits: args.childPackedTraits === undefined ? null : args.childPackedTraits.toString(),
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        logIndex: log.logIndex ?? 0,
        payload: {
          result: Number(args.result),
          childTier: args.childTier === undefined ? null : Number(args.childTier),
          childKittyId: args.childKittyId === undefined ? null : Number(args.childKittyId),
          claimId: args.claimId === undefined ? null : Number(args.claimId),
          childOwner: args.childOwner ? String(args.childOwner) : null,
          childSeedSalt: args.childSeedSalt ? String(args.childSeedSalt) : null
        }
      });
    } else if (event.kind === "breeding-lineage") {
      const args = log.args as
        | { childKittyId?: bigint; parentA?: bigint; parentB?: bigint; poolId?: bigint; childOwner?: Address }
        | undefined;
      if (!args || args.poolId === undefined || args.childKittyId === undefined || !log.transactionHash || !log.blockNumber) {
        return;
      }
      await repo.ingestBreedingEvent({
        eventKind: "LINEAGE",
        poolId: Number(args.poolId),
        childKittyId: Number(args.childKittyId),
        parentAKittyId: args.parentA === undefined ? null : Number(args.parentA),
        parentBKittyId: args.parentB === undefined ? null : Number(args.parentB),
        childOwner: args.childOwner ? String(args.childOwner) : null,
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        logIndex: log.logIndex ?? 0,
        payload: {
          childOwner: args.childOwner ? String(args.childOwner) : null
        }
      });
    } else if (event.kind === "breeding-cooldown-set") {
      const args = log.args as { parentId?: bigint; cooldownUntil?: bigint } | undefined;
      if (!args || args.parentId === undefined || !log.transactionHash || !log.blockNumber) {
        return;
      }
      await repo.ingestBreedingEvent({
        eventKind: "COOLDOWN_SET",
        poolId: 0,
        parentAKittyId: Number(args.parentId),
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        logIndex: log.logIndex ?? 0,
        payload: {
          parentId: Number(args.parentId),
          cooldownUntil: args.cooldownUntil === undefined ? null : Number(args.cooldownUntil)
        }
      });
    } else if (event.kind === "breeding-claimed") {
      const args = log.args as { claimId?: bigint; poolId?: bigint; childKittyId?: bigint; owner?: Address } | undefined;
      if (!args || args.poolId === undefined || args.childKittyId === undefined || !args.owner || !log.transactionHash || !log.blockNumber) {
        return;
      }
      await repo.ingestBreedingEvent({
        eventKind: "CLAIMED",
        poolId: Number(args.poolId),
        claimId: args.claimId === undefined ? null : Number(args.claimId),
        childKittyId: Number(args.childKittyId),
        childOwner: String(args.owner),
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        logIndex: log.logIndex ?? 0
      });
    } else if (event.kind === "breeding-backing-staked") {
      const args = log.args as
        | { poolId?: bigint; provider?: Address; backingKittyId?: bigint; side?: number; queued?: boolean }
        | undefined;
      if (
        !args ||
        args.poolId === undefined ||
        !args.provider ||
        args.backingKittyId === undefined ||
        args.side === undefined ||
        args.queued === undefined ||
        !log.transactionHash ||
        !log.blockNumber
      ) {
        return;
      }
      await repo.ingestBreedingEvent({
        eventKind: "BACKING_STAKED",
        poolId: Number(args.poolId),
        currentBackingProvider: String(args.provider),
        currentBackingKittyId: Number(args.backingKittyId),
        currentBackingSide: Number(args.side),
        backingQueued: Boolean(args.queued),
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        logIndex: log.logIndex ?? 0,
        payload: {
          provider: String(args.provider),
          backingKittyId: Number(args.backingKittyId),
          side: Number(args.side),
          queued: Boolean(args.queued)
        }
      });
    } else if (event.kind === "breeding-backing-withdrawn") {
      const args = log.args as
        | { poolId?: bigint; provider?: Address; backingKittyId?: bigint; side?: number; queued?: boolean }
        | undefined;
      if (
        !args ||
        args.poolId === undefined ||
        !args.provider ||
        args.backingKittyId === undefined ||
        args.side === undefined ||
        args.queued === undefined ||
        !log.transactionHash ||
        !log.blockNumber
      ) {
        return;
      }
      await repo.ingestBreedingEvent({
        eventKind: "BACKING_WITHDRAWN",
        poolId: Number(args.poolId),
        currentBackingProvider: String(args.provider),
        currentBackingKittyId: Number(args.backingKittyId),
        currentBackingSide: Number(args.side),
        backingQueued: Boolean(args.queued),
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        logIndex: log.logIndex ?? 0,
        payload: {
          provider: String(args.provider),
          backingKittyId: Number(args.backingKittyId),
          side: Number(args.side),
          queued: Boolean(args.queued)
        }
      });
    } else if (event.kind === "breeding-backing-consumed") {
      const args = log.args as { poolId?: bigint; provider?: Address; backingKittyId?: bigint; side?: number } | undefined;
      if (
        !args ||
        args.poolId === undefined ||
        !args.provider ||
        args.backingKittyId === undefined ||
        args.side === undefined ||
        !log.transactionHash ||
        !log.blockNumber
      ) {
        return;
      }
      await repo.ingestBreedingEvent({
        eventKind: "BACKING_CONSUMED",
        poolId: Number(args.poolId),
        currentBackingProvider: String(args.provider),
        currentBackingKittyId: Number(args.backingKittyId),
        currentBackingSide: Number(args.side),
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        logIndex: log.logIndex ?? 0,
        payload: {
          provider: String(args.provider),
          backingKittyId: Number(args.backingKittyId),
          side: Number(args.side)
        }
      });
    } else if (event.kind === "breeding-backing-promoted") {
      const args = log.args as { poolId?: bigint; provider?: Address; backingKittyId?: bigint; side?: number } | undefined;
      if (
        !args ||
        args.poolId === undefined ||
        !args.provider ||
        args.backingKittyId === undefined ||
        args.side === undefined ||
        !log.transactionHash ||
        !log.blockNumber
      ) {
        return;
      }
      await repo.ingestBreedingEvent({
        eventKind: "BACKING_PROMOTED",
        poolId: Number(args.poolId),
        currentBackingProvider: String(args.provider),
        currentBackingKittyId: Number(args.backingKittyId),
        currentBackingSide: Number(args.side),
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        logIndex: log.logIndex ?? 0,
        payload: {
          provider: String(args.provider),
          backingKittyId: Number(args.backingKittyId),
          side: Number(args.side)
        }
      });
    }
  };

  const applySyncChanges = async (): Promise<void> => {
    for (let eventIndex = 0; eventIndex < orderedEvents.length; eventIndex += 1) {
      const event = orderedEvents[eventIndex]!;
      const log = event.log;
      try {
        await applyMainEvent(event);
      } catch (error) {
        await failureContext({
          phase: "main-event-ingest",
          fromBlock: Number(fromBlock),
          toBlock: Number(toBlock),
          eventKind: event.kind,
          txHash: log.transactionHash ?? null,
          logIndex: log.logIndex ?? null,
          error
        });
      }
    }

    try {
      await repo.ingestTokenTransferEvents(tokenTransferInputs);
    } catch (error) {
      await failureContext({
        phase: "token-transfer-ingest",
        fromBlock: Number(tokenBalanceFromBlock),
        toBlock: Number(tokenBalanceToBlock),
        error
      });
    }

    if (hasMainRange) {
      await repo.setLatestIndexedBlock(Number(toBlock));
    }
    if (hasTokenBalanceRange) {
      await repo.setLatestTokenBalanceIndexedBlock(Number(tokenBalanceToBlock));
    }
  };

  try {
    await repo.transaction(applySyncChanges);
  } catch (error) {
    if (error instanceof ChainSyncFailure) {
      await reportChainSyncFailure(reportFailure, error);
    }
    await failureContext({
      phase: "sync-transaction",
      fromBlock: Number(fromBlock),
      toBlock: Number(toBlock),
      error
    });
  }
  const nextLatestIndexedBlock = hasMainRange ? Number(toBlock) : latestIndexedBlock;
  const nextTokenBalanceIndexedBlock = hasTokenBalanceRange
    ? Number(tokenBalanceToBlock)
    : latestTokenBalanceIndexedBlock;
  return {
    latestIndexedBlock: nextLatestIndexedBlock,
    headBlock: Number(headBlock),
    tokenBalanceIndexedBlock: nextTokenBalanceIndexedBlock,
    ...(hasMainRange ? { fromBlock: Number(fromBlock), toBlock: Number(toBlock) } : {}),
    ...(hasTokenBalanceRange
      ? {
          tokenBalanceFromBlock: Number(tokenBalanceFromBlock),
          tokenBalanceToBlock: Number(tokenBalanceToBlock)
        }
      : {}),
    ...(hasTargetBlock &&
    nextLatestIndexedBlock >= Number(syncHeadBlock) &&
    nextTokenBalanceIndexedBlock >= Number(syncHeadBlock)
      ? { targetReached: true }
      : {})
  };
}

export async function transactionTouchesIndexedContracts(
  config: ChainSyncConfig,
  txHash: `0x${string}`
): Promise<IndexedTransactionCheck> {
  const client = buildClient(config);
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    return { trusted: false };
  }
  const tokenAddress = config.tokenAddress.toLowerCase();
  const marketAddress = config.marketAddress?.toLowerCase();
  const breedingAddress = config.breedingAddress?.toLowerCase();
  const trusted = receipt.logs.some((log) => {
    const address = log.address.toLowerCase();
    return (
      address === tokenAddress ||
      Boolean(marketAddress && address === marketAddress) ||
      Boolean(breedingAddress && address === breedingAddress)
    );
  });
  return {
    trusted,
    blockNumber: Number(receipt.blockNumber)
  };
}
