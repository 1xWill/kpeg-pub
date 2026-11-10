import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { MarketListing } from "../lib/api.js";
import {
  MARKET_BUY_LISTING_CHANGED_ERROR,
  MARKET_BUY_LISTING_VERIFY_FAILED_ERROR,
  marketBuyListingMatchesOnchainView,
  resolveBuyReadBack,
  resolveCancelReadBack,
  resolveListingReadBack,
  resolveUpdateReadBack,
  verifyMarketBuyListing,
  waitForMarketTxOutcome,
} from "../lib/marketReadBack.js";

const seller = "0x1111111111111111111111111111111111111111" as Address;
const buyer = "0x2222222222222222222222222222222222222222" as Address;
const escrow = "0x3333333333333333333333333333333333333333" as Address;
const market = "0x4444444444444444444444444444444444444444" as Address;

function listing(patch: Partial<MarketListing> = {}): MarketListing {
  return {
    tradeId: 77,
    escrowAddress: escrow,
    seller,
    buyer: null,
    paymentToken: "0x0000000000000000000000000000000000000000",
    priceWei: "1000000000000000000",
    feeBps: 200,
    kittyIds: [77],
    kittyCount: 1,
    status: "OPEN",
    createdBlock: 100,
    createdTxHash: `0x${"a".repeat(64)}`,
    createdAt: 1,
    updatedAt: 1,
    closedBlock: null,
    closedTxHash: null,
    closedAt: null,
    kitties: [],
    ...patch,
  };
}

describe("waitForMarketTxOutcome", () => {
  it("returns success when primary read-back throws and connected fallback confirms after success receipt", async () => {
    const result = await waitForMarketTxOutcome({
      hash: `0x${"1".repeat(64)}` as `0x${string}`,
      publicClient: {
        waitForTransactionReceipt: vi.fn().mockResolvedValue({
          status: "success",
          blockNumber: 12n,
        }),
      } as never,
      readBack: async () => {
        throw new Error("public rpc down");
      },
      readBackViaConnectedWallet: async () => ({ ok: true }),
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.receiptBlock).toBe(12);
      expect(result.value).toEqual({ ok: true });
    }
  });

  it("does not misclassify primary read-back throw as revert when receipt already succeeded", async () => {
    const result = await waitForMarketTxOutcome({
      hash: `0x${"2".repeat(64)}` as `0x${string}`,
      publicClient: {
        waitForTransactionReceipt: vi.fn().mockResolvedValue({
          status: "success",
          blockNumber: 99n,
        }),
      } as never,
      readBack: async () => {
        throw new Error("execution reverted");
      },
      readBackViaConnectedWallet: async () => ({ ok: true }),
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.receiptBlock).toBe(99);
    }
  });

  it("returns pending when receipt succeeds but both read-backs fail", async () => {
    const result = await waitForMarketTxOutcome({
      hash: `0x${"3".repeat(64)}` as `0x${string}`,
      publicClient: {
        waitForTransactionReceipt: vi.fn().mockResolvedValue({
          status: "success",
          blockNumber: 33n,
        }),
      } as never,
      readBack: async () => {
        throw new Error("rpc down");
      },
      readBackViaConnectedWallet: async () => {
        throw new Error("wallet down");
      },
    });

    expect(result.status).toBe("pending");
  });

  it("returns success on non-timeout receipt error when connected fallback confirms", async () => {
    const result = await waitForMarketTxOutcome({
      hash: `0x${"4".repeat(64)}` as `0x${string}`,
      publicClient: {
        waitForTransactionReceipt: vi
          .fn()
          .mockRejectedValue(new Error("rpc temporarily unavailable")),
      } as never,
      readBack: async () => {
        throw new Error("public read failure");
      },
      readBackViaConnectedWallet: async () => ({ ok: true }),
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.receiptBlock).toBe(0);
      expect(result.value).toEqual({ ok: true });
    }
  });

  it("returns early success in race mode when read-back confirms before receipt resolves", async () => {
    const pendingReceipt = new Promise<never>(() => undefined);
    const readBack = vi.fn().mockResolvedValue({ ok: true });

    const result = await waitForMarketTxOutcome({
      hash: `0x${"a".repeat(64)}` as `0x${string}`,
      publicClient: {
        waitForTransactionReceipt: vi.fn().mockReturnValue(pendingReceipt),
      } as never,
      readBack,
      raceReadBack: true,
      readBackPollIntervalMs: 500,
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.receiptBlock).toBe(0);
      expect(result.value).toEqual({ ok: true });
    }
    expect(readBack).toHaveBeenCalledTimes(1);
    expect(readBack).toHaveBeenCalledWith({ receiptBlock: null });
  });

  it("checks read-back at receipt block when receipt wins in race mode", async () => {
    const readBack = vi
      .fn()
      .mockImplementation(async (ctx: { receiptBlock: number | null }) =>
        ctx.receiptBlock === 42 ? { ok: true } : null,
      );

    const result = await waitForMarketTxOutcome({
      hash: `0x${"b".repeat(64)}` as `0x${string}`,
      publicClient: {
        waitForTransactionReceipt: vi.fn().mockResolvedValue({
          status: "success",
          blockNumber: 42n,
        }),
      } as never,
      readBack,
      raceReadBack: true,
      readBackPollIntervalMs: 500,
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.receiptBlock).toBe(42);
      expect(result.value).toEqual({ ok: true });
    }
    expect(readBack).toHaveBeenCalledWith({ receiptBlock: null });
    expect(readBack).toHaveBeenCalledWith({ receiptBlock: 42 });
  });

  it("returns reverted in race mode when receipt reverts", async () => {
    const result = await waitForMarketTxOutcome({
      hash: `0x${"c".repeat(64)}` as `0x${string}`,
      publicClient: {
        waitForTransactionReceipt: vi.fn().mockResolvedValue({
          status: "reverted",
          blockNumber: 7n,
        }),
      } as never,
      readBack: async () => null,
      raceReadBack: true,
      readBackPollIntervalMs: 500,
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("reverted");
  });

  it("returns pending in race mode when timeout expires and read-back cannot confirm", async () => {
    const result = await waitForMarketTxOutcome({
      hash: `0x${"d".repeat(64)}` as `0x${string}`,
      publicClient: {
        waitForTransactionReceipt: vi
          .fn()
          .mockRejectedValue(new Error("timed out waiting for receipt")),
      } as never,
      readBack: async () => null,
      raceReadBack: true,
      readBackPollIntervalMs: 500,
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("pending");
  });

  it("keeps polling in race mode when receipt watcher throws transient non-revert errors", async () => {
    const readBack = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ok: true });

    const result = await waitForMarketTxOutcome({
      hash: `0x${"f".repeat(64)}` as `0x${string}`,
      publicClient: {
        waitForTransactionReceipt: vi
          .fn()
          .mockRejectedValue(new Error("rpc temporarily unavailable")),
      } as never,
      readBack,
      raceReadBack: true,
      readBackPollIntervalMs: 250,
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.value).toEqual({ ok: true });
    }
    expect(readBack).toHaveBeenCalledTimes(2);
  });

  it("stops polling once race-mode read-back confirms", async () => {
    vi.useFakeTimers();
    try {
      const pendingReceipt = new Promise<never>(() => undefined);
      const readBack = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ok: true });
      const outcomePromise = waitForMarketTxOutcome({
        hash: `0x${"e".repeat(64)}` as `0x${string}`,
        publicClient: {
          waitForTransactionReceipt: vi.fn().mockReturnValue(pendingReceipt),
        } as never,
        readBack,
        raceReadBack: true,
        readBackPollIntervalMs: 1_000,
        timeoutMs: 5_000,
      });

      await vi.advanceTimersByTimeAsync(1_000);
      const result = await outcomePromise;
      expect(result.status).toBe("success");
      expect(readBack).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(readBack).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("market read-back resolvers", () => {
  it("resolves listing by chain match when receipt decode and api lookup are unavailable", async () => {
    const result = await resolveListingReadBack({
      ctx: { receiptBlock: 210 },
      seller,
      kittyIds: [7, 9],
      priceWei: 1000n,
      readFromReceipt: async () => null,
      readFromApi: async () => null,
      readFromChain: async () => ({
        tradeId: 88,
        escrowAddress: escrow,
      }),
    });

    expect(result).toEqual({
      tradeId: 88,
      escrowAddress: escrow,
      createdBlock: 210,
    });
  });

  it("keeps cancel pending when api is not found before index catches up", async () => {
    const result = await resolveCancelReadBack({
      ctx: { receiptBlock: 500 },
      latestIndexedBlock: 499,
      readChainPosition: async () => null,
      readIndexedListing: async () => null,
    });
    expect(result).toBeNull();
  });

  it("confirms cancel when api is not found after index catches receipt block", async () => {
    const result = await resolveCancelReadBack({
      ctx: { receiptBlock: 500 },
      latestIndexedBlock: 500,
      readChainPosition: async () => null,
      readIndexedListing: async () => null,
    });
    expect(result).toEqual({ blockNumber: 500 });
  });

  it("confirms buy from on-chain SOLD status without indexer", async () => {
    const result = await resolveBuyReadBack({
      readChainPosition: async () => ({
        tradeId: 1n,
        seller,
        buyer,
        escrowAddress: escrow,
        paymentToken: market,
        price: 1000n,
        feeBps: 200n,
        kittyIds: [1n],
        status: 1n,
        ready: true,
      }),
      readIndexedListing: async () => null,
      verifyOwnership: async () => false,
    });
    expect(result).toEqual({ blockNumber: 0 });
  });

  it("confirms update from on-chain OPEN+price match without indexer", async () => {
    const result = await resolveUpdateReadBack({
      expectedPriceWei: 1234n,
      readChainPosition: async () => ({
        tradeId: 1n,
        seller,
        buyer,
        escrowAddress: escrow,
        paymentToken: market,
        price: 1234n,
        feeBps: 200n,
        kittyIds: [1n],
        status: 0n,
        ready: true,
      }),
      readIndexedListing: async () => listing(),
    });
    expect(result).toEqual({ blockNumber: 0 });
  });
});

describe("market buy preflight verification", () => {
  const openView = {
    tradeId: 77n,
    seller,
    buyer: "0x0000000000000000000000000000000000000000" as Address,
    escrowAddress: escrow,
    paymentToken: "0x0000000000000000000000000000000000000000" as Address,
    price: 1_000_000_000_000_000_000n,
    feeBps: 200n,
    kittyIds: [77n],
    status: 0n,
    ready: true,
  };

  it("matches when on-chain listing equals the displayed listing", async () => {
    const current = listing();
    expect(
      marketBuyListingMatchesOnchainView({
        listing: current,
        onchain: openView,
      }),
    ).toBe(true);

    await expect(
      verifyMarketBuyListing({
        listing: current,
        readChainPosition: async () => openView,
      }),
    ).resolves.toBeUndefined();
  });

  it("fails when kitty ids differ", () => {
    expect(
      marketBuyListingMatchesOnchainView({
        listing: listing(),
        onchain: { ...openView, kittyIds: [999n] },
      }),
    ).toBe(false);
  });

  it("fails when status is not OPEN", () => {
    expect(
      marketBuyListingMatchesOnchainView({
        listing: listing(),
        onchain: { ...openView, status: 1n },
      }),
    ).toBe(false);
  });

  it("fails when listing is not ready", () => {
    expect(
      marketBuyListingMatchesOnchainView({
        listing: listing(),
        onchain: { ...openView, ready: false },
      }),
    ).toBe(false);
  });

  it("throws explicit errors on mismatch and missing chain data", async () => {
    await expect(
      verifyMarketBuyListing({
        listing: listing(),
        readChainPosition: async () => null,
      }),
    ).rejects.toThrow(MARKET_BUY_LISTING_VERIFY_FAILED_ERROR);

    await expect(
      verifyMarketBuyListing({
        listing: listing(),
        readChainPosition: async () => ({ ...openView, price: 123n }),
      }),
    ).rejects.toThrow(MARKET_BUY_LISTING_CHANGED_ERROR);
  });
});
