import type { KittyItem } from "./api.js";

const OPTIMISTIC_OWNER_TRANSFERS_TTL_MS = 10 * 60_000;

export const OPTIMISTIC_OWNER_TRANSFERS_EVENT = "kpeg:optimistic-owner-transfers";

export type OptimisticOwnerTransfersScope = {
  chainId: number | null | undefined;
  tokenAddress: string | null | undefined;
};

export type OptimisticOwnerTransferReason =
  | "LISTING_FUNDED"
  | "LISTING_CANCELED"
  | "LISTING_BOUGHT"
  | "WALLET_TRANSFER";

export type OptimisticOwnerTransfer = {
  txHash: `0x${string}`;
  blockNumber: number;
  createdAt: number;
  expiresAt: number;
  from: string;
  to: string;
  kittyIds: number[];
  kitties: KittyItem[];
  reason: OptimisticOwnerTransferReason;
};

type StoredOptimisticOwnerTransfers = {
  expiresAt: number;
  transfers: OptimisticOwnerTransfer[];
};

function optimisticOwnerTransfersKey(
  scope: OptimisticOwnerTransfersScope,
): string | null {
  if (!scope.chainId || !scope.tokenAddress) {
    return null;
  }
  return `kpeg.optimisticOwnerTransfers.${scope.chainId}.${scope.tokenAddress.toLowerCase()}`;
}

function isStoredOptimisticOwnerTransfers(
  value: unknown,
): value is StoredOptimisticOwnerTransfers {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StoredOptimisticOwnerTransfers).expiresAt === "number" &&
    Array.isArray((value as StoredOptimisticOwnerTransfers).transfers)
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
  window.dispatchEvent(new CustomEvent(OPTIMISTIC_OWNER_TRANSFERS_EVENT));
}

function normalizeTransfer(
  transfer: OptimisticOwnerTransfer,
): OptimisticOwnerTransfer {
  return {
    ...transfer,
    from: transfer.from.toLowerCase(),
    to: transfer.to.toLowerCase(),
    kittyIds: [...new Set(transfer.kittyIds)].sort((a, b) => a - b),
    kitties: transfer.kitties.map((item) => ({
      ...item,
      owner: item.owner.toLowerCase(),
      mintedBy: item.mintedBy.toLowerCase(),
    })),
  };
}

function persistTransfers(
  key: string,
  transfers: OptimisticOwnerTransfer[],
): void {
  if (transfers.length === 0) {
    window.sessionStorage.removeItem(key);
    return;
  }
  const payload: StoredOptimisticOwnerTransfers = {
    expiresAt: Math.max(...transfers.map((item) => item.expiresAt)),
    transfers,
  };
  window.sessionStorage.setItem(key, JSON.stringify(payload));
}

export function readOptimisticOwnerTransfers(
  scope: OptimisticOwnerTransfersScope,
): OptimisticOwnerTransfer[] {
  if (typeof window === "undefined") {
    return [];
  }
  const key = optimisticOwnerTransfersKey(scope);
  if (!key) {
    return [];
  }
  const payload = readStorageJson(key);
  if (
    !isStoredOptimisticOwnerTransfers(payload) ||
    payload.expiresAt <= Date.now()
  ) {
    window.sessionStorage.removeItem(key);
    return [];
  }
  const now = Date.now();
  const filtered = payload.transfers
    .filter(
      (item) =>
        item.expiresAt > now &&
        Number.isFinite(item.blockNumber) &&
        item.blockNumber >= 0,
    )
    .map((item) => normalizeTransfer(item))
    .sort((a, b) => b.createdAt - a.createdAt);
  if (filtered.length !== payload.transfers.length) {
    persistTransfers(key, filtered);
  }
  return filtered;
}

export function appendOptimisticOwnerTransfer(
  scope: OptimisticOwnerTransfersScope,
  transfer: Omit<OptimisticOwnerTransfer, "createdAt" | "expiresAt"> & {
    ttlMs?: number;
  },
): void {
  if (typeof window === "undefined") {
    return;
  }
  const key = optimisticOwnerTransfersKey(scope);
  if (!key) {
    return;
  }
  const ttlMs = Math.max(1_000, transfer.ttlMs ?? OPTIMISTIC_OWNER_TRANSFERS_TTL_MS);
  const now = Date.now();
  const nextTransfer = normalizeTransfer({
    ...transfer,
    createdAt: now,
    expiresAt: now + ttlMs,
  });
  const existing = readOptimisticOwnerTransfers(scope);
  const byHash = new Map(existing.map((item) => [item.txHash, item]));
  byHash.set(nextTransfer.txHash, nextTransfer);
  const next = [...byHash.values()].sort((a, b) => b.createdAt - a.createdAt);
  persistTransfers(key, next);
  dispatchChangedEvent();
}

export function clearOptimisticOwnerTransfers(
  scope: OptimisticOwnerTransfersScope,
  txHashes?: readonly `0x${string}`[],
): void {
  if (typeof window === "undefined") {
    return;
  }
  const key = optimisticOwnerTransfersKey(scope);
  if (!key) {
    return;
  }
  if (!txHashes || txHashes.length === 0) {
    window.sessionStorage.removeItem(key);
    dispatchChangedEvent();
    return;
  }
  const txHashSet = new Set(txHashes);
  const remaining = readOptimisticOwnerTransfers(scope).filter(
    (item) => !txHashSet.has(item.txHash),
  );
  persistTransfers(key, remaining);
  dispatchChangedEvent();
}

export type OptimisticOwnerTransferConflict = {
  txHash: `0x${string}`;
  kittyId: number | null;
  expectedOwner: string;
  actualOwner: string | "NOT_FOUND" | "UNKNOWN";
};

export type ListingBoughtTransferPruneDecision =
  | "clear"
  | "retain"
  | "retain-conflict";

export function decideListingBoughtTransferPrune(input: {
  transfer: OptimisticOwnerTransfer;
  ownerAddress: string | null | undefined;
  verifiedOwnerIds?: ReadonlySet<number> | null;
  ownerVisibleIds?: ReadonlySet<number> | null;
  latestIndexedBlock: number;
  hasFreshOwnerLiveCounter: boolean;
}): ListingBoughtTransferPruneDecision {
  if (input.transfer.reason !== "LISTING_BOUGHT") {
    return "retain";
  }
  const normalizedOwner = input.ownerAddress?.toLowerCase();
  if (!normalizedOwner) {
    return "retain";
  }
  if (input.transfer.to !== normalizedOwner) {
    return "retain-conflict";
  }
  const ownsAllViaVerifiedIds =
    input.verifiedOwnerIds &&
    input.transfer.kittyIds.every((kittyId) =>
      input.verifiedOwnerIds?.has(kittyId),
    );
  if (ownsAllViaVerifiedIds) {
    return "clear";
  }
  if (!input.ownerVisibleIds) {
    return "retain";
  }
  const ownerVisibleHasAll = input.transfer.kittyIds.every((kittyId) =>
    input.ownerVisibleIds?.has(kittyId),
  );
  if (!ownerVisibleHasAll) {
    return "retain";
  }
  if (input.hasFreshOwnerLiveCounter) {
    return "clear";
  }
  const indexedCaughtUp =
    Number.isFinite(input.latestIndexedBlock) &&
    input.transfer.blockNumber > 0 &&
    input.latestIndexedBlock >= input.transfer.blockNumber;
  return indexedCaughtUp ? "clear" : "retain";
}

export function settleOptimisticOwnerTransfersByKittyOwners(input: {
  transfers: readonly OptimisticOwnerTransfer[];
  latestIndexedBlock: number;
  kittyDetailsById: ReadonlyMap<number, { owner: string } | null | undefined>;
}): {
  settledTxHashes: `0x${string}`[];
  conflicts: OptimisticOwnerTransferConflict[];
} {
  const { transfers, latestIndexedBlock, kittyDetailsById } = input;
  if (!Number.isFinite(latestIndexedBlock) || latestIndexedBlock <= 0) {
    return { settledTxHashes: [], conflicts: [] };
  }

  const settledTxHashes: `0x${string}`[] = [];
  const conflicts: OptimisticOwnerTransferConflict[] = [];
  for (const transfer of transfers) {
    if (transfer.blockNumber > latestIndexedBlock) {
      continue;
    }
    const expectedOwner = transfer.to.toLowerCase();
    let confirmed = true;
    for (const kittyId of transfer.kittyIds) {
      const detail = kittyDetailsById.get(kittyId);
      if (detail === undefined) {
        conflicts.push({
          txHash: transfer.txHash,
          kittyId,
          expectedOwner,
          actualOwner: "UNKNOWN",
        });
        confirmed = false;
        break;
      }
      if (detail === null) {
        conflicts.push({
          txHash: transfer.txHash,
          kittyId,
          expectedOwner,
          actualOwner: "NOT_FOUND",
        });
        confirmed = false;
        break;
      }
      if (detail.owner.toLowerCase() !== expectedOwner) {
        conflicts.push({
          txHash: transfer.txHash,
          kittyId,
          expectedOwner,
          actualOwner: detail.owner.toLowerCase(),
        });
        confirmed = false;
        break;
      }
    }
    if (confirmed) {
      settledTxHashes.push(transfer.txHash);
    }
  }
  return { settledTxHashes, conflicts };
}

export function nextOptimisticOwnerTransfersExpiryAt(
  scope: OptimisticOwnerTransfersScope,
): number {
  if (typeof window === "undefined") {
    return 0;
  }
  const transfers = readOptimisticOwnerTransfers(scope);
  if (transfers.length === 0) {
    return 0;
  }
  return Math.min(...transfers.map((item) => item.expiresAt));
}
