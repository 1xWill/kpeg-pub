import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

describe("useDebouncedValue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates only after the configured delay", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: "a" }
    });

    expect(result.current).toBe("a");
    rerender({ value: "abc" });
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("abc");
  });
});
