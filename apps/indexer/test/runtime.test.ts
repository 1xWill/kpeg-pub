import { describe, expect, it, vi } from "vitest";
import {
  ensureRuntimeChainIdentity,
  parseRpcFallbackUrls,
  reportedSyncStatus,
  runSyncUntilCaughtUp,
  shouldApplyCatchUpRepair,
  shouldApplySchemaOnBoot,
  validateRuntimeSyncEnv,
} from "../src/runtime.js";

describe("runtime sync catch-up", () => {
  it("keeps unknown sync state as unknown when head block has not been observed yet", () => {
    expect(
      reportedSyncStatus(
        {
          latestIndexedBlock: 0,
          headBlock: null,
          caughtUp: null,
          syncing: false,
        },
        true,
      ),
    ).toEqual({
      latestIndexedBlock: 0,
      headBlock: null,
      caughtUp: null,
      syncing: false,
    });

    expect(
      reportedSyncStatus(
        {
          latestIndexedBlock: 0,
          headBlock: null,
          caughtUp: null,
          syncing: false,
        },
        false,
      ),
    ).toEqual({
      latestIndexedBlock: 0,
      headBlock: null,
      caughtUp: null,
      syncing: false,
    });
  });

  it("treats configured unknown-head sync state as stale for request-time repair", () => {
    expect(
      shouldApplyCatchUpRepair(
        {
          latestIndexedBlock: 46_472_649,
          headBlock: null,
          caughtUp: null,
          syncing: false,
        },
        true,
      ),
    ).toBe(true);

    expect(
      shouldApplyCatchUpRepair(
        {
          latestIndexedBlock: 46_472_649,
          headBlock: null,
          caughtUp: null,
          syncing: false,
        },
        false,
      ),
    ).toBe(false);
  });

  it("treats kitty index lag as stale even when block caughtUp is true", () => {
    expect(
      shouldApplyCatchUpRepair(
        {
          latestIndexedBlock: 46_585_237,
          tokenBalanceIndexedBlock: 46_585_237,
          headBlock: 46_585_237,
          blocksBehind: 0,
          caughtUp: true,
          syncing: false,
          kittyIndexedBehind: 25,
        },
        true,
      ),
    ).toBe(true);
  });

  it("does not treat normal block lag as stale when kitty index is caught up", () => {
    expect(
      shouldApplyCatchUpRepair(
        {
          latestIndexedBlock: 46_585_200,
          tokenBalanceIndexedBlock: 46_585_200,
          headBlock: 46_585_237,
          blocksBehind: 37,
          caughtUp: false,
          syncing: false,
          kittyIndexedBehind: 0,
          lastSyncSuccessAtMs: 1_700_000_000_500,
          lastSyncFailedAtMs: 1_700_000_000_000,
        },
        true
      )
    ).toBe(false);
  });

  it("treats a newer sync failure as stale even when kitty index delta is unknown", () => {
    expect(
      shouldApplyCatchUpRepair(
        {
          latestIndexedBlock: 46_585_200,
          tokenBalanceIndexedBlock: 46_585_200,
          headBlock: 46_585_237,
          blocksBehind: 37,
          caughtUp: false,
          syncing: false,
          kittyIndexedBehind: null,
          lastSyncSuccessAtMs: 1_700_000_000_000,
          lastSyncFailedAtMs: 1_700_000_001_000,
        },
        true
      )
    ).toBe(true);
  });

  it("repairs first stale pages when the kitty index is behind, even if indexed rows are present", async () => {
    const { shouldApplyPageCatchUpRepair } = await import("../src/runtime.js");
    expect(
      shouldApplyPageCatchUpRepair({
        status: {
          latestIndexedBlock: 46_472_649,
          headBlock: 46_580_000,
          caughtUp: false,
          syncing: false,
          tokenBalanceIndexedBlock: 46_472_649,
          blocksBehind: 107_351,
          kittyIndexedBehind: 28_067,
        },
        syncConfigured: true,
        indexedItemCount: 24,
        indexedTotal: 6_944,
        page: { page: 0, pageSize: 24 },
      }),
    ).toBe(true);
  });

  it("keeps non-empty first-page repair quiet when only block cursors are behind", async () => {
    const { shouldApplyPageCatchUpRepair } = await import("../src/runtime.js");
    expect(
      shouldApplyPageCatchUpRepair({
        status: {
          latestIndexedBlock: 46_472_649,
          headBlock: 46_580_000,
          caughtUp: false,
          syncing: false,
          tokenBalanceIndexedBlock: 46_472_649,
          blocksBehind: 107_351,
        },
        syncConfigured: true,
        indexedItemCount: 24,
        indexedTotal: 6_944,
        page: { page: 0, pageSize: 24 },
      }),
    ).toBe(false);
    expect(
      shouldApplyPageCatchUpRepair({
        status: {
          latestIndexedBlock: 46_472_649,
          headBlock: 46_580_000,
          caughtUp: false,
          syncing: false,
          tokenBalanceIndexedBlock: 46_472_649,
          blocksBehind: 107_351,
          lastSyncSuccessAtMs: 1_700_000_000_000,
          lastSyncFailedAtMs: 1_700_000_001_000,
        },
        syncConfigured: true,
        indexedItemCount: 0,
        indexedTotal: 0,
        page: { page: 0, pageSize: 24 },
      }),
    ).toBe(true);
  });

  it("keeps processing chunks until the indexed block reaches chain head", async () => {
    const syncOnce = vi
      .fn()
      .mockResolvedValueOnce({ latestIndexedBlock: 5_000, headBlock: 12_000, fromBlock: 1, toBlock: 5_000 })
      .mockResolvedValueOnce({ latestIndexedBlock: 10_000, headBlock: 12_000, fromBlock: 5_001, toBlock: 10_000 })
      .mockResolvedValueOnce({ latestIndexedBlock: 12_000, headBlock: 12_000, fromBlock: 10_001, toBlock: 12_000 });

    await expect(runSyncUntilCaughtUp({ maxRuntimeMs: 110_000, syncOnce })).resolves.toEqual({
      latestIndexedBlock: 12_000,
      headBlock: 12_000,
      tokenBalanceIndexedBlock: 12_000,
      caughtUp: true
    });
    expect(syncOnce).toHaveBeenCalledTimes(3);
  });

  it("stops when the runtime budget is exhausted", async () => {
    let now = 0;
    const syncOnce = vi.fn(async () => {
      now += 60_000;
      return { latestIndexedBlock: 5_000, headBlock: 20_000, fromBlock: 1, toBlock: 5_000 };
    });

    await expect(
      runSyncUntilCaughtUp({
        maxRuntimeMs: 45_000,
        syncOnce,
        nowMs: () => now
      })
    ).resolves.toEqual({
      latestIndexedBlock: 5_000,
      headBlock: 20_000,
      tokenBalanceIndexedBlock: 5_000,
      caughtUp: false
    });
    expect(syncOnce).toHaveBeenCalledTimes(1);
  });

  it("stops once a tx-targeted sync reaches the target block before chain head", async () => {
    const syncOnce = vi.fn(async () => ({
      latestIndexedBlock: 46_473_698,
      headBlock: 46_474_722,
      fromBlock: 46_472_650,
      toBlock: 46_473_698,
      targetReached: true,
    }));

    await expect(
      runSyncUntilCaughtUp({
        maxRuntimeMs: 45_000,
        syncOnce,
      }),
    ).resolves.toEqual({
      latestIndexedBlock: 46_473_698,
      headBlock: 46_474_722,
      tokenBalanceIndexedBlock: 46_473_698,
      caughtUp: false,
    });
    expect(syncOnce).toHaveBeenCalledTimes(1);
  });

  it("keeps syncing until both event and token-balance cursors reach head", async () => {
    const syncOnce = vi
      .fn()
      .mockResolvedValueOnce({
        latestIndexedBlock: 20_000,
        tokenBalanceIndexedBlock: 10_000,
        headBlock: 20_000,
        tokenBalanceFromBlock: 5_001,
        tokenBalanceToBlock: 10_000,
      })
      .mockResolvedValueOnce({
        latestIndexedBlock: 20_000,
        tokenBalanceIndexedBlock: 20_000,
        headBlock: 20_000,
        tokenBalanceFromBlock: 10_001,
        tokenBalanceToBlock: 20_000,
      });

    await expect(runSyncUntilCaughtUp({ maxRuntimeMs: 110_000, syncOnce })).resolves.toEqual({
      latestIndexedBlock: 20_000,
      headBlock: 20_000,
      tokenBalanceIndexedBlock: 20_000,
      caughtUp: true,
    });
    expect(syncOnce).toHaveBeenCalledTimes(2);
  });
});

describe("runtime config validation", () => {
  it("parses unique RPC fallback URLs from comma or whitespace separated env", () => {
    expect(
      parseRpcFallbackUrls("https://one.example, https://two.example\nhttps://one.example"),
    ).toEqual(["https://one.example", "https://two.example"]);
  });

  it("keeps schema-on-boot disabled by default in production", () => {
    expect(shouldApplySchemaOnBoot({ NODE_ENV: "production" })).toBe(false);
    expect(
      shouldApplySchemaOnBoot({
        NODE_ENV: "production",
        KPEG_DB_APPLY_SCHEMA_ON_BOOT: "true",
      }),
    ).toBe(true);
    expect(shouldApplySchemaOnBoot({ NODE_ENV: "development" })).toBe(true);
    expect(
      shouldApplySchemaOnBoot({
        NODE_ENV: "development",
        KPEG_DB_APPLY_SCHEMA_ON_BOOT: "false",
      }),
    ).toBe(true);
  });

  it("validates chain identity without writing during read-only boot", async () => {
    const ensureChainIdentity = vi.fn();
    const repo = {
      ensureChainIdentity,
      getChainIdentity: vi.fn(async () => ({
        chainId: 8453,
        tokenAddress: "0x0000000000000000000000000000000000000001",
        marketAddress: "0x0000000000000000000000000000000000000002",
      })),
    };

    await expect(
      ensureRuntimeChainIdentity({
        repo: repo as never,
        applySchemaOnBoot: false,
        expected: {
          chainId: 8453,
          tokenAddress: "0x0000000000000000000000000000000000000001",
          marketAddress: "0x0000000000000000000000000000000000000002",
        },
      }),
    ).resolves.toBeUndefined();
    expect(ensureChainIdentity).not.toHaveBeenCalled();
  });

  it("fails read-only boot when chain identity is missing", async () => {
    const repo = {
      ensureChainIdentity: vi.fn(),
      getChainIdentity: vi.fn(async () => null),
    };

    await expect(
      ensureRuntimeChainIdentity({
        repo: repo as never,
        applySchemaOnBoot: false,
        expected: {
          chainId: 8453,
          tokenAddress: "0x0000000000000000000000000000000000000001",
          marketAddress: null,
        },
      }),
    ).rejects.toThrow("Indexer database is not initialized");
  });

  it("flags missing sync-critical runtime keys", () => {
    expect(
      validateRuntimeSyncEnv({
        KPEG_CHAIN_ID: "84532",
        KPEG_CHAIN_RPC_URL: "https://rpc.example",
      }),
    ).toEqual({
      missing: [
        "KPEG_TOKEN_ADDRESS",
        "KPEG_MARKET_ADDRESS",
        "KPEG_ROUTER_ADDRESS",
        "KPEG_QUOTER_ADDRESS",
      ],
      invalid: [],
    });
  });

  it("flags invalid chain/rpc/address values", () => {
    expect(
      validateRuntimeSyncEnv({
        KPEG_CHAIN_ID: "not-a-number",
        KPEG_CHAIN_RPC_URL: "ws://bad-rpc",
        KPEG_CHAIN_RPC_FALLBACK_URLS: "https://ok.example,ws://bad-fallback",
        KPEG_TOKEN_ADDRESS: "0x123",
        KPEG_MARKET_ADDRESS: "0x0000000000000000000000000000000000000001",
        KPEG_ROUTER_ADDRESS: "0x0000000000000000000000000000000000000002",
        KPEG_QUOTER_ADDRESS: "0x0000000000000000000000000000000000000003",
      }),
    ).toEqual({
      missing: [],
      invalid: [
        "KPEG_CHAIN_ID",
        "KPEG_CHAIN_RPC_URL",
        "KPEG_CHAIN_RPC_FALLBACK_URLS",
        "KPEG_TOKEN_ADDRESS",
      ],
    });
  });
});
