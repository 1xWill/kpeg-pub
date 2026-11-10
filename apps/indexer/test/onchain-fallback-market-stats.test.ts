import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChainSyncConfig } from "../src/chain.js";

const viemMocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  getBlockNumber: vi.fn(async () => 100n),
  getLogs: vi.fn(async () => []),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: viemMocks.readContract,
      getBlockNumber: viemMocks.getBlockNumber,
      getLogs: viemMocks.getLogs,
    })),
    http: vi.fn((url: string) => ({ url })),
  };
});

const {
  clearOnchainFallbackCaches,
  globalStatsWithOnchainFallback,
  listMarketListingsWithOnchainFallback,
  marketStatsWithOnchainFallback,
} =
  await import("../src/onchain-fallback.js");

const config: ChainSyncConfig = {
  rpcUrl: "https://rpc.example",
  chainId: 8453,
  tokenAddress: "0x0000000000000000000000000000000000000001",
  marketAddress: "0x0000000000000000000000000000000000000002",
  startBlock: 1,
};

describe("market stats onchain fallback", () => {
  afterEach(() => {
    clearOnchainFallbackCaches();
    viemMocks.readContract.mockReset();
    viemMocks.getBlockNumber.mockReset();
    viemMocks.getBlockNumber.mockResolvedValue(100n);
    viemMocks.getLogs.mockReset();
    viemMocks.getLogs.mockResolvedValue([]);
  });

  it("returns first onchain market stats immediately when indexed stats are empty", async () => {
    viemMocks.readContract.mockImplementation(async (input: { functionName: string }) => {
      if (input.functionName === "getOpenPositions") {
        return [2n, 3n];
      }
      if (input.functionName === "getPositionView") {
        return {
          tradeId: 2n,
          seller: "0x0000000000000000000000000000000000000003",
          buyer: "0x0000000000000000000000000000000000000000",
          escrowAddress: "0x0000000000000000000000000000000000000004",
          paymentToken: "0x0000000000000000000000000000000000000000",
          price: 5n,
          feeBps: 200n,
          kittyIds: [10n],
          status: 0,
          ready: true,
        };
      }
      throw new Error(`unexpected read ${input.functionName}`);
    });

    await expect(
      marketStatsWithOnchainFallback({
        repo: {} as never,
        config,
        indexed: { listed: 0, floorWei: "0", volumeWei: "0" },
      }),
    ).resolves.toEqual({ listed: 2, floorWei: "5", volumeWei: "0" });
  });

  it("repairs global live and ever kitty stats from onchain token counters", async () => {
    viemMocks.readContract.mockImplementation(async (input: { functionName: string }) => {
      if (input.functionName === "kittiesLive") {
        return 6_850n;
      }
      if (input.functionName === "kittiesEverMinted") {
        return 25_627n;
      }
      throw new Error(`unexpected read ${input.functionName}`);
    });

    await expect(
      globalStatsWithOnchainFallback({
        repo: {} as never,
        config,
        indexed: {
          tokenSupplyFixed: 9_999,
          kittiesLive: 8_010,
          kittiesEverMinted: 11_110,
          holdersLive: 85,
          holdersEver: 139,
          latestIndexedBlock: 46_472_649,
        },
      }),
    ).resolves.toEqual({
      tokenSupplyFixed: 9_999,
      kittiesLive: 6_850,
      kittiesEverMinted: 25_627,
      holdersLive: 85,
      holdersEver: 139,
      latestIndexedBlock: 46_472_649,
    });
  });

  it("rejects empty indexed stats when the required first onchain read fails", async () => {
    viemMocks.readContract.mockRejectedValue(new Error("rpc temporary internal error"));

    await expect(
      marketStatsWithOnchainFallback({
        repo: {} as never,
        config,
        indexed: { listed: 0, floorWei: "0", volumeWei: "100" },
      }),
    ).rejects.toThrow("rpc temporary internal error");
  });

  it("rejects non-empty indexed stats when the required first onchain refresh fails", async () => {
    viemMocks.readContract.mockRejectedValue(new Error("rpc temporary internal error"));

    await expect(
      marketStatsWithOnchainFallback({
        repo: {} as never,
        config,
        indexed: { listed: 1, floorWei: "10", volumeWei: "100" },
      }),
    ).rejects.toThrow("rpc temporary internal error");
  });

  it("rejects false zero volume when the historical sale log scan fails", async () => {
    viemMocks.getLogs.mockRejectedValue(new Error("rpc getLogs rejected"));
    viemMocks.readContract.mockImplementation(async (input: { functionName: string }) => {
      if (input.functionName === "getOpenPositions") {
        return [2n];
      }
      if (input.functionName === "getPositionView") {
        return {
          tradeId: 2n,
          seller: "0x0000000000000000000000000000000000000003",
          buyer: "0x0000000000000000000000000000000000000000",
          escrowAddress: "0x0000000000000000000000000000000000000004",
          paymentToken: "0x0000000000000000000000000000000000000000",
          price: 5n,
          feeBps: 200n,
          kittyIds: [10n],
          status: 0,
          ready: true,
        };
      }
      throw new Error(`unexpected read ${input.functionName}`);
    });

    await expect(
      marketStatsWithOnchainFallback({
        repo: {} as never,
        config,
        indexed: { listed: 0, floorWei: "0", volumeWei: "0" },
      }),
    ).rejects.toThrow("rpc getLogs rejected");
  });

  it("keeps known indexed volume when the historical sale log scan fails", async () => {
    viemMocks.getLogs.mockRejectedValue(new Error("rpc getLogs rejected"));
    viemMocks.readContract.mockImplementation(async (input: { functionName: string }) => {
      if (input.functionName === "getOpenPositions") {
        return [2n];
      }
      if (input.functionName === "getPositionView") {
        return {
          tradeId: 2n,
          seller: "0x0000000000000000000000000000000000000003",
          buyer: "0x0000000000000000000000000000000000000000",
          escrowAddress: "0x0000000000000000000000000000000000000004",
          paymentToken: "0x0000000000000000000000000000000000000000",
          price: 5n,
          feeBps: 200n,
          kittyIds: [10n],
          status: 0,
          ready: true,
        };
      }
      throw new Error(`unexpected read ${input.functionName}`);
    });

    await expect(
      marketStatsWithOnchainFallback({
        repo: {} as never,
        config,
        indexed: { listed: 0, floorWei: "0", volumeWei: "100" },
      }),
    ).resolves.toEqual({ listed: 1, floorWei: "5", volumeWei: "100" });
  });

  it("hydrates missing listing kitty metadata from chain when indexed DB has no kitty row", async () => {
    viemMocks.readContract.mockImplementation(async (input: { functionName: string }) => {
      if (input.functionName === "getOpenPositions") {
        return [15n];
      }
      if (input.functionName === "getPositionView") {
        return {
          tradeId: 15n,
          seller: "0x0000000000000000000000000000000000000003",
          buyer: "0x0000000000000000000000000000000000000000",
          escrowAddress: "0x0000000000000000000000000000000000000004",
          paymentToken: "0x0000000000000000000000000000000000000000",
          price: 5n,
          feeBps: 200n,
          kittyIds: [21226n],
          status: 0,
          ready: true,
        };
      }
      if (input.functionName === "getKitty") {
        return {
          id: 21226n,
          owner: "0x0000000000000000000000000000000000000004",
          seed: `0x${"1".repeat(64)}`,
          tier: 1,
        };
      }
      throw new Error(`unexpected read ${input.functionName}`);
    });
    const repo = {
      getKittyById: vi.fn(async () => null),
      onchainKitty: vi.fn((input: { id: number; owner: string }) => ({
        id: input.id,
        owner: input.owner.toLowerCase(),
        rarityScore: 1,
      })),
    };

    await expect(
      listMarketListingsWithOnchainFallback({
        repo: repo as never,
        config,
        input: {
          page: 0,
          pageSize: 24,
          sort: "latest",
          tab: "all",
        },
        indexed: { page: 0, pageSize: 24, total: 0, items: [] },
        force: true,
      }),
    ).resolves.toMatchObject({
      total: 1,
      items: [
        {
          tradeId: 15,
          kittyIds: [21226],
          kitties: [{ id: 21226 }],
        },
      ],
    });
  });

  it("sorts the complete onchain market id set before paging latest listings", async () => {
    const openIds = [2n, 3n, 5n, 6n, 7n, 8n, 9n, 10n, 11n, 12n, 13n, 14n, 15n];
    viemMocks.readContract.mockImplementation(async (input: { functionName: string; args: unknown[] }) => {
      if (input.functionName === "getOpenPositions") {
        return openIds;
      }
      if (input.functionName === "getPositionView") {
        const tradeId = input.args[0] as bigint;
        return {
          tradeId,
          seller: "0x0000000000000000000000000000000000000003",
          buyer: "0x0000000000000000000000000000000000000000",
          escrowAddress: "0x0000000000000000000000000000000000000004",
          paymentToken: "0x0000000000000000000000000000000000000000",
          price: 5n,
          feeBps: 200n,
          kittyIds: [],
          status: 0,
          ready: true,
        };
      }
      throw new Error(`unexpected read ${input.functionName}`);
    });
    const repo = {
      getKittyById: vi.fn(async () => null),
      onchainKitty: vi.fn(),
    };

    await expect(
      listMarketListingsWithOnchainFallback({
        repo: repo as never,
        config,
        input: {
          page: 0,
          pageSize: 10,
          sort: "latest",
          tab: "all",
        },
        indexed: { page: 0, pageSize: 10, total: 0, items: [] },
        force: true,
      }),
    ).resolves.toMatchObject({
      total: 13,
      items: [
        { tradeId: 15 },
        { tradeId: 14 },
        { tradeId: 13 },
        { tradeId: 12 },
        { tradeId: 11 },
        { tradeId: 10 },
        { tradeId: 9 },
        { tradeId: 8 },
        { tradeId: 7 },
        { tradeId: 6 },
      ],
    });
  });

  it("repairs follow-up latest market pages from the same complete onchain id set", async () => {
    const openIds = [2n, 3n, 5n, 6n, 7n, 8n, 9n, 10n, 11n, 12n, 13n, 14n, 15n];
    viemMocks.readContract.mockImplementation(async (input: { functionName: string; args: unknown[] }) => {
      if (input.functionName === "getOpenPositions") {
        return openIds;
      }
      if (input.functionName === "getPositionView") {
        const tradeId = input.args[0] as bigint;
        return {
          tradeId,
          seller: "0x0000000000000000000000000000000000000003",
          buyer: "0x0000000000000000000000000000000000000000",
          escrowAddress: "0x0000000000000000000000000000000000000004",
          paymentToken: "0x0000000000000000000000000000000000000000",
          price: 5n,
          feeBps: 200n,
          kittyIds: [],
          status: 0,
          ready: true,
        };
      }
      throw new Error(`unexpected read ${input.functionName}`);
    });
    const repo = {
      getKittyById: vi.fn(async () => null),
      onchainKitty: vi.fn(),
    };

    await expect(
      listMarketListingsWithOnchainFallback({
        repo: repo as never,
        config,
        input: {
          page: 1,
          pageSize: 10,
          sort: "latest",
          tab: "all",
        },
        indexed: { page: 1, pageSize: 10, total: 2, items: [] },
        force: true,
      }),
    ).resolves.toMatchObject({
      page: 1,
      pageSize: 10,
      total: 13,
      items: [{ tradeId: 5 }, { tradeId: 3 }, { tradeId: 2 }],
    });
  });

  it("sorts scarcity from the complete onchain id set before paging", async () => {
    const openIds = [2n, 3n, 5n, 6n, 7n, 8n, 9n, 10n, 11n, 12n, 13n, 14n, 15n];
    const rarityByKittyId = new Map<number, number>([
      [1002, 300], // trade 2
      [1003, 350], // trade 3
      [1005, 500], // trade 5
      [1006, 600], // trade 6
      [1007, 700], // trade 7
      [1008, 1_200], // trade 8
      [1009, 550], // trade 9
      [1010, 520], // trade 10
      [1011, 900], // trade 11
      [1012, 480], // trade 12
      [1013, 650], // trade 13
      [1014, 1_100], // trade 14
      [1015, 1_300], // trade 15
    ]);
    const ownerByKittyId = new Map<number, string>([
      ...[...rarityByKittyId.keys()].map((id) => [
        id,
        "0x0000000000000000000000000000000000000003",
      ]),
    ]);
    viemMocks.readContract.mockImplementation(
      async (input: { functionName: string; args: unknown[] }) => {
        if (input.functionName === "getOpenPositions") {
          return openIds;
        }
        if (input.functionName === "getPositionView") {
          const tradeId = Number(input.args[0] as bigint);
          return {
            tradeId: BigInt(tradeId),
            seller: "0x0000000000000000000000000000000000000003",
            buyer: "0x0000000000000000000000000000000000000000",
            escrowAddress: "0x0000000000000000000000000000000000000004",
            paymentToken: "0x0000000000000000000000000000000000000000",
            price: 5n,
            feeBps: 200n,
            kittyIds: [BigInt(1000 + tradeId)],
            status: 0,
            ready: true,
          };
        }
        if (input.functionName === "getKitty") {
          const kittyId = Number(input.args[0] as bigint);
          return {
            id: BigInt(kittyId),
            owner:
              ownerByKittyId.get(kittyId) ??
              "0x0000000000000000000000000000000000000000",
            seed: `0x${"1".repeat(64)}`,
            tier: 1,
          };
        }
        throw new Error(`unexpected read ${input.functionName}`);
      }
    );
    const repo = {
      getKittyById: vi.fn(async (id: number) => {
        const rarity = rarityByKittyId.get(id);
        if (rarity === undefined) {
          return null;
        }
        return {
          id,
          owner:
            ownerByKittyId.get(id) ??
            "0x0000000000000000000000000000000000000003",
          rarityScore: rarity,
        };
      }),
      onchainKitty: vi.fn((input: { id: number; owner: string }) => ({
        id: input.id,
        owner: input.owner.toLowerCase(),
        rarityScore: rarityByKittyId.get(input.id) ?? 0,
      })),
    };

    await expect(
      listMarketListingsWithOnchainFallback({
        repo: repo as never,
        config,
        input: {
          page: 0,
          pageSize: 10,
          sort: "scarcity",
          tab: "all",
        },
        indexed: { page: 0, pageSize: 10, total: 0, items: [] },
        force: true,
      })
    ).resolves.toMatchObject({
      total: 13,
      items: [
        { tradeId: 15 },
        { tradeId: 8 },
        { tradeId: 14 },
        { tradeId: 11 },
        { tradeId: 7 },
        { tradeId: 13 },
        { tradeId: 6 },
        { tradeId: 9 },
        { tradeId: 10 },
        { tradeId: 5 },
      ],
    });

    await expect(
      listMarketListingsWithOnchainFallback({
        repo: repo as never,
        config,
        input: {
          page: 1,
          pageSize: 10,
          offset: 10,
          sort: "scarcity",
          tab: "all",
        },
        indexed: { page: 1, pageSize: 10, total: 2, items: [] },
        force: true,
      })
    ).resolves.toMatchObject({
      total: 13,
      items: [{ tradeId: 12 }, { tradeId: 3 }, { tradeId: 2 }],
    });
  });

  it("keeps scarcity cache scoped by tab and owner, and latest path does not use scarcity ordering cache", async () => {
    const callCounts = {
      openAll: 0,
      openByOwnerA: 0,
      openByOwnerB: 0,
      purchasedOwnerA: 0,
      completedOwnerA: 0,
      position: 0,
    };
    const ownerA = "0x00000000000000000000000000000000000000aa";
    const ownerB = "0x00000000000000000000000000000000000000bb";
    const allOpenIds = [2n, 3n, 4n, 5n];
    const ownerAOpenIds = [2n, 5n];
    const ownerBOpenIds = [3n, 4n];
    const ownerAPurchasedIds = [6n];
    const ownerACompletedIds = [7n];
    const rarityByKittyId = new Map<number, number>([
      [1002, 300],
      [1003, 800],
      [1004, 500],
      [1005, 900],
      [1006, 450],
      [1007, 700],
    ]);
    const ownerByKittyId = new Map<number, string>([
      [1002, ownerA],
      [1003, ownerB],
      [1004, ownerB],
      [1005, ownerA],
      [1006, ownerA],
      [1007, ownerA],
    ]);
    viemMocks.readContract.mockImplementation(
      async (input: { functionName: string; args: unknown[] }) => {
        if (input.functionName === "getOpenPositions") {
          callCounts.openAll += 1;
          return allOpenIds;
        }
        if (input.functionName === "getOpenPositionsByOwner") {
          const owner = String(input.args[0]).toLowerCase();
          if (owner === ownerA.toLowerCase()) {
            callCounts.openByOwnerA += 1;
            return ownerAOpenIds;
          }
          if (owner === ownerB.toLowerCase()) {
            callCounts.openByOwnerB += 1;
            return ownerBOpenIds;
          }
          return [];
        }
        if (input.functionName === "getPurchasedPositions") {
          callCounts.purchasedOwnerA += 1;
          return ownerAPurchasedIds;
        }
        if (input.functionName === "getCompletedPositions") {
          callCounts.completedOwnerA += 1;
          return ownerACompletedIds;
        }
        if (input.functionName === "getPositionView") {
          callCounts.position += 1;
          const tradeId = Number(input.args[0] as bigint);
          return {
            tradeId: BigInt(tradeId),
            seller: ownerA,
            buyer: "0x0000000000000000000000000000000000000000",
            escrowAddress: "0x0000000000000000000000000000000000000004",
            paymentToken: "0x0000000000000000000000000000000000000000",
            price: 5n,
            feeBps: 200n,
            kittyIds: [BigInt(1000 + tradeId)],
            status: 0,
            ready: true,
          };
        }
        if (input.functionName === "getKitty") {
          const kittyId = Number(input.args[0] as bigint);
          return {
            id: BigInt(kittyId),
            owner:
              ownerByKittyId.get(kittyId) ??
              "0x0000000000000000000000000000000000000000",
            seed: `0x${"1".repeat(64)}`,
            tier: 1,
          };
        }
        throw new Error(`unexpected read ${input.functionName}`);
      },
    );
    const repo = {
      getKittyById: vi.fn(async (id: number) => {
        const rarity = rarityByKittyId.get(id);
        if (rarity === undefined) {
          return null;
        }
        return {
          id,
          owner:
            ownerByKittyId.get(id) ??
            "0x0000000000000000000000000000000000000000",
          rarityScore: rarity,
        };
      }),
      onchainKitty: vi.fn((input: { id: number; owner: string }) => ({
        id: input.id,
        owner: input.owner.toLowerCase(),
        rarityScore: rarityByKittyId.get(input.id) ?? 0,
      })),
    };

    await expect(
      listMarketListingsWithOnchainFallback({
        repo: repo as never,
        config,
        input: {
          page: 0,
          pageSize: 10,
          sort: "scarcity",
          tab: "all",
        },
        indexed: { page: 0, pageSize: 10, total: 0, items: [] },
        force: true,
      }),
    ).resolves.toMatchObject({
      items: [{ tradeId: 5 }, { tradeId: 3 }, { tradeId: 4 }, { tradeId: 2 }],
    });
    expect(callCounts.openAll).toBe(1);
    const afterAllPositionReads = callCounts.position;

    await expect(
      listMarketListingsWithOnchainFallback({
        repo: repo as never,
        config,
        input: {
          page: 0,
          pageSize: 10,
          sort: "scarcity",
          tab: "all",
        },
        indexed: { page: 0, pageSize: 10, total: 0, items: [] },
        force: true,
      }),
    ).resolves.toMatchObject({
      items: [{ tradeId: 5 }, { tradeId: 3 }, { tradeId: 4 }, { tradeId: 2 }],
    });
    expect(callCounts.openAll).toBe(1);
    expect(callCounts.position).toBe(afterAllPositionReads);

    await expect(
      listMarketListingsWithOnchainFallback({
        repo: repo as never,
        config,
        input: {
          page: 0,
          pageSize: 10,
          sort: "scarcity",
          tab: "my-listings",
          owner: ownerA,
        },
        indexed: { page: 0, pageSize: 10, total: 0, items: [] },
        force: true,
      }),
    ).resolves.toMatchObject({
      items: [{ tradeId: 5 }, { tradeId: 2 }],
    });
    expect(callCounts.openByOwnerA).toBe(1);

    await expect(
      listMarketListingsWithOnchainFallback({
        repo: repo as never,
        config,
        input: {
          page: 0,
          pageSize: 10,
          sort: "scarcity",
          tab: "my-listings",
          owner: ownerB,
        },
        indexed: { page: 0, pageSize: 10, total: 0, items: [] },
        force: true,
      }),
    ).resolves.toMatchObject({
      items: [{ tradeId: 3 }, { tradeId: 4 }],
    });
    expect(callCounts.openByOwnerB).toBe(1);

    await expect(
      listMarketListingsWithOnchainFallback({
        repo: repo as never,
        config,
        input: {
          page: 0,
          pageSize: 10,
          sort: "scarcity",
          tab: "bought",
          owner: ownerA,
        },
        indexed: { page: 0, pageSize: 10, total: 0, items: [] },
        force: true,
      }),
    ).resolves.toMatchObject({
      items: [{ tradeId: 6 }],
    });
    expect(callCounts.purchasedOwnerA).toBe(1);

    await expect(
      listMarketListingsWithOnchainFallback({
        repo: repo as never,
        config,
        input: {
          page: 0,
          pageSize: 10,
          sort: "latest",
          tab: "sold",
          owner: ownerA,
        } as never,
        indexed: { page: 0, pageSize: 10, total: 0, items: [] },
        force: true,
      }),
    ).resolves.toMatchObject({
      items: [{ tradeId: 7 }],
    });
    expect(callCounts.completedOwnerA).toBe(1);

    const beforeLatestPositionReads = callCounts.position;
    await expect(
      listMarketListingsWithOnchainFallback({
        repo: repo as never,
        config,
        input: {
          page: 0,
          pageSize: 10,
          sort: "latest",
          tab: "all",
        },
        indexed: { page: 0, pageSize: 10, total: 0, items: [] },
        force: true,
      }),
    ).resolves.toMatchObject({
      items: [{ tradeId: 5 }, { tradeId: 4 }, { tradeId: 3 }, { tradeId: 2 }],
    });
    expect(callCounts.openAll).toBe(1);
    expect(callCounts.position).toBeGreaterThan(beforeLatestPositionReads);
  });
});
