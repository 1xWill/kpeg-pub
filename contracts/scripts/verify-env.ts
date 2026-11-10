export function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function explorerApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return envValue(env, "ETHERSCAN_API_KEY") ?? envValue(env, "BASESCAN_API_KEY") ?? "";
}

export function explorerApiKeyEnvName(env: NodeJS.ProcessEnv = process.env): "ETHERSCAN_API_KEY" | "BASESCAN_API_KEY" | undefined {
  if (envValue(env, "ETHERSCAN_API_KEY")) {
    return "ETHERSCAN_API_KEY";
  }
  if (envValue(env, "BASESCAN_API_KEY")) {
    return "BASESCAN_API_KEY";
  }
  return undefined;
}
