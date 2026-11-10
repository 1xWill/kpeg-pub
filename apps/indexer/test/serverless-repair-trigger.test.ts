import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chainMocks = vi.hoisted(() => ({
  runSingleChainSync: vi.fn(),
  readOnchainKittyCounts: vi.fn(),
  transactionTouchesIndexedContracts: vi.fn(),
}));

const repairMocks = vi.hoisted(() => ({
  runHistoryAggregateRepairChunk: vi.fn(),
}));

vi.mock("../src/chain.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/chain.js")>();
  return {
    ...actual,
    runSingleChainSync: chainMocks.runSingleChainSync,
    readOnchainKittyCounts: chainMocks.readOnchainKittyCounts,
    transactionTouchesIndexedContracts: chainMocks.transactionTouchesIndexedContracts,
  };
});

vi.mock("../src/history-aggregate-repair.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/history-aggregate-repair.js")>();
  return {
    ...actual,
    runHistoryAggregateRepairChunk: repairMocks.runHistoryAggregateRepairChunk,
  };
});

const originalEnv = { ...process.env };
const TEST_TOKEN = "0x0000000000000000000000000000000000000001";
const TEST_MARKET = "0x0000000000000000000000000000000000000002";
const TEST_ROUTER = "0x0000000000000000000000000000000000000003";
const TEST_QUOTER = "0x0000000000000000000000000000000000000004";

function applyRuntimeEnv(): void {
  process.env = {
    ...originalEnv,
    NODE_ENV: "development",
    KPEG_DB_MODE: "sqlite",
    KPEG_DB_PATH: ":memory:",
    KPEG_CHAIN_RPC_URL: "https://rpc.example",
    KPEG_CHAIN_RPC_FALLBACK_URLS: "",
    KPEG_CHAIN_ID: "8453",
    KPEG_TOKEN_ADDRESS: TEST_TOKEN,
    KPEG_MARKET_ADDRESS: TEST_MARKET,
    KPEG_ROUTER_ADDRESS: TEST_ROUTER,
    KPEG_QUOTER_ADDRESS: TEST_QUOTER,
    KPEG_SYNC_SECRET: "sync-secret",
  };
}

describe("serverless repair trigger guard", () => {
  beforeEach(() => {
    vi.resetModules();
    chainMocks.runSingleChainSync.mockReset();
    chainMocks.readOnchainKittyCounts.mockReset();
    chainMocks.transactionTouchesIndexedContracts.mockReset();
    repairMocks.runHistoryAggregateRepairChunk.mockReset();
    applyRuntimeEnv();
    chainMocks.runSingleChainSync.mockResolvedValue({
      latestIndexedBlock: 100,
      tokenBalanceIndexedBlock: 100,
      headBlock: 100,
      fromBlock: 1,
      toBlock: 100,
      tokenBalanceFromBlock: 1,
      tokenBalanceToBlock: 100,
    });
    chainMocks.readOnchainKittyCounts.mockResolvedValue({
      blockNumber: 100,
      kittiesLive: 10,
      kittiesEverMinted: 11,
    });
    chainMocks.transactionTouchesIndexedContracts.mockResolvedValue({
      trusted: true,
      blockNumber: 100,
    });
    repairMocks.runHistoryAggregateRepairChunk.mockResolvedValue({
      job: {
        jobName: "history-aggregates",
        version: 1,
        status: "running",
        fromBlock: 1,
        nextBlock: 5_001,
        targetBlock: 100_000,
        updatedAtMs: Date.now(),
        lastError: null,
      },
      processedFromBlock: 1,
      processedToBlock: 5_000,
      scannedEventCount: 12,
      ownerHistoryRows: 50,
      marketSalesRows: 3,
      finalized: false,
      skipped: false,
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("does not trigger history repair from public GET routes", async () => {
    const { handleApiRequest } = await import("../src/serverless.js");
    const response = await handleApiRequest({ method: "GET", url: "/api/status" });
    expect(response.statusCode).toBe(200);
    expect(repairMocks.runHistoryAggregateRepairChunk).not.toHaveBeenCalled();
  });

  it("triggers one repair chunk from authorized /api/sync", async () => {
    const { handleApiRequest } = await import("../src/serverless.js");
    const response = await handleApiRequest({
      method: "GET",
      url: "/api/sync",
      headers: {
        authorization: "Bearer sync-secret",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(repairMocks.runHistoryAggregateRepairChunk).toHaveBeenCalledTimes(1);
  });

  it("does not trigger repair for tx-scoped sync without secret", async () => {
    const { handleApiRequest } = await import("../src/serverless.js");
    const response = await handleApiRequest({
      method: "POST",
      url: "/api/sync",
      payload: JSON.stringify({
        txHash: `0x${"1".repeat(64)}`,
      }),
      headers: {
        "content-type": "application/json",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(repairMocks.runHistoryAggregateRepairChunk).not.toHaveBeenCalled();
  });

  it("does not trigger repair chunk when current repair version is already done", async () => {
    const { getRuntimeContext } = await import("../src/runtime.js");
    const context = await getRuntimeContext();
    await context.repo.ensureRepairJob({
      jobName: "history-aggregates",
      version: 1,
      fromBlock: 1,
      targetBlock: 100,
    });
    await context.repo.updateRepairJobProgress({
      jobName: "history-aggregates",
      nextBlock: 101,
      targetBlock: 100,
      done: true,
    });

    const { handleApiRequest } = await import("../src/serverless.js");
    const response = await handleApiRequest({
      method: "GET",
      url: "/api/sync",
      headers: {
        authorization: "Bearer sync-secret",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(repairMocks.runHistoryAggregateRepairChunk).not.toHaveBeenCalled();
  });
});
