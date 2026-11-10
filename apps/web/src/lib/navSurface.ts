const SCROLL_EPSILON_PX = 2;
const SURFACE_FADE_DISTANCE_PX = 52;

function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed.length === 0 ? "/" : trimmed;
}

export function navSurfaceTriggerId(pathname: string): string | null {
  const normalized = normalizePathname(pathname);
  if (normalized === "/explore") return "nav-surface-trigger-gallery";
  if (normalized === "/market") return "nav-surface-trigger-kitty-bazaar";
  if (normalized === "/collections") return "nav-surface-trigger-kitty-nest";
  if (normalized.startsWith("/portfolio/")) {
    return "nav-surface-trigger-portfolio";
  }
  return null;
}

export function navSurfaceAlwaysTransparent(pathname: string): boolean {
  return normalizePathname(pathname) === "/trade";
}

export function shouldUseSolidNavSurface({
  pathname,
  scrollY,
  navBottom,
  triggerTop,
}: {
  pathname: string;
  scrollY: number;
  navBottom: number | null;
  triggerTop: number | null;
}): boolean {
  if (navSurfaceAlwaysTransparent(pathname)) {
    return false;
  }
  if (scrollY <= SCROLL_EPSILON_PX) {
    return false;
  }
  const triggerId = navSurfaceTriggerId(pathname);
  if (!triggerId) {
    return true;
  }
  if (navBottom === null || triggerTop === null) {
    return false;
  }
  return triggerTop <= navBottom;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function navSurfaceOpacity({
  pathname,
  scrollY,
  navBottom,
  triggerTop,
}: {
  pathname: string;
  scrollY: number;
  navBottom: number | null;
  triggerTop: number | null;
}): number {
  if (navSurfaceAlwaysTransparent(pathname)) {
    return 0;
  }
  if (scrollY <= SCROLL_EPSILON_PX) {
    return 0;
  }
  const triggerId = navSurfaceTriggerId(pathname);
  if (!triggerId) {
    return 1;
  }
  if (navBottom === null || triggerTop === null) {
    return 0;
  }
  const distanceToTrigger = triggerTop - navBottom;
  if (distanceToTrigger <= 0) {
    return 1;
  }
  return clamp01(1 - distanceToTrigger / SURFACE_FADE_DISTANCE_PX);
}
