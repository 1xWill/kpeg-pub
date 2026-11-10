import { useEffect, useRef } from "react";
import { NORMAL_GALLERY_REFETCH_MS } from "../lib/postTradeRefresh.js";

const pageFreshnessRefetchAt = new Map<string, number>();
const pageFreshnessForceToken = new Map<string, number>();

export function shouldRunPageFreshnessRefetch(input: {
  pageKey: string;
  now: number;
  cooldownMs: number;
}): boolean {
  const lastRefetchAt = pageFreshnessRefetchAt.get(input.pageKey) ?? 0;
  return input.now - lastRefetchAt >= input.cooldownMs;
}

export function markPageFreshnessRefetch(pageKey: string, at: number): void {
  pageFreshnessRefetchAt.set(pageKey, at);
}

export function clearPageFreshnessRefetchStateForTests(): void {
  pageFreshnessRefetchAt.clear();
  pageFreshnessForceToken.clear();
}

export function shouldRunPageFreshnessForceRefetch(input: {
  pageKey: string;
  forceToken: number;
}): boolean {
  if (!Number.isFinite(input.forceToken) || input.forceToken <= 0) {
    return false;
  }
  const previousToken = pageFreshnessForceToken.get(input.pageKey) ?? 0;
  return previousToken !== input.forceToken;
}

export function markPageFreshnessForceRefetch(
  pageKey: string,
  forceToken: number,
): void {
  pageFreshnessForceToken.set(pageKey, forceToken);
}

export function usePageFreshnessRefetch(input: {
  pageKey: string;
  enabled?: boolean;
  cooldownMs?: number;
  forceToken?: number;
  onRefetch: () => Promise<void> | void;
}): void {
  const enabled = input.enabled ?? true;
  const cooldownMs = input.cooldownMs ?? NORMAL_GALLERY_REFETCH_MS;
  const forceToken = input.forceToken ?? 0;
  const onRefetchRef = useRef(input.onRefetch);
  useEffect(() => {
    onRefetchRef.current = input.onRefetch;
  }, [input.onRefetch]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (
      shouldRunPageFreshnessForceRefetch({
        pageKey: input.pageKey,
        forceToken,
      })
    ) {
      const now = Date.now();
      markPageFreshnessRefetch(input.pageKey, now);
      markPageFreshnessForceRefetch(input.pageKey, forceToken);
      void Promise.resolve(onRefetchRef.current());
      return;
    }
    const now = Date.now();
    if (
      !shouldRunPageFreshnessRefetch({
        pageKey: input.pageKey,
        now,
        cooldownMs,
      })
    ) {
      return;
    }
    markPageFreshnessRefetch(input.pageKey, now);
    void Promise.resolve(onRefetchRef.current());
  }, [cooldownMs, enabled, forceToken, input.pageKey]);
}
