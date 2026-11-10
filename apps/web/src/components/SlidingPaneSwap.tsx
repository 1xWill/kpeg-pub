import {
  createContext,
  useEffect,
  useMemo,
  useContext,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

const DEFAULT_DURATION_MS = 160;
const DEFAULT_OFFSET_PX = 28;
type TransitionPhase = "idle" | "exiting" | "entering";
const NestedPaneTransitionContext = createContext(false);

export function useNestedPaneTransitionSuppressed() {
  return useContext(NestedPaneTransitionContext);
}

export function SlidingPaneSwap({
  contentKey,
  content,
  ready = true,
  className = "",
  durationMs = DEFAULT_DURATION_MS,
  offsetPx = DEFAULT_OFFSET_PX,
  suppressNestedTransitions = false,
  onTransitioningChange,
}: {
  contentKey: string;
  content: ReactNode;
  ready?: boolean;
  className?: string;
  durationMs?: number;
  offsetPx?: number;
  suppressNestedTransitions?: boolean;
  onTransitioningChange?: (transitioning: boolean) => void;
}) {
  const inheritedTransitionSuppression = useContext(NestedPaneTransitionContext);
  const [currentContent, setCurrentContent] = useState(content);
  const [phaseState, setPhaseState] = useState<TransitionPhase>("idle");
  const activeKey = useRef(contentKey);
  const pending = useRef<{ key: string; content: ReactNode } | null>(null);
  const phase = useRef<TransitionPhase>("idle");
  const exitTimer = useRef<number | null>(null);
  const enterFrame = useRef<number | null>(null);
  const enterFrameNext = useRef<number | null>(null);

  const transitionStyle = useMemo<CSSProperties>(
    () => ({
      transitionDuration: `${durationMs}ms`,
      transitionProperty: "transform, opacity",
      transitionTimingFunction: "var(--ease)",
      willChange: "transform, opacity",
    }),
    [durationMs],
  );

  const setPhase = (next: TransitionPhase) => {
    phase.current = next;
    setPhaseState(next);
  };

  const clearAnimationHandles = () => {
    if (exitTimer.current !== null) {
      window.clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    if (enterFrame.current !== null) {
      window.cancelAnimationFrame(enterFrame.current);
      enterFrame.current = null;
    }
    if (enterFrameNext.current !== null) {
      window.cancelAnimationFrame(enterFrameNext.current);
      enterFrameNext.current = null;
    }
  };

  const beginExit = () => {
    if (!pending.current || phase.current !== "idle") return;
    clearAnimationHandles();
    setPhase("exiting");
    exitTimer.current = window.setTimeout(() => {
      const next = pending.current;
      if (!next) {
        setPhase("idle");
        return;
      }
      activeKey.current = next.key;
      pending.current = null;
      setCurrentContent(next.content);
      setPhase("entering");
      enterFrame.current = window.requestAnimationFrame(() => {
        enterFrameNext.current = window.requestAnimationFrame(() => {
          setPhase("idle");
          if (pending.current && pending.current.key !== activeKey.current) {
            beginExit();
          }
        });
      });
    }, durationMs);
  };

  useEffect(() => {
    return clearAnimationHandles;
  }, []);

  useEffect(() => {
    onTransitioningChange?.(phaseState !== "idle");
  }, [onTransitioningChange, phaseState]);

  useEffect(() => {
    if (activeKey.current === contentKey) {
      if (phase.current !== "exiting") {
        setCurrentContent(content);
      }
      return;
    }
    if (!ready) return;
    if (inheritedTransitionSuppression) {
      clearAnimationHandles();
      pending.current = null;
      activeKey.current = contentKey;
      setCurrentContent(content);
      setPhase("idle");
      return;
    }
    pending.current = { key: contentKey, content };
    beginExit();
  }, [content, contentKey, inheritedTransitionSuppression, ready]);

  const suppressChildren =
    inheritedTransitionSuppression ||
    (suppressNestedTransitions && phaseState !== "idle");

  return (
    <NestedPaneTransitionContext.Provider value={suppressChildren}>
      <div className={`overflow-hidden ${className}`}>
        <div
          className={
            phaseState === "idle"
              ? ""
              : "pointer-events-none select-none"
          }
          style={{
            ...transitionStyle,
            opacity: phaseState === "exiting" || phaseState === "entering" ? 0 : 1,
            transform:
              phaseState === "exiting"
                ? `translateY(${-offsetPx}px)`
                : phaseState === "entering"
                  ? `translateY(${offsetPx}px)`
                  : "translateY(0)",
          }}
        >
          {currentContent}
        </div>
      </div>
    </NestedPaneTransitionContext.Provider>
  );
}
