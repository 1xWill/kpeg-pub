export const NETWORK_TO_RPC_ENV: Record<string, string> = {
  localhost: "KPEG_LOCAL_RPC_URL",
  "base-sepolia": "KPEG_BASE_SEPOLIA_RPC_URL",
  "base-mainnet": "KPEG_BASE_MAINNET_RPC_URL"
};

export function rpcOverrideEnv(network: string, rpcUrl?: string): Record<string, string> {
  if (!rpcUrl) {
    return {};
  }
  const key = NETWORK_TO_RPC_ENV[network];
  if (!key) {
    throw new Error(`Unsupported network for rpc override: ${network}`);
  }
  return { [key]: rpcUrl };
}
