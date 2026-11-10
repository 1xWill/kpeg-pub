import { KPEG_MARKET_ABI, KPEG_TOKEN_ABI } from "@kpeg/core";
import {
  createPublicClient,
  defineChain,
  encodePacked,
  fallback,
  http,
  keccak256,
  parseAbiItem,
  type AbiEvent,
  type Address,
  type Chain,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import type { ChainSyncConfig } from "./chain.js";
import type { KPEGRepository } from "./repository.js";

type SortMode = "latest" | "scarcity";
type MarketTab = "all" | "my-listings" | "bought" | "sold";
type MarketStatus = "OPEN" | "SOLD" | "DELETED";

type MarketListInput = {
  page: number;
  pageSize: number;
  offset?: number;
  sort: SortMode;
  tab: MarketTab;
  owner?: string;
  search?: string;
};

type OwnerListInput = {
  page: number;
  pageSize: number;
  offset?: number;
  sort: SortMode;
};

type GlobalListInput = {
  page: number;
  pageSize: number;
  offset?: number;
  sort: SortMode;
};

type OwnerStats = {
  currentKitties: number;
  everKitties: number;
};

type MarketStats = {
  floorWei: string;
  volumeWei: string;
  listed: number;
};

type GlobalStats = {
  tokenSupplyFixed: number;
  kittiesLive: number;
  kittiesEverMinted: number;
  holdersLive: number;
  holdersEver: number;
  latestIndexedBlock: number;
};

type OnchainFallbackOptions = {
  repo: KPEGRepository;
  config: ChainSyncConfig;
};

const ZERO_TX = `0x${"0".repeat(64)}` as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const LOG_RANGE_LIMIT = 5_000n;
const ownerHistoryCache = new Map<string, { expiresAt: number; verifiedToBlock: bigint; kittyIds: Set<number> }>();
const OWNER_HISTORY_TTL_MS = 10 * 60_000;
const globalKittiesPageAuditCache = new Map<string, number>();
const GLOBAL_KITTIES_PAGE_AUDIT_TTL_MS = 60_000;
const globalLatestPageCache = new Map<
  string,
  { expiresAt: number; total: number; mintedCount: number; pageIds: number[]; items: GlobalKittyItem[] }
>();
const GLOBAL_LATEST_PAGE_CACHE_TTL_MS = 45_000;
const globalScarcityCache = new Map<
  string,
  { expiresAt: number; total: number; mintedCount: number; items: GlobalKittyItem[] }
>();
const GLOBAL_SCARCITY_CACHE_TTL_MS = 60_000;
const marketPageAuditCache = new Map<string, number>();
const MARKET_PAGE_AUDIT_TTL_MS = 60_000;
const marketPageResultCache = new Map<string, {
  expiresAt: number;
  total: number;
  items: Awaited<ReturnType<KPEGRepository["listMarketListings"]>>["items"];
}>();
const MARKET_PAGE_RESULT_TTL_MS = 15_000;
const marketTabCountCache = new Map<string, { expiresAt: number; total: number }>();
const MARKET_TAB_COUNT_TTL_MS = 60_000;
const marketStatsCache = new Map<string, { expiresAt: number; stats: MarketStats }>();
const MARKET_STATS_TTL_MS = 60_000;
const marketStatsRefreshInFlight = new Map<string, Promise<void>>();
const ownerKittiesPageCache = new Map<string, number>();
const OWNER_KITTIES_PAGE_TTL_MS = 60_000;
const onchainGlobalCountsCache = new Map<string, { expiresAt: number; onchainTotal: number; mintedCount: number }>();
const ONCHAIN_GLOBAL_COUNTS_TTL_MS = 15_000;
const ownerLiveStatsCache = new Map<string, { expiresAt: number; live: number; listed: number }>();
const OWNER_LIVE_STATS_TTL_MS = 15_000;
const ownerKittiesIdCache = new Map<string, { expiresAt: number; ids: number[] }>();
const OWNER_KITTIES_ID_TTL_MS = 15_000;
const marketTradeIdsCache = new Map<string, { expiresAt: number; ids: readonly bigint[] }>();
const marketAllTradeIdsCache = new Map<string, { expiresAt: number; ids: readonly bigint[] }>();
const marketScarcitySortedTradeIdsCache = new Map<string, { expiresAt: number; ids: readonly bigint[] }>();
const MARKET_TRADE_IDS_TTL_MS = 15_000;
const publicClientCache = new Map<string, unknown>();
const ONCHAIN_KITTY_SCAN_BATCH_SIZE = 40;

const BATCH_MINTED = parseAbiItem(
  "event KittyBatchMinted(address indexed owner, uint256 indexed startKittyId, uint256 count, uint8 tier, uint256 batchSizeWhole, bytes32 seedBase)"
);
const BATCH_BURNED = parseAbiItem(
  "event KittyBatchBurned(address indexed owner, uint256 indexed startKittyId, uint256 count)"
);
const BATCH_MOVED = parseAbiItem(
  "event KittyBatchMoved(address indexed from, address indexed to, uint256 indexed startKittyId, uint256 count)"
);
const KITTY_MOVED = parseAbiItem(
  "event KittyMoved(uint256 indexed kittyId, address indexed from, address indexed to)"
);
const POSITION_BOUGHT = parseAbiItem(
  "event PositionBought(uint256 indexed tradeId, address indexed buyer, address indexed seller, uint256 price, uint256 feeAmount)"
);

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function setAuditWindow(cache: Map<string, number>, key: string, ttlMs: number): void {
  cache.set(key, Date.now() + ttlMs);
}

async function mapSequential<T, U>(
  items: readonly T[],
  fn: (item: T) => Promise<U>
): Promise<U[]> {
  const output: U[] = [];
  for (const item of items) {
    output.push(await fn(item));
  }
  return output;
}

export function clearOnchainFallbackCaches(): void {
  ownerHistoryCache.clear();
  globalKittiesPageAuditCache.clear();
  globalLatestPageCache.clear();
  globalScarcityCache.clear();
  marketPageAuditCache.clear();
  marketPageResultCache.clear();
  marketTabCountCache.clear();
  marketStatsCache.clear();
  marketStatsRefreshInFlight.clear();
  ownerKittiesPageCache.clear();
  onchainGlobalCountsCache.clear();
  ownerLiveStatsCache.clear();
  ownerKittiesIdCache.clear();
  marketTradeIdsCache.clear();
  marketAllTradeIdsCache.clear();
  marketScarcitySortedTradeIdsCache.clear();
}

function buildClient(config: ChainSyncConfig) {
  const rpcUrls = [...new Set([config.rpcUrl, ...(config.rpcFallbackUrls ?? [])].filter(Boolean))];
  const cacheKey = [config.chainId, ...rpcUrls].join(":");
  const cached = publicClientCache.get(cacheKey);
  if (cached) {
    return cached as ReturnType<typeof createPublicClient>;
  }
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
  const client = createPublicClient({
    chain,
    transport:
      rpcUrls.length > 1
        ? fallback(rpcUrls.map((url) => http(url)), { rank: true })
        : http(config.rpcUrl)
  });
  publicClientCache.set(cacheKey, client);
  return client;
}

async function estimateStartBlock(client: ReturnType<typeof buildClient>, config: ChainSyncConfig): Promise<bigint> {
  if (config.startBlock && config.startBlock > 0) {
    return BigInt(config.startBlock);
  }
  if (!config.deployedAtHint) {
    return 1n;
  }
  const targetTimestampSec = Math.floor(new Date(config.deployedAtHint).getTime() / 1000);
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

async function getLogsInChunks<T>(
  client: ReturnType<typeof buildClient>,
  input: {
    address: Address;
    event: AbiEvent;
    args: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
  }
): Promise<T[]> {
  const logs: T[] = [];
  for (let start = input.fromBlock; start <= input.toBlock; start += LOG_RANGE_LIMIT) {
    const end = start + LOG_RANGE_LIMIT - 1n;
    logs.push(
      ...((await client.getLogs({
        address: input.address,
        event: input.event,
        args: input.args,
        fromBlock: start,
        toBlock: end < input.toBlock ? end : input.toBlock
      })) as T[])
    );
  }
  return logs;
}

function addRange(ids: Set<number>, start: bigint | undefined, count: bigint | undefined): void {
  if (start === undefined || count === undefined) return;
  for (let offset = 0n; offset < count; offset += 1n) {
    ids.add(Number(start + offset));
  }
}

function statusName(status: number): MarketStatus {
  if (status === 0) return "OPEN";
  if (status === 1) return "SOLD";
  return "DELETED";
}

function minWei(a: string, b: string): string {
  return BigInt(a) <= BigInt(b) ? a : b;
}

function addWei(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

async function onchainOwnerListingKittyIds(
  client: ReturnType<typeof buildClient>,
  config: ChainSyncConfig,
  owner: Address
): Promise<Set<number>> {
  if (!config.marketAddress) {
    return new Set();
  }
  const tradeIds = await client.readContract({
    address: config.marketAddress,
    abi: KPEG_MARKET_ABI,
    functionName: "getOpenPositionsByOwner",
    args: [owner, 0n, 100n]
  });
  const ids = new Set<number>();
  await Promise.all(
    tradeIds.map(async (tradeId) => {
      const position = await client.readContract({
        address: config.marketAddress!,
        abi: KPEG_MARKET_ABI,
        functionName: "getPositionView",
        args: [tradeId]
      });
      if (!position.ready) {
        return;
      }
      for (const kittyId of position.kittyIds) {
        ids.add(Number(kittyId));
      }
    })
  );
  return ids;
}

export async function ownerStatsWithOnchainFallback(
  options: OnchainFallbackOptions & {
    owner: string;
    indexed: OwnerStats;
  }
): Promise<OwnerStats> {
  const now = Date.now();
  const owner = normalizeAddress(options.owner) as Address;
  const cacheKey = `${options.config.chainId}:${options.config.tokenAddress.toLowerCase()}:${owner}:stats`;
  const cached = ownerLiveStatsCache.get(cacheKey);
  const cacheFresh = Boolean(cached && cached.expiresAt > now);
  let liveCount: number;
  let listedCount: number;
  if (cached && cached.expiresAt > now) {
    liveCount = cached.live;
    listedCount = cached.listed;
  } else {
    const client = buildClient(options.config);
    const [live, listedKittyIds] = await Promise.all([
      client.readContract({
        address: options.config.tokenAddress,
        abi: KPEG_TOKEN_ABI,
        functionName: "ownerKittiesLive",
        args: [owner]
      }),
      onchainOwnerListingKittyIds(client, options.config, owner)
    ]);
    liveCount = Number(live);
    listedCount = listedKittyIds.size;
    ownerLiveStatsCache.set(cacheKey, {
      live: liveCount,
      listed: listedCount,
      expiresAt: now + OWNER_LIVE_STATS_TTL_MS
    });
  }
  const repaired = mergeOwnerStatsWithOnchain(options.indexed, liveCount, listedCount);
  if (cacheFresh && options.indexed.everKitties >= repaired.everKitties) {
    return repaired;
  }
  try {
    return mergeOwnerStatsWithOnchain(
      options.indexed,
      liveCount,
      listedCount,
      await onchainOwnerHistoryCount(buildClient(options.config), options.config, owner)
    );
  } catch {
    // Keep the cheap live/listed repair even when an RPC rejects historical log scans.
    return repaired;
  }
}

export function mergeOwnerStatsWithOnchain(
  indexed: OwnerStats,
  liveKitties: number,
  escrowListedKitties: number,
  historyKitties?: number
): OwnerStats {
  const currentKitties = liveKitties;
  const minimumEver = currentKitties + escrowListedKitties;
  return {
    currentKitties,
    everKitties:
      historyKitties === undefined
        ? Math.max(indexed.everKitties, minimumEver)
        : Math.max(minimumEver, historyKitties)
  };
}

export function shouldUseOnchainOwnerPage(
  indexed: Awaited<ReturnType<KPEGRepository["listByOwner"]>>,
  onchainIds: readonly number[],
  offset: number,
  auditDue: boolean
): boolean {
  if (onchainIds.length === 0) {
    if (!auditDue) {
      return false;
    }
    return indexed.total > offset || indexed.items.length > 0;
  }
  if (indexed.total !== onchainIds.length) {
    return true;
  }
  if (indexed.items.length < Math.min(indexed.pageSize, onchainIds.length - offset)) {
    return true;
  }
  if (!auditDue) {
    return false;
  }
  const indexedIds = new Set(indexed.items.map((item) => item.id));
  return onchainIds.slice(offset, offset + indexed.pageSize).some((id) => !indexedIds.has(id));
}

async function readCurrentOwnerKitty(
  options: OnchainFallbackOptions,
  client: ReturnType<typeof buildClient>,
  owner: Address,
  indexedById: Map<number, Awaited<ReturnType<KPEGRepository["listByOwner"]>>["items"][number] | Exclude<Awaited<ReturnType<KPEGRepository["getKittyById"]>>, null>>,
  id: number
) {
  const indexed = indexedById.get(id);
  if (indexed && normalizeAddress(indexed.owner) === owner) {
    return indexed;
  }
  const fromRepo = await options.repo.getKittyById(id);
  if (fromRepo && normalizeAddress(fromRepo.owner) === owner) {
    return fromRepo;
  }
  const kitty = await client.readContract({
    address: options.config.tokenAddress,
    abi: KPEG_TOKEN_ABI,
    functionName: "getKitty",
    args: [BigInt(id)]
  });
  return options.repo.onchainKitty({
    id: Number(kitty.id),
    owner: kitty.owner,
    seed: kitty.seed,
    tier: Number(kitty.tier) as 0 | 1 | 2 | 3 | 4,
    entropy: entropyForOnchainKitty({
      id: Number(kitty.id),
      seed: kitty.seed,
      tier: Number(kitty.tier)
    })
  });
}

function entropyForOnchainKitty(input: { id: number; seed: `0x${string}`; tier: number }): bigint {
  return BigInt(
    keccak256(
      encodePacked(
        ["bytes32", "uint256", "uint8"],
        [input.seed, BigInt(input.id), input.tier]
      )
    )
  );
}

type OnchainKittySnapshot = {
  id: number;
  owner: Address;
  seed: `0x${string}`;
  tier: number;
  alive: boolean;
};
type GlobalKittyItem = Awaited<
  ReturnType<KPEGRepository["listGlobal"]>
>["items"][number];

export function shouldUseOnchainGlobalPage(
  indexed: Awaited<ReturnType<KPEGRepository["listGlobal"]>>,
  onchainTotal: number,
  onchainPageIds: readonly number[],
  offset: number,
  force: boolean,
  auditDue: boolean
): boolean {
  if (onchainTotal === 0) {
    if (!auditDue) {
      return false;
    }
    return indexed.total > offset || indexed.items.length > 0;
  }
  if (force) {
    return true;
  }
  if (indexed.total !== onchainTotal) {
    return true;
  }
  if (!auditDue) {
    return false;
  }
  if (indexed.items.length < Math.min(indexed.pageSize, Math.max(0, onchainTotal - offset))) {
    return true;
  }
  const indexedIds = new Set(indexed.items.map((item) => item.id));
  return onchainPageIds.some((id) => !indexedIds.has(id));
}

async function readOnchainKittySnapshot(
  client: ReturnType<typeof buildClient>,
  tokenAddress: Address,
  id: number
): Promise<OnchainKittySnapshot | null> {
  try {
    const kitty = await client.readContract({
      address: tokenAddress,
      abi: KPEG_TOKEN_ABI,
      functionName: "getKitty",
      args: [BigInt(id)]
    });
    return {
      id: Number(kitty.id),
      owner: kitty.owner,
      seed: kitty.seed,
      tier: Number(kitty.tier),
      alive: Boolean(kitty.alive)
    };
  } catch {
    return null;
  }
}

export async function kittyByIdWithOnchainFallback(
  options: OnchainFallbackOptions & {
    id: number;
    indexed: Awaited<ReturnType<KPEGRepository["getKittyById"]>>;
  }
): Promise<Awaited<ReturnType<KPEGRepository["getKittyById"]>>> {
  if (options.indexed) {
    return options.indexed;
  }
  if (!Number.isFinite(options.id) || options.id < 1) {
    return null;
  }
  const client = buildClient(options.config);
  const snapshot = await readOnchainKittySnapshot(
    client,
    options.config.tokenAddress,
    options.id
  );
  if (!snapshot || normalizeAddress(snapshot.owner) === ZERO_ADDRESS) {
    return null;
  }
  return options.repo.onchainKitty({
    id: snapshot.id,
    owner: snapshot.owner,
    seed: snapshot.seed,
    tier: snapshot.tier as 0 | 1 | 2 | 3 | 4,
    entropy: entropyForOnchainKitty({
      id: snapshot.id,
      seed: snapshot.seed,
      tier: snapshot.tier
    })
  });
}

async function readLatestLiveKittySnapshots(
  client: ReturnType<typeof buildClient>,
  tokenAddress: Address,
  mintedCount: number,
  limit: number
): Promise<OnchainKittySnapshot[]> {
  const snapshots: OnchainKittySnapshot[] = [];
  if (limit <= 0 || mintedCount <= 0) {
    return snapshots;
  }
  let cursor = mintedCount;
  while (cursor >= 1 && snapshots.length < limit) {
    const rangeStart = Math.max(1, cursor - ONCHAIN_KITTY_SCAN_BATCH_SIZE + 1);
    const ids: number[] = [];
    for (let id = cursor; id >= rangeStart; id -= 1) {
      ids.push(id);
    }
    const chunk = await Promise.all(
      ids.map((id) => readOnchainKittySnapshot(client, tokenAddress, id))
    );
    for (const snapshot of chunk) {
      if (!snapshot || normalizeAddress(snapshot.owner) === ZERO_ADDRESS) {
        continue;
      }
      snapshots.push(snapshot);
      if (snapshots.length >= limit) {
        break;
      }
    }
    cursor = rangeStart - 1;
  }
  return snapshots;
}

function asOnchainKittyDto(
  repo: KPEGRepository,
  snapshot: OnchainKittySnapshot
): GlobalKittyItem {
  return repo.onchainKitty({
    id: snapshot.id,
    owner: snapshot.owner,
    seed: snapshot.seed,
    tier: snapshot.tier as 0 | 1 | 2 | 3 | 4,
    entropy: entropyForOnchainKitty({
      id: snapshot.id,
      seed: snapshot.seed,
      tier: snapshot.tier
    })
  });
}

async function readOnchainGlobalLatestPage(
  options: OnchainFallbackOptions,
  client: ReturnType<typeof buildClient>,
  input: GlobalListInput,
  counts: { onchainTotal: number; mintedCount: number }
): Promise<{
  onchainTotal: number;
  items: GlobalKittyItem[];
  pageIds: number[];
}> {
  const offset = input.offset ?? input.page * input.pageSize;
  const { onchainTotal, mintedCount } = counts;
  if (!Number.isFinite(onchainTotal) || onchainTotal <= 0) {
    return { onchainTotal: 0, items: [], pageIds: [] };
  }
  const cacheKey = `${options.config.chainId}:${options.config.tokenAddress.toLowerCase()}:latest:${offset}:${input.pageSize}`;
  const cached = globalLatestPageCache.get(cacheKey);
  if (
    cached &&
    cached.expiresAt > Date.now() &&
    cached.total === onchainTotal &&
    cached.mintedCount === mintedCount
  ) {
    return {
      onchainTotal: cached.total,
      items: cached.items,
      pageIds: cached.pageIds
    };
  }
  const needed = Math.min(onchainTotal, offset + input.pageSize);
  const snapshots = await readLatestLiveKittySnapshots(
    client,
    options.config.tokenAddress,
    mintedCount,
    needed
  );
  const pageSnapshots = snapshots.slice(offset, offset + input.pageSize);
  const indexedById = new Map<number, Awaited<ReturnType<KPEGRepository["getKittyById"]>>>();
  const pageIds = pageSnapshots.map((snapshot) => snapshot.id);
  const items = await Promise.all(
    pageSnapshots.map(async (snapshot) => {
      const indexed = indexedById.get(snapshot.id) ?? (await options.repo.getKittyById(snapshot.id));
      if (indexed) {
        indexedById.set(snapshot.id, indexed);
      }
      if (
        indexed &&
        normalizeAddress(indexed.owner) === normalizeAddress(snapshot.owner)
      ) {
        return indexed;
      }
      return asOnchainKittyDto(options.repo, snapshot);
    })
  );
  globalLatestPageCache.set(cacheKey, {
    total: onchainTotal,
    mintedCount,
    pageIds,
    items,
    expiresAt: Date.now() + GLOBAL_LATEST_PAGE_CACHE_TTL_MS
  });
  return { onchainTotal, items, pageIds };
}

async function readOnchainGlobalCounts(
  client: ReturnType<typeof buildClient>,
  tokenAddress: Address
): Promise<{ onchainTotal: number; mintedCount: number }> {
  const cacheKey = tokenAddress.toLowerCase();
  const cached = onchainGlobalCountsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      onchainTotal: cached.onchainTotal,
      mintedCount: cached.mintedCount
    };
  }
  const [liveRaw, mintedRaw] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: KPEG_TOKEN_ABI,
      functionName: "kittiesLive"
    }),
    client.readContract({
      address: tokenAddress,
      abi: KPEG_TOKEN_ABI,
      functionName: "kittiesEverMinted"
    })
  ]);
  const counts = {
    onchainTotal: Number(liveRaw),
    mintedCount: Number(mintedRaw)
  };
  onchainGlobalCountsCache.set(cacheKey, {
    ...counts,
    expiresAt: Date.now() + ONCHAIN_GLOBAL_COUNTS_TTL_MS
  });
  return counts;
}

export async function globalStatsWithOnchainFallback(
  options: OnchainFallbackOptions & {
    indexed: GlobalStats;
  }
): Promise<GlobalStats> {
  const client = buildClient(options.config);
  const counts = await readOnchainGlobalCounts(client, options.config.tokenAddress);
  return {
    ...options.indexed,
    kittiesLive: counts.onchainTotal,
    kittiesEverMinted: counts.mintedCount
  };
}

async function readOnchainGlobalScarcityPage(
  options: OnchainFallbackOptions,
  client: ReturnType<typeof buildClient>,
  input: GlobalListInput,
  counts: { onchainTotal: number; mintedCount: number }
): Promise<{
  onchainTotal: number;
  items: GlobalKittyItem[];
  pageIds: number[];
}> {
  const offset = input.offset ?? input.page * input.pageSize;
  const { onchainTotal, mintedCount } = counts;
  if (!Number.isFinite(onchainTotal) || onchainTotal <= 0) {
    return { onchainTotal: 0, items: [], pageIds: [] };
  }
  const cacheKey = `${options.config.chainId}:${options.config.tokenAddress.toLowerCase()}:scarcity`;
  const cached = globalScarcityCache.get(cacheKey);
  const sorted =
    cached &&
    cached.expiresAt > Date.now() &&
    cached.total === onchainTotal &&
    cached.mintedCount === mintedCount
      ? cached.items
      : await (async () => {
          const snapshots = await readLatestLiveKittySnapshots(
            client,
            options.config.tokenAddress,
            mintedCount,
            onchainTotal
          );
          const indexedById = new Map<number, Awaited<ReturnType<KPEGRepository["getKittyById"]>>>();
          const allItems = await Promise.all(
            snapshots.map(async (snapshot) => {
              const indexed =
                indexedById.get(snapshot.id) ??
                (await options.repo.getKittyById(snapshot.id));
              if (indexed) {
                indexedById.set(snapshot.id, indexed);
              }
              if (
                indexed &&
                normalizeAddress(indexed.owner) === normalizeAddress(snapshot.owner)
              ) {
                return indexed;
              }
              return asOnchainKittyDto(options.repo, snapshot);
            })
          );
          const sortedItems = [...allItems].sort(
            (a, b) => b.rarityScore - a.rarityScore || b.id - a.id
          );
          globalScarcityCache.set(cacheKey, {
            total: onchainTotal,
            mintedCount,
            items: sortedItems,
            expiresAt: Date.now() + GLOBAL_SCARCITY_CACHE_TTL_MS
          });
          return sortedItems;
        })();
  const pageItems = sorted.slice(offset, offset + input.pageSize);
  return {
    onchainTotal,
    items: pageItems,
    pageIds: pageItems.map((item) => item.id)
  };
}

export async function listGlobalKittiesWithOnchainFallback(
  options: OnchainFallbackOptions & {
    input: GlobalListInput;
    indexed: Awaited<ReturnType<KPEGRepository["listGlobal"]>>;
    force: boolean;
  }
): Promise<Awaited<ReturnType<KPEGRepository["listGlobal"]>>> {
  const offset = options.input.offset ?? options.input.page * options.input.pageSize;
  const cacheKey = [
    options.config.chainId,
    options.config.tokenAddress.toLowerCase(),
    options.input.sort,
    offset,
    options.input.pageSize
  ].join(":");
  const nextAuditAt = globalKittiesPageAuditCache.get(cacheKey);
  if (!options.force && nextAuditAt === undefined) {
    setAuditWindow(globalKittiesPageAuditCache, cacheKey, GLOBAL_KITTIES_PAGE_AUDIT_TTL_MS);
    return options.indexed;
  }
  const auditDue = (nextAuditAt ?? 0) <= Date.now();
  if (!options.force && !auditDue) {
    return options.indexed;
  }
  const client = buildClient(options.config);
  const counts = await readOnchainGlobalCounts(client, options.config.tokenAddress);
  const onchain =
    options.input.sort === "latest"
      ? await readOnchainGlobalLatestPage(options, client, options.input, counts)
      : await readOnchainGlobalScarcityPage(options, client, options.input, counts);
  if (
    !shouldUseOnchainGlobalPage(
      options.indexed,
      onchain.onchainTotal,
      onchain.pageIds,
      offset,
      options.force,
      auditDue
    )
  ) {
    setAuditWindow(globalKittiesPageAuditCache, cacheKey, GLOBAL_KITTIES_PAGE_AUDIT_TTL_MS);
    return options.indexed;
  }
  setAuditWindow(globalKittiesPageAuditCache, cacheKey, GLOBAL_KITTIES_PAGE_AUDIT_TTL_MS);
  return {
    ...options.indexed,
    total: onchain.onchainTotal,
    items: onchain.items
  };
}

export async function listOwnerKittiesWithOnchainFallback(
  options: OnchainFallbackOptions & {
    owner: string;
    input: OwnerListInput;
    indexed: Awaited<ReturnType<KPEGRepository["listByOwner"]>>;
    force: boolean;
  }
): Promise<Awaited<ReturnType<KPEGRepository["listByOwner"]>>> {
  const owner = normalizeAddress(options.owner) as Address;
  const offset = options.input.offset ?? options.input.page * options.input.pageSize;
  const cacheKey = [
    options.config.chainId,
    options.config.tokenAddress.toLowerCase(),
    owner,
    options.input.sort,
    offset,
    options.input.pageSize
  ].join(":");
  const nextAuditAt = ownerKittiesPageCache.get(cacheKey);
  if (!options.force && nextAuditAt === undefined) {
    setAuditWindow(ownerKittiesPageCache, cacheKey, OWNER_KITTIES_PAGE_TTL_MS);
    return options.indexed;
  }
  const auditDue = (nextAuditAt ?? 0) <= Date.now();
  if (!options.force && !auditDue) {
    return options.indexed;
  }
  const client = buildClient(options.config);
  const onchainIdCacheKey = [
    options.config.chainId,
    options.config.tokenAddress.toLowerCase(),
    owner
  ].join(":");
  const onchainIds = await readOnchainOwnerIds(client, options.config.tokenAddress, owner, onchainIdCacheKey);
  const needsLatestRepair = shouldUseOnchainOwnerPage(
    options.indexed,
    onchainIds,
    offset,
    auditDue
  );
  const needsScarcityRepair =
    options.input.sort === "scarcity" &&
    (options.indexed.total < onchainIds.length || auditDue);
  if (
    (options.input.sort === "latest" && !needsLatestRepair) ||
    (options.input.sort === "scarcity" && !needsScarcityRepair)
  ) {
    setAuditWindow(ownerKittiesPageCache, cacheKey, OWNER_KITTIES_PAGE_TTL_MS);
    return options.indexed;
  }

  const indexedById = new Map(options.indexed.items.map((item) => [item.id, item]));
  const itemIds =
    options.input.sort === "scarcity"
      ? onchainIds
      : onchainIds.slice(offset, offset + options.input.pageSize);
  const items = await Promise.all(
    itemIds.map((id) =>
      readCurrentOwnerKitty(options, client, owner, indexedById, id)
    )
  );
  const sortedItems =
    options.input.sort === "scarcity"
      ? [...items]
          .sort((a, b) => b.rarityScore - a.rarityScore || b.id - a.id)
          .slice(offset, offset + options.input.pageSize)
      : items;
  setAuditWindow(ownerKittiesPageCache, cacheKey, OWNER_KITTIES_PAGE_TTL_MS);
  return {
    ...options.indexed,
    total: onchainIds.length,
    items: sortedItems
  };
}

async function readOnchainOwnerIds(
  client: ReturnType<typeof buildClient>,
  tokenAddress: Address,
  owner: Address,
  cacheKey: string
): Promise<number[]> {
  const cached = ownerKittiesIdCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ids;
  }
  const ids = (
    await client.readContract({
      address: tokenAddress,
      abi: KPEG_TOKEN_ABI,
      functionName: "getOwnerKitties",
      args: [owner]
    })
  ).map((id) => Number(id)).sort((a, b) => b - a);
  ownerKittiesIdCache.set(cacheKey, {
    ids,
    expiresAt: Date.now() + OWNER_KITTIES_ID_TTL_MS
  });
  return ids;
}

async function onchainOwnerHistoryCount(
  client: ReturnType<typeof buildClient>,
  config: ChainSyncConfig,
  owner: Address
): Promise<number> {
  const cacheKey = `${config.chainId}:${config.tokenAddress.toLowerCase()}:${owner}`;
  const cached = ownerHistoryCache.get(cacheKey);
  const toBlock = await client.getBlockNumber();
  if (cached && cached.expiresAt > Date.now() && cached.verifiedToBlock >= toBlock) {
    return cached.kittyIds.size;
  }

  const fromBlock =
    cached && cached.expiresAt > Date.now() ? cached.verifiedToBlock + 1n : await estimateStartBlock(client, config);
  const owned = cached && cached.expiresAt > Date.now() ? new Set(cached.kittyIds) : new Set<number>();
  if (fromBlock > toBlock) {
    ownerHistoryCache.set(cacheKey, {
      kittyIds: owned,
      verifiedToBlock: toBlock,
      expiresAt: Date.now() + OWNER_HISTORY_TTL_MS
    });
    return owned.size;
  }

  const [minted, burned, movedFrom, movedTo, singleFrom, singleTo] = await Promise.all([
    getLogsInChunks<{ args: { startKittyId?: bigint; count?: bigint } }>(client, {
      address: config.tokenAddress,
      event: BATCH_MINTED,
      args: { owner },
      fromBlock,
      toBlock
    }),
    getLogsInChunks<{ args: { startKittyId?: bigint; count?: bigint } }>(client, {
      address: config.tokenAddress,
      event: BATCH_BURNED,
      args: { owner },
      fromBlock,
      toBlock
    }),
    getLogsInChunks<{ args: { startKittyId?: bigint; count?: bigint } }>(client, {
      address: config.tokenAddress,
      event: BATCH_MOVED,
      args: { from: owner },
      fromBlock,
      toBlock
    }),
    getLogsInChunks<{ args: { startKittyId?: bigint; count?: bigint } }>(client, {
      address: config.tokenAddress,
      event: BATCH_MOVED,
      args: { to: owner },
      fromBlock,
      toBlock
    }),
    getLogsInChunks<{ args: { kittyId?: bigint } }>(client, {
      address: config.tokenAddress,
      event: KITTY_MOVED,
      args: { from: owner },
      fromBlock,
      toBlock
    }),
    getLogsInChunks<{ args: { kittyId?: bigint } }>(client, {
      address: config.tokenAddress,
      event: KITTY_MOVED,
      args: { to: owner },
      fromBlock,
      toBlock
    })
  ]);

  for (const log of [...minted, ...burned, ...movedFrom, ...movedTo]) {
    addRange(owned, log.args.startKittyId, log.args.count);
  }
  for (const log of [...singleFrom, ...singleTo]) {
    if (log.args.kittyId !== undefined) {
      owned.add(Number(log.args.kittyId));
    }
  }

  ownerHistoryCache.set(cacheKey, {
    kittyIds: owned,
    verifiedToBlock: toBlock,
    expiresAt: Date.now() + OWNER_HISTORY_TTL_MS
  });
  return owned.size;
}

export function shouldUseOnchainMarketPage(
  indexed: Awaited<ReturnType<KPEGRepository["listMarketListings"]>>,
  onchainTradeIds: readonly number[],
  offset: number,
  force: boolean,
  auditDue = false
): boolean {
  if (force) {
    return true;
  }
  if (onchainTradeIds.length === 0) {
    if (!auditDue) {
      return false;
    }
    return indexed.total > offset || indexed.items.length > 0;
  }
  if (auditDue || indexed.total < offset + onchainTradeIds.length) {
    return true;
  }
  const indexedIds = new Set(indexed.items.map((item) => item.tradeId));
  return onchainTradeIds.some((tradeId) => !indexedIds.has(tradeId));
}

export function mergeMarketStatsWithOnchain(indexed: MarketStats, onchain: MarketStats): MarketStats {
  const floorWei =
    indexed.floorWei === "0"
      ? onchain.floorWei
      : onchain.floorWei === "0"
        ? indexed.floorWei
        : minWei(indexed.floorWei, onchain.floorWei);
  return {
    floorWei,
    volumeWei: BigInt(indexed.volumeWei) >= BigInt(onchain.volumeWei) ? indexed.volumeWei : onchain.volumeWei,
    listed: Math.max(indexed.listed, onchain.listed)
  };
}

function sortMarketItems<T extends { tradeId: number; kitties: Array<{ rarityScore: number }> }>(
  items: T[],
  sort: SortMode
): T[] {
  if (sort === "scarcity") {
    return [...items].sort((a, b) => {
      const aRarity = Math.max(0, ...a.kitties.map((kitty) => kitty.rarityScore));
      const bRarity = Math.max(0, ...b.kitties.map((kitty) => kitty.rarityScore));
      return bRarity - aRarity || b.tradeId - a.tradeId;
    });
  }
  return [...items].sort((a, b) => b.tradeId - a.tradeId);
}

async function readAllMarketTradeIdsCached(
  client: ReturnType<typeof buildClient>,
  marketAddress: Address,
  tab: MarketTab,
  owner: Address | undefined
): Promise<readonly bigint[]> {
  const cacheKey = [marketAddress.toLowerCase(), tab, owner ?? "", "all"].join(":");
  const cached = marketAllTradeIdsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ids;
  }
  const ids: bigint[] = [];
  let offset = 0n;
  while (true) {
    const pageIds = await readMarketTradeIds(client, marketAddress, tab, owner, offset, 100n);
    ids.push(...pageIds);
    if (pageIds.length < 100) {
      break;
    }
    offset += BigInt(pageIds.length);
  }
  marketAllTradeIdsCache.set(cacheKey, {
    ids,
    expiresAt: Date.now() + MARKET_TRADE_IDS_TTL_MS
  });
  marketTabCountCache.set([marketAddress.toLowerCase(), tab, owner ?? ""].join(":"), {
    total: ids.length,
    expiresAt: Date.now() + MARKET_TAB_COUNT_TTL_MS
  });
  return ids;
}

async function readMarketTradeIdsPage(
  options: OnchainFallbackOptions,
  client: ReturnType<typeof buildClient>,
  marketAddress: Address,
  tab: MarketTab,
  owner: Address | undefined,
  offset: bigint,
  limit: bigint,
  sort: SortMode
): Promise<{ ids: readonly bigint[]; total: number }> {
  if (sort === "latest") {
    const allIds = await readAllMarketTradeIdsCached(client, marketAddress, tab, owner);
    const sorted = [...allIds].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    return {
      ids: sorted.slice(Number(offset), Number(offset + limit)),
      total: sorted.length
    };
  }
  const sortedByScarcity = await readAllMarketTradeIdsSortedByScarcityCached(
    options,
    client,
    marketAddress,
    tab,
    owner
  );
  const start = Number(offset);
  const end = Number(offset + limit);
  const ids = sortedByScarcity.slice(start, end);
  return {
    ids,
    total: sortedByScarcity.length
  };
}

export async function listMarketListingsWithOnchainFallback(
  options: OnchainFallbackOptions & {
    input: MarketListInput;
    indexed: Awaited<ReturnType<KPEGRepository["listMarketListings"]>>;
    force: boolean;
  }
): Promise<Awaited<ReturnType<KPEGRepository["listMarketListings"]>>> {
  if (!options.config.marketAddress || options.input.search?.trim()) {
    return options.indexed;
  }

  const owner = options.input.owner ? (normalizeAddress(options.input.owner) as Address) : undefined;
  const offset = BigInt(options.input.offset ?? options.input.page * options.input.pageSize);
  const limit = BigInt(options.input.pageSize);
  const cacheKey = [
    options.config.chainId,
    options.config.marketAddress.toLowerCase(),
    options.input.tab,
    owner ?? "",
    options.input.sort,
    Number(offset),
    options.input.pageSize
  ].join(":");
  const cachedPage = marketPageResultCache.get(cacheKey);
  if (cachedPage && cachedPage.expiresAt > Date.now()) {
    return {
      ...options.indexed,
      total: Math.max(options.indexed.total, cachedPage.total),
      items: sortMarketItems([...cachedPage.items], options.input.sort)
    };
  }
  const nextAuditAt = marketPageAuditCache.get(cacheKey);
  if (!options.force && nextAuditAt === undefined) {
    setAuditWindow(marketPageAuditCache, cacheKey, MARKET_PAGE_AUDIT_TTL_MS);
    return options.indexed;
  }
  const auditDue = (nextAuditAt ?? 0) <= Date.now();
  if (!options.force && !auditDue) {
    return options.indexed;
  }
  const client = buildClient(options.config);
  const page = await readMarketTradeIdsPage(
    options,
    client,
    options.config.marketAddress,
    options.input.tab,
    owner,
    offset,
    limit,
    options.input.sort
  );
  const tradeIds = page.ids;
  const numericTradeIds = tradeIds.map((tradeId) => Number(tradeId));
  if (!shouldUseOnchainMarketPage(options.indexed, numericTradeIds, Number(offset), options.force, auditDue)) {
    setAuditWindow(marketPageAuditCache, cacheKey, MARKET_PAGE_AUDIT_TTL_MS);
    return options.indexed;
  }
  const onchainTotal = page.total;
  if (tradeIds.length === 0) {
    return {
      ...options.indexed,
      total: onchainTotal,
      items: []
    };
  }

  const onchainItems = await mapSequential(
    tradeIds,
    async (tradeId) => {
      const position = await client.readContract({
        address: options.config.marketAddress!,
        abi: KPEG_MARKET_ABI,
        functionName: "getPositionView",
        args: [tradeId]
      });
      const kitties = (
        await mapSequential(
          position.kittyIds,
          async (kittyId) => {
            const id = Number(kittyId);
            const indexed = await options.repo.getKittyById(id);
            if (indexed) {
              return indexed;
            }
            const snapshot = await readOnchainKittySnapshot(
              client,
              options.config.tokenAddress,
              id
            );
            return snapshot ? asOnchainKittyDto(options.repo, snapshot) : null;
          }
        )
      ).filter((kitty): kitty is NonNullable<typeof kitty> => Boolean(kitty));
      return {
        tradeId: Number(position.tradeId),
        escrowAddress: normalizeAddress(position.escrowAddress),
        seller: normalizeAddress(position.seller),
        buyer: position.buyer.toLowerCase() === ZERO_ADDRESS ? null : normalizeAddress(position.buyer),
        paymentToken: normalizeAddress(position.paymentToken),
        priceWei: position.price.toString(),
        feeBps: Number(position.feeBps),
        kittyIds: position.kittyIds.map((kittyId) => Number(kittyId)),
        kittyCount: position.kittyIds.length,
        status: statusName(position.status),
        createdBlock: 0,
        createdTxHash: ZERO_TX,
        createdAt: 0,
        updatedAt: Date.now(),
        closedBlock: null,
        closedTxHash: null,
        closedAt: null,
        kitties
      };
    }
  );

  const indexedByTradeId = new Map(options.indexed.items.map((item) => [item.tradeId, item]));
  const merged = new Map(
    onchainItems.map((item) => {
      const indexed = indexedByTradeId.get(item.tradeId);
      return [item.tradeId, indexed ? { ...item, kitties: indexed.kitties } : item] as const;
    })
  );
  const items = sortMarketItems([...merged.values()], options.input.sort);
  marketPageResultCache.set(cacheKey, {
    total: onchainTotal,
    items,
    expiresAt: Date.now() + MARKET_PAGE_RESULT_TTL_MS
  });
  setAuditWindow(marketPageAuditCache, cacheKey, MARKET_PAGE_AUDIT_TTL_MS);
  return {
    ...options.indexed,
    total: Math.max(options.indexed.total, onchainTotal),
    items
  };
}

async function readMarketTradeIdsCached(
  client: ReturnType<typeof buildClient>,
  marketAddress: Address,
  tab: MarketTab,
  owner: Address | undefined,
  offset: bigint,
  limit: bigint
): Promise<readonly bigint[]> {
  const cacheKey = [marketAddress.toLowerCase(), tab, owner ?? "", offset.toString(), limit.toString()].join(":");
  const cached = marketTradeIdsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ids;
  }
  const ids = await readMarketTradeIds(client, marketAddress, tab, owner, offset, limit);
  marketTradeIdsCache.set(cacheKey, {
    ids,
    expiresAt: Date.now() + MARKET_TRADE_IDS_TTL_MS
  });
  return ids;
}

async function readAllMarketTradeIdsSortedByScarcityCached(
  options: OnchainFallbackOptions,
  client: ReturnType<typeof buildClient>,
  marketAddress: Address,
  tab: MarketTab,
  owner: Address | undefined
): Promise<readonly bigint[]> {
  const cacheKey = [
    options.config.chainId,
    marketAddress.toLowerCase(),
    tab,
    owner ?? "",
    "scarcity",
    "all",
  ].join(":");
  const cached = marketScarcitySortedTradeIdsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ids;
  }
  const allTradeIds = await readAllMarketTradeIdsCached(client, marketAddress, tab, owner);
  if (allTradeIds.length <= 1) {
    marketScarcitySortedTradeIdsCache.set(cacheKey, {
      ids: allTradeIds,
      expiresAt: Date.now() + MARKET_TRADE_IDS_TTL_MS
    });
    return allTradeIds;
  }

  const rows = await mapSequential(allTradeIds, async (tradeId) => {
    try {
      const position = await client.readContract({
        address: marketAddress,
        abi: KPEG_MARKET_ABI,
        functionName: "getPositionView",
        args: [tradeId]
      });
      const rarityScores = await mapSequential(
        position.kittyIds,
        async (kittyId) => {
          const id = Number(kittyId);
          const indexed = await options.repo.getKittyById(id);
          if (indexed) {
            return indexed.rarityScore;
          }
          const snapshot = await readOnchainKittySnapshot(
            client,
            options.config.tokenAddress,
            id
          );
          if (!snapshot || normalizeAddress(snapshot.owner) === ZERO_ADDRESS) {
            return 0;
          }
          return asOnchainKittyDto(options.repo, snapshot).rarityScore;
        }
      );
      const maxRarity = rarityScores.length > 0 ? Math.max(...rarityScores) : 0;
      return { tradeId, maxRarity };
    } catch {
      return { tradeId, maxRarity: 0 };
    }
  });

  const sorted = [...rows]
    .sort((a, b) => {
      if (a.maxRarity !== b.maxRarity) {
        return b.maxRarity - a.maxRarity;
      }
      if (a.tradeId === b.tradeId) {
        return 0;
      }
      return a.tradeId < b.tradeId ? 1 : -1;
    })
    .map((row) => row.tradeId);
  marketScarcitySortedTradeIdsCache.set(cacheKey, {
    ids: sorted,
    expiresAt: Date.now() + MARKET_TRADE_IDS_TTL_MS
  });
  return sorted;
}

export async function marketStatsWithOnchainFallback(
  options: OnchainFallbackOptions & {
    indexed: MarketStats;
  }
): Promise<MarketStats> {
  if (!options.config.marketAddress) {
    return options.indexed;
  }

  const cacheKey = `${options.config.chainId}:${options.config.marketAddress.toLowerCase()}:stats`;
  const cached = marketStatsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return mergeMarketStatsWithOnchain(options.indexed, cached.stats);
  }
  const refresh = refreshMarketStatsCache(cacheKey, options);
  if (!cached) {
    await refresh;
    const refreshed = marketStatsCache.get(cacheKey);
    if (refreshed && refreshed.expiresAt > Date.now()) {
      return mergeMarketStatsWithOnchain(options.indexed, refreshed.stats);
    }
  }
  void refresh.catch(() => undefined);
  if (cached) {
    return mergeMarketStatsWithOnchain(options.indexed, cached.stats);
  }
  return options.indexed;
}

async function refreshMarketStatsCache(
  cacheKey: string,
  options: OnchainFallbackOptions & { indexed: MarketStats }
): Promise<void> {
  const inFlight = marketStatsRefreshInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }
  const task = (async () => {
    const client = buildClient(options.config);
    const openStats = await readOpenMarketStats(client, options.config.marketAddress!);
    let volumeWei = options.indexed.volumeWei;
    try {
      const onchainVolumeWei = await readMarketVolumeWei(client, options.config);
      volumeWei = BigInt(volumeWei) >= BigInt(onchainVolumeWei) ? volumeWei : onchainVolumeWei;
    } catch (error) {
      if (volumeWei === "0") {
        throw error;
      }
    }
    marketStatsCache.set(cacheKey, {
      stats: { ...openStats, volumeWei },
      expiresAt: Date.now() + MARKET_STATS_TTL_MS
    });
  })().finally(() => {
    marketStatsRefreshInFlight.delete(cacheKey);
  });
  marketStatsRefreshInFlight.set(cacheKey, task);
  return task;
}

async function readOpenMarketStats(
  client: ReturnType<typeof buildClient>,
  marketAddress: Address
): Promise<{ floorWei: string; listed: number }> {
  let offset = 0n;
  let listed = 0;
  let floorWei = "0";
  while (true) {
    const tradeIds = await client.readContract({
      address: marketAddress,
      abi: KPEG_MARKET_ABI,
      functionName: "getOpenPositions",
      args: [offset, 100n]
    });
    if (tradeIds.length === 0) {
      break;
    }
    listed += tradeIds.length;
    const positions = await mapSequential(
      tradeIds,
      (tradeId) =>
        client.readContract({
          address: marketAddress,
          abi: KPEG_MARKET_ABI,
          functionName: "getPositionView",
          args: [tradeId]
        })
    );
    for (const position of positions) {
      const priceWei = position.price.toString();
      floorWei = floorWei === "0" ? priceWei : minWei(floorWei, priceWei);
    }
    if (tradeIds.length < 100) {
      break;
    }
    offset += BigInt(tradeIds.length);
  }
  return { floorWei, listed };
}

async function readMarketVolumeWei(
  client: ReturnType<typeof buildClient>,
  config: ChainSyncConfig
): Promise<string> {
  if (!config.marketAddress) {
    return "0";
  }
  const fromBlock = await estimateStartBlock(client, config);
  const toBlock = await client.getBlockNumber();
  const logs = await getLogsInChunks<{ args: { price?: bigint } }>(client, {
    address: config.marketAddress,
    event: POSITION_BOUGHT,
    args: {},
    fromBlock,
    toBlock
  });
  return logs.reduce((sum, log) => addWei(sum, log.args.price?.toString() ?? "0"), "0");
}

async function readMarketTradeIds(
  client: ReturnType<typeof buildClient>,
  marketAddress: Address,
  tab: MarketTab,
  owner: Address | undefined,
  offset: bigint,
  limit: bigint
): Promise<readonly bigint[]> {
  if (tab === "all") {
    return client.readContract({
      address: marketAddress,
      abi: KPEG_MARKET_ABI,
      functionName: "getOpenPositions",
      args: [offset, limit]
    });
  }
  if (!owner) {
    return [];
  }
  if (tab === "my-listings") {
    return client.readContract({
      address: marketAddress,
      abi: KPEG_MARKET_ABI,
      functionName: "getOpenPositionsByOwner",
      args: [owner, offset, limit]
    });
  }
  if (tab === "bought") {
    return client.readContract({
      address: marketAddress,
      abi: KPEG_MARKET_ABI,
      functionName: "getPurchasedPositions",
      args: [owner, offset, limit]
    });
  }
  return client.readContract({
    address: marketAddress,
    abi: KPEG_MARKET_ABI,
    functionName: "getCompletedPositions",
    args: [owner, offset, limit]
  });
}
