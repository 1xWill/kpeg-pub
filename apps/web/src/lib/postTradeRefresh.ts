const POST_TRADE_REFRESH_KEY = "kpeg.postTradeRefreshUntil";

export const POST_TRADE_REFRESH_EVENT = "kpeg:post-trade-refresh";
export const POST_TRADE_REFRESH_MS = 90_000;
export const POST_TRADE_REFETCH_MS = 3_000;
export const BACKFILL_REFETCH_MS = 15_000;
export const DEFAULT_NORMAL_GALLERY_REFETCH_MS = 30_000;
const MIN_NORMAL_GALLERY_REFETCH_MS = 5_000;

export function resolveNormalGalleryRefetchMs(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (
    Number.isFinite(parsed) &&
    Number.isInteger(parsed) &&
    parsed >= MIN_NORMAL_GALLERY_REFETCH_MS
  ) {
    return parsed;
  }
  return DEFAULT_NORMAL_GALLERY_REFETCH_MS;
}

export const NORMAL_GALLERY_REFETCH_MS = resolveNormalGalleryRefetchMs(
  import.meta.env.VITE_KPEG_NORMAL_REFETCH_MS,
);

export function getPostTradeRefreshUntil(): number {
  if (typeof window === "undefined") {
    return 0;
  }
  const value = Number(window.sessionStorage.getItem(POST_TRADE_REFRESH_KEY) ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function markPostTradeRefresh(): number {
  const until = Date.now() + POST_TRADE_REFRESH_MS;
  window.sessionStorage.setItem(POST_TRADE_REFRESH_KEY, String(until));
  window.dispatchEvent(new CustomEvent(POST_TRADE_REFRESH_EVENT, { detail: { until } }));
  return until;
}

export function clearPostTradeRefresh(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.removeItem(POST_TRADE_REFRESH_KEY);
  window.dispatchEvent(new CustomEvent(POST_TRADE_REFRESH_EVENT, { detail: { until: 0 } }));
}

export function isPostTradeRefreshActive(until: number): boolean {
  return until > Date.now();
}
