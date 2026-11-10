import { afterEach, describe, expect, it } from "vitest";
import type { MarketListing } from "../lib/api.js";
import {
  clearOptimisticMarketListings,
  filterSettleableOptimisticMarketListingTradeIds,
  readOptimisticMarketListings,
  settleOptimisticMarketListingsByDetails,
  upsertOptimisticMarketListing,
} from "../lib/optimisticMarketListings.js";

const scope = {
  chainId: 84532,
  marketAddress: "0x00000000000000000000000000000000000000aa",
};

function listing(tradeId: number, patch: Partial<MarketListing> = {}): MarketListing {
  return {
    tradeId,
    escrowAddress: "0x00000000000000000000000000000000000000bb",
    seller: "0x00000000000000000000000000000000000000cc",
    buyer: null,
    paymentToken: "0x0000000000000000000000000000000000000000",
    priceWei: "1000000000000000000",
    feeBps: 200,
    kittyIds: [tradeId],
    kittyCount: 1,
    status: "OPEN",
    createdBlock: 100,
    createdTxHash: `0x${"1".repeat(64)}`,
    createdAt: 1,
    updatedAt: 1,
    closedBlock: null,
    closedTxHash: null,
    closedAt: null,
    kitties: [],
    ...patch,
  };
}

describe("optimisticMarketListings", () => {
  afterEach(() => {
    clearOptimisticMarketListings(scope);
  });

  it("persists and deduplicates by trade id", () => {
    upsertOptimisticMarketListing(scope, {
      ...listing(1),
      txHash: `0x${"a".repeat(64)}`,
      blockNumber: 120,
    });
    upsertOptimisticMarketListing(scope, {
      ...listing(1, { priceWei: "2000000000000000000" }),
      txHash: `0x${"b".repeat(64)}`,
      blockNumber: 121,
    });
    const items = readOptimisticMarketListings(scope);
    expect(items).toHaveLength(1);
    expect(items[0]?.priceWei).toBe("2000000000000000000");
    expect(items[0]?.txHash).toBe(`0x${"b".repeat(64)}`);
  });

  it("clears by trade id", () => {
    upsertOptimisticMarketListing(scope, {
      ...listing(1),
      txHash: `0x${"a".repeat(64)}`,
      blockNumber: 120,
    });
    upsertOptimisticMarketListing(scope, {
      ...listing(2),
      txHash: `0x${"c".repeat(64)}`,
      blockNumber: 120,
    });
    clearOptimisticMarketListings(scope, [1]);
    const items = readOptimisticMarketListings(scope);
    expect(items.map((item) => item.tradeId)).toEqual([2]);
  });

  it("settles deleted overlays when detail is not found after indexed catch-up", () => {
    const deleted = {
      ...listing(9, { status: "DELETED", closedTxHash: `0x${"f".repeat(64)}` }),
      txHash: `0x${"f".repeat(64)}` as `0x${string}`,
      blockNumber: 150,
      createdAt: 1,
      expiresAt: Date.now() + 10_000,
    };
    const result = settleOptimisticMarketListingsByDetails({
      items: [deleted],
      latestIndexedBlock: 150,
      detailsByTradeId: new Map([[9, null]]),
    });
    expect(result.settledTradeIds).toEqual([9]);
    expect(result.conflicts).toEqual([]);
  });

  it("retains overlays and reports stale conflict when detail still disagrees", () => {
    const deleted = {
      ...listing(9, { status: "DELETED", closedTxHash: `0x${"f".repeat(64)}` }),
      txHash: `0x${"f".repeat(64)}` as `0x${string}`,
      blockNumber: 150,
      createdAt: 1,
      expiresAt: Date.now() + 10_000,
    };
    const result = settleOptimisticMarketListingsByDetails({
      items: [deleted],
      latestIndexedBlock: 150,
      detailsByTradeId: new Map([[9, listing(9, { status: "OPEN" })]]),
    });
    expect(result.settledTradeIds).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.actualStatus).toBe("OPEN");
    expect(result.conflicts[0]?.expectedStatus).toBe("DELETED");
  });

  it("requires exact OPEN price match before settling", () => {
    const updatedOpen = {
      ...listing(5, { status: "OPEN", priceWei: "2000000000000000000" }),
      txHash: `0x${"c".repeat(64)}` as `0x${string}`,
      blockNumber: 150,
      createdAt: 1,
      expiresAt: Date.now() + 10_000,
    };
    const mismatched = settleOptimisticMarketListingsByDetails({
      items: [updatedOpen],
      latestIndexedBlock: 150,
      detailsByTradeId: new Map([[5, listing(5, { status: "OPEN", priceWei: "1000000000000000000" })]]),
    });
    expect(mismatched.settledTradeIds).toEqual([]);
    expect(mismatched.conflicts).toHaveLength(1);

    const matched = settleOptimisticMarketListingsByDetails({
      items: [updatedOpen],
      latestIndexedBlock: 150,
      detailsByTradeId: new Map([[5, listing(5, { status: "OPEN", priceWei: "2000000000000000000" })]]),
    });
    expect(matched.settledTradeIds).toEqual([5]);
    expect(matched.conflicts).toEqual([]);
  });

  it("retains overlays when detail fetch was unresolved", () => {
    const sold = {
      ...listing(7, { status: "SOLD", buyer: "0x00000000000000000000000000000000000000dd" }),
      txHash: `0x${"d".repeat(64)}` as `0x${string}`,
      blockNumber: 150,
      createdAt: 1,
      expiresAt: Date.now() + 10_000,
    };
    const result = settleOptimisticMarketListingsByDetails({
      items: [sold],
      latestIndexedBlock: 150,
      detailsByTradeId: new Map(),
    });
    expect(result.settledTradeIds).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.actualStatus).toBe("UNKNOWN");
  });

  it("does not clear deleted settlement while cached listings still include the trade", () => {
    const deleted = {
      ...listing(11, { status: "DELETED", closedTxHash: `0x${"a".repeat(64)}` }),
      txHash: `0x${"a".repeat(64)}` as `0x${string}`,
      blockNumber: 220,
      createdAt: 1,
      expiresAt: Date.now() + 10_000,
    };
    const result = filterSettleableOptimisticMarketListingTradeIds({
      settledTradeIds: [11],
      items: [deleted],
      detailsByTradeId: new Map([[11, null]]),
      cachedTradeIds: new Set([11]),
    });
    expect(result.clearableTradeIds).toEqual([]);
    expect(result.blockedTradeIds).toEqual([11]);
  });

  it("clears deleted settlement after caches no longer include the trade", () => {
    const deleted = {
      ...listing(12, { status: "DELETED", closedTxHash: `0x${"b".repeat(64)}` }),
      txHash: `0x${"b".repeat(64)}` as `0x${string}`,
      blockNumber: 220,
      createdAt: 1,
      expiresAt: Date.now() + 10_000,
    };
    const result = filterSettleableOptimisticMarketListingTradeIds({
      settledTradeIds: [12],
      items: [deleted],
      detailsByTradeId: new Map([[12, null]]),
      cachedTradeIds: new Set<number>(),
    });
    expect(result.clearableTradeIds).toEqual([12]);
    expect(result.blockedTradeIds).toEqual([]);
  });
});
