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

async function main() {
  const network = process.argv[2];
  if (!network || !NETWORKS.has(network)) {
    throw new Error(
      `Usage: tsx scripts/renounce-ownership-cli.ts <${Array.from(NETWORKS).join("|")}> [--private-key 0x...] [--include-gateway] [--allow-partial] [--confirm-market-final 1] [--confirm ${"I_UNDERSTAND_THIS_IS_IRREVERSIBLE"}]`
    );
  }
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      `Usage: tsx scripts/renounce-ownership-cli.ts <${Array.from(NETWORKS).join("|")}> [--private-key 0x...] [--include-gateway] [--allow-partial] [--confirm-market-final 1] [--confirm ${"I_UNDERSTAND_THIS_IS_IRREVERSIBLE"}]`
    );
    return;
  }

  const privateKey =
    readOption("private-key") ??
    process.env.KPEG_RENOUNCE_PRIVATE_KEY?.trim() ??
    process.env.KPEG_DEPLOYER_PRIVATE_KEY?.trim();
  if (network !== "localhost" && !privateKey) {
    throw new Error(
      `Missing wallet key for ${network}. Set KPEG_RENOUNCE_PRIVATE_KEY, KPEG_DEPLOYER_PRIVATE_KEY, or pass --private-key 0x...`
    );
  }

  const includeGateway = process.argv.includes("--include-gateway");
  const allowPartial = process.argv.includes("--allow-partial");
  const confirm = readOption("confirm");
  const confirmMarketFinal = readOption("confirm-market-final");
  const childArgs = ["run", "scripts/renounce-ownership.ts", "--network", NETWORK_TO_HARDHAT[network]];
  if (includeGateway) {
    childArgs.push("--include-gateway");
  }
  if (allowPartial) {
    childArgs.push("--allow-partial");
  }
  if (confirmMarketFinal) {
    childArgs.push("--confirm-market-final", confirmMarketFinal);
  }
  if (confirm) {
    childArgs.push("--confirm", confirm);
  }

  const child = spawn("hardhat", childArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(privateKey ? { KPEG_DEPLOYER_PRIVATE_KEY: privateKey, KPEG_LOCAL_PRIVATE_KEY: privateKey } : {})
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
