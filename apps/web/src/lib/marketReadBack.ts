import { KPEG_MARKET_ABI } from "@kpeg/core";
import { zeroAddress, type Address, type PublicClient } from "viem";
import type { MarketListing } from "./api.js";

export type MarketReadBackContext = { receiptBlock: number | null };

export type MarketTxOutcomeSuccess<T> = {
  status: "success";
  receiptBlock: number;
  value: T;
};

export type MarketTxOutcome =
  | { status: "reverted"; error: Error }
  | { status: "pending"; error: Error };

type MarketTxOutcomeInput<T> = {
  hash: `0x${string}`;
  publicClient: PublicClient;
  readBack: (ctx: MarketReadBackContext) => Promise<T | null>;
  readBackViaConnectedWallet?: (
    ctx: MarketReadBackContext,
  ) => Promise<T | null>;
  timeoutMs?: number;
  raceReadBack?: boolean;
  readBackPollIntervalMs?: number;
};

export type MarketPositionViewOnChain = {
  tradeId: bigint;
  seller: Address;
  buyer: Address;
  escrowAddress: Address;
  paymentToken: Address;
  price: bigint;
  feeBps: bigint;
  kittyIds: readonly bigint[];
  status: number | bigint;
  ready: boolean;
};

export type ReadContractDelegate = (request: {
  address: Address;
  abi: typeof KPEG_MARKET_ABI;
  functionName: string;
  args?: readonly unknown[];
}) => Promise<unknown>;

type ListingConfirmation = {
  tradeId: number;
  escrowAddress: Address;
  createdBlock: number;
};

const MARKET_POSITION_STATUS_OPEN = 0;
const MARKET_POSITION_STATUS_SOLD = 1;
const MARKET_POSITION_STATUS_DELETED = 2;
export const MARKET_BUY_LISTING_CHANGED_ERROR = "Listing changed on-chain.";
export const MARKET_BUY_LISTING_VERIFY_FAILED_ERROR =
  "Could not verify listing from chain.";

function toError(error: unknown, fallback = "Unknown error"): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function isTimeoutLikeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("timed out") || message.includes("timeout");
}

function isRevertLikeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("execution reverted") ||
    message.includes("transaction failed") ||
    message.includes("reverted")
  );
}

async function readBackWithFallback<T>(
  input: MarketTxOutcomeInput<T>,
  ctx: MarketReadBackContext,
): Promise<T | null> {
  try {
    const primary = await input.readBack(ctx);
    if (primary !== null) {
      return primary;
    }
  } catch {
    // Continue to connected-wallet fallback when primary read-back throws.
  }
  if (!input.readBackViaConnectedWallet) {
    return null;
  }
  try {
    return await input.readBackViaConnectedWallet(ctx);
  } catch {
    return null;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

type ReceiptWaitOutcome =
  | { status: "success"; receiptBlock: number }
  | { status: "reverted"; error: Error }
  | { status: "error"; error: Error; timeout: boolean };

async function waitForReceiptOutcome<T>(
  input: MarketTxOutcomeInput<T>,
  timeoutMs: number,
): Promise<ReceiptWaitOutcome> {
  try {
    const receipt = await input.publicClient.waitForTransactionReceipt({
      hash: input.hash,
      timeout: timeoutMs,
    });
    if (receipt.status !== "success") {
      return {
        status: "reverted",
        error: new Error("Transaction reverted onchain."),
      };
    }
    return {
      status: "success",
      receiptBlock: Number(receipt.blockNumber),
    };
  } catch (error) {
    if (isRevertLikeError(error)) {
      return {
        status: "reverted",
        error: toError(error, "Transaction reverted onchain."),
      };
    }
    return {
      status: "error",
      error: toError(error, "Transaction confirmation is still pending."),
      timeout: isTimeoutLikeError(error),
    };
  }
}

async function finalizeFromReceiptOutcome<T>(
  input: MarketTxOutcomeInput<T>,
  outcome: ReceiptWaitOutcome,
): Promise<MarketTxOutcomeSuccess<T> | MarketTxOutcome> {
  if (outcome.status === "reverted") {
    return {
      status: "reverted",
      error: outcome.error,
    };
  }
  if (outcome.status === "success") {
    const readValue = await readBackWithFallback(input, {
      receiptBlock: outcome.receiptBlock,
    });
    if (readValue !== null) {
      return {
        status: "success",
        receiptBlock: outcome.receiptBlock,
        value: readValue,
      };
    }
    return {
      status: "pending",
      error: new Error("Transaction mined but read-back is not ready yet."),
    };
  }
  const readValue = await readBackWithFallback(input, { receiptBlock: null });
  if (readValue !== null) {
    return {
      status: "success",
      receiptBlock: 0,
      value: readValue,
    };
  }
  return {
    status: "pending",
    error: outcome.timeout
      ? new Error("Transaction confirmation timed out.")
      : outcome.error,
  };
}

export async function waitForMarketTxOutcome<T>(
  input: MarketTxOutcomeInput<T>,
): Promise<MarketTxOutcomeSuccess<T> | MarketTxOutcome> {
  const timeoutMs = input.timeoutMs ?? 90_000;
  if (!input.raceReadBack) {
    const receiptOutcome = await waitForReceiptOutcome(input, timeoutMs);
    return finalizeFromReceiptOutcome(input, receiptOutcome);
  }

  const pollIntervalMs = Math.max(250, input.readBackPollIntervalMs ?? 2_000);
  const deadlineAt = Date.now() + timeoutMs;
  let receiptOutcomePromise: Promise<ReceiptWaitOutcome> | null =
    waitForReceiptOutcome(input, timeoutMs);

  while (Date.now() < deadlineAt) {
    const readValue = await readBackWithFallback(input, { receiptBlock: null });
    if (readValue !== null) {
      return {
        status: "success",
        receiptBlock: 0,
        value: readValue,
      };
    }
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    if (!receiptOutcomePromise) {
      receiptOutcomePromise = waitForReceiptOutcome(input, remainingMs);
    }
    const next = await Promise.race<
      | { kind: "receipt"; outcome: ReceiptWaitOutcome }
      | { kind: "tick" }
    >([
      receiptOutcomePromise.then((outcome) => ({ kind: "receipt", outcome })),
      wait(Math.min(pollIntervalMs, remainingMs)).then(() => ({ kind: "tick" })),
    ]);
    if (next.kind === "receipt") {
      if (next.outcome.status === "error" && !next.outcome.timeout) {
        // Treat non-revert receipt watcher errors as transient and keep polling.
        receiptOutcomePromise = null;
        continue;
      }
      return finalizeFromReceiptOutcome(input, next.outcome);
    }
  }

  const finalReadValue = await readBackWithFallback(input, { receiptBlock: null });
  if (finalReadValue !== null) {
    return {
      status: "success",
      receiptBlock: 0,
      value: finalReadValue,
    };
  }

  if (!receiptOutcomePromise) {
    return {
      status: "pending",
      error: new Error("Transaction confirmation timed out."),
    };
  }
  const maybeReceipt = await Promise.race<
    { kind: "receipt"; outcome: ReceiptWaitOutcome } | { kind: "none" }
  >([
    receiptOutcomePromise.then((outcome) => ({ kind: "receipt", outcome })),
    Promise.resolve({ kind: "none" }),
  ]);
  if (maybeReceipt.kind === "receipt") {
    if (maybeReceipt.outcome.status === "error" && !maybeReceipt.outcome.timeout) {
      return {
        status: "pending",
        error: new Error("Transaction confirmation timed out."),
      };
    }
    return finalizeFromReceiptOutcome(input, maybeReceipt.outcome);
  }
  return {
    status: "pending",
    error: new Error("Transaction confirmation timed out."),
  };
}

export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function toSortedNumberArray(
  values: readonly bigint[] | readonly number[],
): number[] {
  return [...values].map((value) => Number(value)).sort((a, b) => a - b);
}

export function sortedIdsEqual(
  left: readonly number[],
  right: readonly number[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

export function marketStatusFromChain(
  status: number | bigint,
): MarketListing["status"] | null {
  const normalized = Number(status);
  if (normalized === MARKET_POSITION_STATUS_OPEN) return "OPEN";
  if (normalized === MARKET_POSITION_STATUS_SOLD) return "SOLD";
  if (normalized === MARKET_POSITION_STATUS_DELETED) return "DELETED";
  return null;
}

export function apiListingMatchesSubmittedFields(input: {
  listing: MarketListing;
  seller: Address;
  kittyIds: readonly number[];
  priceWei: bigint;
}): boolean {
  if (input.listing.status !== "OPEN") {
    return false;
  }
  if (!sameAddress(input.listing.seller, input.seller)) {
    return false;
  }
  if (input.listing.priceWei !== input.priceWei.toString()) {
    return false;
  }
  return sortedIdsEqual(
    toSortedNumberArray(input.listing.kittyIds),
    toSortedNumberArray(input.kittyIds),
  );
}

export function canTrustApiNotFoundAfterReceiptBlock(
  latestIndexedBlock: number | null | undefined,
  receiptBlock: number | null,
): boolean {
  if (receiptBlock === null || receiptBlock <= 0) {
    return false;
  }
  if (!Number.isFinite(latestIndexedBlock) || (latestIndexedBlock ?? 0) <= 0) {
    return false;
  }
  return (latestIndexedBlock ?? 0) >= receiptBlock;
}

export async function readMarketPositionViewViaConnectedWallet(input: {
  readContract: ReadContractDelegate;
  marketAddress: Address;
  tradeId: bigint;
}): Promise<MarketPositionViewOnChain | null> {
  try {
    return (await input.readContract({
      address: input.marketAddress,
      abi: KPEG_MARKET_ABI,
      functionName: "getPositionView",
      args: [input.tradeId],
    })) as MarketPositionViewOnChain;
  } catch {
    return null;
  }
}

export async function readMarketPositionViewViaPublicClient(input: {
  publicClient: PublicClient;
  marketAddress: Address;
  tradeId: bigint;
}): Promise<MarketPositionViewOnChain | null> {
  return readMarketPositionViewViaConnectedWallet({
    marketAddress: input.marketAddress,
    tradeId: input.tradeId,
    readContract: (request) =>
      input.publicClient.readContract(request as never) as Promise<unknown>,
  });
}

async function findOwnerOpenListingMatchByChainWithDelegate(input: {
  readContract: ReadContractDelegate;
  marketAddress: Address;
  owner: Address;
  kittyIds: readonly number[];
  priceWei: bigint;
}): Promise<{ tradeId: number; escrowAddress: Address } | null> {
  const normalizedKittyIds = toSortedNumberArray(input.kittyIds);
  const pageSize = 100n;
  let offset = 0n;
  while (true) {
    const tradeIds = (await input.readContract({
      address: input.marketAddress,
      abi: KPEG_MARKET_ABI,
      functionName: "getOpenPositionsByOwner",
      args: [input.owner, offset, pageSize],
    })) as readonly bigint[];
    if (tradeIds.length === 0) {
      return null;
    }
    for (const tradeId of tradeIds) {
      const view = await readMarketPositionViewViaConnectedWallet({
        readContract: input.readContract,
        marketAddress: input.marketAddress,
        tradeId,
      });
      if (!view) {
        continue;
      }
      if (marketStatusFromChain(view.status) !== "OPEN" || !view.ready) {
        continue;
      }
      if (!sameAddress(view.seller, input.owner)) {
        continue;
      }
      if (view.price !== input.priceWei) {
        continue;
      }
      if (!sortedIdsEqual(toSortedNumberArray(view.kittyIds), normalizedKittyIds)) {
        continue;
      }
      return { tradeId: Number(tradeId), escrowAddress: view.escrowAddress };
    }
    if (tradeIds.length < Number(pageSize)) {
      return null;
    }
    offset += BigInt(tradeIds.length);
  }
}

export async function findOwnerOpenListingMatchByChain(input: {
  publicClient: PublicClient;
  marketAddress: Address;
  owner: Address;
  kittyIds: readonly number[];
  priceWei: bigint;
}): Promise<{ tradeId: number; escrowAddress: Address } | null> {
  return findOwnerOpenListingMatchByChainWithDelegate({
    ...input,
    readContract: (request) =>
      input.publicClient.readContract(request as never) as Promise<unknown>,
  });
}

export async function findOwnerOpenListingMatchByChainViaConnectedWallet(input: {
  readContract: ReadContractDelegate;
  marketAddress: Address;
  owner: Address;
  kittyIds: readonly number[];
  priceWei: bigint;
}): Promise<{ tradeId: number; escrowAddress: Address } | null> {
  return findOwnerOpenListingMatchByChainWithDelegate(input);
}

export async function findListingFromApiByCreatedTxHash(input: {
  owner: Address;
  txHash: `0x${string}`;
  listMyListingsPage: (
    offset: number,
    pageSize: number,
  ) => Promise<{ items: MarketListing[]; total: number }>;
}): Promise<MarketListing | null> {
  const pageSize = 100;
  let offset = 0;
  while (true) {
    const page = await input.listMyListingsPage(offset, pageSize);
    const found = page.items.find(
      (item) => item.createdTxHash.toLowerCase() === input.txHash.toLowerCase(),
    );
    if (found) {
      return found;
    }
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) {
      return null;
    }
  }
}

export async function resolveListingReadBack(input: {
  ctx: MarketReadBackContext;
  seller: Address;
  kittyIds: readonly number[];
  priceWei: bigint;
  readFromReceipt: () => Promise<
    { tradeId: number; escrowAddress: Address; createdBlock: number } | null
  >;
  readFromApi: () => Promise<MarketListing | null>;
  readFromChain: () => Promise<{ tradeId: number; escrowAddress: Address } | null>;
}): Promise<ListingConfirmation | null> {
  const receiptResult = await input.readFromReceipt().catch(() => null);
  if (receiptResult) {
    return receiptResult;
  }
  const indexedListing = await input.readFromApi().catch(() => null);
  if (
    indexedListing &&
    apiListingMatchesSubmittedFields({
      listing: indexedListing,
      seller: input.seller,
      kittyIds: input.kittyIds,
      priceWei: input.priceWei,
    })
  ) {
    return {
      tradeId: indexedListing.tradeId,
      escrowAddress: indexedListing.escrowAddress as Address,
      createdBlock: indexedListing.createdBlock,
    };
  }
  const chainMatched = await input.readFromChain().catch(() => null);
  if (!chainMatched) {
    return null;
  }
  return {
    tradeId: chainMatched.tradeId,
    escrowAddress: chainMatched.escrowAddress,
    createdBlock: input.ctx.receiptBlock ?? 0,
  };
}

export async function resolveCancelReadBack(input: {
  ctx: MarketReadBackContext;
  latestIndexedBlock: number | null | undefined;
  readChainPosition: () => Promise<MarketPositionViewOnChain | null>;
  readIndexedListing: () => Promise<MarketListing | null>;
}): Promise<{ blockNumber: number } | null> {
  const onchain = await input.readChainPosition().catch(() => null);
  if (onchain && marketStatusFromChain(onchain.status) === "DELETED") {
    return { blockNumber: input.ctx.receiptBlock ?? 0 };
  }
  const indexed = await input.readIndexedListing().catch(() => null);
  if (indexed?.status === "DELETED") {
    return { blockNumber: indexed.closedBlock ?? 0 };
  }
  if (
    !indexed &&
    canTrustApiNotFoundAfterReceiptBlock(
      input.latestIndexedBlock,
      input.ctx.receiptBlock,
    )
  ) {
    return { blockNumber: input.ctx.receiptBlock ?? 0 };
  }
  return null;
}

export async function resolveBuyReadBack(input: {
  readChainPosition: () => Promise<MarketPositionViewOnChain | null>;
  readIndexedListing: () => Promise<MarketListing | null>;
  verifyOwnership: () => Promise<boolean>;
}): Promise<{ blockNumber: number } | null> {
  const onchain = await input.readChainPosition().catch(() => null);
  if (onchain && marketStatusFromChain(onchain.status) === "SOLD") {
    return { blockNumber: 0 };
  }
  const indexed = await input.readIndexedListing().catch(() => null);
  if (indexed?.status === "SOLD") {
    return { blockNumber: indexed.closedBlock ?? 0 };
  }
  const ownsAll = await input.verifyOwnership().catch(() => false);
  if (ownsAll) {
    return { blockNumber: 0 };
  }
  return null;
}

export function marketBuyListingMatchesOnchainView(input: {
  listing: MarketListing;
  onchain: MarketPositionViewOnChain;
}): boolean {
  if (marketStatusFromChain(input.onchain.status) !== "OPEN") {
    return false;
  }
  if (!input.onchain.ready) {
    return false;
  }
  if (!sameAddress(input.onchain.seller, input.listing.seller)) {
    return false;
  }
  if (!sameAddress(input.onchain.paymentToken, zeroAddress)) {
    return false;
  }
  if (input.onchain.price !== BigInt(input.listing.priceWei)) {
    return false;
  }
  if (
    !sortedIdsEqual(
      toSortedNumberArray(input.onchain.kittyIds),
      toSortedNumberArray(input.listing.kittyIds),
    )
  ) {
    return false;
  }
  if (
    input.listing.escrowAddress &&
    !sameAddress(input.onchain.escrowAddress, input.listing.escrowAddress)
  ) {
    return false;
  }
  return true;
}

export async function verifyMarketBuyListing(input: {
  listing: MarketListing;
  readChainPosition: () => Promise<MarketPositionViewOnChain | null>;
}): Promise<void> {
  let onchain: MarketPositionViewOnChain | null = null;
  try {
    onchain = await input.readChainPosition();
  } catch {
    onchain = null;
  }
  if (!onchain) {
    throw new Error(MARKET_BUY_LISTING_VERIFY_FAILED_ERROR);
  }
  if (!marketBuyListingMatchesOnchainView({ listing: input.listing, onchain })) {
    throw new Error(MARKET_BUY_LISTING_CHANGED_ERROR);
  }
}

export async function resolveUpdateReadBack(input: {
  expectedPriceWei: bigint;
  readChainPosition: () => Promise<MarketPositionViewOnChain | null>;
  readIndexedListing: () => Promise<MarketListing | null>;
}): Promise<{ blockNumber: number } | null> {
  const onchain = await input.readChainPosition().catch(() => null);
  if (
    onchain &&
    marketStatusFromChain(onchain.status) === "OPEN" &&
    onchain.price === input.expectedPriceWei
  ) {
    return { blockNumber: 0 };
  }
  const indexed = await input.readIndexedListing().catch(() => null);
  if (
    indexed &&
    indexed.status === "OPEN" &&
    indexed.priceWei === input.expectedPriceWei.toString()
  ) {
    return { blockNumber: 0 };
  }
  return null;
}
