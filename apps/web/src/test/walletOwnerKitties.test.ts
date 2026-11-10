import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { KittyItem } from "../lib/api.js";
import {
  materializeOwnerKitties,
  readOwnerSeedKittiesFromCache,
  readWalletOwnerKittiesSnapshotFromCache,
  readWalletOwnerKitties,
  resolveWalletOwnerKittiesQueryData,
  upsertWalletOwnerKittiesOwnedIds,
  walletOwnerKittiesQueryKey,
} from "../lib/walletOwnerKitties.js";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;

const baseTraits: KittyItem["traits"] = {
  background: "Sky",
  breed: "Persian",
  clothes: "Pink Scarf",
  mood: "Purple Moon",
  marks: "Blush",
  mouth: "Stoic",
  eyes: "Happy ^_^",
  accessory: "None",
};

function kitty(id: number): KittyItem {
  return {
    id,
    seed: "0x1",
    tier: 1,
    tierLabel: "UNCOMMON",
    mintTier: 1,
    mintTierLabel: "UNCOMMON",
    owner: OWNER,
    mintedBy: OWNER,
    mintBatchSize: 1,
    mintedAt: 1,
    blockNumber: 1,
    rarityScore: 1,
    traits: baseTraits,
    kpegRarity: {
      label: "RARITY",
      percentage: 1,
      oneInN: 1,
      basis: "Rarity Probability",
    },
  };
}

describe("materializeOwnerKitties", () => {
  it("keeps chain owner ids as source-of-truth and fills metadata from pages + per-id fetch", async () => {
    const listOwnerFn = vi
      .fn()
      .mockResolvedValueOnce({
        page: 0,
        pageSize: 100,
        total: 2,
        items: [kitty(2), kitty(99)],
      })
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 100,
        total: 2,
        items: [],
      });
    const getKittyFn = vi.fn(async (id: number) => kitty(id));

    const result = await materializeOwnerKitties({
      owner: OWNER,
      ownerIds: new Set([1, 2, 3]),
      seedKitties: [kitty(1)],
      listOwnerFn: listOwnerFn as never,
      getKittyFn: getKittyFn as never,
    });

    expect([...result.ownerIds].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(result.kitties.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(result.missingIds).toEqual([]);
    expect(getKittyFn).toHaveBeenCalledTimes(1);
    expect(getKittyFn).toHaveBeenCalledWith(3);
  });

  it("returns missing ids when metadata is not available yet", async () => {
    const result = await materializeOwnerKitties({
      owner: OWNER,
      ownerIds: new Set([7]),
      seedKitties: [],
      listOwnerFn: vi.fn(async () => ({
        page: 0,
        pageSize: 100,
        total: 0,
        items: [],
      })) as never,
      getKittyFn: vi.fn(async () => {
        throw new Error("not ready");
      }) as never,
    });

    expect(result.kitties).toEqual([]);
    expect(result.missingIds).toEqual([7]);
  });

  it("keeps chain-owned ids complete when API only has newest owner window", async () => {
    const ownerIds = new Set(Array.from({ length: 80 }, (_, index) => index + 1));
    const latestWindow = Array.from({ length: 25 }, (_, index) => kitty(56 + index));
    const listOwnerFn = vi
      .fn()
      .mockResolvedValueOnce({
        page: 0,
        pageSize: 100,
        total: 25,
        items: latestWindow,
      })
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 100,
        total: 25,
        items: [],
      });
    const getKittyFn = vi.fn(async () => {
      throw new Error("metadata not indexed yet");
    });

    const result = await materializeOwnerKitties({
      owner: OWNER,
      ownerIds,
      seedKitties: [],
      listOwnerFn: listOwnerFn as never,
      getKittyFn: getKittyFn as never,
    });

    expect(result.ownerIds.size).toBe(80);
    expect(result.kitties.map((item) => item.id)).toEqual(
      Array.from({ length: 25 }, (_, index) => 56 + index),
    );
    expect(result.missingIds).toEqual(
      Array.from({ length: 55 }, (_, index) => index + 1),
    );
  });
});

describe("readWalletOwnerKitties", () => {
  it("falls back to connected-wallet read when public rpc read fails", async () => {
    const readFromPublicClient = vi.fn(async () => {
      throw new Error("public rpc down");
    });
    const readFromConnectedWallet = vi.fn(async () => [5n, 6n]);

    const result = await readWalletOwnerKitties({
      publicClient: {} as never,
      owner: OWNER,
      tokenAddress: TOKEN,
      chainId: 84532,
      connector: { id: "mock" },
      readFromPublicClient,
      readFromConnectedWallet,
    });

    expect(readFromPublicClient).toHaveBeenCalledTimes(1);
    expect(readFromConnectedWallet).toHaveBeenCalledTimes(1);
    expect([...result.ownerIds].sort((a, b) => a - b)).toEqual([5, 6]);
    expect(result.verified).toBe(true);
  });
});

describe("readOwnerSeedKittiesFromCache", () => {
  it("merges owner gallery pages and shared wallet-owner cache data", () => {
    const client = new QueryClient();
    const owner = OWNER.toLowerCase();
    client.setQueryData(
      ["gallery", "collections", owner, "latest", "", 4],
      {
        pages: [
          {
            items: [kitty(1), kitty(2)],
          },
        ],
      },
    );
    client.setQueryData(
      walletOwnerKittiesQueryKey({
        chainId: 84532,
        tokenAddress: TOKEN,
        owner: owner as `0x${string}`,
      }),
      {
        tokenAddress: TOKEN,
        ownerIds: new Set([1, 2, 3]),
        kitties: [kitty(2), kitty(3)],
        missingIds: [],
        verified: true,
        updatedAt: Date.now(),
      },
    );

    const seeds = readOwnerSeedKittiesFromCache(client, owner);
    expect(seeds.map((item) => item.id).sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("readWalletOwnerKittiesSnapshotFromCache", () => {
  it("only returns a snapshot for the same chain, token, and owner", () => {
    const client = new QueryClient();
    const owner = OWNER.toLowerCase() as `0x${string}`;
    const cached = {
      tokenAddress: TOKEN,
      ownerIds: new Set([1, 2]),
      kitties: [kitty(1), kitty(2)],
      missingIds: [],
      verified: true,
      updatedAt: Date.now(),
    };
    client.setQueryData(
      walletOwnerKittiesQueryKey({
        chainId: 8453,
        tokenAddress: TOKEN,
        owner,
      }),
      cached,
    );

    expect(
      readWalletOwnerKittiesSnapshotFromCache({
        queryClient: client,
        chainId: 8453,
        tokenAddress: TOKEN,
        owner,
      }),
    ).toBe(cached);
    expect(
      readWalletOwnerKittiesSnapshotFromCache({
        queryClient: client,
        chainId: 84532,
        tokenAddress: TOKEN,
        owner,
      }),
    ).toBeUndefined();
  });
});

describe("resolveWalletOwnerKittiesQueryData", () => {
  it("returns unverified API/cache fallback when chain reads fail", async () => {
    const result = await resolveWalletOwnerKittiesQueryData({
      owner: OWNER,
      tokenAddress: TOKEN,
      chainId: 84532,
      publicClient: null,
      connector: undefined,
      seedKitties: [kitty(1)],
      readChainOwned: async () => {
        throw new Error("both chain reads failed");
      },
      listOwnerFn: vi
        .fn()
        .mockResolvedValueOnce({
          page: 0,
          pageSize: 100,
          total: 2,
          items: [kitty(1), kitty(2)],
        })
        .mockResolvedValueOnce({
          page: 1,
          pageSize: 100,
          total: 2,
          items: [],
        }) as never,
      getKittyFn: vi.fn(async (id: number) => kitty(id)) as never,
    });

    expect(result.verified).toBe(false);
    expect([...result.ownerIds].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(result.kitties.map((item) => item.id)).toEqual([1, 2]);
  });

  it("falls back to current owner seed cards when chain and API reads fail", async () => {
    const result = await resolveWalletOwnerKittiesQueryData({
      owner: OWNER,
      tokenAddress: TOKEN,
      chainId: 84532,
      publicClient: null,
      connector: undefined,
      seedKitties: [kitty(4), kitty(5)],
      readChainOwned: async () => {
        throw new Error("chain unavailable");
      },
      listOwnerFn: vi.fn(async () => {
        throw new Error("api unavailable");
      }) as never,
      getKittyFn: vi.fn(async (id: number) => kitty(id)) as never,
    });

    expect(result.verified).toBe(false);
    expect([...result.ownerIds].sort((a, b) => a - b)).toEqual([4, 5]);
    expect(result.kitties.map((item) => item.id)).toEqual([4, 5]);
    expect(result.missingIds).toEqual([]);
  });
});

describe("upsertWalletOwnerKittiesOwnedIds", () => {
  it("creates a buyer cache snapshot from confirmed bought ids", () => {
    const client = new QueryClient();

    upsertWalletOwnerKittiesOwnedIds({
      queryClient: client,
      chainId: 84532,
      tokenAddress: TOKEN,
      owner: OWNER,
      ownerIds: [10, 11, 12],
      kitties: [kitty(10), kitty(11)],
      verified: true,
    });

    const value = client.getQueryData(
      walletOwnerKittiesQueryKey({
        chainId: 84532,
        tokenAddress: TOKEN,
        owner: OWNER,
      }),
    ) as {
      ownerIds: Set<number>;
      missingIds: number[];
      verified: boolean;
      kitties: KittyItem[];
    };
    expect([...value.ownerIds].sort((a, b) => a - b)).toEqual([10, 11, 12]);
    expect(value.kitties.map((item) => item.id).sort((a, b) => a - b)).toEqual([
      10, 11,
    ]);
    expect(value.missingIds).toEqual([12]);
    expect(value.verified).toBe(true);
  });

  it("preserves existing ids and upgrades to verified after confirmed readback", () => {
    const client = new QueryClient();
    const key = walletOwnerKittiesQueryKey({
      chainId: 84532,
      tokenAddress: TOKEN,
      owner: OWNER,
    });
    client.setQueryData(key, {
      tokenAddress: TOKEN,
      ownerIds: new Set([1]),
      kitties: [kitty(1)],
      missingIds: [],
      verified: false,
      updatedAt: Date.now(),
    });

    upsertWalletOwnerKittiesOwnedIds({
      queryClient: client,
      chainId: 84532,
      tokenAddress: TOKEN,
      owner: OWNER,
      ownerIds: [2],
      kitties: [kitty(2)],
      verified: false,
    });
    let value = client.getQueryData(key) as {
      ownerIds: Set<number>;
      verified: boolean;
    };
    expect([...value.ownerIds].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(value.verified).toBe(false);

    upsertWalletOwnerKittiesOwnedIds({
      queryClient: client,
      chainId: 84532,
      tokenAddress: TOKEN,
      owner: OWNER,
      ownerIds: [2],
      kitties: [kitty(2)],
      verified: true,
    });
    value = client.getQueryData(key) as { ownerIds: Set<number>; verified: boolean };
    expect([...value.ownerIds].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(value.verified).toBe(true);
  });
});
