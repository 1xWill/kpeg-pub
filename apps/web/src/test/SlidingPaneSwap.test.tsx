import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlidingPaneSwap } from "../components/SlidingPaneSwap.js";

describe("SlidingPaneSwap", () => {
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
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps the old pane mounted until the next pane is ready", () => {
    const { rerender } = render(
      <SlidingPaneSwap contentKey="alpha" content={<div>Alpha</div>} />,
    );

    expect(screen.queryByText("Alpha")).not.toBeNull();

    rerender(
      <SlidingPaneSwap
        contentKey="beta"
        ready={false}
        content={<div>Beta</div>}
      />,
    );

    expect(screen.queryByText("Alpha")).not.toBeNull();
    expect(screen.queryByText("Beta")).toBeNull();

    rerender(
      <SlidingPaneSwap contentKey="beta" ready content={<div>Beta</div>} />,
    );

    expect(screen.queryByText("Alpha")).not.toBeNull();
    expect(screen.queryByText("Beta")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(160);
    });

    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.queryByText("Beta")).not.toBeNull();
  });

  it("does not render outgoing and incoming panes at the same time", () => {
    const { rerender } = render(
      <SlidingPaneSwap contentKey="alpha" content={<div>Alpha</div>} />,
    );

    rerender(<SlidingPaneSwap contentKey="beta" content={<div>Beta</div>} />);

    expect(screen.queryByText("Alpha")).not.toBeNull();
    expect(screen.queryByText("Beta")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(159);
    });

    expect(screen.queryByText("Alpha")).not.toBeNull();
    expect(screen.queryByText("Beta")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.queryByText("Beta")).not.toBeNull();
  });

  it("updates the active pane in place when the key does not change", () => {
    const { rerender } = render(
      <SlidingPaneSwap contentKey="same" content={<div>First</div>} />,
    );

    rerender(<SlidingPaneSwap contentKey="same" content={<div>Second</div>} />);

    expect(screen.queryByText("First")).toBeNull();
    expect(screen.queryByText("Second")).not.toBeNull();
  });

  it("suppresses nested pane swaps during a parent route swap", () => {
    function NestedPane({ paneKey }: { paneKey: string }) {
      return (
        <SlidingPaneSwap contentKey={paneKey} content={<div>{paneKey}</div>} />
      );
    }

    const { rerender } = render(
      <SlidingPaneSwap
        contentKey="route-a"
        suppressNestedTransitions
        content={<NestedPane paneKey="Gallery" />}
      />,
    );

    rerender(
      <SlidingPaneSwap
        contentKey="route-b"
        suppressNestedTransitions
        content={<NestedPane paneKey="My Kitties" />}
      />,
    );

    expect(screen.queryByText("Gallery")).not.toBeNull();
    expect(screen.queryByText("My Kitties")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(160);
    });

    expect(screen.queryByText("Gallery")).toBeNull();
    expect(screen.queryByText("My Kitties")).not.toBeNull();
  });

  it("reports transition state while panes switch", () => {
    const onTransitioningChange = vi.fn();
    const { rerender } = render(
      <SlidingPaneSwap
        contentKey="alpha"
        content={<div>Alpha</div>}
        onTransitioningChange={onTransitioningChange}
      />,
    );

    rerender(
      <SlidingPaneSwap
        contentKey="beta"
        content={<div>Beta</div>}
        onTransitioningChange={onTransitioningChange}
      />,
    );

    expect(onTransitioningChange).toHaveBeenLastCalledWith(true);

    act(() => {
      vi.advanceTimersByTime(160);
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(onTransitioningChange).toHaveBeenLastCalledWith(false);
  });
});
