import type { SyncRunInput, SyncRunResult } from "./server.js";

type DevSyncOptions = {
  enabled: boolean;
  intervalMs: number;
  runSync: (input: SyncRunInput) => Promise<SyncRunResult>;
  log?: {
    info?: (message: string) => void;
    warn?: (input: unknown, message?: string) => void;
  };
};

export function devAutoSyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.KPEG_DEV_AUTO_SYNC !== "false";
}

export function devAutoSyncIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.KPEG_DEV_SYNC_INTERVAL_MS);
  return Number.isFinite(value) && value >= 10_000 ? value : 60_000;
}

export function startDevAutoSync(options: DevSyncOptions): NodeJS.Timeout | null {
  if (!options.enabled) {
    return null;
  }

  let running = false;
  const runOnce = () => {
    if (running) {
      return;
    }
    running = true;
    void options.runSync({ authorizedBySecret: true })
      .then((result) => {
        options.log?.info?.(
          `dev sync indexed block ${result.latestIndexedBlock}${result.headBlock ? `/${result.headBlock}` : ""}`
        );
      })
      .catch((error) => {
        options.log?.warn?.(error, "dev sync failed");
      })
      .finally(() => {
        running = false;
      });
  };

  runOnce();
  const timer = setInterval(runOnce, options.intervalMs);
  timer.unref?.();
  return timer;
}
