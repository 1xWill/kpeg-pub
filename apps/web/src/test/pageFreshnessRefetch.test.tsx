import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPageFreshnessRefetchStateForTests,
  markPageFreshnessForceRefetch,
  markPageFreshnessRefetch,
  shouldRunPageFreshnessForceRefetch,
  shouldRunPageFreshnessRefetch,
  usePageFreshnessRefetch,
} from "../hooks/usePageFreshnessRefetch.js";

describe("usePageFreshnessRefetch", () => {
  beforeEach(() => {
    clearPageFreshnessRefetchStateForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T00:00:00Z"));
  });

  afterEach(() => {
    clearPageFreshnessRefetchStateForTests();
    vi.useRealTimers();
  });

  it("triggers on first page visit", () => {
    const onRefetch = vi.fn();
    renderHook(() =>
      usePageFreshnessRefetch({
        pageKey: "explore",
        cooldownMs: 30_000,
        onRefetch,
      }),
    );
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  it("skips remount refetch for the same page within cooldown", () => {
    const onRefetch = vi.fn();
    const mounted = renderHook(() =>
      usePageFreshnessRefetch({
        pageKey: "market:all",
        cooldownMs: 30_000,
        onRefetch,
      }),
    );
    expect(onRefetch).toHaveBeenCalledTimes(1);
    mounted.unmount();

    renderHook(() =>
      usePageFreshnessRefetch({
        pageKey: "market:all",
        cooldownMs: 30_000,
        onRefetch,
      }),
    );
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  it("re-triggers for the same page after cooldown elapses", () => {
    const onRefetch = vi.fn();
    const mounted = renderHook(() =>
      usePageFreshnessRefetch({
        pageKey: "market:all",
        cooldownMs: 30_000,
        onRefetch,
      }),
    );
    expect(onRefetch).toHaveBeenCalledTimes(1);
    mounted.unmount();

    vi.advanceTimersByTime(30_001);
    renderHook(() =>
      usePageFreshnessRefetch({
        pageKey: "market:all",
        cooldownMs: 30_000,
        onRefetch,
      }),
    );
    expect(onRefetch).toHaveBeenCalledTimes(2);
  });

  it("evaluates cooldown using page-key timestamps", () => {
    markPageFreshnessRefetch("trade", Date.now());
    expect(
      shouldRunPageFreshnessRefetch({
        pageKey: "trade",
        now: Date.now() + 10_000,
        cooldownMs: 30_000,
      }),
    ).toBe(false);
    expect(
      shouldRunPageFreshnessRefetch({
        pageKey: "trade",
        now: Date.now() + 30_001,
        cooldownMs: 30_000,
      }),
    ).toBe(true);
  });

  it("evaluates force-token freshness per page key", () => {
    expect(
      shouldRunPageFreshnessForceRefetch({
        pageKey: "collections:0xabc",
        forceToken: 0,
      }),
    ).toBe(false);
    expect(
      shouldRunPageFreshnessForceRefetch({
        pageKey: "collections:0xabc",
        forceToken: 100,
      }),
    ).toBe(true);
    markPageFreshnessForceRefetch("collections:0xabc", 100);
    expect(
      shouldRunPageFreshnessForceRefetch({
        pageKey: "collections:0xabc",
        forceToken: 100,
      }),
    ).toBe(false);
    expect(
      shouldRunPageFreshnessForceRefetch({
        pageKey: "collections:0xabc",
        forceToken: 200,
      }),
    ).toBe(true);
  });

  it("bypasses cooldown once when force token changes", () => {
    const onRefetch = vi.fn();
    const hook = renderHook(
      ({ forceToken }: { forceToken: number }) =>
        usePageFreshnessRefetch({
          pageKey: "collections:0xabc",
          cooldownMs: 30_000,
          forceToken,
          onRefetch,
        }),
      { initialProps: { forceToken: 0 } },
    );
    expect(onRefetch).toHaveBeenCalledTimes(1);

    hook.rerender({ forceToken: 100 });
    expect(onRefetch).toHaveBeenCalledTimes(2);

    // Same force token should not repeatedly refetch.
    hook.rerender({ forceToken: 100 });
    expect(onRefetch).toHaveBeenCalledTimes(2);

    // A new force token should refetch again.
    hook.rerender({ forceToken: 101 });
    expect(onRefetch).toHaveBeenCalledTimes(3);
  });
});
