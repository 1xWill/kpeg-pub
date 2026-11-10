export type ThemeMode = "dark" | "light";

type StartViewTransition = (
  updateCallback: () => void | Promise<void>,
) => ViewTransition;

type ThemeTransitionAnimation = {
  clipPath: [string, string];
  pseudoElement: "::view-transition-new(root)" | "::view-transition-old(root)";
};

export type ThemeTransitionOptions = {
  fromTheme: ThemeMode;
  toTheme: ThemeMode;
  originX: number;
  originY: number;
  applyTheme: () => void;
  durationMs?: number;
  easing?: string;
};

const DEFAULT_DURATION_MS = 560;
const DEFAULT_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const THEME_TRANSITION_ATTR = "themeTransitioning";
const THEME_TRANSITION_DIRECTION_ATTR = "themeTransitionDirection";

function startViewTransitionOrNull(): StartViewTransition | null {
  if (typeof document === "undefined") {
    return null;
  }
  const candidate = (
    document as Document & { startViewTransition?: StartViewTransition }
  ).startViewTransition;
  return typeof candidate === "function" ? candidate.bind(document) : null;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clampToViewport(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(0, value), Math.max(0, max));
}

export function themeTransitionRadius(
  originX: number,
  originY: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const safeX = clampToViewport(originX, viewportWidth);
  const safeY = clampToViewport(originY, viewportHeight);
  const maxX = Math.max(safeX, viewportWidth - safeX);
  const maxY = Math.max(safeY, viewportHeight - safeY);
  return Math.hypot(maxX, maxY);
}

export function themeTransitionAnimation(
  fromTheme: ThemeMode,
  toTheme: ThemeMode,
  originX: number,
  originY: number,
  radius: number,
): ThemeTransitionAnimation {
  const clipFrom = `circle(0px at ${originX}px ${originY}px)`;
  const clipTo = `circle(${Math.ceil(radius)}px at ${originX}px ${originY}px)`;

  if (fromTheme === "dark" && toTheme === "light") {
    return {
      clipPath: [clipFrom, clipTo],
      pseudoElement: "::view-transition-new(root)",
    };
  }

  return {
    clipPath: [clipTo, clipFrom],
    pseudoElement: "::view-transition-old(root)",
  };
}

export async function applyThemeWithRadialTransition({
  fromTheme,
  toTheme,
  originX,
  originY,
  applyTheme,
  durationMs = DEFAULT_DURATION_MS,
  easing = DEFAULT_EASING,
}: ThemeTransitionOptions): Promise<void> {
  let applied = false;
  const applyOnce = () => {
    if (applied) {
      return;
    }
    applied = true;
    applyTheme();
  };

  if (fromTheme === toTheme || typeof window === "undefined") {
    applyOnce();
    return;
  }

  const startViewTransition = startViewTransitionOrNull();
  if (!startViewTransition || prefersReducedMotion()) {
    applyOnce();
    return;
  }

  const radius = themeTransitionRadius(
    originX,
    originY,
    window.innerWidth,
    window.innerHeight,
  );
  const animation = themeTransitionAnimation(
    fromTheme,
    toTheme,
    originX,
    originY,
    radius,
  );
  document.documentElement.dataset[THEME_TRANSITION_ATTR] = "true";
  document.documentElement.dataset[THEME_TRANSITION_DIRECTION_ATTR] = `to-${toTheme}`;

  try {
    const transition = startViewTransition(() => {
      applyOnce();
    });
    await transition.ready;
    if (typeof document.documentElement.animate === "function") {
      const radial = document.documentElement.animate(
        { clipPath: animation.clipPath },
        {
          duration: durationMs,
          easing,
          fill: "both",
          pseudoElement: animation.pseudoElement,
        },
      );
      await radial.finished.catch(() => undefined);
    }
    await transition.finished.catch(() => undefined);
  } catch {
    applyOnce();
  } finally {
    delete document.documentElement.dataset[THEME_TRANSITION_ATTR];
    delete document.documentElement.dataset[THEME_TRANSITION_DIRECTION_ATTR];
  }
}
