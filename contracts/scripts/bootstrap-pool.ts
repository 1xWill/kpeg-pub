import { ethers, network } from "hardhat";
import { encodeSqrtPriceX96FromKpegPerEth, fullRangeTicks, readDeployment, readPoolSqrtPriceX96 } from "./lib";
import { addLiquidityViaPositionManager } from "./liquidity-position";

type BootstrapArgs = {
  priceKpegPerEth: string;
  tokenLiquidity: string;
  ethLiquidity: string;
  tickLower?: number;
  tickUpper?: number;
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

function envNameFor(name: string): string {
  return `KPEG_BOOTSTRAP_${name.toUpperCase().replaceAll("-", "_")}`;
}

function readValue(name: string): string | undefined {
  return readOption(name) ?? process.env[envNameFor(name)];
}

function requireValue(name: string): string {
  const value = readValue(name);
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

function readBootstrapArgs(): BootstrapArgs {
  const tickLower = readValue("tick-lower");
  const tickUpper = readValue("tick-upper");
  if ((tickLower && !tickUpper) || (!tickLower && tickUpper)) {
    throw new Error("--tick-lower and --tick-upper must be provided together");
  }

  return {
    priceKpegPerEth: requireValue("price-kpeg-per-eth"),
    tokenLiquidity: requireValue("token-liquidity"),
    ethLiquidity: requireValue("eth-liquidity"),
    ...(tickLower && tickUpper ? { tickLower: Number(tickLower), tickUpper: Number(tickUpper) } : {})
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("KPEG_DEPLOYER_PRIVATE_KEY is required for this network");
  }
  const deployment = await readDeployment(network.name);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const args = readBootstrapArgs();
  const initializeGasLimit = BigInt(process.env.KPEG_INITIALIZE_POOL_GAS_LIMIT ?? "800000");

  const router = await ethers.getContractAt("KPEGV4Router", deployment.router);
  const poolKey = await router.getPoolKey();
  const poolInitialized = await router.poolInitialized();
  const targetSqrtPriceX96 = encodeSqrtPriceX96FromKpegPerEth(args.priceKpegPerEth, deployment.tokenIsCurrency0);

  if (!poolInitialized) {
    await (await router.connect(deployer).initializePool(targetSqrtPriceX96, { gasLimit: initializeGasLimit })).wait();
  } else {
    const liveSqrtPriceX96 = await readPoolSqrtPriceX96(deployment.poolManager, {
      currency0: poolKey.currency0,
      currency1: poolKey.currency1,
      fee: poolKey.fee,
      tickSpacing: poolKey.tickSpacing,
      hooks: poolKey.hooks
    });
    if (liveSqrtPriceX96 !== targetSqrtPriceX96) {
      throw new Error(
        `Pool already initialized at a different price. Live sqrtPriceX96=${liveSqrtPriceX96.toString()} expected=${targetSqrtPriceX96.toString()}. If the first bootstrap attempt used the wrong tokenIsCurrency0 value, you must redeploy or reset the pool before retrying.`
      );
    }
  }

  const tickSpacing = Number(await router.tickSpacing());
  const { tickLower, tickUpper } =
    args.tickLower !== undefined && args.tickUpper !== undefined
      ? { tickLower: args.tickLower, tickUpper: args.tickUpper }
      : fullRangeTicks(tickSpacing);

  const addResult = await addLiquidityViaPositionManager({
    deployment,
    networkName: network.name,
    tokenLiquidity: args.tokenLiquidity,
    ethLiquidity: args.ethLiquidity,
    tickLower,
    tickUpper,
    deadline
  });

  console.log(
    JSON.stringify(
      {
        network: network.name,
        token: deployment.token,
        router: deployment.router,
        tickLower,
        tickUpper,
        priceKpegPerEth: args.priceKpegPerEth,
        tokenLiquidity: args.tokenLiquidity,
        ethLiquidity: args.ethLiquidity,
        txHash: addResult.txHash
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
