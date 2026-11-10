import { describe, expect, it, beforeEach, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import type { KittyItem } from "../lib/api.js";
import {
  appendOptimisticKittyRemovals,
  appendOptimisticKitties,
  nextOptimisticStateExpiryAt,
  optimisticKittiesFromReceipt,
  optimisticRemovalsFromReceipt,
  readOptimisticKittyRemovals,
  readOptimisticKitties,
} from "../lib/optimisticKitties.js";
import { indexingProgressMessage, mergeExploreStats } from "../pages/GalleryPage.js";

function kitty(id: number): KittyItem {
  return {
    id,
    seed: "0x1",
    tier: 1,
    tierLabel: "Uncommon",
    mintTier: 1,
    mintTierLabel: "Uncommon",
    owner: "0x1111111111111111111111111111111111111111",
    mintedBy: "0x1111111111111111111111111111111111111111",
    mintBatchSize: 100,
    mintedAt: 1,
    blockNumber: 2,
    txHash: "0x3",
    gasUsed: null,
    baseFeeWei: null,
    rarityScore: 1,
    traits: {
      background: "Sky",
      breed: "Persian",
      clothes: "Pink Scarf",
      mood: "Purple Moon",
      marks: "Blush",
      mouth: "Stoic",
      eyes: "Happy ^_^",
      accessory: "None",
    },
    traitOdds: {
      background: { trait: "Sky", selectedWeight: 1, contextTotalWeight: 1, probabilityPct: 100 },
      breed: { trait: "Persian", selectedWeight: 1, contextTotalWeight: 1, probabilityPct: 100 },
      clothes: { trait: "Pink Scarf", selectedWeight: 1, contextTotalWeight: 1, probabilityPct: 100 },
      mood: { trait: "Purple Moon", selectedWeight: 1, contextTotalWeight: 1, probabilityPct: 100 },
      marks: { trait: "Blush", selectedWeight: 1, contextTotalWeight: 1, probabilityPct: 100 },
      mouth: { trait: "Stoic", selectedWeight: 1, contextTotalWeight: 1, probabilityPct: 100 },
      eyes: { trait: "Happy ^_^", selectedWeight: 1, contextTotalWeight: 1, probabilityPct: 100 },
      accessory: { trait: "None", selectedWeight: 1, contextTotalWeight: 1, probabilityPct: 100 },
    },
    kpegRarity: {
      label: "RARITY",
      percentage: 1,
      oneInN: 1,
      basis: "Rarity Probability",
    },
  };
}

describe("optimistic kitties", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("scopes optimistic kitties by chain and token", () => {
    appendOptimisticKitties([kitty(1)], {
      chainId: 84532,
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(
      readOptimisticKitties({
        chainId: 84532,
        tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }).map((item) => item.id),
    ).toEqual([1]);
    expect(
      readOptimisticKitties({
        chainId: 84532,
        tokenAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ).toEqual([]);
  });

  it("scopes optimistic sell removals by chain and token", () => {
    appendOptimisticKittyRemovals(
      [
        {
          txHash: `0x${"9".repeat(64)}`,
          owner: "0x1111111111111111111111111111111111111111",
          count: 2,
          kittyIds: [80, 81],
          blockNumber: 123,
          createdAt: Date.now(),
          expiresAt: Date.now() + 10_000,
        },
      ],
      {
        chainId: 84532,
        tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    );

    expect(
      readOptimisticKittyRemovals({
        chainId: 84532,
        tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }).map((item) => item.count),
    ).toEqual([2]);
    expect(
      readOptimisticKittyRemovals({
        chainId: 84532,
        tokenAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ).toEqual([]);
  });

  it("dedupes optimistic sell removals by txHash", () => {
    const txHash = `0x${"8".repeat(64)}` as const;
    appendOptimisticKittyRemovals(
      [
        {
          txHash,
          owner: "0x1111111111111111111111111111111111111111",
          count: 1,
          kittyIds: [70],
          blockNumber: 200,
          createdAt: Date.now(),
          expiresAt: Date.now() + 20_000,
        },
        {
          txHash,
          owner: "0x1111111111111111111111111111111111111111",
          count: 2,
          kittyIds: [71],
          blockNumber: 201,
          createdAt: Date.now() + 1,
          expiresAt: Date.now() + 25_000,
        },
      ],
      {
        chainId: 84532,
        tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    );
    const stored = readOptimisticKittyRemovals({
      chainId: 84532,
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.count).toBe(2);
    expect(stored[0]?.kittyIds.sort((a, b) => a - b)).toEqual([70, 71]);
    expect(stored[0]?.blockNumber).toBe(201);
  });

  it("ignores and cleans expired optimistic records", () => {
    vi.useFakeTimers();
    const now = Date.now();
    const scope = {
      chainId: 84532,
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const kittiesKey = `kpeg.optimisticKitties.${scope.chainId}.${scope.tokenAddress.toLowerCase()}`;
    window.sessionStorage.setItem(
      kittiesKey,
      JSON.stringify({
        expiresAt: now - 1,
        kitties: [kitty(5)],
      }),
    );
    const removalsKey = `kpeg.optimisticKittyRemovals.${scope.chainId}.${scope.tokenAddress.toLowerCase()}`;
    window.sessionStorage.setItem(
      removalsKey,
      JSON.stringify({
        expiresAt: now - 1,
        removals: [
          {
            txHash: `0x${"7".repeat(64)}`,
            owner: "0x1111111111111111111111111111111111111111",
            count: 1,
            kittyIds: [90],
            blockNumber: 300,
            createdAt: now - 10,
            expiresAt: now - 1,
          },
        ],
      }),
    );
    expect(readOptimisticKitties(scope)).toEqual([]);
    expect(readOptimisticKittyRemovals(scope)).toEqual([]);
    expect(window.sessionStorage.getItem(kittiesKey)).toBeNull();
    expect(window.sessionStorage.getItem(removalsKey)).toBeNull();
    vi.useRealTimers();
  });

  it("exposes the next optimistic expiry so mounted pages can clear stale local state", () => {
    vi.useFakeTimers();
    const now = Date.now();
    const scope = {
      chainId: 84532,
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    appendOptimisticKitties([kitty(1)], scope);
    appendOptimisticKittyRemovals(
      [
        {
          txHash: `0x${"6".repeat(64)}`,
          owner: "0x1111111111111111111111111111111111111111",
          count: 1,
          kittyIds: [80],
          blockNumber: 123,
          createdAt: now,
          expiresAt: now + 1_000,
        },
      ],
      scope,
    );

    expect(nextOptimisticStateExpiryAt(scope)).toBe(now + 1_000);
    vi.useRealTimers();
  });

  it("does not let optimistic totals override authoritative onchain counts", () => {
    expect(
      mergeExploreStats({
        apiKittiesLive: 175,
        apiKittiesEverMinted: 175,
        onchainKittiesLive: 100,
        onchainKittiesEverMinted: 100,
        optimisticMintCount: 20,
        optimisticRemovalCount: 7,
      }),
    ).toEqual({ kittiesLive: 100, kittiesEverMinted: 100 });
  });

  it("applies optimistic buy/sell deltas when onchain counts are unavailable", () => {
    expect(
      mergeExploreStats({
        apiKittiesLive: 50,
        apiKittiesEverMinted: 70,
        onchainKittiesLive: null,
        onchainKittiesEverMinted: null,
        optimisticMintCount: 4,
        optimisticRemovalCount: 2,
      }),
    ).toEqual({ kittiesLive: 52, kittiesEverMinted: 74 });
  });

  it("never lets optimistic sell deltas reduce ever-born", () => {
    expect(
      mergeExploreStats({
        apiKittiesLive: 50,
        apiKittiesEverMinted: 70,
        onchainKittiesLive: null,
        onchainKittiesEverMinted: null,
        optimisticMintCount: 0,
        optimisticRemovalCount: 5,
      }),
    ).toEqual({ kittiesLive: 45, kittiesEverMinted: 70 });
  });

  it("reports indexed/live progress without mixing live and ever-minted totals", () => {
    expect(
      indexingProgressMessage({
        scope: "explore",
        indexedTotal: 0,
        liveOnchainCount: 90,
      }),
    ).toBe("0 / 90 live kitties indexed from chain. Backfill is running; cards appear as indexing catches up.");
    expect(
      indexingProgressMessage({
        scope: "owner",
        indexedTotal: 0,
        liveOnchainCount: 87,
      }),
    ).toBe("0 / 87 wallet kitties indexed from chain. Backfill is running; cards appear as indexing catches up.");
  });

  it("parses KittyBatchBurned logs into optimistic removal records", () => {
    const abi = [
      {
        type: "event",
        name: "KittyBatchBurned",
        inputs: [
          { indexed: true, name: "owner", type: "address" },
          { indexed: true, name: "startKittyId", type: "uint256" },
          { indexed: false, name: "count", type: "uint256" },
        ],
      },
    ] as const;
    const owner = "0x1111111111111111111111111111111111111111" as const;
    const topics = encodeEventTopics({
      abi,
      eventName: "KittyBatchBurned",
      args: { owner, startKittyId: 50n },
    });
    const data = encodeAbiParameters([{ type: "uint256" }], [3n]);
    const txHash = `0x${"3".repeat(64)}` as const;

    expect(
      optimisticRemovalsFromReceipt({
        tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        receipt: {
          transactionHash: txHash,
          blockNumber: 321n,
          logs: [
            {
              address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              topics: topics as readonly `0x${string}`[],
              data,
            },
          ],
        },
      }),
    ).toMatchObject([
      {
        txHash,
        owner: owner.toLowerCase(),
        count: 3,
        kittyIds: [50, 51, 52],
        blockNumber: 321,
      },
    ]);
  });

  it("parses KittyBatchMinted logs into optimistic kitty records", () => {
    const abi = [
      {
        type: "event",
        name: "KittyBatchMinted",
        inputs: [
          { indexed: true, name: "owner", type: "address" },
          { indexed: true, name: "startKittyId", type: "uint256" },
          { indexed: false, name: "count", type: "uint256" },
          { indexed: false, name: "tier", type: "uint8" },
          { indexed: false, name: "batchSizeWhole", type: "uint256" },
          { indexed: false, name: "seedBase", type: "bytes32" },
        ],
      },
    ] as const;
    const owner = "0x1111111111111111111111111111111111111111" as const;
    const topics = encodeEventTopics({
      abi,
      eventName: "KittyBatchMinted",
      args: { owner, startKittyId: 100n },
    });
    const data = encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [2n, 1, 2n, `0x${"ab".repeat(32)}` as `0x${string}`],
    );
    const txHash = `0x${"5".repeat(64)}` as const;

    const parsed = optimisticKittiesFromReceipt({
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      receipt: {
        transactionHash: txHash,
        blockNumber: 400n,
        logs: [
          {
            address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            topics: topics as readonly `0x${string}`[],
            data,
          },
        ],
      },
    });

    expect(parsed).toHaveLength(2);
    expect(parsed.map((item) => item.id)).toEqual([100, 101]);
    expect(parsed.every((item) => item.owner === owner.toLowerCase())).toBe(true);
    expect(parsed.every((item) => item.txHash === txHash)).toBe(true);
  });

  it("ignores KittyBatchMinted logs from other token addresses", () => {
    const abi = [
      {
        type: "event",
        name: "KittyBatchMinted",
        inputs: [
          { indexed: true, name: "owner", type: "address" },
          { indexed: true, name: "startKittyId", type: "uint256" },
          { indexed: false, name: "count", type: "uint256" },
          { indexed: false, name: "tier", type: "uint8" },
          { indexed: false, name: "batchSizeWhole", type: "uint256" },
          { indexed: false, name: "seedBase", type: "bytes32" },
        ],
      },
    ] as const;
    const topics = encodeEventTopics({
      abi,
      eventName: "KittyBatchMinted",
      args: {
        owner: "0x1111111111111111111111111111111111111111",
        startKittyId: 5n,
      },
    });
    const data = encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [1n, 1, 1n, `0x${"cd".repeat(32)}` as `0x${string}`],
    );

    expect(
      optimisticKittiesFromReceipt({
        tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        receipt: {
          transactionHash: `0x${"7".repeat(64)}`,
          blockNumber: 10n,
          logs: [
            {
              address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              topics: topics as readonly `0x${string}`[],
              data,
            },
          ],
        },
      }),
    ).toEqual([]);
  });

  it("returns no optimistic state for failed/rejected receipt inputs", () => {
    expect(
      optimisticKittiesFromReceipt({
        tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        receipt: undefined,
      }),
    ).toEqual([]);
    expect(
      optimisticKittiesFromReceipt({
        tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        receipt: {
          logs: [],
        },
      }),
    ).toEqual([]);
    expect(
      optimisticRemovalsFromReceipt({
        tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        receipt: undefined,
      }),
    ).toEqual([]);
    expect(
      optimisticRemovalsFromReceipt({
        tokenAddress: undefined,
        receipt: {
          transactionHash: `0x${"6".repeat(64)}`,
          logs: [],
        },
      }),
    ).toEqual([]);
  });
});
