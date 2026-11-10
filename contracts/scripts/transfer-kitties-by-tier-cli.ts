import { spawn } from "node:child_process";

const NETWORKS = new Set(["localhost", "base-sepolia", "base-mainnet"]);
const NETWORK_TO_HARDHAT: Record<string, string> = {
  localhost: "localhost",
  "base-sepolia": "baseSepolia",
  "base-mainnet": "baseMainnet"
};

function readOption(name: string): string | undefined {
  const prefixed = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefixed));
  if (inline) {
    return inline.slice(prefixed.length);
  }

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) {
    return process.argv[index + 1];
  }

  return undefined;
}

function requireOption(name: string): string {
  const value = readOption(name);
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

async function main() {
  const network = process.argv[2];
  if (!network || !NETWORKS.has(network)) {
    throw new Error(
      `Usage: tsx scripts/transfer-kitties-by-tier-cli.ts <${Array.from(NETWORKS).join("|")}> --receiver 0x... --tier <Common|Uncommon|Rare|Epic|Legendary|0-4> [--private-key 0x...] [--limit N] [--batch-size N] [--log-chunk-size N] [--dry-run]`
    );
  }

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      `Usage: tsx scripts/transfer-kitties-by-tier-cli.ts <${Array.from(NETWORKS).join("|")}> --receiver 0x... --tier <Common|Uncommon|Rare|Epic|Legendary|0-4> [--private-key 0x...] [--limit N] [--batch-size N] [--log-chunk-size N] [--dry-run]`
    );
    return;
  }

  const privateKey = readOption("private-key") ?? process.env.KPEG_TRANSFER_KITTIES_PRIVATE_KEY?.trim();
  if (network !== "localhost" && !privateKey) {
    throw new Error(
      `Missing sender wallet key for ${network}. Set KPEG_TRANSFER_KITTIES_PRIVATE_KEY or pass --private-key 0x...`
    );
  }

  const childArgs = ["run", "scripts/transfer-kitties-by-tier.ts", "--network", NETWORK_TO_HARDHAT[network]];
  const limit = readOption("limit");
  const batchSize = readOption("batch-size");
  const logChunkSize = readOption("log-chunk-size");
  const child = spawn("hardhat", childArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(privateKey ? { KPEG_DEPLOYER_PRIVATE_KEY: privateKey, KPEG_LOCAL_PRIVATE_KEY: privateKey } : {}),
      KPEG_TRANSFER_KITTIES_RECEIVER: requireOption("receiver"),
      KPEG_TRANSFER_KITTIES_TIER: requireOption("tier"),
      ...(limit ? { KPEG_TRANSFER_KITTIES_LIMIT: limit } : {}),
      ...(batchSize ? { KPEG_TRANSFER_KITTIES_BATCH_SIZE: batchSize } : {}),
      ...(logChunkSize ? { KPEG_TRANSFER_KITTIES_LOG_CHUNK_SIZE: logChunkSize } : {}),
      ...(process.argv.includes("--dry-run") ? { KPEG_TRANSFER_KITTIES_DRY_RUN: "1" } : {})
    }
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
  });
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
