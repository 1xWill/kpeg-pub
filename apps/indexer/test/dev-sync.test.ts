import { afterEach, describe, expect, it, vi } from "vitest";
import { devAutoSyncEnabled, devAutoSyncIntervalMs, startDevAutoSync } from "../src/dev-sync.js";

describe("dev auto sync", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs immediately and then repeats in development", async () => {
    vi.useFakeTimers();
    const runSync = vi.fn(async () => ({
      ok: true as const,
      skipped: false,
      latestIndexedBlock: 10,
      headBlock: 10,
      caughtUp: true
    }));

    const timer = startDevAutoSync({
      enabled: true,
      intervalMs: 60_000,
      runSync
    });

    expect(runSync).toHaveBeenCalledTimes(1);
    expect(runSync).toHaveBeenLastCalledWith({ authorizedBySecret: true });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runSync).toHaveBeenCalledTimes(2);

    timer && clearInterval(timer);
  });

  it("uses development defaults and allows explicit disable", () => {
    expect(devAutoSyncEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(devAutoSyncEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(devAutoSyncEnabled({ NODE_ENV: "development", KPEG_DEV_AUTO_SYNC: "false" })).toBe(false);
    expect(devAutoSyncIntervalMs({ KPEG_DEV_SYNC_INTERVAL_MS: "90000" })).toBe(90_000);
    expect(devAutoSyncIntervalMs({ KPEG_DEV_SYNC_INTERVAL_MS: "1000" })).toBe(60_000);
  });
});
