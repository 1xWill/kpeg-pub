import { spawn } from "node:child_process";
import { rpcOverrideEnv } from "./sell-kpeg-cli-lib";

const NETWORKS = new Set(["localhost", "base-sepolia", "base-mainnet"]);
const NETWORK_TO_HARDHAT: Record<string, string> = {
  localhost: "localhost",
  "base-sepolia": "baseSepolia",
  "base-mainnet": "baseMainnet"
};
const USAGE =
  `Usage: tsx scripts/sell-kpeg-cli.ts <${Array.from(NETWORKS).join("|")}> --whole <N|max> ` +
  `[--private-key 0x...] [--from 0x...] [--rpc-url URL] [--slippage-bps N] ` +
  `[--deadline-seconds N] [--max-tx-gas-limit N] [--dry-run]`;

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

async function main() {
  const network = process.argv[2];
  if (!network || !NETWORKS.has(network)) {
    throw new Error(USAGE);
  }

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const whole = readOption("whole") ?? "max";
  const privateKey = readOption("private-key") ?? process.env.KPEG_SELL_PRIVATE_KEY?.trim();
  const from = readOption("from");
  const rpcUrl = readOption("rpc-url");
  const slippageBps = readOption("slippage-bps");
  const deadlineSeconds = readOption("deadline-seconds");
  const maxTxGasLimit = readOption("max-tx-gas-limit");

  if (!privateKey && !from) {
    throw new Error("Pass --private-key 0x... or --from 0x...");
  }

  const child = spawn("hardhat", ["run", "scripts/sell-kpeg.ts", "--network", NETWORK_TO_HARDHAT[network]], {
    stdio: "inherit",
    env: {
      ...process.env,
      KPEG_SELL_WHOLE: whole,
      ...(privateKey ? { KPEG_SELL_PRIVATE_KEY: privateKey } : {}),
      ...(from ? { KPEG_SELL_FROM: from } : {}),
      ...rpcOverrideEnv(network, rpcUrl),
      ...(slippageBps ? { KPEG_SELL_SLIPPAGE_BPS: slippageBps } : {}),
      ...(deadlineSeconds ? { KPEG_SELL_DEADLINE_SECONDS: deadlineSeconds } : {}),
      ...(maxTxGasLimit ? { KPEG_SELL_MAX_TX_GAS_LIMIT: maxTxGasLimit } : {}),
      ...(process.argv.includes("--dry-run") ? { KPEG_SELL_DRY_RUN: "1" } : {})
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
