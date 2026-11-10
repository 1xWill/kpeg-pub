import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getKitty } from "../lib/api.js";

const DEFAULT_PREFETCH_DELAY_MS = 1200;
const DETAIL_QUERY_STALE_MS = 60_000;
const FALLBACK_CHAIN_ID = Number(import.meta.env.VITE_KPEG_CHAIN_ID ?? 84532);
const FALLBACK_TOKEN_ADDRESS = (
  import.meta.env.VITE_KPEG_TOKEN_ADDRESS?.trim().toLowerCase() ?? ""
);

type DetailQueryScope = {
  chainId?: number | null;
  tokenAddress?: string | null;
};

function resolvePrefetchDelayMs(): number {
  const raw = Number(import.meta.env.VITE_KPEG_DETAIL_PREFETCH_DELAY_MS ?? DEFAULT_PREFETCH_DELAY_MS);
  if (!Number.isFinite(raw)) {
    return DEFAULT_PREFETCH_DELAY_MS;
  }
  return Math.max(200, Math.min(5_000, Math.floor(raw)));
}

function prefetchDetailRouteModule() {
  return import("../pages/DetailPage.js");
}

function clearTimer(timerRef: { current: number | null }) {
  if (timerRef.current === null) {
    return;
  }
  window.clearTimeout(timerRef.current);
  timerRef.current = null;
}

function resolveScope(scope?: DetailQueryScope): {
  chainId: number;
  tokenAddress: string;
} {
  const chainId =
    Number.isInteger(scope?.chainId) && Number(scope?.chainId) > 0
      ? Number(scope?.chainId)
      : Number.isInteger(FALLBACK_CHAIN_ID) && FALLBACK_CHAIN_ID > 0
        ? FALLBACK_CHAIN_ID
        : 0;
  const tokenAddress =
    scope?.tokenAddress?.trim().toLowerCase() || FALLBACK_TOKEN_ADDRESS || "unknown";
  return { chainId, tokenAddress };
}

export function useKittyDetailPrefetch(
  kittyId: number | null | undefined,
  scope?: DetailQueryScope
) {
  const queryClient = useQueryClient();
  const timerRef = useRef<number | null>(null);
  const queryScope = resolveScope(scope);

  const runPrefetch = useCallback(() => {
    if (!kittyId || kittyId < 1) {
      return;
    }
    clearTimer(timerRef);
    void queryClient.prefetchQuery({
      queryKey: ["kitty", queryScope.chainId, queryScope.tokenAddress, kittyId],
      queryFn: () => getKitty(kittyId),
      staleTime: DETAIL_QUERY_STALE_MS,
    });
    void prefetchDetailRouteModule();
  }, [kittyId, queryClient, queryScope.chainId, queryScope.tokenAddress]);

  const arm = useCallback(() => {
    clearTimer(timerRef);
    timerRef.current = window.setTimeout(runPrefetch, resolvePrefetchDelayMs());
  }, [runPrefetch]);

  const disarm = useCallback(() => {
    clearTimer(timerRef);
  }, []);

  useEffect(() => {
    return () => clearTimer(timerRef);
  }, []);

  return {
    onPointerEnter: arm,
    onPointerLeave: disarm,
    onPointerCancel: disarm,
    onFocus: arm,
    onBlur: disarm,
  };
}
