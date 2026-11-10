import { describe, expect, it } from "vitest";
import {
  buildSchedulerEntries,
  cronFromIntervalMinutes,
  mergeEnvText,
  parseSchedulerArgs
} from "../../../scripts/write-sync-scheduler-env.mjs";

describe("scheduler env helper", () => {
  it("parses required network and options", () => {
    expect(
      parseSchedulerArgs([
        "base-mainnet",
        "--app-url",
        "https://kpeg.example",
        "--interval-minutes",
        "5"
      ])
    ).toMatchObject({
      network: "base-mainnet",
      appUrl: "https://kpeg.example",
      intervalMinutes: "5"
    });
  });

  it("builds defaults and generates sync secret when missing", () => {
    const entries = Object.fromEntries(
      buildSchedulerEntries({
        network: "base-sepolia",
        processEnv: {},
        existingEnv: {},
        baseEnv: {}
      })
    );
    expect(entries.KPEG_SYNC_INTERVAL_MINUTES).toBe("1");
    expect(entries.KPEG_SYNC_TIMEZONE).toBe("Etc/UTC");
    expect(entries.KPEG_SYNC_SCHEDULER_LOCATION).toBe("us-central1");
    expect(entries.KPEG_SYNC_SCHEDULER_JOB_NAME).toBe("kpeg-sync-base-sepolia");
    expect(entries.KPEG_SYNC_SECRET.length).toBeGreaterThan(0);
  });

  it("derives target URL from app URL and keeps cron format stable", () => {
    const entries = Object.fromEntries(
      buildSchedulerEntries({
        network: "base-mainnet",
        appUrl: "https://kpeg.example/",
        intervalMinutes: "15",
        processEnv: {},
        existingEnv: {},
        baseEnv: {}
      })
    );
    expect(entries.KPEG_SYNC_SCHEDULER_TARGET_URL).toBe("https://kpeg.example/api/sync");
    expect(cronFromIntervalMinutes(1)).toBe("* * * * *");
    expect(cronFromIntervalMinutes(10)).toBe("*/10 * * * *");
  });

  it("prefers app env sync secret over stale scheduler env secret", () => {
    const entries = Object.fromEntries(
      buildSchedulerEntries({
        network: "base-sepolia",
        processEnv: {},
        existingEnv: {
          KPEG_SYNC_SECRET: "stale-scheduler-secret"
        },
        baseEnv: {
          KPEG_SYNC_SECRET: "app-env-secret"
        }
      })
    );
    expect(entries.KPEG_SYNC_SECRET).toBe("app-env-secret");
  });

  it("merges scheduler keys without dropping unrelated entries", () => {
    const merged = mergeEnvText(
      "FOO=bar\nKPEG_SYNC_INTERVAL_MINUTES=9\n",
      [
        ["KPEG_SYNC_INTERVAL_MINUTES", "1"]
      ]
    );
    expect(merged).toContain("FOO=bar");
    expect(merged).toContain("KPEG_SYNC_INTERVAL_MINUTES=1");
    expect(merged).not.toContain("KPEG_SYNC_INTERVAL_MINUTES=9");
  });
});
