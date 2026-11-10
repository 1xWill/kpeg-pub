import { describe, expect, it } from "vitest";
import { syncBackfillActive } from "../lib/syncStatus.js";

describe("syncBackfillActive", () => {
  it("treats explicit sync lag or in-progress sync as active backfill", () => {
    expect(syncBackfillActive(undefined)).toBe(false);
    expect(
      syncBackfillActive({
        syncing: false,
        caughtUp: false,
      }),
    ).toBe(true);
    expect(
      syncBackfillActive({
        syncing: true,
        caughtUp: null,
      }),
    ).toBe(true);
  });

  it("stops backfill polling only after sync reports caught up", () => {
    expect(
      syncBackfillActive({
        syncing: false,
        caughtUp: true,
      }),
    ).toBe(false);
  });
});
