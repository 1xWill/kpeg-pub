#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function parseEnvText(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

function inferNetwork(chainIdRaw) {
  const chainId = Number(chainIdRaw);
  if (!Number.isInteger(chainId)) {
    return null;
  }
  if (chainId === 84532) return "base-sepolia";
  if (chainId === 8453) return "base-mainnet";
  if (chainId === 31337) return "localhost";
  return `chain-${chainId}`;
}

function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, "..");
  const envPath = resolve(process.env.KPEG_ENV_PATH ?? resolve(repoRoot, ".env"));
  const fileEnv = existsSync(envPath) ? parseEnvText(readFileSync(envPath, "utf8")) : {};
  const env = { ...fileEnv, ...process.env };
  const required = [
    "KPEG_CHAIN_RPC_URL",
    "KPEG_CHAIN_ID",
    "KPEG_CHAIN_START_BLOCK",
    "KPEG_TOKEN_ADDRESS",
    "KPEG_MARKET_ADDRESS",
    "KPEG_ROUTER_ADDRESS",
    "KPEG_QUOTER_ADDRESS",
    "VITE_KPEG_CHAIN_ID",
    "VITE_KPEG_TOKEN_ADDRESS",
    "VITE_KPEG_MARKET_ADDRESS",
    "VITE_KPEG_ROUTER_ADDRESS",
    "VITE_KPEG_QUOTER_ADDRESS"
  ];

  const missing = required.filter((key) => !env[key]?.trim());
  const invalid = [];
  const chainId = Number(env.KPEG_CHAIN_ID?.trim());
  if (env.KPEG_CHAIN_ID?.trim() && (!Number.isInteger(chainId) || chainId <= 0)) {
    invalid.push("KPEG_CHAIN_ID");
  }
  const rpcUrl = env.KPEG_CHAIN_RPC_URL?.trim();
  if (rpcUrl && !/^https?:\/\//.test(rpcUrl)) {
    invalid.push("KPEG_CHAIN_RPC_URL");
  }
  const chainStartBlock = Number(env.KPEG_CHAIN_START_BLOCK?.trim());
  if (
    env.KPEG_CHAIN_START_BLOCK?.trim() &&
    (!Number.isInteger(chainStartBlock) || chainStartBlock <= 0)
  ) {
    invalid.push("KPEG_CHAIN_START_BLOCK");
  }
  const addressKeys = [
    "KPEG_TOKEN_ADDRESS",
    "KPEG_MARKET_ADDRESS",
    "KPEG_ROUTER_ADDRESS",
    "KPEG_QUOTER_ADDRESS",
    "VITE_KPEG_TOKEN_ADDRESS",
    "VITE_KPEG_MARKET_ADDRESS",
    "VITE_KPEG_ROUTER_ADDRESS",
    "VITE_KPEG_QUOTER_ADDRESS"
  ];
  for (const key of addressKeys) {
    const value = env[key]?.trim();
    if (value && !/^0x[a-fA-F0-9]{40}$/.test(value)) {
      invalid.push(key);
    }
  }
  if (missing.length > 0 || invalid.length > 0) {
    const inferredNetwork = inferNetwork(env.KPEG_CHAIN_ID ?? env.VITE_KPEG_CHAIN_ID);
    const networkHint =
      inferredNetwork &&
      (inferredNetwork === "localhost" ||
        inferredNetwork === "base-sepolia" ||
        inferredNetwork === "base-mainnet")
        ? inferredNetwork
        : "localhost";
    throw new Error(
      [
        "App env is incomplete for trade flow.",
        existsSync(envPath) ? `Checked env file: ${envPath}` : `Env file not found at ${envPath}; checked process env only.`,
        ...(missing.length > 0 ? [`Missing keys: ${missing.join(", ")}`] : []),
        ...(invalid.length > 0 ? [`Invalid values: ${invalid.join(", ")}`] : []),
        `Run: node scripts/write-app-env.mjs ${networkHint} local-sqlite`,
        "Then restart: pnpm dev"
      ].join("\n")
    );
  }

  console.log("App env OK for trade flow.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
