import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runTradePageFreshnessRefetch,
  TradePage,
} from "../pages/TradePage.js";

const ensureWalletRuntimeLoadedMock = vi.fn();
const getConfigMock = vi.fn();
let isConnected = false;

vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi")>();
  return {
    ...actual,
    useAccount: () => ({ isConnected }),
  };
});

vi.mock("../components/TradePanel.js", () => ({
  TradePanel: () => <div>Trade Panel</div>,
}));

vi.mock("../lib/wagmi.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/wagmi.js")>();
  return {
    ...actual,
    ensureWalletRuntimeLoaded: () => ensureWalletRuntimeLoadedMock(),
  };
});

vi.mock("../lib/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api.js")>();
  return {
    ...actual,
    getConfig: (...args: unknown[]) => getConfigMock(...args),
  };
});

function renderTradePage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TradePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  ensureWalletRuntimeLoadedMock.mockReset();
  getConfigMock.mockReset();
  getConfigMock.mockResolvedValue({
    chainId: 84532,
    tokenAddress: null,
    routerAddress: null,
    quoterAddress: null,
  });
  isConnected = false;
});

afterEach(() => {
  cleanup();
});

describe("TradePage wallet runtime warmup", () => {
  it("auto-loads wallet runtime when wallet is already connected", async () => {
    isConnected = true;
    renderTradePage();
    await waitFor(() => {
      expect(ensureWalletRuntimeLoadedMock).toHaveBeenCalledTimes(1);
    });
  });

  it("does not load wallet runtime when wallet is disconnected", async () => {
    renderTradePage();
    await waitFor(() => {
      expect(getConfigMock).toHaveBeenCalled();
    });
    expect(ensureWalletRuntimeLoadedMock).not.toHaveBeenCalled();
  });
});

describe("runTradePageFreshnessRefetch", () => {
  it("refreshes config and active trade live query groups", () => {
    const refetchConfig = vi.fn();
    const invalidateQueries = vi.fn();

    runTradePageFreshnessRefetch({
      refetchConfig,
      invalidateQueries,
    });

    expect(refetchConfig).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledTimes(5);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ["stats"],
      refetchType: "active",
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ["pool-key"],
      refetchType: "active",
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: ["token-is-currency0"],
      refetchType: "active",
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(4, {
      queryKey: ["quote-buy"],
      refetchType: "active",
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(5, {
      queryKey: ["quote-sell"],
      refetchType: "active",
    });
  });
});
