import {
  Children,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { Spinner } from "./Spinner.js";
import { useNestedPaneTransitionSuppressed } from "./SlidingPaneSwap.js";
import { useProgressiveItems } from "../hooks/useProgressiveItems.js";

const REORDER_VIEWPORT_BUFFER_PX = 320;
const REORDER_MAX_MEASURED_NODES = 180;
const REORDER_FALLBACK_NODES = 32;
const REORDER_MAX_TRAVEL_PX = 1200;
const REORDER_LOW_OVERLAP_RATIO = 0.24;
const REORDER_LATCH_SEPARATOR = "\u001e";
const PROGRESSIVE_BATCH_ROWS = 2;
const PROGRESSIVE_MIN_BATCH = 8;
const GRID_PLACEHOLDER_META = (
  <div className="grid gap-[2px] rounded-b-[5px] border border-[var(--line)] border-t-0 bg-[var(--card-bg)] px-[0.6rem] py-[0.44rem]">
    <div className="h-[0.85rem] w-2/3 animate-pulse rounded bg-white/[0.08]" />
    <div className="h-[0.75rem] w-1/2 animate-pulse rounded bg-white/[0.06]" />
  </div>
);

function resetReorderNodeStyles(node: HTMLElement) {
  node.style.transition = "";
  node.style.transform = "";
  node.style.opacity = "";
  node.style.position = "";
  node.style.zIndex = "";
  node.style.willChange = "";
}

function collectReorderCandidates(
  grid: HTMLDivElement,
  nodes: HTMLElement[],
): HTMLElement[] {
  if (nodes.length <= REORDER_MAX_MEASURED_NODES) {
    return nodes;
  }
  const viewportHeight = Math.max(
    window.innerHeight,
    document.documentElement?.clientHeight ?? 0,
  );
  if (viewportHeight <= 0) {
    return nodes.slice(0, REORDER_FALLBACK_NODES);
  }
  const gridTop = grid.getBoundingClientRect().top;
  const viewportTop = -gridTop - REORDER_VIEWPORT_BUFFER_PX;
  const viewportBottom =
    viewportTop + viewportHeight + REORDER_VIEWPORT_BUFFER_PX * 2;
  const candidates: HTMLElement[] = [];
  for (const node of nodes) {
    const top = node.offsetTop;
    const bottom = top + node.offsetHeight;
    if (bottom < viewportTop || top > viewportBottom) {
      continue;
    }
    candidates.push(node);
    if (candidates.length >= REORDER_MAX_MEASURED_NODES) {
      break;
    }
  }
  if (candidates.length > 0) {
    return candidates;
  }
  return nodes.slice(0, Math.min(nodes.length, REORDER_FALLBACK_NODES));
}

type InfiniteGalleryGridProps = {
  children: ReactNode;
  empty: ReactNode;
  initialLoading: boolean;
  loadingLabel: string;
  initialSkeletonCount?: number;
  hasMore: boolean;
  fetchingMore: boolean;
  onLoadMore: () => void;
  animateReorder?: boolean;
  reorderToken?: string | number;
};

export function InfiniteGalleryGrid({
  children,
  empty,
  initialLoading,
  loadingLabel,
  initialSkeletonCount = 10,
  hasMore,
  fetchingMore,
  onLoadMore,
  animateReorder = false,
  reorderToken,
}: InfiniteGalleryGridProps) {
  const childArray = useMemo(() => Children.toArray(children), [children]);
  const childKeys = useMemo(
    () =>
      childArray.map((child, index) =>
        String(
          typeof child === "object" && child !== null && "key" in child
            ? child.key ?? index
            : index,
        ),
      ),
    [childArray],
  );
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(onLoadMore);
  const previousRects = useRef<Map<string, DOMRect> | null>(null);
  const previousKeys = useRef<string[]>([]);
  const previousReorderToken = useRef<string | number | null>(null);
  const animationFrame = useRef<number | null>(null);
  const cleanupTimer = useRef<number | null>(null);
  const suppressReorder = useNestedPaneTransitionSuppressed();
  const animateStableReorder = animateReorder && !suppressReorder;
  const currentReorderSignature = useMemo(
    () => childKeys.join("\u001f"),
    [childKeys],
  );
  const previousReorderSignatureRef = useRef<string>(currentReorderSignature);
  const previousReorderTokenInputRef = useRef<string | number | null | undefined>(
    reorderToken ?? null,
  );
  const reorderFullRenderLatchRef = useRef<string | null>(null);
  // Keep card animations on a single timeline; content-visibility can pause
  // offscreen rows and desync metallic shimmer after sort reorders.
  const sectionClassName = "grid gap-0 pt-5";
  const baseBatchCount = Math.max(
    PROGRESSIVE_MIN_BATCH,
    initialSkeletonCount * PROGRESSIVE_BATCH_ROWS,
  );
  const nextReorderTokenInput = reorderToken ?? null;
  const reorderRenderKey = [
    String(nextReorderTokenInput ?? ""),
    currentReorderSignature,
  ].join(REORDER_LATCH_SEPARATOR);
  const activateFullRenderLatch =
    animateStableReorder &&
    previousReorderTokenInputRef.current !== nextReorderTokenInput &&
    previousReorderSignatureRef.current !== currentReorderSignature &&
    childArray.length > baseBatchCount;
  const forceFullRenderForThisRender =
    activateFullRenderLatch ||
    (animateStableReorder &&
      reorderFullRenderLatchRef.current === reorderRenderKey);

  const progressiveChildren = useProgressiveItems({
    items: childArray,
    getKey: (_item, index) => childKeys[index] ?? String(index),
    enabled: !initialLoading && !forceFullRenderForThisRender,
    initialCount: baseBatchCount,
    chunkSize: baseBatchCount,
    resetToken: reorderToken ?? null,
  });
  const resetStyles = (nodes: Iterable<HTMLElement>) => {
    for (const node of nodes) {
      resetReorderNodeStyles(node);
    }
  };

  const clearReorderAnimation = () => {
    if (animationFrame.current !== null) {
      window.cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }
    if (cleanupTimer.current !== null) {
      window.clearTimeout(cleanupTimer.current);
      cleanupTimer.current = null;
    }
    const nodes =
      gridRef.current?.querySelectorAll<HTMLElement>("[data-reorder-key]") ??
      [];
    resetStyles(nodes);
  };

  useEffect(() => {
    loadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useLayoutEffect(() => {
    if (!animateStableReorder) {
      reorderFullRenderLatchRef.current = null;
    } else if (activateFullRenderLatch) {
      reorderFullRenderLatchRef.current = reorderRenderKey;
    } else if (
      reorderFullRenderLatchRef.current !== null &&
      reorderFullRenderLatchRef.current !== reorderRenderKey
    ) {
      reorderFullRenderLatchRef.current = null;
    }
    previousReorderSignatureRef.current = currentReorderSignature;
    previousReorderTokenInputRef.current = nextReorderTokenInput;
  }, [
    activateFullRenderLatch,
    animateStableReorder,
    currentReorderSignature,
    nextReorderTokenInput,
    reorderRenderKey,
  ]);

  useEffect(() => {
    return () => {
      clearReorderAnimation();
    };
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (
      !sentinel ||
      sentinel.closest('[aria-hidden="true"]') ||
      !hasMore ||
      fetchingMore ||
      initialLoading
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreRef.current();
        }
      },
      { rootMargin: "240px 0px 320px", threshold: 0.01 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchingMore, hasMore, initialLoading]);

  useLayoutEffect(() => {
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const grid = gridRef.current;
    if (!grid || initialLoading || reduceMotion || suppressReorder) {
      clearReorderAnimation();
      previousRects.current = null;
      previousKeys.current = [];
      previousReorderToken.current = reorderToken ?? null;
      return;
    }

    const allNodes = Array.from(
      grid.querySelectorAll<HTMLElement>("[data-reorder-key]"),
    );
    const nextKeys = allNodes.map((node) => node.dataset.reorderKey ?? "");
    const oldKeys = previousKeys.current;
    previousKeys.current = nextKeys;
    const measuredNodes = collectReorderCandidates(grid, allNodes);
    const nextRects = new Map(
      measuredNodes.map((node) => [
        node.dataset.reorderKey ?? "",
        node.getBoundingClientRect(),
      ]),
    );
    const oldRects = previousRects.current;
    previousRects.current = nextRects;
    const previousToken = previousReorderToken.current;
    const currentToken = reorderToken ?? null;
    previousReorderToken.current = currentToken;
    if (!animateStableReorder || !oldRects) return;
    const animateByToken =
      reorderToken === undefined
        ? true
        : previousToken !== null && previousToken !== currentToken;
    if (!animateByToken) return;
    const appendedByScrollLoad =
      oldKeys.length > 0 &&
      nextKeys.length > oldKeys.length &&
      oldKeys.every((key, index) => nextKeys[index] === key);
    if (appendedByScrollLoad) return;

    if (animationFrame.current !== null) {
      window.cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }
    if (cleanupTimer.current !== null) {
      window.clearTimeout(cleanupTimer.current);
      cleanupTimer.current = null;
    }
    resetStyles(allNodes);

    let sharedMeasuredCount = 0;
    const movedNodes: HTMLElement[] = [];
    const enteringNodes: HTMLElement[] = [];
    for (const node of measuredNodes) {
      const key = node.dataset.reorderKey ?? "";
      const oldRect = oldRects.get(key);
      const nextRect = nextRects.get(key);
      if (!oldRect || !nextRect) {
        enteringNodes.push(node);
        continue;
      }
      sharedMeasuredCount += 1;
      const dx = oldRect.left - nextRect.left;
      const dy = oldRect.top - nextRect.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      if (Math.abs(dx) > REORDER_MAX_TRAVEL_PX || Math.abs(dy) > REORDER_MAX_TRAVEL_PX) {
        enteringNodes.push(node);
        continue;
      }
      node.style.transition = "none";
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      node.style.position = "relative";
      node.style.zIndex = "1";
      node.style.willChange = "transform";
      movedNodes.push(node);
    }
    const overlapRatio =
      measuredNodes.length === 0 ? 0 : sharedMeasuredCount / measuredNodes.length;
    const fadeInNodes =
      overlapRatio <= REORDER_LOW_OVERLAP_RATIO
        ? enteringNodes
        : enteringNodes.filter((node) => {
            const key = node.dataset.reorderKey ?? "";
            return !oldRects.has(key);
          });
    for (const node of fadeInNodes) {
      node.style.transition = "none";
      node.style.transform = "translate(0, 14px)";
      node.style.opacity = "0";
      node.style.willChange = "transform, opacity";
    }
    if (movedNodes.length === 0 && fadeInNodes.length === 0) return;

    animationFrame.current = window.requestAnimationFrame(() => {
      for (const node of movedNodes) {
        node.style.transition =
          "transform 340ms var(--ease), opacity 180ms var(--ease)";
        node.style.transform = "translate(0, 0)";
        node.style.opacity = "1";
      }
      for (const node of fadeInNodes) {
        node.style.transition =
          "transform 260ms var(--ease), opacity 220ms var(--ease)";
        node.style.transform = "translate(0, 0)";
        node.style.opacity = "1";
      }
    });
    cleanupTimer.current = window.setTimeout(() => {
      resetStyles(movedNodes);
      resetStyles(fadeInNodes);
      cleanupTimer.current = null;
    }, 360);
  }, [
    animateStableReorder,
    initialLoading,
    progressiveChildren.signature,
    progressiveChildren.visibleCount,
    reorderToken,
    suppressReorder,
  ]);

  if (initialLoading) {
    const skeletonCount = Math.max(1, initialSkeletonCount);
    return (
      <section className={sectionClassName}>
        <div className="grid grid-cols-2 gap-[clamp(0.82rem,1.6vw,1.35rem)] [contain:layout_paint] min-[700px]:grid-cols-3 min-[980px]:grid-cols-4 min-[1280px]:grid-cols-5">
          {Array.from({ length: skeletonCount }).map((_, index) => (
            <div className="min-w-0" key={`skeleton-${index}`}>
              <div className="mb-[-1px] grid aspect-square place-items-center overflow-hidden rounded-[5px] bg-white/[0.055]">
                <div className="h-full w-full animate-pulse bg-white/[0.08]" />
              </div>
              {GRID_PLACEHOLDER_META}
            </div>
          ))}
        </div>
        <div className="inline-flex min-h-14 items-center gap-2 py-3 text-[var(--fg-muted)]">
          <Spinner /> {loadingLabel}
        </div>
      </section>
    );
  }

  return (
    <section className={sectionClassName}>
      <div
        ref={gridRef}
        className="grid grid-cols-2 gap-[clamp(0.82rem,1.6vw,1.35rem)] [contain:layout_paint] min-[700px]:grid-cols-3 min-[980px]:grid-cols-4 min-[1280px]:grid-cols-5"
      >
        {progressiveChildren.visibleItems.map((child, index) => {
          const key = progressiveChildren.keys[index] ?? String(index);
          return (
            <div className="min-w-0" data-reorder-key={key} key={key}>
              {child}
            </div>
          );
        })}
        {progressiveChildren.pendingCount > 0
          ? Array.from({ length: progressiveChildren.pendingCount }).map(
              (_, index) => (
                <div
                  className="min-w-0"
                  key={`placeholder-${progressiveChildren.visibleCount + index}`}
                >
                  <div className="mb-[-1px] grid aspect-square place-items-center overflow-hidden rounded-[5px] bg-white/[0.055]">
                    <div className="h-full w-full animate-pulse bg-white/[0.08]" />
                  </div>
                  {GRID_PLACEHOLDER_META}
                </div>
              ),
            )
          : null}
      </div>
      {empty ? <div>{empty}</div> : null}
      <div
        ref={sentinelRef}
        className="grid min-h-12 place-items-center pt-3 text-[var(--fg-muted)]"
      >
        {fetchingMore ? <Spinner /> : null}
      </div>
    </section>
  );
}
