import { describe, expect, it } from "vitest";
import {
  SELL_BURN_WARNING,
  buyButtonLabel,
  capWholeKPEGSupply,
  effectiveMaxBuyWhole,
  maxBuyExceededMessage,
  remainingWholeKPEGSupply,
  sellWouldReduceWholeCapacityBelowLive,
  wholeKPEGFromWei,
} from "../lib/tradePanelBuy.js";

describe("buyButtonLabel", () => {
  it("returns the default label when no whole amount is selected", () => {
    expect(buyButtonLabel(null, false)).toBe("BUY kPEG");
    expect(buyButtonLabel(0, false)).toBe("BUY kPEG");
  });

  it("uses whole amount wording for one kPEG", () => {
    expect(buyButtonLabel(1, false)).toBe("BUY 1 kPEG");
  });

  it("uses whole amount wording for more than one kPEG", () => {
    expect(buyButtonLabel(2, false)).toBe("BUY 2 kPEG");
    expect(buyButtonLabel(25, false)).toBe("BUY 25 kPEG");
  });

  it("prioritizes the pending label", () => {
    expect(buyButtonLabel(1, true)).toBe("BUYING...");
    expect(buyButtonLabel(5, true)).toBe("BUYING...");
  });
});

describe("wholeKPEGFromWei", () => {
  it("floors max buy to whole kPEG because buys must be whole-number kitties", () => {
    expect(wholeKPEGFromWei(24_997_500_000_000_000_000n)).toBe(24);
    expect(wholeKPEGFromWei(25_000_000_000_000_000_000n)).toBe(25);
    expect(wholeKPEGFromWei(undefined)).toBeNull();
  });
});

describe("capWholeKPEGSupply", () => {
  it("caps stale contract max buy values to the fixed supply", () => {
    expect(capWholeKPEGSupply(12_364)).toBe(9_999);
    expect(capWholeKPEGSupply(24)).toBe(24);
    expect(capWholeKPEGSupply(null)).toBeNull();
  });
});

describe("remainingWholeKPEGSupply", () => {
  it("returns whole supply left after live kitties", () => {
    expect(remainingWholeKPEGSupply(0)).toBe(9_999);
    expect(remainingWholeKPEGSupply(2_500)).toBe(7_499);
    expect(remainingWholeKPEGSupply(9_999)).toBe(0);
  });

  it("clamps overshoot and keeps null when live count is unknown", () => {
    expect(remainingWholeKPEGSupply(12_000)).toBe(0);
    expect(remainingWholeKPEGSupply(null)).toBeNull();
  });
});

describe("effectiveMaxBuyWhole", () => {
  it("caps contract max buy by remaining whole supply", () => {
    expect(effectiveMaxBuyWhole(9_999, 1_234)).toBe(8_765);
    expect(effectiveMaxBuyWhole(24, 1_234)).toBe(24);
  });

  it("still handles stale contract max and unknown live count", () => {
    expect(effectiveMaxBuyWhole(12_500, 5)).toBe(9_994);
    expect(effectiveMaxBuyWhole(24, null)).toBe(24);
    expect(effectiveMaxBuyWhole(null, 5)).toBeNull();
  });
});

describe("maxBuyExceededMessage", () => {
  it("returns null when the buy is within the current whole max", () => {
    expect(maxBuyExceededMessage(24, 24)).toBeNull();
    expect(maxBuyExceededMessage(null, 24)).toBeNull();
  });

  it("explains when the requested buy exceeds the current max", () => {
    expect(maxBuyExceededMessage(25, 24)).toBe(
      "Current max buy is 24 whole kPEG. Wait for the limit to grow or buy less.",
    );
  });

  it("explains when buying is not open yet", () => {
    expect(maxBuyExceededMessage(1, 0)).toBe(
      "Buying is not open yet. Wait for the pool to start.",
    );
  });
});

describe("fractional sell burn risk", () => {
  it("detects when sell amount drops whole-token capacity below live kitty count", () => {
    expect(
      sellWouldReduceWholeCapacityBelowLive({
        ownerKittiesLive: 3,
        balanceWei: 3_400_000_000_000_000_000n,
        sellWei: 500_000_000_000_000_000n,
      }),
    ).toBe(true);
  });

  it("does not warn when whole-token capacity still covers live kitty count", () => {
    expect(
      sellWouldReduceWholeCapacityBelowLive({
        ownerKittiesLive: 3,
        balanceWei: 3_400_000_000_000_000_000n,
        sellWei: 100_000_000_000_000_000n,
      }),
    ).toBe(false);
  });

  it("keeps the fixed user-facing warning copy", () => {
    expect(SELL_BURN_WARNING).toBe(
      "Selling can burn a live kitty. You can transfer selected kitties to another wallet if you want to preserve specific kitties.",
    );
  });
});
