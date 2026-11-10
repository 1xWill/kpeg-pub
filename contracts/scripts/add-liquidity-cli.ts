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
      `Usage: tsx scripts/add-liquidity-cli.ts <${Array.from(NETWORKS).join("|")}> --token-liquidity N --eth-liquidity N [--private-key 0x...]`
    );
  }

  const tickLower = readOption("tick-lower");
  const tickUpper = readOption("tick-upper");
  if ((tickLower && !tickUpper) || (!tickLower && tickUpper)) {
    throw new Error("--tick-lower and --tick-upper must be provided together");
  }

  const privateKey = readOption("private-key") ?? process.env.KPEG_LIQUIDITY_PRIVATE_KEY?.trim();
  if (network !== "localhost" && !privateKey) {
    throw new Error(
      `Missing wallet key for ${network}. Set KPEG_LIQUIDITY_PRIVATE_KEY or pass --private-key 0x...`
    );
  }
  const child = spawn("hardhat", ["run", "scripts/add-liquidity.ts", "--network", NETWORK_TO_HARDHAT[network]], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(privateKey ? { KPEG_DEPLOYER_PRIVATE_KEY: privateKey, KPEG_LOCAL_PRIVATE_KEY: privateKey } : {}),
      KPEG_ADD_LIQUIDITY_TOKEN_LIQUIDITY: requireOption("token-liquidity"),
      KPEG_ADD_LIQUIDITY_ETH_LIQUIDITY: requireOption("eth-liquidity"),
      ...(tickLower ? { KPEG_ADD_LIQUIDITY_TICK_LOWER: tickLower } : {}),
      ...(tickUpper ? { KPEG_ADD_LIQUIDITY_TICK_UPPER: tickUpper } : {})
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
