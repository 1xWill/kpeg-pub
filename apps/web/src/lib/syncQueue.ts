import { triggerSync } from "./api.js";

const SYNC_QUEUE_STORAGE_KEY = "kpeg.syncQueue.v1";
const MAX_RETRY_DELAY_MS = 5 * 60_000;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export const TX_SYNC_FLUSHED_EVENT = "kpeg:tx-sync-flushed";
export const TX_SYNC_COALESCE_MS = 12_000;
export const TX_SYNC_RETRY_BASE_MS = 10_000;

type SyncQueueState = {
  txHashes: Array<`0x${string}`>;
  retryCount: number;
  nextRetryAt: number;
};

let state: SyncQueueState | null = null;
let flushTimer: number | null = null;
let flushTimerDueAt = 0;
let flushPromise: Promise<void> | null = null;
let listenersBound = false;
let onlineHandler: (() => void) | null = null;
let focusHandler: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;

function defaultState(): SyncQueueState {
  return { txHashes: [], retryCount: 0, nextRetryAt: 0 };
}

function isTxHash(value: string): value is `0x${string}` {
  return TX_HASH_PATTERN.test(value);
}

function parseState(raw: string | null): SyncQueueState {
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw) as Partial<SyncQueueState> | null;
    if (!parsed || typeof parsed !== "object") {
      return defaultState();
    }
    const txHashes = Array.isArray(parsed.txHashes)
      ? [...new Set(parsed.txHashes.filter((value): value is `0x${string}` => typeof value === "string" && isTxHash(value)))]
      : [];
    const retryCount =
      Number.isInteger(parsed.retryCount) && (parsed.retryCount ?? 0) >= 0
        ? Number(parsed.retryCount)
        : 0;
    const nextRetryAt =
      typeof parsed.nextRetryAt === "number" && Number.isFinite(parsed.nextRetryAt)
        ? parsed.nextRetryAt
        : 0;
    return { txHashes, retryCount, nextRetryAt };
  } catch {
    return defaultState();
  }
}

function loadState(): SyncQueueState {
  if (state) {
    return state;
  }
  if (typeof window === "undefined") {
    state = defaultState();
    return state;
  }
  state = parseState(window.localStorage.getItem(SYNC_QUEUE_STORAGE_KEY));
  return state;
}

function persistState(nextState: SyncQueueState): void {
  state = nextState;
  if (typeof window === "undefined") {
    return;
  }
  if (nextState.txHashes.length === 0 && nextState.retryCount === 0 && nextState.nextRetryAt === 0) {
    window.localStorage.removeItem(SYNC_QUEUE_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(SYNC_QUEUE_STORAGE_KEY, JSON.stringify(nextState));
}

function retryDelayMs(retryCount: number): number {
  if (retryCount <= 0) return 0;
  const exponential = TX_SYNC_RETRY_BASE_MS * 2 ** Math.max(0, retryCount - 1);
  return Math.min(MAX_RETRY_DELAY_MS, exponential);
}

function clearFlushTimer(): void {
  if (flushTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(flushTimer);
  }
  flushTimer = null;
  flushTimerDueAt = 0;
}

function scheduleFlush(delayMs: number): void {
  if (typeof window === "undefined") {
    return;
  }
  const dueAt = Date.now() + Math.max(0, delayMs);
  if (flushTimer !== null && flushTimerDueAt !== 0 && flushTimerDueAt <= dueAt) {
    return;
  }
  clearFlushTimer();
  flushTimerDueAt = dueAt;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushTimerDueAt = 0;
    void flushPendingTxSyncs();
  }, Math.max(0, dueAt - Date.now()));
}

function bindLifecycleListeners(): void {
  if (typeof window === "undefined" || listenersBound) {
    return;
  }
  const flushNow = () => {
    void flushPendingTxSyncs({ force: true });
  };
  onlineHandler = flushNow;
  focusHandler = flushNow;
  visibilityHandler = () => {
    if (document.visibilityState === "visible") {
      flushNow();
    }
  };
  window.addEventListener("online", onlineHandler);
  window.addEventListener("focus", focusHandler);
  document.addEventListener("visibilitychange", visibilityHandler);
  listenersBound = true;
}

function hasPendingTxHashes(): boolean {
  return loadState().txHashes.length > 0;
}

export function initTxSyncQueue(): void {
  if (typeof window === "undefined") {
    return;
  }
  bindLifecycleListeners();
  if (hasPendingTxHashes()) {
    scheduleFlush(0);
  }
}

export function enqueueTxSync(
  txHash: `0x${string}`,
  options: { immediate?: boolean } = {},
): void {
  if (!isTxHash(txHash)) {
    return;
  }
  initTxSyncQueue();
  const current = loadState();
  const txHashes = [...current.txHashes];
  if (!txHashes.includes(txHash)) {
    txHashes.push(txHash);
  }
  persistState({
    txHashes,
    retryCount: 0,
    nextRetryAt: 0,
  });
  if (options.immediate) {
    void flushPendingTxSyncs({ force: true });
    return;
  }
  scheduleFlush(TX_SYNC_COALESCE_MS);
}

export async function flushPendingTxSyncs(options: { force?: boolean } = {}): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  initTxSyncQueue();
  if (flushPromise) {
    return flushPromise;
  }
  const current = loadState();
  if (current.txHashes.length === 0) {
    clearFlushTimer();
    return;
  }
  const now = Date.now();
  if (!options.force && current.nextRetryAt > now) {
    scheduleFlush(current.nextRetryAt - now);
    return;
  }

  const pendingAtFlushStart = [...current.txHashes];
  const processedAtFlushStart = new Set(pendingAtFlushStart);
  const txHash = pendingAtFlushStart[pendingAtFlushStart.length - 1]!;
  flushPromise = triggerSync(txHash)
    .then(() => {
      const latest = loadState();
      // Any tx hash that was already pending when this flush started is covered by this
      // sync pass; keep only hashes appended while this flush was in flight.
      const remaining = latest.txHashes.filter(
        (value) => !processedAtFlushStart.has(value),
      );
      if (remaining.length === 0) {
        persistState(defaultState());
        clearFlushTimer();
      } else {
        persistState({
          txHashes: remaining,
          retryCount: 0,
          nextRetryAt: 0,
        });
      }
      window.dispatchEvent(new CustomEvent(TX_SYNC_FLUSHED_EVENT, { detail: { txHash } }));
    })
    .catch((error) => {
      const failed = loadState();
      const nextRetryCount = failed.retryCount + 1;
      const nextRetryAt = Date.now() + retryDelayMs(nextRetryCount);
      console.warn("KPEG tx sync failed; queued retry.", {
        txHash,
        retryCount: nextRetryCount,
        nextRetryAt,
        error,
      });
      persistState({
        txHashes: failed.txHashes,
        retryCount: nextRetryCount,
        nextRetryAt,
      });
      scheduleFlush(nextRetryAt - Date.now());
    })
    .finally(() => {
      flushPromise = null;
      const next = loadState();
      if (next.txHashes.length === 0) {
        return;
      }
      if (next.nextRetryAt > Date.now()) {
        scheduleFlush(next.nextRetryAt - Date.now());
        return;
      }
      scheduleFlush(0);
    });

  return flushPromise;
}

export function __resetTxSyncQueueForTest(): void {
  clearFlushTimer();
  flushPromise = null;
  state = null;
  if (typeof window !== "undefined" && listenersBound) {
    if (onlineHandler) window.removeEventListener("online", onlineHandler);
    if (focusHandler) window.removeEventListener("focus", focusHandler);
    if (visibilityHandler) {
      document.removeEventListener("visibilitychange", visibilityHandler);
    }
    window.localStorage.removeItem(SYNC_QUEUE_STORAGE_KEY);
  }
  listenersBound = false;
  onlineHandler = null;
  focusHandler = null;
  visibilityHandler = null;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(SYNC_QUEUE_STORAGE_KEY);
  }
}
