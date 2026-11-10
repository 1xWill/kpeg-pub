import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { KPEGRepository } from "../src/repository.js";

describe("breeding event replay safety", () => {
  it("does not duplicate breeding_events rows when the same tx/log is replayed", async () => {
    const db = await openDb({
      mode: "sqlite",
      sqlitePath: ":memory:",
      libsqlUrl: undefined,
      libsqlAuthToken: undefined,
    });
    const repo = new KPEGRepository(db);
    try {
      const event = {
        eventKind: "POOL_CREATED" as const,
        poolId: 42,
        poolType: 1,
        host: "0x00000000000000000000000000000000000000aa",
        parentAKittyId: 1,
        parentBKittyId: null,
        cycleStartedAt: 0,
        cycleDays: 0,
        filterCount: 0,
        filterGroups: [],
        filterTraits: [],
        blockNumber: 100,
        txHash: `0x${"1".repeat(64)}` as const,
        logIndex: 7,
      };

      await repo.ingestBreedingEvent(event);
      await repo.ingestBreedingEvent(event);

      const rows = await db.all<{ value: number }>(
        `SELECT COUNT(*) AS value FROM breeding_events WHERE tx_hash = ? AND log_index = ?`,
        [event.txHash, event.logIndex]
      );
      expect(Number(rows[0]?.value ?? 0)).toBe(1);
    } finally {
      await db.close();
    }
  });
});
