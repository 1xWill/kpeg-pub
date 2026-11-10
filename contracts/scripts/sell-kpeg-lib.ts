export const KPEG_UNIT = 10n ** 18n;
export const DEFAULT_DEADLINE_SECONDS = 3600n;
export const DEFAULT_SLIPPAGE_BPS = 1000n;
export const DEFAULT_MAX_TX_GAS_LIMIT = 29_000_000n;

const TX_GAS_CAP_PATTERNS = [
  /exceeds max transaction gas limit/i,
  /gas limit too high/i
];

export function parseWholeSellArg(raw: string | undefined): bigint | "max" {
    const normalized = raw?.trim().toLowerCase() ?? "max";
    if (normalized === "max" || normalized === "all") {
        return "max";
    }
    if (!/^\d+$/.test(normalized)) {
        throw new Error(`Invalid --whole value: ${raw}`);
    }
    const whole = BigInt(normalized);
    if (whole <= 0n) {
        throw new Error("--whole must be greater than 0");
    }
    return whole;
}

export function wholeToAmount(whole: bigint): bigint {
    return whole * KPEG_UNIT;
}

export function applySlippage(amount: bigint, slippageBps: bigint): bigint {
    if (slippageBps < 0n || slippageBps >= 10_000n) {
        throw new Error(`Invalid slippage bps: ${slippageBps.toString()}`);
    }
    return (amount * (10_000n - slippageBps)) / 10_000n;
}

export function isTxGasCapError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TX_GAS_CAP_PATTERNS.some((pattern) => pattern.test(message));
}

export async function findMaxWholeSellable(
    maxWhole: bigint,
    canSellWhole: (whole: bigint) => Promise<boolean>
): Promise<bigint> {
    let low = 0n;
    let high = maxWhole;

    while (low < high) {
        const mid = (low + high + 1n) / 2n;
        if (await canSellWhole(mid)) {
            low = mid;
        } else {
            high = mid - 1n;
        }
    }

    return low;
}
