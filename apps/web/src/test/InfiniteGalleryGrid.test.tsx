import { cleanup, render, screen } from "@testing-library/react";
import { act, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InfiniteGalleryGrid } from "../components/InfiniteGalleryGrid.js";
import { SlidingPaneSwap } from "../components/SlidingPaneSwap.js";

const baseProps = {
  empty: null,
  initialLoading: false,
  loadingLabel: "Loading",
  hasMore: false,
  fetchingMore: false,
  onLoadMore: () => {},
};

function rectForIndex(index: number): DOMRect {
  return {
    x: index * 100,
    y: 0,
    width: 80,
    height: 80,
    top: 0,
    right: index * 100 + 80,
    bottom: 80,
    left: index * 100,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("InfiniteGalleryGrid", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
    }));
    vi.spyOn(
      HTMLElement.prototype,
      "getBoundingClientRect",
    ).mockImplementation(function getRect(this: HTMLElement) {
      const siblings = Array.from(this.parentElement?.children ?? []);
      return rectForIndex(Math.max(0, siblings.indexOf(this)));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("animates stable cards into their new order", () => {
    const { rerender } = render(
      <InfiniteGalleryGrid {...baseProps} animateReorder>
        <article key="one">One</article>
        <article key="two">Two</article>
      </InfiniteGalleryGrid>,
    );

    rerender(
      <InfiniteGalleryGrid {...baseProps} animateReorder>
        <article key="two">Two</article>
        <article key="one">One</article>
      </InfiniteGalleryGrid>,
    );

    const two = screen.getByText("Two").parentElement;
    const one = screen.getByText("One").parentElement;
    expect(two?.style.transform).toBe("translate(100px, 0px)");
    expect(one?.style.transform).toBe("translate(-100px, 0px)");

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(two?.style.transform).toBe("translate(0, 0)");
    expect(one?.style.transform).toBe("translate(0, 0)");
  });

  it("does not move cards while a parent route pane is switching", () => {
    let setOrder: ((next: string[]) => void) | null = null;

    function ReorderableGrid() {
      const [order, setNextOrder] = useState(["one", "two"]);
      useEffect(() => {
        setOrder = setNextOrder;
      }, []);

      return (
        <InfiniteGalleryGrid {...baseProps} animateReorder>
          {order.map((item) => (
            <article key={item}>{item}</article>
          ))}
        </InfiniteGalleryGrid>
      );
    }

    const { rerender } = render(
      <SlidingPaneSwap
        contentKey="explore"
        suppressNestedTransitions
        content={<ReorderableGrid />}
      />,
    );

    rerender(
      <SlidingPaneSwap
        contentKey="market"
        suppressNestedTransitions
        content={<ReorderableGrid />}
      />,
    );

    act(() => {
      setOrder?.(["two", "one"]);
    });

    expect(screen.getByText("two").parentElement?.style.transform).toBe("");
    expect(screen.getByText("one").parentElement?.style.transform).toBe("");
  });

  it("does not trigger reorder animation when infinite scroll appends cards", () => {
    const { rerender } = render(
      <InfiniteGalleryGrid {...baseProps} animateReorder>
        <article key="one">One</article>
        <article key="two">Two</article>
      </InfiniteGalleryGrid>,
    );

    rerender(
      <InfiniteGalleryGrid {...baseProps} animateReorder>
        <article key="one">One</article>
        <article key="two">Two</article>
        <article key="three">Three</article>
      </InfiniteGalleryGrid>,
    );

    expect(screen.getByText("One").parentElement?.style.transform).toBe("");
    expect(screen.getByText("Two").parentElement?.style.transform).toBe("");
    expect(screen.getByText("Three").parentElement?.style.transform).toBe("");
    expect(screen.getByText("Three").parentElement?.style.opacity).toBe("");
  });

  it("only animates reorder when reorder token changes", () => {
    const { rerender } = render(
      <InfiniteGalleryGrid {...baseProps} animateReorder reorderToken="latest">
        <article key="one">One</article>
        <article key="two">Two</article>
      </InfiniteGalleryGrid>,
    );

    rerender(
      <InfiniteGalleryGrid {...baseProps} animateReorder reorderToken="latest">
        <article key="two">Two</article>
        <article key="one">One</article>
      </InfiniteGalleryGrid>,
    );
    expect(screen.getByText("Two").parentElement?.style.transform).toBe("");
    expect(screen.getByText("One").parentElement?.style.transform).toBe("");

    rerender(
      <InfiniteGalleryGrid {...baseProps} animateReorder reorderToken="scarcity">
        <article key="one">One</article>
        <article key="two">Two</article>
      </InfiniteGalleryGrid>,
    );
    rerender(
      <InfiniteGalleryGrid {...baseProps} animateReorder reorderToken="latest">
        <article key="two">Two</article>
        <article key="one">One</article>
      </InfiniteGalleryGrid>,
    );
    expect(screen.getByText("Two").parentElement?.style.transform).toBe(
      "translate(100px, 0px)",
    );
    expect(screen.getByText("One").parentElement?.style.transform).toBe(
      "translate(-100px, 0px)",
    );
  });

  it("fades in new viewport cards when there is low key overlap", () => {
    const { rerender } = render(
      <InfiniteGalleryGrid {...baseProps} animateReorder reorderToken="latest">
        <article key="one">One</article>
        <article key="two">Two</article>
      </InfiniteGalleryGrid>,
    );

    rerender(
      <InfiniteGalleryGrid {...baseProps} animateReorder reorderToken="scarcity">
        <article key="three">Three</article>
        <article key="four">Four</article>
      </InfiniteGalleryGrid>,
    );

    const three = screen.getByText("Three").parentElement;
    const four = screen.getByText("Four").parentElement;
    expect(three?.style.opacity).toBe("0");
    expect(three?.style.transform).toBe("translate(0, 14px)");
    expect(four?.style.opacity).toBe("0");
    expect(four?.style.transform).toBe("translate(0, 14px)");

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(three?.style.opacity).toBe("1");
    expect(three?.style.transform).toBe("translate(0, 0)");
    expect(four?.style.opacity).toBe("1");
    expect(four?.style.transform).toBe("translate(0, 0)");
  });

  it("progressively mounts loaded children with placeholders", () => {
    render(
      <InfiniteGalleryGrid
        {...baseProps}
        initialSkeletonCount={2}
      >
        {Array.from({ length: 10 }, (_, index) => (
          <article key={`item-${index + 1}`}>Item {index + 1}</article>
        ))}
      </InfiniteGalleryGrid>,
    );

    expect(screen.queryByText("Item 1")).not.toBeNull();
    expect(screen.queryByText("Item 8")).not.toBeNull();
    expect(screen.queryByText("Item 9")).toBeNull();
    expect(screen.queryByText("Item 10")).toBeNull();
    expect(document.querySelectorAll("[data-reorder-key]").length).toBe(8);
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(screen.queryByText("Item 9")).not.toBeNull();
    expect(screen.queryByText("Item 10")).not.toBeNull();
    expect(document.querySelectorAll("[data-reorder-key]").length).toBe(10);
  });

  it("does not render card art work for placeholder slots", () => {
    const renderArt = vi.fn();
    function RenderedCard({ id }: { id: number }) {
      renderArt(id);
      return <article>Item {id}</article>;
    }

    render(
      <InfiniteGalleryGrid
        {...baseProps}
        initialSkeletonCount={2}
      >
        {Array.from({ length: 10 }, (_, index) => (
          <RenderedCard
            id={index + 1}
            key={`item-${index + 1}`}
          />
        ))}
      </InfiniteGalleryGrid>,
    );

    const firstMountedCount =
      document.querySelectorAll("[data-reorder-key]").length;
    expect(firstMountedCount).toBeGreaterThan(0);
    expect(firstMountedCount).toBeLessThan(10);
    expect(renderArt).toHaveBeenCalledTimes(firstMountedCount);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(document.querySelectorAll("[data-reorder-key]").length).toBe(10);
    expect(renderArt).toHaveBeenCalledTimes(10);
  });

  it("mounts all loaded cards immediately on reorder token change for large sets", () => {
    const original = Array.from({ length: 30 }, (_, index) => index + 1);
    const { rerender } = render(
      <InfiniteGalleryGrid
        {...baseProps}
        animateReorder
        reorderToken="latest"
      >
        {original.map((item) => (
          <article key={`item-${item}`}>Item {item}</article>
        ))}
      </InfiniteGalleryGrid>,
    );

    const reversed = [...original].reverse();
    rerender(
      <InfiniteGalleryGrid
        {...baseProps}
        animateReorder
        reorderToken="scarcity"
      >
        {reversed.map((item) => (
          <article key={`item-${item}`}>Item {item}</article>
        ))}
      </InfiniteGalleryGrid>,
    );

    expect(screen.queryByText("Item 30")).not.toBeNull();
    expect(document.querySelectorAll("[data-reorder-key]").length).toBe(30);
  });

  it("renders empty copy when no cards are loaded", () => {
    render(
      <InfiniteGalleryGrid
        {...baseProps}
        empty={<div>No cards yet</div>}
      >
        {[]}
      </InfiniteGalleryGrid>,
    );

    expect(screen.queryByText("No cards yet")).not.toBeNull();
    expect(document.querySelectorAll("[data-reorder-key]").length).toBe(0);
  });

  it("keeps initial loading skeleton branch intact", () => {
    render(
      <InfiniteGalleryGrid
        {...baseProps}
        initialLoading
        loadingLabel="Loading cards..."
        initialSkeletonCount={3}
      >
        <article key="one">One</article>
      </InfiniteGalleryGrid>,
    );

    expect(screen.queryByText("Loading cards...")).not.toBeNull();
    expect(document.querySelectorAll("[data-reorder-key]").length).toBe(0);
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("calls onLoadMore when the sentinel intersects", () => {
    const onLoadMore = vi.fn();
    let observerCallback: IntersectionObserverCallback | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class MockIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];

      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }

      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = () => [];
    }

    vi.stubGlobal(
      "IntersectionObserver",
      MockIntersectionObserver as unknown as typeof IntersectionObserver,
    );

    render(
      <InfiniteGalleryGrid
        {...baseProps}
        hasMore
        onLoadMore={onLoadMore}
      >
        <article key="one">One</article>
      </InfiniteGalleryGrid>,
    );

    expect(observe).toHaveBeenCalledTimes(1);
    act(() => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(0);
  });
});
