import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NORMAL_GALLERY_REFETCH_MS,
  getPostTradeRefreshUntil,
  isPostTradeRefreshActive,
  markPostTradeRefresh,
  POST_TRADE_REFRESH_EVENT,
  POST_TRADE_REFRESH_MS,
  resolveNormalGalleryRefetchMs,
} from "../lib/postTradeRefresh.js";

describe("post trade refresh marker", () => {
  it("stores and broadcasts a temporary refresh window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T00:00:00Z"));
    const listener = vi.fn();
    window.addEventListener(POST_TRADE_REFRESH_EVENT, listener);

    const until = markPostTradeRefresh();

    expect(until).toBe(Date.now() + POST_TRADE_REFRESH_MS);
    expect(getPostTradeRefreshUntil()).toBe(until);
    expect(isPostTradeRefreshActive(until)).toBe(true);
    expect(listener).toHaveBeenCalledOnce();

    window.removeEventListener(POST_TRADE_REFRESH_EVENT, listener);
    vi.useRealTimers();
  });

  it("keeps the normal refetch interval at 30s when env is absent/invalid/too small", () => {
    expect(resolveNormalGalleryRefetchMs(undefined)).toBe(
      DEFAULT_NORMAL_GALLERY_REFETCH_MS,
    );
    expect(resolveNormalGalleryRefetchMs("abc")).toBe(
      DEFAULT_NORMAL_GALLERY_REFETCH_MS,
    );
    expect(resolveNormalGalleryRefetchMs("1000")).toBe(
      DEFAULT_NORMAL_GALLERY_REFETCH_MS,
    );
  });

  it("accepts valid positive integer normal refetch overrides", () => {
    expect(resolveNormalGalleryRefetchMs("30000")).toBe(30_000);
    expect(resolveNormalGalleryRefetchMs(45_000)).toBe(45_000);
  });
});
