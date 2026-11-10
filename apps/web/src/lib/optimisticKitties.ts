import { KPEG_TOKEN_ABI, generateKPEGFromOnchainEntropy } from "@kpeg/core";
import { decodeEventLog, encodePacked, keccak256, type Address } from "viem";
import type { KittyItem } from "./api.js";

const LEGACY_OPTIMISTIC_KITTIES_KEY = "kpeg.optimisticKitties";
const LEGACY_OPTIMISTIC_KITTY_REMOVALS_KEY = "kpeg.optimisticKittyRemovals";
const OPTIMISTIC_TTL_MS = 5 * 60_000;

export const OPTIMISTIC_KITTIES_EVENT = "kpeg:optimistic-kitties";

type StoredOptimisticKitties = {
  expiresAt: number;
  kitties: KittyItem[];
};

export type OptimisticKittyRemoval = {
  txHash: `0x${string}`;
  owner: string;
  count: number;
  kittyIds: number[];
  blockNumber: number;
  createdAt: number;
  expiresAt: number;
};

type StoredOptimisticKittyRemovals = {
  expiresAt: number;
  removals: OptimisticKittyRemoval[];
};

export type OptimisticKittiesScope = {
  chainId: number | null | undefined;
  tokenAddress: string | null | undefined;
};

type ReceiptLog = {
  address?: string;
  data: `0x${string}`;
  topics: readonly `0x${string}`[];
};

type TradeReceipt = {
  blockNumber?: bigint | null;
  transactionHash?: `0x${string}`;
  gasUsed?: bigint;
  logs?: ReceiptLog[];
};

function optimisticStateKey(scope: OptimisticKittiesScope, suffix: string): string | null {
  if (!scope.chainId || !scope.tokenAddress) {
    return null;
  }
  return `kpeg.${suffix}.${scope.chainId}.${scope.tokenAddress.toLowerCase()}`;
}

function optimisticKittiesKey(scope: OptimisticKittiesScope): string | null {
  return optimisticStateKey(scope, "optimisticKitties");
}

function optimisticKittyRemovalsKey(scope: OptimisticKittiesScope): string | null {
  return optimisticStateKey(scope, "optimisticKittyRemovals");
}

function isStoredOptimisticKitties(value: unknown): value is StoredOptimisticKitties {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StoredOptimisticKitties).expiresAt === "number" &&
    Array.isArray((value as StoredOptimisticKitties).kitties)
  );
}

function isStoredOptimisticKittyRemovals(value: unknown): value is StoredOptimisticKittyRemovals {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StoredOptimisticKittyRemovals).expiresAt === "number" &&
    Array.isArray((value as StoredOptimisticKittyRemovals).removals)
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

function dispatchOptimisticStateChanged(): void {
  window.dispatchEvent(new CustomEvent(OPTIMISTIC_KITTIES_EVENT));
}

export function readOptimisticKitties(scope: OptimisticKittiesScope): KittyItem[] {
  if (typeof window === "undefined") {
    return [];
  }
  window.sessionStorage.removeItem(LEGACY_OPTIMISTIC_KITTIES_KEY);
  const key = optimisticKittiesKey(scope);
  if (!key) {
    return [];
  }
  const payload = readStorageJson(key);
  if (!isStoredOptimisticKitties(payload) || payload.expiresAt <= Date.now()) {
    window.sessionStorage.removeItem(key);
    return [];
  }
  return payload.kitties;
}

export function appendOptimisticKitties(
  kitties: KittyItem[],
  scope: OptimisticKittiesScope,
): void {
  if (typeof window === "undefined" || kitties.length === 0) {
    return;
  }
  const key = optimisticKittiesKey(scope);
  if (!key) {
    return;
  }
  const merged = new Map<number, KittyItem>();
  for (const kitty of readOptimisticKitties(scope)) {
    merged.set(kitty.id, kitty);
  }
  for (const kitty of kitties) {
    merged.set(kitty.id, kitty);
  }
  const payload: StoredOptimisticKitties = {
    expiresAt: Date.now() + OPTIMISTIC_TTL_MS,
    kitties: [...merged.values()].sort((a, b) => b.id - a.id),
  };
  window.sessionStorage.setItem(key, JSON.stringify(payload));
  dispatchOptimisticStateChanged();
}

export function clearOptimisticKitties(
  scope: OptimisticKittiesScope,
  kittyIds?: readonly number[],
): void {
  if (typeof window === "undefined") {
    return;
  }
  const key = optimisticKittiesKey(scope);
  if (!key) {
    return;
  }
  if (!kittyIds || kittyIds.length === 0) {
    window.sessionStorage.removeItem(key);
    dispatchOptimisticStateChanged();
    return;
  }
  const kittyIdSet = new Set(kittyIds);
  const remaining = readOptimisticKitties(scope).filter(
    (item) => !kittyIdSet.has(item.id),
  );
  if (remaining.length === 0) {
    window.sessionStorage.removeItem(key);
  } else {
    const payload: StoredOptimisticKitties = {
      expiresAt: Date.now() + OPTIMISTIC_TTL_MS,
      kitties: remaining.sort((a, b) => b.id - a.id),
    };
    window.sessionStorage.setItem(key, JSON.stringify(payload));
  }
  dispatchOptimisticStateChanged();
}

export function readOptimisticKittyRemovals(scope: OptimisticKittiesScope): OptimisticKittyRemoval[] {
  if (typeof window === "undefined") {
    return [];
  }
  window.sessionStorage.removeItem(LEGACY_OPTIMISTIC_KITTY_REMOVALS_KEY);
  const key = optimisticKittyRemovalsKey(scope);
  if (!key) {
    return [];
  }
  const payload = readStorageJson(key);
  if (!isStoredOptimisticKittyRemovals(payload) || payload.expiresAt <= Date.now()) {
    window.sessionStorage.removeItem(key);
    return [];
  }
  const now = Date.now();
  const removals = payload.removals.filter((item) => item.expiresAt > now && item.count > 0);
  if (removals.length !== payload.removals.length) {
    if (removals.length === 0) {
      window.sessionStorage.removeItem(key);
    } else {
      const expiresAt = Math.max(...removals.map((item) => item.expiresAt));
      window.sessionStorage.setItem(key, JSON.stringify({ expiresAt, removals }));
    }
  }
  return removals;
}

export function nextOptimisticStateExpiryAt(scope: OptimisticKittiesScope): number {
  if (typeof window === "undefined") {
    return 0;
  }
  const expiries: number[] = [];
  const kittiesKey = optimisticKittiesKey(scope);
  if (kittiesKey) {
    const payload = readStorageJson(kittiesKey);
    if (isStoredOptimisticKitties(payload)) {
      expiries.push(payload.expiresAt);
    }
  }
  const removalsKey = optimisticKittyRemovalsKey(scope);
  if (removalsKey) {
    const payload = readStorageJson(removalsKey);
    if (isStoredOptimisticKittyRemovals(payload)) {
      for (const removal of payload.removals) {
        expiries.push(removal.expiresAt);
      }
    }
  }
  return expiries.length > 0 ? Math.min(...expiries) : 0;
}

export function appendOptimisticKittyRemovals(
  removals: OptimisticKittyRemoval[],
  scope: OptimisticKittiesScope,
): void {
  if (typeof window === "undefined" || removals.length === 0) {
    return;
  }
  const key = optimisticKittyRemovalsKey(scope);
  if (!key) {
    return;
  }
  const now = Date.now();
  const merged = new Map<`0x${string}`, OptimisticKittyRemoval>();
  for (const existing of readOptimisticKittyRemovals(scope)) {
    if (existing.expiresAt > now) {
      merged.set(existing.txHash, existing);
    }
  }
  for (const removal of removals) {
    if (removal.count <= 0 || removal.expiresAt <= now) {
      continue;
    }
    const previous = merged.get(removal.txHash);
    if (!previous) {
      merged.set(removal.txHash, {
        ...removal,
        owner: removal.owner.toLowerCase(),
        kittyIds: [...new Set(removal.kittyIds)],
      });
      continue;
    }
    merged.set(removal.txHash, {
      ...previous,
      owner: removal.owner.toLowerCase(),
      count: Math.max(previous.count, removal.count),
      kittyIds: [...new Set([...previous.kittyIds, ...removal.kittyIds])],
      blockNumber: Math.max(previous.blockNumber, removal.blockNumber),
      createdAt: Math.min(previous.createdAt, removal.createdAt),
      expiresAt: Math.max(previous.expiresAt, removal.expiresAt),
    });
  }
  const next = [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);
  if (next.length === 0) {
    window.sessionStorage.removeItem(key);
    dispatchOptimisticStateChanged();
    return;
  }
  const payload: StoredOptimisticKittyRemovals = {
    expiresAt: Math.max(...next.map((item) => item.expiresAt)),
    removals: next,
  };
  window.sessionStorage.setItem(key, JSON.stringify(payload));
  dispatchOptimisticStateChanged();
}

export function clearOptimisticKittyRemovals(
  scope: OptimisticKittiesScope,
  txHashes?: readonly `0x${string}`[],
): void {
  if (typeof window === "undefined") {
    return;
  }
  const key = optimisticKittyRemovalsKey(scope);
  if (!key) {
    return;
  }
  if (!txHashes || txHashes.length === 0) {
    window.sessionStorage.removeItem(key);
    dispatchOptimisticStateChanged();
    return;
  }
  const txHashSet = new Set(txHashes);
  const remaining = readOptimisticKittyRemovals(scope).filter((item) => !txHashSet.has(item.txHash));
  if (remaining.length === 0) {
    window.sessionStorage.removeItem(key);
  } else {
    const payload: StoredOptimisticKittyRemovals = {
      expiresAt: Math.max(...remaining.map((item) => item.expiresAt)),
      removals: remaining,
    };
    window.sessionStorage.setItem(key, JSON.stringify(payload));
  }
  dispatchOptimisticStateChanged();
}

export function optimisticKittiesFromReceipt(input: {
  receipt: TradeReceipt | undefined;
  tokenAddress: Address | undefined;
}): KittyItem[] {
  if (!input.receipt?.logs || !input.tokenAddress || !input.receipt.transactionHash) {
    return [];
  }

  const mintedAt = Date.now();
  const out: KittyItem[] = [];
  for (const log of input.receipt.logs) {
    if (log.address?.toLowerCase() !== input.tokenAddress.toLowerCase()) {
      continue;
    }
    try {
      const decoded = decodeEventLog({
        abi: KPEG_TOKEN_ABI,
        eventName: "KittyBatchMinted",
        data: log.data,
        topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]],
      });
      const args = decoded.args;
      const startKittyId = args.startKittyId;
      const count = args.count;
      const mintTier = Number(args.tier) as 0 | 1 | 2 | 3 | 4;
      const batchSizeWhole = args.batchSizeWhole;

      for (let offset = 0n; offset < count; offset += 1n) {
        const kittyId = startKittyId + offset;
        const seed = keccak256(
          encodePacked(
            ["bytes32", "uint256", "uint8", "uint256"],
            [args.seedBase, kittyId, mintTier, batchSizeWhole],
          ),
        );
        const entropy = BigInt(
          keccak256(
            encodePacked(["bytes32", "uint256", "uint8"], [seed, kittyId, mintTier]),
          ),
        );
        const generated = generateKPEGFromOnchainEntropy({
          seed,
          tier: mintTier,
          entropy,
        });
        out.push({
          id: Number(kittyId),
          seed,
          tier: generated.kpegTier,
          tierLabel: generated.kpegTierLabel,
          mintTier: generated.mintTier,
          mintTierLabel: generated.mintTierLabel,
          owner: args.owner.toLowerCase(),
          mintedBy: args.owner.toLowerCase(),
          mintBatchSize: Number(batchSizeWhole),
          mintedAt,
          blockNumber: Number(input.receipt.blockNumber ?? 0n),
          txHash: input.receipt.transactionHash,
          gasUsed:
            input.receipt.gasUsed === undefined
              ? null
              : Number(input.receipt.gasUsed),
          baseFeeWei: null,
          rarityScore: Math.log10(generated.kpegRarityOneInN) * 100,
          traits: generated.traits,
          traitOdds: generated.traitOdds,
          kpegRarity: {
            label: "RARITY",
            percentage: generated.kpegRarityPct,
            oneInN: generated.kpegRarityOneInN,
            basis: "Rarity Probability",
          },
        });
      }
    } catch {
      continue;
    }
  }
  return out;
}

export function optimisticRemovalsFromReceipt(input: {
  receipt: TradeReceipt | undefined;
  tokenAddress: Address | undefined;
}): OptimisticKittyRemoval[] {
  if (!input.receipt?.logs || !input.tokenAddress || !input.receipt.transactionHash) {
    return [];
  }
  const now = Date.now();
  const byOwner = new Map<string, { count: number; kittyIds: number[] }>();

  for (const log of input.receipt.logs) {
    if (log.address?.toLowerCase() !== input.tokenAddress.toLowerCase()) {
      continue;
    }
    try {
      const decoded = decodeEventLog({
        abi: KPEG_TOKEN_ABI,
        eventName: "KittyBatchBurned",
        data: log.data,
        topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]],
      });
      const owner = decoded.args.owner.toLowerCase();
      const startKittyId = Number(decoded.args.startKittyId);
      const count = Number(decoded.args.count);
      if (!Number.isFinite(startKittyId) || !Number.isFinite(count) || count <= 0) {
        continue;
      }
      const existing = byOwner.get(owner) ?? { count: 0, kittyIds: [] };
      existing.count += count;
      for (let i = 0; i < count; i += 1) {
        existing.kittyIds.push(startKittyId + i);
      }
      byOwner.set(owner, existing);
    } catch {
      continue;
    }
  }

  return [...byOwner.entries()].map(([owner, value]) => ({
    txHash: input.receipt!.transactionHash!,
    owner,
    count: value.count,
    kittyIds: [...new Set(value.kittyIds)],
    blockNumber: Number(input.receipt?.blockNumber ?? 0n),
    createdAt: now,
    expiresAt: now + OPTIMISTIC_TTL_MS,
  }));
}
