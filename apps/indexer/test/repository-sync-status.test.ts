import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { KPEGRepository } from "../src/repository.js";

describe("repository sync status lifecycle", () => {
  it("records sync failure diagnostics and clears them on a later success", async () => {
    const db = await openDb({
      mode: "sqlite",
      sqlitePath: ":memory:",
      libsqlUrl: undefined,
      libsqlAuthToken: undefined,
    });
    const repo = new KPEGRepository(db);

    try {
      const failedAtMs = 1_717_000_000_000;
      const successAtMs = failedAtMs + 5_000;
      const txHash = `0x${"a".repeat(64)}` as const;

      await repo.recordSyncFailure({
        failedAtMs,
        phase: "main-event-ingest",
        fromBlock: 120,
        toBlock: 240,
        eventKind: "breeding-lineage",
        txHash,
        logIndex: 7,
        error: "synthetic ingest failure",
      });

      await expect(repo.getSyncFailureStatus()).resolves.toEqual({
        lastSyncSuccessAtMs: null,
        lastSyncFailedAtMs: failedAtMs,
        lastSyncPhase: "main-event-ingest",
        lastSyncFromBlock: 120,
        lastSyncToBlock: 240,
        lastSyncEventKind: "breeding-lineage",
        lastSyncTxHash: txHash,
        lastSyncLogIndex: 7,
        lastSyncError: "synthetic ingest failure",
      });

      await repo.markSyncSuccess(successAtMs);

      await expect(repo.getSyncFailureStatus()).resolves.toEqual({
        lastSyncSuccessAtMs: successAtMs,
        lastSyncFailedAtMs: null,
        lastSyncPhase: null,
        lastSyncFromBlock: null,
        lastSyncToBlock: null,
        lastSyncEventKind: null,
        lastSyncTxHash: null,
        lastSyncLogIndex: null,
        lastSyncError: null,
      });
    } finally {
      await db.close();
    }
  });

  it("stores and reads sync snapshot values for status APIs", async () => {
    const db = await openDb({
      mode: "sqlite",
      sqlitePath: ":memory:",
      libsqlUrl: undefined,
      libsqlAuthToken: undefined,
    });
    const repo = new KPEGRepository(db);

    try {
      const updatedAtMs = 1_717_000_123_456;
      await repo.setSyncSnapshot({
        headBlock: 46_583_001,
        onchainKittiesLive: 6_900,
        onchainKittiesEverMinted: 39_847,
        updatedAtMs,
      });

      await expect(repo.getSyncSnapshot()).resolves.toEqual({
        headBlock: 46_583_001,
        onchainKittiesLive: 6_900,
        onchainKittiesEverMinted: 39_847,
        updatedAtMs,
      });
    } finally {
      await db.close();
    }
  });

  it("resets replay state across history-derived tables, market sales, and sync cursors", async () => {
    const db = await openDb({
      mode: "sqlite",
      sqlitePath: ":memory:",
      libsqlUrl: undefined,
      libsqlAuthToken: undefined,
    });
    const repo = new KPEGRepository(db);
    const ownerA = "0x00000000000000000000000000000000000000a1";
    const ownerB = "0x00000000000000000000000000000000000000b2";
    const buyer = "0x00000000000000000000000000000000000000c3";

    try {
      await repo.ensureChainIdentity({
        chainId: 8453,
        tokenAddress: "0x0000000000000000000000000000000000000aaa",
        marketAddress: "0x0000000000000000000000000000000000000bbb",
      });
      await repo.ingestMintEvent({
        kittyId: 1,
        owner: ownerA,
        mintedBy: ownerA,
        tier: 1,
        batchSizeWhole: 1,
        seed: `0x${"1".repeat(64)}`,
        blockNumber: 100,
        txHash: `0x${"a".repeat(64)}`,
      });
      await repo.ingestMoveEvent({
        kittyId: 1,
        from: ownerA,
        to: ownerB,
        blockNumber: 101,
      });
      await repo.ingestMarketPositionCreated({
        tradeId: 7,
        seller: ownerB,
        escrowAddress: "0x0000000000000000000000000000000000000dd1",
        paymentToken: "0x0000000000000000000000000000000000000eee",
        priceWei: "1000000000000000000",
        feeBps: 250,
        kittyIds: [1],
        blockNumber: 102,
        txHash: `0x${"b".repeat(64)}`,
      });
      await repo.ingestMarketPositionBought({
        tradeId: 7,
        buyer,
        seller: ownerB,
        priceWei: "1000000000000000000",
        feeWei: "25000000000000000",
        blockNumber: 103,
        txHash: `0x${"c".repeat(64)}`,
      });
      await repo.setLatestIndexedBlock(103);
      await repo.setLatestTokenBalanceIndexedBlock(103);
      await repo.recordSyncFailure({
        phase: "main-event-ingest",
        failedAtMs: 1_717_000_000_000,
        fromBlock: 100,
        toBlock: 103,
        error: "synthetic failure before replay reset",
      });
      await repo.setSyncSnapshot({
        headBlock: 200,
        onchainKittiesLive: 10,
        onchainKittiesEverMinted: 11,
        updatedAtMs: 1_717_000_000_999,
      });
      await expect(repo.ownerStats(ownerA)).resolves.toEqual({
        currentKitties: 0,
        everKitties: 1,
      });
      await expect(repo.getMarketStats()).resolves.toMatchObject({
        listed: 0,
        volumeWei: "1000000000000000000",
      });

      await repo.resetIndexedStateForReplay();

      const [kittiesCount, historyCount, marketListingCount, marketSalesCount, tokenBalanceCount] = await Promise.all([
        db.get<{ value: number }>(`SELECT COUNT(*) AS value FROM kitties`),
        db.get<{ value: number }>(`SELECT COUNT(*) AS value FROM owner_kitty_history`),
        db.get<{ value: number }>(`SELECT COUNT(*) AS value FROM market_listings`),
        db.get<{ value: number }>(`SELECT COUNT(*) AS value FROM market_sales`),
        db.get<{ value: number }>(`SELECT COUNT(*) AS value FROM token_balances`),
      ]);
      expect(Number(kittiesCount?.value ?? 0)).toBe(0);
      expect(Number(historyCount?.value ?? 0)).toBe(0);
      expect(Number(marketListingCount?.value ?? 0)).toBe(0);
      expect(Number(marketSalesCount?.value ?? 0)).toBe(0);
      expect(Number(tokenBalanceCount?.value ?? 0)).toBe(0);

      await expect(repo.getLatestIndexedBlock()).resolves.toBe(0);
      await expect(repo.getLatestTokenBalanceIndexedBlock()).resolves.toBe(0);
      await expect(repo.getStats()).resolves.toMatchObject({
        kittiesLive: 0,
        kittiesEverMinted: 0,
        holdersLive: 0,
        holdersEver: 0,
        latestIndexedBlock: 0,
      });
      await expect(repo.getMarketStats()).resolves.toMatchObject({
        listed: 0,
        volumeWei: "0",
      });
      await expect(repo.getSyncFailureStatus()).resolves.toEqual({
        lastSyncSuccessAtMs: null,
        lastSyncFailedAtMs: null,
        lastSyncPhase: null,
        lastSyncFromBlock: null,
        lastSyncToBlock: null,
        lastSyncEventKind: null,
        lastSyncTxHash: null,
        lastSyncLogIndex: null,
        lastSyncError: null,
      });
      await expect(repo.getSyncSnapshot()).resolves.toMatchObject({
        headBlock: null,
        onchainKittiesLive: null,
        onchainKittiesEverMinted: null,
      });
    } finally {
      await db.close();
    }
  });
});
