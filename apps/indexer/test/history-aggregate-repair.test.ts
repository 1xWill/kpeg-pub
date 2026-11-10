import { beforeEach, describe, expect, it, vi } from "vitest";

const viemMocks = vi.hoisted(() => ({
  getBlockNumber: vi.fn(),
  getBlock: vi.fn(),
}));

const chainMocks = vi.hoisted(() => ({
  getLogsInChunks: vi.fn(),
  compareChainEvents: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getBlockNumber: viemMocks.getBlockNumber,
      getBlock: viemMocks.getBlock,
    })),
    http: vi.fn((url: string) => ({ url })),
  };
});

vi.mock("../src/chain.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/chain.js")>();
  return {
    ...actual,
    getLogsInChunks: chainMocks.getLogsInChunks,
    compareChainEvents: chainMocks.compareChainEvents,
  };
});

const { HISTORY_AGGREGATE_REPAIR_JOB_NAME, runHistoryAggregateRepairChunk } = await import(
  "../src/history-aggregate-repair.js"
);

describe("history aggregate repair", () => {
  beforeEach(() => {
    viemMocks.getBlockNumber.mockReset();
    viemMocks.getBlock.mockReset();
    chainMocks.getLogsInChunks.mockReset();
    chainMocks.compareChainEvents.mockReset();
    viemMocks.getBlockNumber.mockResolvedValue(20n);
    viemMocks.getBlock.mockResolvedValue({ timestamp: 1_000n });
    chainMocks.getLogsInChunks.mockResolvedValue([]);
    chainMocks.compareChainEvents.mockImplementation((a: {
      log: { blockNumber?: bigint; transactionIndex?: number; logIndex?: number };
    }, b: {
      log: { blockNumber?: bigint; transactionIndex?: number; logIndex?: number };
    }) => {
      const aBlock = Number(a.log.blockNumber ?? 0n);
      const bBlock = Number(b.log.blockNumber ?? 0n);
      if (aBlock !== bBlock) {
        return aBlock - bBlock;
      }
      const aTx = a.log.transactionIndex ?? 0;
      const bTx = b.log.transactionIndex ?? 0;
      if (aTx !== bTx) {
        return aTx - bTx;
      }
      return (a.log.logIndex ?? 0) - (b.log.logIndex ?? 0);
    });
  });

  it("skips when repair job is already done", async () => {
    const repo = {
      ensureRepairJob: vi.fn(async () => ({
        jobName: HISTORY_AGGREGATE_REPAIR_JOB_NAME,
        version: 1,
        status: "done" as const,
        fromBlock: 10,
        nextBlock: 21,
        targetBlock: 20,
        updatedAtMs: Date.now(),
        lastError: null,
      })),
      markRepairJobRunning: vi.fn(),
      appendOwnerKittyHistoryRepair: vi.fn(),
      upsertMarketSalesRepair: vi.fn(),
      updateRepairJobProgress: vi.fn(),
      finalizeHistoryAggregateRepair: vi.fn(),
    };

    const result = await runHistoryAggregateRepairChunk({
      repo: repo as never,
      syncConfig: {
        rpcUrl: "https://rpc.example",
        chainId: 8453,
        tokenAddress: "0x0000000000000000000000000000000000000001",
      },
      maxBlocksPerRun: 5_000,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("already-done");
    expect(repo.markRepairJobRunning).not.toHaveBeenCalled();
    expect(chainMocks.getLogsInChunks).not.toHaveBeenCalled();
  });

  it("resumes from next_block and preserves chain ordering", async () => {
    const appendOwnerKittyHistoryRepair = vi.fn(async () => undefined);
    const updateRepairJobProgress = vi.fn(async (input: { nextBlock: number; targetBlock: number }) => ({
      jobName: HISTORY_AGGREGATE_REPAIR_JOB_NAME,
      version: 1,
      status: "running" as const,
      fromBlock: 10,
      nextBlock: input.nextBlock,
      targetBlock: input.targetBlock,
      updatedAtMs: Date.now(),
      lastError: null,
    }));
    const repo = {
      ensureRepairJob: vi.fn(async () => ({
        jobName: HISTORY_AGGREGATE_REPAIR_JOB_NAME,
        version: 1,
        status: "running" as const,
        fromBlock: 10,
        nextBlock: 10,
        targetBlock: 20,
        updatedAtMs: Date.now(),
        lastError: null,
      })),
      markRepairJobRunning: vi.fn(async () => undefined),
      appendOwnerKittyHistoryRepair,
      upsertMarketSalesRepair: vi.fn(async () => undefined),
      updateRepairJobProgress,
      finalizeHistoryAggregateRepair: vi.fn(),
    };

    chainMocks.getLogsInChunks.mockImplementation(async (_client: unknown, params: { event?: { name?: string } }) => {
      if (params.event?.name === "KittyBatchMinted") {
        return [{
          args: {
            owner: "0x00000000000000000000000000000000000000a1",
            startKittyId: 1n,
            count: 1n,
          },
          blockNumber: 10n,
          transactionIndex: 0,
          logIndex: 2,
        }];
      }
      if (params.event?.name === "KittyMoved") {
        return [{
          args: {
            to: "0x00000000000000000000000000000000000000b2",
            kittyId: 1n,
          },
          blockNumber: 10n,
          transactionIndex: 0,
          logIndex: 1,
        }];
      }
      return [];
    });

    const result = await runHistoryAggregateRepairChunk({
      repo: repo as never,
      syncConfig: {
        rpcUrl: "https://rpc.example",
        chainId: 8453,
        tokenAddress: "0x0000000000000000000000000000000000000001",
      },
      maxBlocksPerRun: 5,
    });

    expect(result.processedFromBlock).toBe(10);
    expect(result.processedToBlock).toBe(14);
    expect(updateRepairJobProgress).toHaveBeenCalledWith({
      jobName: HISTORY_AGGREGATE_REPAIR_JOB_NAME,
      nextBlock: 15,
      targetBlock: 20,
      done: false,
    });
    expect(appendOwnerKittyHistoryRepair).toHaveBeenCalledWith([
      {
        owner: "0x00000000000000000000000000000000000000b2",
        kittyId: 1,
        firstSeenAt: 1_000_000,
      },
      {
        owner: "0x00000000000000000000000000000000000000a1",
        kittyId: 1,
        firstSeenAt: 1_000_000,
      },
    ]);
  });
});
