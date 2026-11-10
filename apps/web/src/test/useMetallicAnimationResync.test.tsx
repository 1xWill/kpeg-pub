import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useMetallicAnimationResync } from "../hooks/useMetallicAnimationResync.js";
import { METALLIC_SCOPE_CLASS } from "../lib/metallicScope.js";

function Harness() {
  useMetallicAnimationResync();
  return null;
}

function countSyncDelayWrites(setPropertySpy: ReturnType<typeof vi.spyOn>) {
  const calls = setPropertySpy.mock.calls as Array<[string, string, string?]>;
  return calls.filter(([name]) => name === "--tier-metal-sync-delay").length;
}

describe("useMetallicAnimationResync", () => {
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
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete document.body.dataset.tierMetalResizing;
    delete document.body.dataset.tierMetalScrolling;
    delete document.body.dataset.tierMetalSyncPhase;
    delete document.body.dataset.tierMetalModalOpen;
    document.body.style.removeProperty("--tier-metal-sync-delay");
  });

  it("pauses during resize and applies one deferred resync for a resize burst", () => {
    const setPropertySpy = vi.spyOn(document.body.style, "setProperty");

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Harness />
      </MemoryRouter>,
    );

    act(() => {
      vi.advanceTimersByTime(0);
    });
    const baselineWrites = countSyncDelayWrites(setPropertySpy);

    act(() => {
      for (let index = 0; index < 12; index += 1) {
        window.dispatchEvent(new Event("resize"));
      }
    });

    expect(document.body.dataset.tierMetalResizing).toBe("true");
    expect(countSyncDelayWrites(setPropertySpy)).toBe(baselineWrites);

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(countSyncDelayWrites(setPropertySpy)).toBe(baselineWrites);

    act(() => {
      vi.advanceTimersByTime(31);
      vi.runOnlyPendingTimers();
    });

    expect(document.body.dataset.tierMetalResizing).toBeUndefined();
    expect(countSyncDelayWrites(setPropertySpy)).toBe(baselineWrites + 1);
  });

  it("writes metallic flags to the app scope when available", () => {
    const scope = document.createElement("div");
    scope.className = METALLIC_SCOPE_CLASS;
    document.body.appendChild(scope);
    const setPropertySpy = vi.spyOn(scope.style, "setProperty");

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Harness />
      </MemoryRouter>,
      { container: scope },
    );

    act(() => {
      vi.advanceTimersByTime(0);
      window.dispatchEvent(new Event("resize"));
    });

    expect(scope.dataset.tierMetalResizing).toBe("true");
    expect(document.body.dataset.tierMetalResizing).toBeUndefined();
    expect(countSyncDelayWrites(setPropertySpy)).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(200);
      vi.runOnlyPendingTimers();
    });

    expect(scope.dataset.tierMetalResizing).toBeUndefined();
  });
});
