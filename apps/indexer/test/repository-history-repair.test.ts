import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { KPEGRepository } from "../src/repository.js";

describe("repository history aggregate repair state", () => {
  it("resumes from persisted next_block for the same repair version", async () => {
    const db = await openDb({
      mode: "sqlite",
      sqlitePath: ":memory:",
      libsqlUrl: undefined,
      libsqlAuthToken: undefined,
    });
    const repo = new KPEGRepository(db);
    try {
      const first = await repo.ensureRepairJob({
        jobName: "history-aggregates",
        version: 1,
        fromBlock: 100,
        targetBlock: 400,
      });
      expect(first).toMatchObject({
        status: "pending",
        fromBlock: 100,
        nextBlock: 100,
        targetBlock: 400,
      });
      await repo.updateRepairJobProgress({
        jobName: "history-aggregates",
        nextBlock: 180,
        targetBlock: 400,
        done: false,
      });
      const resumed = await repo.ensureRepairJob({
        jobName: "history-aggregates",
        version: 1,
        fromBlock: 100,
        targetBlock: 450,
      });
      expect(resumed).toMatchObject({
        status: "running",
        fromBlock: 100,
        nextBlock: 180,
        targetBlock: 450,
      });
    } finally {
      await db.close();
    }
  });

  it("rebuilds owner-ever and market volume from repair staging without touching sync cursors", async () => {
    const db = await openDb({
      mode: "sqlite",
      sqlitePath: ":memory:",
      libsqlUrl: undefined,
      libsqlAuthToken: undefined,
    });
    const repo = new KPEGRepository(db);
    const ownerA = "0x00000000000000000000000000000000000000a1";
    const ownerB = "0x00000000000000000000000000000000000000b2";
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
        blockNumber: 10,
        txHash: `0x${"a".repeat(64)}`,
      });
      await repo.ingestMoveEvent({
        kittyId: 1,
        from: ownerA,
        to: ownerB,
        blockNumber: 11,
      });
      await repo.setLatestIndexedBlock(777);
      await repo.setLatestTokenBalanceIndexedBlock(888);
      await repo.ensureRepairJob({
        jobName: "history-aggregates",
        version: 1,
        fromBlock: 10,
        targetBlock: 20,
      });
      await repo.appendOwnerKittyHistoryRepair([
        { owner: ownerA, kittyId: 1, firstSeenAt: 1_000 },
        { owner: ownerB, kittyId: 1, firstSeenAt: 1_500 },
      ]);
      await repo.upsertMarketSalesRepair([
        {
          tradeId: 2,
          seller: ownerA,
          buyer: ownerB,
          priceWei: "1000000000000000000",
          feeWei: "25000000000000000",
          soldBlock: 12,
          soldTxHash: `0x${"b".repeat(64)}`,
          soldAt: 2_000,
        },
      ]);

      const finalized = await repo.finalizeHistoryAggregateRepair("history-aggregates");
      expect(finalized.status).toBe("done");
      expect(finalized.nextBlock).toBe(21);

      await expect(repo.ownerStats(ownerA)).resolves.toEqual({
        currentKitties: 0,
        everKitties: 1,
      });
      await expect(repo.ownerStats(ownerB)).resolves.toEqual({
        currentKitties: 1,
        everKitties: 1,
      });
      await expect(repo.getMarketStats()).resolves.toMatchObject({
        volumeWei: "1000000000000000000",
      });
      await expect(repo.getLatestIndexedBlock()).resolves.toBe(777);
      await expect(repo.getLatestTokenBalanceIndexedBlock()).resolves.toBe(888);
    } finally {
      await db.close();
    }
  });

  it("keeps a done repair job frozen for the same version", async () => {
    const db = await openDb({
      mode: "sqlite",
      sqlitePath: ":memory:",
      libsqlUrl: undefined,
      libsqlAuthToken: undefined,
    });
    const repo = new KPEGRepository(db);
    try {
      await repo.ensureRepairJob({
        jobName: "history-aggregates",
        version: 1,
        fromBlock: 100,
        targetBlock: 120,
      });
      await repo.updateRepairJobProgress({
        jobName: "history-aggregates",
        nextBlock: 121,
        targetBlock: 120,
        done: true,
      });

      const ensured = await repo.ensureRepairJob({
        jobName: "history-aggregates",
        version: 1,
        fromBlock: 100,
        targetBlock: 300,
      });
      expect(ensured).toMatchObject({
        status: "done",
        fromBlock: 100,
        nextBlock: 121,
        targetBlock: 120,
      });
    } finally {
      await db.close();
    }
  });
});
