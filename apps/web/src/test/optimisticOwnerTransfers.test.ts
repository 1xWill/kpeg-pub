import { afterEach, describe, expect, it } from "vitest";
import {
  appendOptimisticOwnerTransfer,
  clearOptimisticOwnerTransfers,
  decideListingBoughtTransferPrune,
  readOptimisticOwnerTransfers,
  settleOptimisticOwnerTransfersByKittyOwners,
} from "../lib/optimisticOwnerTransfers.js";

const scope = {
  chainId: 84532,
  tokenAddress: "0x00000000000000000000000000000000000000dd",
};

describe("optimisticOwnerTransfers", () => {
  afterEach(() => {
    clearOptimisticOwnerTransfers(scope);
  });

  it("persists normalized transfers and clears by tx hash", () => {
    appendOptimisticOwnerTransfer(scope, {
      txHash: `0x${"1".repeat(64)}`,
      blockNumber: 200,
      from: "0xAAA",
      to: "0xBBB",
      kittyIds: [5, 5, 6],
      kitties: [],
      reason: "LISTING_FUNDED",
    });

    const first = readOptimisticOwnerTransfers(scope);
    expect(first).toHaveLength(1);
    expect(first[0]?.from).toBe("0xaaa");
    expect(first[0]?.to).toBe("0xbbb");
    expect(first[0]?.kittyIds).toEqual([5, 6]);

    clearOptimisticOwnerTransfers(scope, [`0x${"1".repeat(64)}`]);
    expect(readOptimisticOwnerTransfers(scope)).toEqual([]);
  });

  it("settles transfers only when kitty detail owners confirm the target owner", () => {
    const transfers = [
        {
          txHash: `0x${"1".repeat(64)}`,
          blockNumber: 10,
          createdAt: 1,
          expiresAt: 9_999_999,
          from: "0x1",
          to: "0x2",
          kittyIds: [1],
          kitties: [],
          reason: "LISTING_FUNDED",
        },
        {
          txHash: `0x${"2".repeat(64)}`,
          blockNumber: 20,
          createdAt: 1,
          expiresAt: 9_999_999,
          from: "0x1",
          to: "0x2",
          kittyIds: [2],
          kitties: [],
          reason: "LISTING_BOUGHT",
        },
      ];
    const result = settleOptimisticOwnerTransfersByKittyOwners({
      transfers: transfers as any,
      latestIndexedBlock: 20,
      kittyDetailsById: new Map([
        [1, { owner: "0x2" }],
        [2, { owner: "0xBAD" }],
      ]),
    });
    expect(result.settledTxHashes).toEqual([`0x${"1".repeat(64)}`]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.txHash).toBe(`0x${"2".repeat(64)}`);
  });

  it("keeps transfer overlays when kitty details are unresolved", () => {
    const result = settleOptimisticOwnerTransfersByKittyOwners({
      transfers: [
        {
          txHash: `0x${"3".repeat(64)}`,
          blockNumber: 10,
          createdAt: 1,
          expiresAt: 9_999_999,
          from: "0x1",
          to: "0x2",
          kittyIds: [9],
          kitties: [],
          reason: "LISTING_FUNDED",
        },
      ],
      latestIndexedBlock: 10,
      kittyDetailsById: new Map([[9, undefined]]),
    });
    expect(result.settledTxHashes).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.actualOwner).toBe("UNKNOWN");
  });

  it("retains LISTING_BOUGHT when kitty detail could be ahead but buyer owner source is stale", () => {
    const transfer = {
      txHash: `0x${"8".repeat(64)}` as `0x${string}`,
      blockNumber: 120,
      createdAt: 1,
      expiresAt: 9_999_999,
      from: "0xmarket",
      to: "0xbuyer",
      kittyIds: [1, 2, 3],
      kitties: [],
      reason: "LISTING_BOUGHT" as const,
    };
    expect(
      decideListingBoughtTransferPrune({
        transfer: transfer as any,
        ownerAddress: "0xBuyer",
        verifiedOwnerIds: null,
        ownerVisibleIds: null,
        latestIndexedBlock: 120,
        hasFreshOwnerLiveCounter: false,
      }),
    ).toBe("retain");
  });

  it("clears LISTING_BOUGHT when verified buyer owner ids contain all bought ids", () => {
    const transfer = {
      txHash: `0x${"9".repeat(64)}` as `0x${string}`,
      blockNumber: 121,
      createdAt: 1,
      expiresAt: 9_999_999,
      from: "0xmarket",
      to: "0xbuyer",
      kittyIds: [11, 12],
      kitties: [],
      reason: "LISTING_BOUGHT" as const,
    };
    expect(
      decideListingBoughtTransferPrune({
        transfer: transfer as any,
        ownerAddress: "0xbuyer",
        verifiedOwnerIds: new Set([11, 12, 99]),
        ownerVisibleIds: null,
        latestIndexedBlock: 121,
        hasFreshOwnerLiveCounter: false,
      }),
    ).toBe("clear");
  });

  it("retains conflict when LISTING_BOUGHT belongs to a different owner scope", () => {
    const transfer = {
      txHash: `0x${"a".repeat(64)}` as `0x${string}`,
      blockNumber: 122,
      createdAt: 1,
      expiresAt: 9_999_999,
      from: "0xmarket",
      to: "0xowner-a",
      kittyIds: [21],
      kitties: [],
      reason: "LISTING_BOUGHT" as const,
    };
    expect(
      decideListingBoughtTransferPrune({
        transfer: transfer as any,
        ownerAddress: "0xowner-b",
        verifiedOwnerIds: new Set([21]),
        ownerVisibleIds: new Set([21]),
        latestIndexedBlock: 122,
        hasFreshOwnerLiveCounter: true,
      }),
    ).toBe("retain-conflict");
  });
});
