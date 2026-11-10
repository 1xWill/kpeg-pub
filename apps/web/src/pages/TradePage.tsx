import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useAccount } from "wagmi";
import { TradePanel } from "../components/TradePanel.js";
import { usePageFreshnessRefetch } from "../hooks/usePageFreshnessRefetch.js";
import { getConfig } from "../lib/api.js";
import {
  appendOptimisticKitties,
  appendOptimisticKittyRemovals,
} from "../lib/optimisticKitties.js";
import { markPostTradeRefresh } from "../lib/postTradeRefresh.js";
import {
  resolveRuntimeAddress,
  resolveRuntimeChainId,
} from "../lib/runtimeConfig.js";
import { enqueueTxSync } from "../lib/syncQueue.js";
import { ensureWalletRuntimeLoaded } from "../lib/wagmi.js";

function refetchKittyQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["stats"] });
  void queryClient.invalidateQueries({ queryKey: ["gallery"] });
  void queryClient.invalidateQueries({ queryKey: ["owner-summary"] });
}

type TradePageQueryInvalidationFilter = {
  queryKey: readonly unknown[];
  refetchType?: "active";
};

export function runTradePageFreshnessRefetch(input: {
  refetchConfig: () => Promise<unknown> | unknown;
  invalidateQueries: (
    filter: TradePageQueryInvalidationFilter,
  ) => Promise<unknown> | unknown;
}) {
  void input.refetchConfig();
  const refetchFilters: TradePageQueryInvalidationFilter[] = [
    { queryKey: ["stats"], refetchType: "active" },
    { queryKey: ["pool-key"], refetchType: "active" },
    { queryKey: ["token-is-currency0"], refetchType: "active" },
    { queryKey: ["quote-buy"], refetchType: "active" },
    { queryKey: ["quote-sell"], refetchType: "active" },
  ];
  for (const filter of refetchFilters) {
    void input.invalidateQueries(filter);
  }
}

export function TradePage() {
  const queryClient = useQueryClient();
  const { isConnected } = useAccount();

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    void ensureWalletRuntimeLoaded();
  }, [isConnected]);

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
    staleTime: 30_000,
  });
  const tokenAddress = resolveRuntimeAddress(
    configQuery.data?.tokenAddress,
    import.meta.env.VITE_KPEG_TOKEN_ADDRESS,
  );
  const routerAddress = resolveRuntimeAddress(
    configQuery.data?.routerAddress,
    import.meta.env.VITE_KPEG_ROUTER_ADDRESS,
  );
  const quoterAddress = resolveRuntimeAddress(
    configQuery.data?.quoterAddress,
    import.meta.env.VITE_KPEG_QUOTER_ADDRESS,
  );
  const writeChainId = resolveRuntimeChainId(
    configQuery.data?.chainId,
    import.meta.env.VITE_KPEG_CHAIN_ID,
  );
  const refetchTradePageFreshness = useCallback(() => {
    runTradePageFreshnessRefetch({
      refetchConfig: () => configQuery.refetch(),
      invalidateQueries: (filter) => queryClient.invalidateQueries(filter),
    });
  }, [configQuery, queryClient]);
  usePageFreshnessRefetch({
    pageKey: "trade",
    onRefetch: refetchTradePageFreshness,
  });

  return (
    <main className="relative z-10 mx-auto grid min-h-[calc(100vh-7rem)] w-full max-w-[var(--page-max)] content-start justify-items-center gap-4 pt-10">
      <section className="max-w-[34rem] text-center">
        <p className="m-0 font-mono text-[0.74rem] font-extrabold tracking-[0.28em] text-[var(--accent-cool)]">
          TRADE
        </p>
        <p className="mt-3 mb-0 text-[0.86rem] leading-[1.6] text-[var(--fg-muted)] max-[640px]:text-[0.78rem]">
          Buy 1 whole integer kPEG from the pool to mint 1 kitty. Selling 1
          whole kPEG burns that kitty forever and you cannot retrieve it.
        </p>
      </section>
      <div className="box-border w-full max-w-[460px] overflow-hidden rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg-soft)_88%,transparent)] p-[1.35rem] backdrop-blur-[10px] max-[640px]:p-[1rem] max-[360px]:p-[0.86rem]">
        <TradePanel
          tokenAddress={tokenAddress}
          routerAddress={routerAddress}
          quoterAddress={quoterAddress}
          writeChainId={writeChainId}
          onSettled={(settlement) => {
            if (settlement.optimisticKitties?.length) {
              appendOptimisticKitties(settlement.optimisticKitties, {
                chainId: writeChainId,
                tokenAddress,
              });
            }
            if (settlement.optimisticRemovals?.length) {
              appendOptimisticKittyRemovals(settlement.optimisticRemovals, {
                chainId: writeChainId,
                tokenAddress,
              });
            }
            markPostTradeRefresh();
            enqueueTxSync(settlement.txHash, { immediate: true });
            refetchKittyQueries(queryClient);
          }}
        />
      </div>
    </main>
  );
}
