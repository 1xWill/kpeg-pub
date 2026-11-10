export function formatPct(value: number): string {
  if (!Number.isFinite(value)) {
    return "N/A";
  }
  if (value >= 1) {
    return `${value.toFixed(2)}%`;
  }
  if (value >= 0.01) {
    return `${value.toFixed(4)}%`;
  }
  if (value >= 0.0001) {
    return `${value.toFixed(6).replace(/\.?0+$/, "")}%`;
  }
  return `${value.toFixed(8).replace(/\.?0+$/, "")}%`;
}

export function formatPctCompact(value: number): { text: string; zeroCount: null | number; significantText: string | null } {
  const fullText = formatPct(value);
  if (!Number.isFinite(value)) {
    return { text: fullText, zeroCount: null, significantText: null };
  }

  const [, decimalsRaw = ""] = value.toFixed(12).split(".");
  const decimals = decimalsRaw.replace(/0+$/, "");
  const zeroCount = decimals.match(/^0+/)?.[0].length ?? 0;

  if (zeroCount <= 3) {
    return { text: fullText, zeroCount: null, significantText: null };
  }

  const significantText = decimals.slice(zeroCount, zeroCount + 3).replace(/0+$/, "") || "0";
  return {
    text: "0.0",
    zeroCount,
    significantText: `${significantText}%`
  };
}

export function formatTokenAmount(value: number, symbol: string): string {
  if (!Number.isFinite(value)) {
    return `0 ${symbol}`;
  }
  const maximumFractionDigits = value >= 1_000 ? 2 : 4;
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits,
    minimumFractionDigits: 0
  })} ${symbol}`;
}

export function formatFixedDecimals(value: number, symbol: string, maximumFractionDigits = 6): string {
  if (!Number.isFinite(value)) {
    return `0 ${symbol}`;
  }
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits,
    minimumFractionDigits: 0
  })} ${symbol}`;
}

export function formatOneInN(value: number): string {
  if (!Number.isFinite(value)) {
    return "N/A";
  }
  if (value < 1_000) {
    return `1 in ${value.toFixed(1)}`;
  }
  return `1 in ${Math.round(value).toLocaleString()}`;
}

export function rarityScoreFromOneInN(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.log10(value) * 100;
}

export function formatRarityScore(value: number): string {
  if (!Number.isFinite(value)) {
    return "N/A";
  }
  return Math.round(value).toLocaleString();
}

export function shortAddress(address: string): string {
  if (address.length < 12) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
