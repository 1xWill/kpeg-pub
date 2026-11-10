import type { MarketListing } from "./api.js";

const OPTIMISTIC_MARKET_LISTINGS_TTL_MS = 10 * 60_000;

export const OPTIMISTIC_MARKET_LISTINGS_EVENT = "kpeg:optimistic-market-listings";

export type OptimisticMarketScope = {
  chainId: number | null | undefined;
  marketAddress: string | null | undefined;
};

export type OptimisticMarketListing = MarketListing & {
  txHash: `0x${string}`;
  blockNumber: number;
  createdAt: number;
  expiresAt: number;
};

type StoredOptimisticMarketListings = {
  expiresAt: number;
  listings: OptimisticMarketListing[];
};

function optimisticMarketListingsKey(scope: OptimisticMarketScope): string | null {
  if (!scope.chainId || !scope.marketAddress) {
    return null;
  }
  return `kpeg.optimisticMarketListings.${scope.chainId}.${scope.marketAddress.toLowerCase()}`;
}

function isStoredOptimisticMarketListings(
  value: unknown,
): value is StoredOptimisticMarketListings {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StoredOptimisticMarketListings).expiresAt === "number" &&
    Array.isArray((value as StoredOptimisticMarketListings).listings)
  );
}

function readStorageJson(key: string): unknown {
  const raw = window.sessionStorage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function dispatchChangedEvent(): void {
  window.dispatchEvent(new CustomEvent(OPTIMISTIC_MARKET_LISTINGS_EVENT));
}

function dedupeListings(
  listings: OptimisticMarketListing[],
): OptimisticMarketListing[] {
  const byTradeId = new Map<number, OptimisticMarketListing>();
  for (const listing of listings) {
    const existing = byTradeId.get(listing.tradeId);
    if (!existing || listing.createdAt >= existing.createdAt) {
      byTradeId.set(listing.tradeId, listing);
    }
  }
  return [...byTradeId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function persistListings(
  key: string,
  listings: OptimisticMarketListing[],
): void {
  if (listings.length === 0) {
    window.sessionStorage.removeItem(key);
    return;
  }
  const payload: StoredOptimisticMarketListings = {
    expiresAt: Math.max(...listings.map((item) => item.expiresAt)),
    listings,
  };
  window.sessionStorage.setItem(key, JSON.stringify(payload));
}

export function readOptimisticMarketListings(
  scope: OptimisticMarketScope,
): OptimisticMarketListing[] {
  if (typeof window === "undefined") {
    return [];
  }
  const key = optimisticMarketListingsKey(scope);
  if (!key) {
    return [];
  }
  const payload = readStorageJson(key);
  if (
    !isStoredOptimisticMarketListings(payload) ||
    payload.expiresAt <= Date.now()
  ) {
    window.sessionStorage.removeItem(key);
    return [];
  }

  const now = Date.now();
  const filtered = dedupeListings(
    payload.listings.filter(
      (item) =>
        Number.isFinite(item.tradeId) &&
        Number.isFinite(item.blockNumber) &&
        item.blockNumber >= 0 &&
        item.expiresAt > now,
    ),
  );
  if (filtered.length !== payload.listings.length) {
    persistListings(key, filtered);
  }
  return filtered;
}

export function upsertOptimisticMarketListing(
  scope: OptimisticMarketScope,
  listing: Omit<OptimisticMarketListing, "createdAt" | "expiresAt"> & {
    ttlMs?: number;
  },
): void {
  if (typeof window === "undefined") {
    return;
  }
  const key = optimisticMarketListingsKey(scope);
  if (!key) {
    return;
  }
  const ttlMs = Math.max(1_000, listing.ttlMs ?? OPTIMISTIC_MARKET_LISTINGS_TTL_MS);
  const now = Date.now();
  const nextItem: OptimisticMarketListing = {
    ...listing,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  const next = dedupeListings([...readOptimisticMarketListings(scope), nextItem]);
  persistListings(key, next);
  dispatchChangedEvent();
}

export function clearOptimisticMarketListings(
  scope: OptimisticMarketScope,
  tradeIds?: readonly number[],
): void {
  if (typeof window === "undefined") {
    return;
  }
  const key = optimisticMarketListingsKey(scope);
  if (!key) {
    return;
  }
  if (!tradeIds || tradeIds.length === 0) {
    window.sessionStorage.removeItem(key);
    dispatchChangedEvent();
    return;
  }
  const tradeIdSet = new Set(tradeIds);
  const remaining = readOptimisticMarketListings(scope).filter(
    (item) => !tradeIdSet.has(item.tradeId),
  );
  persistListings(key, remaining);
  dispatchChangedEvent();
}

function listingMatchesForSettlement(
  local: OptimisticMarketListing,
  server: MarketListing,
): boolean {
  if (local.status !== server.status) {
    return false;
  }
  if (local.status === "OPEN") {
    return local.priceWei === server.priceWei;
  }
  return true;
}

export type OptimisticMarketListingConflict = {
  tradeId: number;
  txHash: `0x${string}`;
  expectedStatus: OptimisticMarketListing["status"];
  actualStatus: OptimisticMarketListing["status"] | "NOT_FOUND" | "UNKNOWN";
  expectedPriceWei: string;
  actualPriceWei: string | null;
};

export function settleOptimisticMarketListingsByDetails(input: {
  items: readonly OptimisticMarketListing[];
  latestIndexedBlock: number;
  detailsByTradeId: ReadonlyMap<number, MarketListing | null | undefined>;
}): {
  settledTradeIds: number[];
  conflicts: OptimisticMarketListingConflict[];
} {
  const { items, latestIndexedBlock, detailsByTradeId } = input;
  if (!Number.isFinite(latestIndexedBlock) || latestIndexedBlock <= 0) {
    return { settledTradeIds: [], conflicts: [] };
  }

  const settledTradeIds: number[] = [];
  const conflicts: OptimisticMarketListingConflict[] = [];
  for (const item of items) {
    if (item.blockNumber > latestIndexedBlock) {
      continue;
    }
    const detail = detailsByTradeId.get(item.tradeId);
    if (detail === undefined) {
      conflicts.push({
        tradeId: item.tradeId,
        txHash: item.txHash,
        expectedStatus: item.status,
        actualStatus: "UNKNOWN",
        expectedPriceWei: item.priceWei,
        actualPriceWei: null,
      });
      continue;
    }
    if (detail === null) {
      if (item.status === "DELETED") {
        settledTradeIds.push(item.tradeId);
      } else {
        conflicts.push({
          tradeId: item.tradeId,
          txHash: item.txHash,
          expectedStatus: item.status,
          actualStatus: "NOT_FOUND",
          expectedPriceWei: item.priceWei,
          actualPriceWei: null,
        });
      }
      continue;
    }
    if (!listingMatchesForSettlement(item, detail)) {
      conflicts.push({
        tradeId: item.tradeId,
        txHash: item.txHash,
        expectedStatus: item.status,
        actualStatus: detail.status,
        expectedPriceWei: item.priceWei,
        actualPriceWei: detail.priceWei,
      });
      continue;
    }
    settledTradeIds.push(item.tradeId);
  }
  return { settledTradeIds, conflicts };
}

export function filterSettleableOptimisticMarketListingTradeIds(input: {
  settledTradeIds: readonly number[];
  items: readonly OptimisticMarketListing[];
  detailsByTradeId: ReadonlyMap<number, MarketListing | null | undefined>;
  cachedTradeIds: ReadonlySet<number>;
}): {
  clearableTradeIds: number[];
  blockedTradeIds: number[];
} {
  const itemByTradeId = new Map(
    input.items.map((item) => [item.tradeId, item] as const),
  );
  const clearableTradeIds: number[] = [];
  const blockedTradeIds: number[] = [];
  for (const tradeId of input.settledTradeIds) {
    const item = itemByTradeId.get(tradeId);
    if (!item || item.status !== "DELETED") {
      clearableTradeIds.push(tradeId);
      continue;
    }
    const detail = input.detailsByTradeId.get(tradeId);
    if (detail !== null || !input.cachedTradeIds.has(tradeId)) {
      clearableTradeIds.push(tradeId);
      continue;
    }
    blockedTradeIds.push(tradeId);
  }
  return { clearableTradeIds, blockedTradeIds };
}

export function nextOptimisticMarketListingsExpiryAt(
  scope: OptimisticMarketScope,
): number {
  if (typeof window === "undefined") {
    return 0;
  }
  const items = readOptimisticMarketListings(scope);
  if (items.length === 0) {
    return 0;
  }
  return Math.min(...items.map((item) => item.expiresAt));
}
