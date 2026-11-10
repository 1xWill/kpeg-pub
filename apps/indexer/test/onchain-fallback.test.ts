import { describe, expect, it } from "vitest";
import {
  mergeMarketStatsWithOnchain,
  mergeOwnerStatsWithOnchain,
  shouldUseOnchainGlobalPage,
  shouldUseOnchainOwnerPage,
  shouldUseOnchainMarketPage
} from "../src/onchain-fallback.js";

function indexedMarket(tradeIds: number[], total = tradeIds.length) {
  return {
    page: 0,
    pageSize: 10,
    total,
    items: tradeIds.map((tradeId) => ({
      tradeId,
      escrowAddress: "0x0000000000000000000000000000000000000000",
      seller: "0x0000000000000000000000000000000000000001",
      buyer: null,
      paymentToken: "0x0000000000000000000000000000000000000000",
      priceWei: "1",
      feeBps: 200,
      kittyIds: [tradeId],
      kittyCount: 1,
      status: "OPEN" as const,
      createdBlock: 1,
      createdTxHash: `0x${"0".repeat(64)}` as const,
      createdAt: 1,
      updatedAt: 1,
      closedBlock: null,
      closedTxHash: null,
      closedAt: null,
      kitties: []
    }))
  };
}

function indexedOwner(kittyIds: number[], total = kittyIds.length) {
  return {
    page: 0,
    pageSize: 10,
    total,
    items: kittyIds.map((id) => ({
      id,
      rarityScore: id,
    }))
  } as any;
}

function indexedGlobal(kittyIds: number[], total = kittyIds.length) {
  return {
    page: 0,
    pageSize: 10,
    total,
    items: kittyIds.map((id) => ({
      id,
      rarityScore: id,
    }))
  } as any;
}

describe("onchain fallback decisions", () => {
  it("repairs market stats from onchain values without lowering DB volume", () => {
    expect(
      mergeMarketStatsWithOnchain(
        { listed: 0, floorWei: "0", volumeWei: "100" },
        { listed: 2, floorWei: "50", volumeWei: "80" }
      )
    ).toEqual({ listed: 2, floorWei: "50", volumeWei: "100" });
  });

  it("keeps the lower known floor price when DB and onchain stats differ", () => {
    expect(
      mergeMarketStatsWithOnchain(
        { listed: 1, floorWei: "40", volumeWei: "0" },
        { listed: 1, floorWei: "50", volumeWei: "10" }
      )
    ).toEqual({ listed: 1, floorWei: "40", volumeWei: "10" });
  });

  it("counts sold historical kitties in ever-owned without inflating current ownership", () => {
    expect(
      mergeOwnerStatsWithOnchain(
        { currentKitties: 87, everKitties: 87 },
        87,
        3,
        90
      )
    ).toEqual({ currentKitties: 87, everKitties: 90 });
  });

  it("uses onchain live/history ownership over stale indexed counts", () => {
    expect(
      mergeOwnerStatsWithOnchain(
        { currentKitties: 100, everKitties: 100 },
        87,
        3,
        90
      )
    ).toEqual({ currentKitties: 87, everKitties: 90 });
  });

  it("audits market pages when the DB has rows but is missing onchain trade ids", () => {
    expect(shouldUseOnchainMarketPage(indexedMarket([1], 1), [1, 2, 3], 0, false)).toBe(true);
  });

  it("keeps indexed market rows when the requested onchain page is already represented", () => {
    expect(shouldUseOnchainMarketPage(indexedMarket([3, 2, 1], 3), [1, 2, 3], 0, false)).toBe(false);
  });

  it("audits market pages when the indexed total is lower than the onchain page proves", () => {
    expect(shouldUseOnchainMarketPage(indexedMarket([1, 2, 3], 2), [1, 2, 3], 0, false)).toBe(true);
  });

  it("repairs owner pages when indexed totals are stale-high after burns", () => {
    expect(shouldUseOnchainOwnerPage(indexedOwner([9, 8, 7], 3), [9, 8], 0, true)).toBe(true);
  });

  it("repairs owner pages when onchain owner set is empty but indexed still has rows", () => {
    expect(shouldUseOnchainOwnerPage(indexedOwner([9], 1), [], 0, true)).toBe(true);
  });

  it("repairs global pages when indexed totals are stale-high after burns", () => {
    expect(shouldUseOnchainGlobalPage(indexedGlobal([9, 8, 7], 3), 2, [9, 8], 0, false, true)).toBe(true);
  });

  it("repairs global pages when onchain live total is zero but indexed still has rows", () => {
    expect(shouldUseOnchainGlobalPage(indexedGlobal([9], 1), 0, [], 0, false, true)).toBe(true);
  });
});
