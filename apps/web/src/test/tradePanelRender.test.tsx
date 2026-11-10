import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradePanel } from "../components/TradePanel.js";
import { SELL_BURN_WARNING } from "../lib/tradePanelBuy.js";

const writeContractAsync = vi.fn();

vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi")>();
  return {
    ...actual,
    useAccount: () => ({
      address: "0x1111111111111111111111111111111111111111",
      chainId: 84532,
    }),
    useConnect: () => ({
      connect: vi.fn(),
      connectors: [{ id: "injected" }],
      isPending: false,
    }),
    usePublicClient: () => null,
    useReadContract: (input: { functionName?: string }) => {
      switch (input.functionName) {
        case "allowance":
          return { data: 0n, isLoading: false, refetch: vi.fn() };
        case "maxBuy":
          return { data: 10_000_000_000_000_000_000n, isLoading: false };
        case "kittiesLive":
          return { data: 100n, isLoading: false };
        case "ownerKittiesLive":
          return { data: 3n, isLoading: false };
        case "notMintableAccount":
          return {
            data: "0x0000000000000000000000000000000000000002",
            isLoading: false,
          };
        default:
          return { data: undefined, isLoading: false };
      }
    },
    useBalance: (input: { token?: string }) =>
      input.token
        ? { data: { value: 3_400_000_000_000_000_000n }, isLoading: false }
        : { data: { value: 1_000_000_000_000_000_000n }, isLoading: false },
    useWaitForTransactionReceipt: () => ({
      isLoading: false,
      isSuccess: false,
      data: undefined,
    }),
    useWriteContract: () => ({
      writeContractAsync,
      isPending: false,
      data: undefined,
    }),
  };
});

vi.mock("../context/toast.js", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

function renderTradePanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TradePanel
        tokenAddress={"0x3333333333333333333333333333333333333333"}
        routerAddress={undefined}
        quoterAddress={undefined}
        writeChainId={84532}
        onSettled={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("TradePanel sell burn warning", () => {
  it("renders fixed sell warning text when sell can burn live kitty capacity", () => {
    renderTradePanel();
    fireEvent.click(screen.getByRole("button", { name: "SELL" }));
    expect(screen.queryByText(SELL_BURN_WARNING)).not.toBeNull();
  });
});

describe("TradePanel numeric rendering", () => {
  it("keeps rolling digits on trade values without lifted digit slots", () => {
    renderTradePanel();

    expect(document.querySelector(".kpeg-rolling-track")).not.toBeNull();
    expect(screen.getByLabelText("1 ETH")).not.toBeNull();
    expect(screen.queryByLabelText("2.00%")).toBeNull();
    expect(screen.getByText("2.00%")).not.toBeNull();

    const tradeDigits = Array.from(
      document.querySelectorAll(".kpeg-rolling-track"),
    );
    expect(tradeDigits.length).toBeGreaterThan(0);
    expect(tradeDigits.every((track) => track.className.includes("absolute"))).toBe(true);
    expect(tradeDigits.every((track) => !track.className.includes("flex"))).toBe(true);
  });
});
