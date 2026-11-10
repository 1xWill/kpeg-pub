import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAppendOnlyKeyExpansion,
  useProgressiveItems,
} from "../hooks/useProgressiveItems.js";

function flushFrames() {
  act(() => {
    vi.runOnlyPendingTimers();
  });
}

describe("isAppendOnlyKeyExpansion", () => {
  it("accepts prefix-preserving expansions", () => {
    expect(
      isAppendOnlyKeyExpansion({
        previousKeys: ["1", "2"],
        nextKeys: ["1", "2", "3"],
      }),
    ).toBe(true);
  });

  it("rejects key changes or shrink", () => {
    expect(
      isAppendOnlyKeyExpansion({
        previousKeys: ["1", "2"],
        nextKeys: ["2", "1"],
      }),
    ).toBe(false);
    expect(
      isAppendOnlyKeyExpansion({
        previousKeys: ["1", "2"],
        nextKeys: ["1"],
      }),
    ).toBe(false);
  });
});

describe("useProgressiveItems", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reveals items in chunks until complete", () => {
    const items = Array.from({ length: 10 }, (_, index) => index + 1);
    const { result } = renderHook(() =>
      useProgressiveItems({
        items,
        getKey: (item) => String(item),
        enabled: true,
        initialCount: 3,
        chunkSize: 3,
      }),
    );

    expect(result.current.visibleItems).toEqual([1, 2, 3]);
    expect(result.current.pendingCount).toBe(7);

    flushFrames();
    expect(result.current.visibleItems).toEqual([1, 2, 3, 4, 5, 6]);

    flushFrames();
    flushFrames();
    expect(result.current.visibleItems).toEqual(items);
    expect(result.current.complete).toBe(true);
  });

  it("keeps all items visible when disabled", () => {
    const items = [1, 2, 3, 4];
    const { result } = renderHook(() =>
      useProgressiveItems({
        items,
        getKey: (item) => String(item),
        enabled: false,
        initialCount: 1,
        chunkSize: 1,
      }),
    );
    expect(result.current.visibleItems).toEqual(items);
    expect(result.current.pendingCount).toBe(0);
  });

  it("preserves current visibility for append-only additions", () => {
    const firstItems = [1, 2, 3, 4, 5];
    const { result, rerender } = renderHook(
      ({ items }) =>
        useProgressiveItems({
          items,
          getKey: (item) => String(item),
          enabled: true,
          initialCount: 2,
          chunkSize: 2,
        }),
      {
        initialProps: { items: firstItems },
      },
    );

    flushFrames();
    expect(result.current.visibleItems).toEqual([1, 2, 3, 4]);

    rerender({ items: [1, 2, 3, 4, 5, 6, 7] });
    expect(result.current.visibleItems).toEqual([1, 2, 3, 4]);

    flushFrames();
    expect(result.current.visibleItems).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("resets when key order changes", () => {
    const { result, rerender } = renderHook(
      ({ items }) =>
        useProgressiveItems({
          items,
          getKey: (item) => String(item),
          enabled: true,
          initialCount: 2,
          chunkSize: 2,
        }),
      {
        initialProps: { items: [1, 2, 3, 4] },
      },
    );
    flushFrames();
    expect(result.current.visibleItems).toEqual([1, 2, 3, 4]);

    rerender({ items: [4, 3, 2, 1] });
    expect(result.current.visibleItems).toEqual([4, 3]);
  });

  it("never renders reordered keys with stale expanded count before effects flush", () => {
    const renderHistory: number[][] = [];
    const { rerender } = renderHook(
      ({ items }) => {
        const state = useProgressiveItems({
          items,
          getKey: (item) => String(item),
          enabled: true,
          initialCount: 2,
          chunkSize: 2,
        });
        renderHistory.push([...state.visibleItems]);
        return state;
      },
      {
        initialProps: { items: [1, 2, 3, 4, 5, 6] },
      },
    );

    flushFrames();
    flushFrames();
    renderHistory.length = 0;

    rerender({ items: [6, 5, 4, 3, 2, 1] });
    expect(renderHistory[0]).toEqual([6, 5]);
  });

  it("ignores stale frame callbacks after key signature changes", () => {
    let frameId = 0;
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frameId += 1;
      frameCallbacks.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frameCallbacks.delete(id);
    });

    const { result, rerender } = renderHook(
      ({ items }) =>
        useProgressiveItems({
          items,
          getKey: (item) => String(item),
          enabled: true,
          initialCount: 2,
          chunkSize: 2,
        }),
      {
        initialProps: { items: [1, 2, 3, 4, 5, 6] },
      },
    );
    const staleCallback = frameCallbacks.get(1);
    expect(staleCallback).toBeTypeOf("function");

    rerender({ items: [6, 5, 4, 3, 2, 1] });
    act(() => {
      staleCallback?.(performance.now());
    });
    expect(result.current.visibleItems).toEqual([6, 5]);
  });

  it("cancels scheduled frame work on unmount", () => {
    let frameId = 0;
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    const cancelledFrameIds: number[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frameId += 1;
      frameCallbacks.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      cancelledFrameIds.push(id);
      frameCallbacks.delete(id);
    });

    const { unmount } = renderHook(() =>
      useProgressiveItems({
        items: [1, 2, 3, 4, 5, 6],
        getKey: (item) => String(item),
        enabled: true,
        initialCount: 2,
        chunkSize: 2,
      }),
    );
    expect(frameCallbacks.size).toBe(1);

    unmount();
    expect(cancelledFrameIds).toContain(1);
    expect(frameCallbacks.size).toBe(0);
  });
});
