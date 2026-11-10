import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  openDb: vi.fn(),
}));

const chainMocks = vi.hoisted(() => ({
  readChainHeadBlock: vi.fn(),
  runSingleChainSync: vi.fn(),
  readOnchainKittyCounts: vi.fn(),
}));

vi.mock("../src/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db.js")>();
  return {
    ...actual,
    openDb: dbMocks.openDb,
  };
});

vi.mock("../src/chain.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/chain.js")>();
  return {
    ...actual,
    readChainHeadBlock: chainMocks.readChainHeadBlock,
    runSingleChainSync: chainMocks.runSingleChainSync,
    readOnchainKittyCounts: chainMocks.readOnchainKittyCounts,
  };
});

const { runReconcileOnchainCli } = await import("../src/reconcile-onchain.js");

const originalEnv = { ...process.env };

describe("reconcile:onchain dry run", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      KPEG_DB_MODE: "sqlite",
      KPEG_DB_PATH: ":memory:",
      KPEG_CHAIN_ID: "8453",
      KPEG_CHAIN_RPC_URL: "https://rpc.example",
      KPEG_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000001",
      KPEG_RECONCILE_DRY_RUN: "1",
      KPEG_RECONCILE_TARGET_BLOCK: "123",
      KPEG_RECONCILE_INCLUDE_MARKET: "0",
      KPEG_RECONCILE_INCLUDE_BREEDING: "0",
    };
    dbMocks.openDb.mockReset();
    chainMocks.readChainHeadBlock.mockReset();
    chainMocks.runSingleChainSync.mockReset();
    chainMocks.readOnchainKittyCounts.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("prints plan and exits before opening DB or replaying logs", async () => {
    await expect(runReconcileOnchainCli()).resolves.toBeUndefined();
    expect(dbMocks.openDb).not.toHaveBeenCalled();
    expect(chainMocks.runSingleChainSync).not.toHaveBeenCalled();
    expect(chainMocks.readOnchainKittyCounts).not.toHaveBeenCalled();
  });
});
