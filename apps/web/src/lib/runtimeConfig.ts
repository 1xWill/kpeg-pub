export function resolveRuntimeAddress(
  runtimeAddress: string | null | undefined,
  envAddress: string | undefined,
): `0x${string}` | undefined {
  const value = runtimeAddress?.trim() || envAddress?.trim();
  return value ? (value as `0x${string}`) : undefined;
}

export function resolveRuntimeChainId(
  runtimeChainId: number | null | undefined,
  envChainId: string | undefined,
  fallback = 84532,
): number {
  if (Number.isInteger(runtimeChainId) && runtimeChainId! > 0) {
    return runtimeChainId!;
  }

  const parsed = Number(envChainId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
