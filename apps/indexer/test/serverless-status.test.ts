import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chainMocks = vi.hoisted(() => ({
  readChainHeadBlock: vi.fn(),
  readOnchainKittyCounts: vi.fn(),
}));

vi.mock("../src/chain.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/chain.js")>();
  return {
    ...actual,
    readChainHeadBlock: chainMocks.readChainHeadBlock,
    readOnchainKittyCounts: chainMocks.readOnchainKittyCounts,
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
  };
}

describe("serverless /api/status runtime sync fields", () => {
  beforeEach(() => {
    vi.resetModules();
    chainMocks.readChainHeadBlock.mockReset();
    chainMocks.readOnchainKittyCounts.mockReset();
    applyRuntimeEnv();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns kitty freshness fields when onchain count reads succeed", async () => {
    const { getRuntimeContext } = await import("../src/runtime.js");
    const context = await getRuntimeContext();
    await context.repo.setLatestIndexedBlock(450);
    await context.repo.setLatestTokenBalanceIndexedBlock(460);
    await context.repo.setSyncSnapshot({
      headBlock: 500,
      onchainKittiesLive: 6_900,
      onchainKittiesEverMinted: 7_000,
      updatedAtMs: Date.now(),
    });
    const { handleApiRequest } = await import("../src/serverless.js");
    const response = await handleApiRequest({ method: "GET", url: "/api/status" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      latestIndexedBlock: 450,
      tokenBalanceIndexedBlock: 460,
      headBlock: 500,
      blocksBehind: 50,
      caughtUp: false,
      syncing: false,
      maxKittyId: 0,
      dbLiveKitties: 0,
      onchainKittiesEverMinted: 7_000,
      onchainKittiesLive: 6_900,
      kittyIndexedBehind: 7_000,
    });
    expect(chainMocks.readChainHeadBlock).not.toHaveBeenCalled();
    expect(chainMocks.readOnchainKittyCounts).not.toHaveBeenCalled();
  });

  it("keeps /api/status usable when snapshot rows are missing", async () => {
    const { handleApiRequest } = await import("../src/serverless.js");
    const response = await handleApiRequest({ method: "GET", url: "/api/status" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      latestIndexedBlock: 0,
      tokenBalanceIndexedBlock: 0,
      headBlock: null,
      blocksBehind: null,
      caughtUp: null,
      syncing: false,
      maxKittyId: 0,
      dbLiveKitties: 0,
      onchainKittiesEverMinted: null,
      onchainKittiesLive: null,
      kittyIndexedBehind: null,
    });
    expect(chainMocks.readChainHeadBlock).not.toHaveBeenCalled();
    expect(chainMocks.readOnchainKittyCounts).not.toHaveBeenCalled();
  });
});
