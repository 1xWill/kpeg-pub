import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(process.cwd(), "../.env"), override: true });

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
      `Usage: tsx scripts/bootstrap-cli.ts <${Array.from(NETWORKS).join("|")}> --price-kpeg-per-eth N --token-liquidity N --eth-liquidity N [--private-key 0x...]`
    );
  }

  const tickLower = readOption("tick-lower");
  const tickUpper = readOption("tick-upper");
  if ((tickLower && !tickUpper) || (!tickLower && tickUpper)) {
    throw new Error("--tick-lower and --tick-upper must be provided together");
  }

  const privateKey =
    readOption("private-key") ??
    process.env.KPEG_BOOTSTRAP_PRIVATE_KEY?.trim() ??
    process.env.KPEG_LIQUIDITY_PRIVATE_KEY?.trim() ??
    process.env.KPEG_DEPLOYER_PRIVATE_KEY?.trim();
  if (network !== "localhost" && !privateKey) {
    throw new Error(
      `Missing wallet key for ${network}. Set KPEG_BOOTSTRAP_PRIVATE_KEY, KPEG_LIQUIDITY_PRIVATE_KEY, KPEG_DEPLOYER_PRIVATE_KEY, or pass --private-key 0x...`
    );
  }

  const child = spawn(
    "hardhat",
    ["run", "scripts/bootstrap-pool.ts", "--network", NETWORK_TO_HARDHAT[network]],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        ...(privateKey ? { KPEG_DEPLOYER_PRIVATE_KEY: privateKey, KPEG_LOCAL_PRIVATE_KEY: privateKey } : {}),
        KPEG_BOOTSTRAP_PRICE_KPEG_PER_ETH: requireOption("price-kpeg-per-eth"),
        KPEG_BOOTSTRAP_TOKEN_LIQUIDITY: requireOption("token-liquidity"),
        KPEG_BOOTSTRAP_ETH_LIQUIDITY: requireOption("eth-liquidity"),
        ...(tickLower ? { KPEG_BOOTSTRAP_TICK_LOWER: tickLower } : {}),
        ...(tickUpper ? { KPEG_BOOTSTRAP_TICK_UPPER: tickUpper } : {})
      }
    }
  );

  const exitCode = await new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
  });
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
