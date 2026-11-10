export const FIXED_TOKEN_SUPPLY_WHOLE = 9_999;
const TOKEN_UNIT_WEI = 1_000_000_000_000_000_000n;
export const SELL_BURN_WARNING =
  "Selling can burn a live kitty. You can transfer selected kitties to another wallet if you want to preserve specific kitties.";

export function buyButtonLabel(
  buyWhole: number | null,
  isPending: boolean,
): string {
  if (isPending) {
    return "BUYING...";
  }
  if (!buyWhole) {
    return "BUY kPEG";
  }
  return `BUY ${buyWhole} kPEG`;
}

export function wholeKPEGFromWei(value: unknown): number | null {
  if (typeof value !== "bigint") {
    return null;
  }
  return Number(value / 1_000_000_000_000_000_000n);
}

export function capWholeKPEGSupply(value: number | null): number | null {
  return value === null ? null : Math.min(value, FIXED_TOKEN_SUPPLY_WHOLE);
}

export function remainingWholeKPEGSupply(
  liveKitties: number | null,
): number | null {
  if (liveKitties === null || !Number.isFinite(liveKitties)) {
    return null;
  }
  const mintedWhole = Math.max(0, Math.floor(liveKitties));
  return Math.max(0, FIXED_TOKEN_SUPPLY_WHOLE - mintedWhole);
}

export function effectiveMaxBuyWhole(
  contractMaxBuyWhole: number | null,
  liveKitties: number | null,
): number | null {
  const cappedContractMaxBuy = capWholeKPEGSupply(contractMaxBuyWhole);
  if (cappedContractMaxBuy === null) {
    return null;
  }
  const remainingSupplyWhole = remainingWholeKPEGSupply(liveKitties);
  return remainingSupplyWhole === null
    ? cappedContractMaxBuy
    : Math.min(cappedContractMaxBuy, remainingSupplyWhole);
}

export function maxBuyExceededMessage(
  buyWhole: number | null,
  maxBuyWhole: number | null,
): string | null {
  if (!buyWhole || maxBuyWhole === null || buyWhole <= maxBuyWhole) {
    return null;
  }
  return maxBuyWhole >= 1
    ? `Current max buy is ${maxBuyWhole} whole kPEG. Wait for the limit to grow or buy less.`
    : "Buying is not open yet. Wait for the pool to start.";
}

export function buyFailureHint(
  error: Error,
  maxBuyMessage: string | null,
): string {
  if (/BuyLimitExceeded|buy limit|max buy/i.test(error.message)) {
    return (
      maxBuyMessage ??
      "This buy exceeds the current max buy. Wait for the limit to grow or buy less."
    );
  }
  return "Check wallet network, ETH balance, current max buy, and pool token-side liquidity.";
}

export function sellWouldReduceWholeCapacityBelowLive(input: {
  ownerKittiesLive: number | null;
  balanceWei: bigint;
  sellWei: bigint | null;
}): boolean {
  if (
    input.ownerKittiesLive === null ||
    input.ownerKittiesLive <= 0 ||
    input.sellWei === null ||
    input.sellWei <= 0n
  ) {
    return false;
  }
  const afterBalanceWei =
    input.balanceWei > input.sellWei ? input.balanceWei - input.sellWei : 0n;
  const afterWholeCapacity = Number(afterBalanceWei / TOKEN_UNIT_WEI);
  return input.ownerKittiesLive > afterWholeCapacity;
}
