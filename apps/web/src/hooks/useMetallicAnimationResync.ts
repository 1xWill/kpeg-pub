import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { getMetallicScopeElement } from "../lib/metallicScope.js";

const SCROLL_RESUME_DEBOUNCE_MS = 150;
const RESIZE_RESUME_DEBOUNCE_MS = 180;
let metallicSyncPhaseB = false;
let globalQueueResync: (() => void) | null = null;

function modalOpen(scope: HTMLElement): boolean {
  return scope.dataset.tierMetalModalOpen === "true";
}

function nowSeconds(): number {
  if (typeof performance !== "undefined") {
    return performance.now() / 1000;
  }
  return Date.now() / 1000;
}

function applyGlobalMetallicSyncDelay(scope: HTMLElement) {
  metallicSyncPhaseB = !metallicSyncPhaseB;
  scope.dataset.tierMetalSyncPhase = metallicSyncPhaseB ? "b" : "a";
  scope.style.setProperty(
    "--tier-metal-sync-delay",
    `-${nowSeconds()}s`,
  );
}

export function requestMetallicAnimationResync() {
  globalQueueResync?.();
}

export function useMetallicAnimationResync() {
  const location = useLocation();
  const queueResyncRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    let rafId: number | null = null;
    let scrollResumeTimer: number | null = null;
    let resizeResumeTimer: number | null = null;
    const scope = getMetallicScopeElement();
    let modalWasOpen = modalOpen(scope);
    let scrolling = false;
    let resizing = false;
    let pendingResync = false;

    const flushResync = () => {
      if (!pendingResync || rafId !== null || modalOpen(scope) || resizing) {
        return;
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (!pendingResync || modalOpen(scope) || resizing) return;
        pendingResync = false;
        applyGlobalMetallicSyncDelay(scope);
      });
    };

    const queueResync = () => {
      pendingResync = true;
      flushResync();
    };

    queueResyncRef.current = queueResync;
    globalQueueResync = queueResync;

    const setScrolling = (active: boolean) => {
      if (scrolling === active) return;
      scrolling = active;
      if (active) {
        scope.dataset.tierMetalScrolling = "true";
        return;
      }
      delete scope.dataset.tierMetalScrolling;
    };

    const setResizing = (active: boolean) => {
      if (resizing === active) return;
      resizing = active;
      if (active) {
        scope.dataset.tierMetalResizing = "true";
        return;
      }
      delete scope.dataset.tierMetalResizing;
    };

    const handleResize = () => {
      if (!resizing) {
        setResizing(true);
      }
      if (resizeResumeTimer !== null) {
        window.clearTimeout(resizeResumeTimer);
      }
      resizeResumeTimer = window.setTimeout(() => {
        resizeResumeTimer = null;
        setResizing(false);
        queueResync();
      }, RESIZE_RESUME_DEBOUNCE_MS);
    };

    const handleScroll = () => {
      if (!scrolling) {
        setScrolling(true);
      }
      if (scrollResumeTimer !== null) {
        window.clearTimeout(scrollResumeTimer);
      }
      scrollResumeTimer = window.setTimeout(() => {
        scrollResumeTimer = null;
        setScrolling(false);
      }, SCROLL_RESUME_DEBOUNCE_MS);
    };

    const modalObserver = new MutationObserver(() => {
      const isOpen = modalOpen(scope);
      if (modalWasOpen && !isOpen) {
        queueResync();
      }
      modalWasOpen = isOpen;
    });

    modalObserver.observe(scope, {
      attributes: true,
      attributeFilter: ["data-tier-metal-modal-open"],
    });

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, { passive: true });
    queueResync();

    return () => {
      queueResyncRef.current = () => {};
      if (globalQueueResync === queueResync) {
        globalQueueResync = null;
      }
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll);
      modalObserver.disconnect();
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      if (scrollResumeTimer !== null) {
        window.clearTimeout(scrollResumeTimer);
      }
      if (resizeResumeTimer !== null) {
        window.clearTimeout(resizeResumeTimer);
      }
      delete scope.dataset.tierMetalScrolling;
      delete scope.dataset.tierMetalResizing;
      delete scope.dataset.tierMetalSyncPhase;
      scope.style.removeProperty("--tier-metal-sync-delay");
    };
  }, []);

  useEffect(() => {
    queueResyncRef.current();
  }, [location.pathname, location.search, location.hash]);
}
