import { describe, expect, it, vi } from "vitest";

const viemMocks = vi.hoisted(() => ({
  getBlockNumber: vi.fn(),
  getLogs: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getBlock: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getBlockNumber: viemMocks.getBlockNumber,
      getLogs: viemMocks.getLogs,
      getTransactionReceipt: viemMocks.getTransactionReceipt,
      getBlock: viemMocks.getBlock,
    })),
    http: vi.fn((url: string) => ({ url })),
  };
});

const { runSingleChainSync } = await import("../src/chain.js");

describe("chain token holder indexing", () => {
  it("backfills Transfer logs from the independent token balance cursor", async () => {
    viemMocks.getBlockNumber.mockResolvedValue(20n);
    viemMocks.getLogs.mockImplementation(async (params: { event?: { name?: string }; fromBlock: bigint; toBlock: bigint }) => {
      if (params.fromBlock > params.toBlock) {
        return [];
      }
      if (params.event?.name !== "Transfer") {
        return [];
      }
      return [
        {
          args: {
            from: "0x0000000000000000000000000000000000000000",
            to: "0x0000000000000000000000000000000000000001",
            amount: 10n,
          },
          blockNumber: 10n,
          transactionHash: `0x${"1".repeat(64)}`,
          transactionIndex: 0,
          logIndex: 0,
        },
      ];
    });
    const repo = {
      getLatestIndexedBlock: vi.fn(async () => 20),
      getLatestTokenBalanceIndexedBlock: vi.fn(async () => 0),
      ingestTokenTransferEvents: vi.fn(async () => undefined),
      setLatestTokenBalanceIndexedBlock: vi.fn(async () => undefined),
      setLatestIndexedBlock: vi.fn(async () => undefined),
      transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    };

    await expect(
      runSingleChainSync(repo as never, {
        rpcUrl: "https://rpc.example",
        chainId: 8453,
        tokenAddress: "0x0000000000000000000000000000000000000001",
        startBlock: 10,
        maxBlocksPerRun: 5,
      }),
    ).resolves.toMatchObject({
      latestIndexedBlock: 20,
      tokenBalanceIndexedBlock: 14,
      tokenBalanceFromBlock: 10,
      tokenBalanceToBlock: 14,
    });

    expect(repo.ingestTokenTransferEvents).toHaveBeenCalledWith([
      {
        from: "0x0000000000000000000000000000000000000000",
        to: "0x0000000000000000000000000000000000000001",
        amountWei: "10",
        blockNumber: 10,
      },
    ]);
    expect(repo.setLatestTokenBalanceIndexedBlock).toHaveBeenCalledWith(14);
    expect(repo.setLatestIndexedBlock).not.toHaveBeenCalled();
  });

  it("does not advance either cursor when main event ingestion fails after token logs load", async () => {
    viemMocks.getBlockNumber.mockResolvedValue(20n);
    viemMocks.getLogs.mockImplementation(async (params: { event?: { name?: string }; fromBlock: bigint; toBlock: bigint }) => {
      if (params.fromBlock > params.toBlock) {
        return [];
      }
      if (params.event?.name === "Transfer") {
        return [
          {
            args: {
              from: "0x0000000000000000000000000000000000000000",
              to: "0x0000000000000000000000000000000000000001",
              amount: 10n,
            },
            blockNumber: 10n,
            transactionHash: `0x${"1".repeat(64)}`,
            transactionIndex: 0,
            logIndex: 0,
          },
        ];
      }
      if (params.event?.name === "KittyMoved") {
        return [
          {
            args: {
              kittyId: 123n,
              from: "0x0000000000000000000000000000000000000001",
              to: "0x0000000000000000000000000000000000000002",
            },
            blockNumber: 11n,
            transactionHash: `0x${"2".repeat(64)}`,
            transactionIndex: 0,
            logIndex: 0,
          },
        ];
      }
      return [];
    });
    const repo = {
      getLatestIndexedBlock: vi.fn(async () => 9),
      getLatestTokenBalanceIndexedBlock: vi.fn(async () => 9),
      ingestMoveEvent: vi.fn(async () => {
        throw new Error("synthetic move failure");
      }),
      ingestTokenTransferEvents: vi.fn(async () => undefined),
      setLatestTokenBalanceIndexedBlock: vi.fn(async () => undefined),
      setLatestIndexedBlock: vi.fn(async () => undefined),
      transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    };
    const reportFailure = vi.fn(async () => undefined);

    await expect(
      runSingleChainSync(
        repo as never,
        {
          rpcUrl: "https://rpc.example",
          chainId: 8453,
          tokenAddress: "0x0000000000000000000000000000000000000001",
          startBlock: 10,
          maxBlocksPerRun: 5,
        },
        reportFailure,
      ),
    ).rejects.toThrow("chain sync failed during main-event-ingest");
    expect(reportFailure).toHaveBeenCalledWith({
      phase: "main-event-ingest",
      fromBlock: 10,
      toBlock: 14,
      eventKind: "move",
      txHash: `0x${"2".repeat(64)}`,
      logIndex: 0,
      error: "synthetic move failure",
    });
    expect(repo.ingestTokenTransferEvents).not.toHaveBeenCalled();
    expect(repo.setLatestIndexedBlock).not.toHaveBeenCalled();
    expect(repo.setLatestTokenBalanceIndexedBlock).not.toHaveBeenCalled();
  });

  it("advances both cursors together after successful main and token ingestion", async () => {
    viemMocks.getBlockNumber.mockResolvedValue(20n);
    viemMocks.getLogs.mockImplementation(async (params: { event?: { name?: string }; fromBlock: bigint; toBlock: bigint }) => {
      if (params.fromBlock > params.toBlock) {
        return [];
      }
      if (params.event?.name === "Transfer") {
        return [
          {
            args: {
              from: "0x0000000000000000000000000000000000000000",
              to: "0x0000000000000000000000000000000000000001",
              amount: 10n,
            },
            blockNumber: 10n,
            transactionHash: `0x${"1".repeat(64)}`,
            transactionIndex: 0,
            logIndex: 0,
          },
        ];
      }
      if (params.event?.name === "KittyMoved") {
        return [
          {
            args: {
              kittyId: 123n,
              from: "0x0000000000000000000000000000000000000001",
              to: "0x0000000000000000000000000000000000000002",
            },
            blockNumber: 11n,
            transactionHash: `0x${"2".repeat(64)}`,
            transactionIndex: 0,
            logIndex: 0,
          },
        ];
      }
      return [];
    });
    const callOrder: string[] = [];
    const repo = {
      getLatestIndexedBlock: vi.fn(async () => 9),
      getLatestTokenBalanceIndexedBlock: vi.fn(async () => 9),
      ingestMoveEvent: vi.fn(async () => {
        callOrder.push("main");
      }),
      ingestTokenTransferEvents: vi.fn(async () => {
        callOrder.push("token");
      }),
      setLatestTokenBalanceIndexedBlock: vi.fn(async () => undefined),
      setLatestIndexedBlock: vi.fn(async () => undefined),
      transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    };

    await expect(
      runSingleChainSync(repo as never, {
        rpcUrl: "https://rpc.example",
        chainId: 8453,
        tokenAddress: "0x0000000000000000000000000000000000000001",
        startBlock: 10,
        maxBlocksPerRun: 5,
      }),
    ).resolves.toMatchObject({
      latestIndexedBlock: 14,
      tokenBalanceIndexedBlock: 14,
    });

    expect(callOrder).toEqual(["main", "token"]);
    expect(repo.setLatestIndexedBlock).toHaveBeenCalledWith(14);
    expect(repo.setLatestTokenBalanceIndexedBlock).toHaveBeenCalledWith(14);
  });

  it("does not mark a targeted sync reached until the token balance cursor reaches the target", async () => {
    viemMocks.getBlockNumber.mockResolvedValue(200n);
    viemMocks.getLogs.mockResolvedValue([]);
    const repo = {
      getLatestIndexedBlock: vi.fn(async () => 100),
      getLatestTokenBalanceIndexedBlock: vi.fn(async () => 0),
      ingestTokenTransferEvents: vi.fn(async () => undefined),
      setLatestTokenBalanceIndexedBlock: vi.fn(async () => undefined),
      setLatestIndexedBlock: vi.fn(async () => undefined),
      transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    };

    const result = await runSingleChainSync(repo as never, {
      rpcUrl: "https://rpc.example",
      chainId: 8453,
      tokenAddress: "0x0000000000000000000000000000000000000001",
      startBlock: 1,
      maxBlocksPerRun: 50,
      targetBlock: 100,
    });

    expect(result).toMatchObject({
      latestIndexedBlock: 100,
      tokenBalanceIndexedBlock: 50,
      tokenBalanceFromBlock: 1,
      tokenBalanceToBlock: 50,
    });
    expect(result.targetReached).toBeUndefined();
  });
});
