import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerSyncMock } = vi.hoisted(() => ({
  triggerSyncMock: vi.fn(),
}));

vi.mock("../lib/api.js", () => ({
  triggerSync: triggerSyncMock,
}));

import {
  __resetTxSyncQueueForTest,
  enqueueTxSync,
  TX_SYNC_COALESCE_MS,
  TX_SYNC_RETRY_BASE_MS,
} from "../lib/syncQueue.js";

const TX_HASH_A = `0x${"a".repeat(64)}` as const;
const TX_HASH_B = `0x${"b".repeat(64)}` as const;
const TX_HASH_C = `0x${"c".repeat(64)}` as const;

describe("tx sync queue", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    triggerSyncMock.mockReset();
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    __resetTxSyncQueueForTest();
    window.localStorage.clear();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    __resetTxSyncQueueForTest();
    vi.useRealTimers();
  });

  it("coalesces multiple tx hashes and flushes once with the newest hash", async () => {
    triggerSyncMock.mockResolvedValue({
      ok: true,
      skipped: false,
      latestIndexedBlock: 1,
    });

    enqueueTxSync(TX_HASH_A);
    enqueueTxSync(TX_HASH_B);

    await vi.advanceTimersByTimeAsync(TX_SYNC_COALESCE_MS);
    await Promise.resolve();

    expect(triggerSyncMock).toHaveBeenCalledTimes(1);
    expect(triggerSyncMock).toHaveBeenCalledWith(TX_HASH_B);
  });

  it("retries failed syncs with backoff", async () => {
    triggerSyncMock
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockResolvedValueOnce({
        ok: true,
        skipped: false,
        latestIndexedBlock: 2,
      });

    enqueueTxSync(TX_HASH_A);
    await vi.advanceTimersByTimeAsync(TX_SYNC_COALESCE_MS);
    await Promise.resolve();
    expect(triggerSyncMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TX_SYNC_RETRY_BASE_MS - 1);
    expect(triggerSyncMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(triggerSyncMock).toHaveBeenCalledTimes(2);
    expect(triggerSyncMock).toHaveBeenLastCalledWith(TX_HASH_A);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "KPEG tx sync failed; queued retry.",
      expect.objectContaining({
        txHash: TX_HASH_A,
        retryCount: 1,
      }),
    );
  });

  it("flushes immediately on focus without waiting coalesce window", async () => {
    triggerSyncMock.mockResolvedValue({
      ok: true,
      skipped: false,
      latestIndexedBlock: 3,
    });

    enqueueTxSync(TX_HASH_A);
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();

    expect(triggerSyncMock).toHaveBeenCalledTimes(1);
    expect(triggerSyncMock).toHaveBeenCalledWith(TX_HASH_A);
  });

  it("flushes immediately when enqueueTxSync is called with immediate option", async () => {
    triggerSyncMock.mockResolvedValue({
      ok: true,
      skipped: false,
      latestIndexedBlock: 4,
    });

    enqueueTxSync(TX_HASH_A, { immediate: true });
    await Promise.resolve();

    expect(triggerSyncMock).toHaveBeenCalledTimes(1);
    expect(triggerSyncMock).toHaveBeenCalledWith(TX_HASH_A);
  });

  it("does not drop tx hashes enqueued while a flush is already in flight", async () => {
    let resolveFirst!: (value: {
      ok: true;
      skipped: false;
      latestIndexedBlock: number;
    }) => void;
    triggerSyncMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        skipped: false,
        latestIndexedBlock: 5,
      });

    enqueueTxSync(TX_HASH_A, { immediate: true });
    await Promise.resolve();
    expect(triggerSyncMock).toHaveBeenCalledTimes(1);
    expect(triggerSyncMock).toHaveBeenNthCalledWith(1, TX_HASH_A);

    enqueueTxSync(TX_HASH_B, { immediate: true });
    await Promise.resolve();
    expect(triggerSyncMock).toHaveBeenCalledTimes(1);

    resolveFirst({ ok: true, skipped: false, latestIndexedBlock: 4 });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(triggerSyncMock).toHaveBeenCalledTimes(2);
    expect(triggerSyncMock).toHaveBeenNthCalledWith(2, TX_HASH_B);
  });

  it("clears all hashes pending at flush start while preserving hashes appended mid-flight", async () => {
    let resolveFirst!: (value: {
      ok: true;
      skipped: false;
      latestIndexedBlock: number;
    }) => void;
    triggerSyncMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        skipped: false,
        latestIndexedBlock: 6,
      });

    enqueueTxSync(TX_HASH_A);
    enqueueTxSync(TX_HASH_B);
    await vi.advanceTimersByTimeAsync(TX_SYNC_COALESCE_MS);
    await Promise.resolve();
    expect(triggerSyncMock).toHaveBeenCalledTimes(1);
    expect(triggerSyncMock).toHaveBeenNthCalledWith(1, TX_HASH_B);

    enqueueTxSync(TX_HASH_C, { immediate: true });
    await Promise.resolve();
    expect(triggerSyncMock).toHaveBeenCalledTimes(1);

    resolveFirst({ ok: true, skipped: false, latestIndexedBlock: 6 });
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(triggerSyncMock).toHaveBeenCalledTimes(2);
    expect(triggerSyncMock).toHaveBeenNthCalledWith(2, TX_HASH_C);
  });
});
