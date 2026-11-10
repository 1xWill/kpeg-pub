import { ethers, network } from "hardhat";
import { fullRangeTicks, readDeployment } from "./lib";
import { addLiquidityViaPositionManager } from "./liquidity-position";

type AddLiquidityArgs = {
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
  return `KPEG_ADD_LIQUIDITY_${name.toUpperCase().replaceAll("-", "_")}`;
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

function readArgs(): AddLiquidityArgs {
  const tickLower = readValue("tick-lower");
  const tickUpper = readValue("tick-upper");
  if ((tickLower && !tickUpper) || (!tickLower && tickUpper)) {
    throw new Error("--tick-lower and --tick-upper must be provided together");
  }

  return {
    tokenLiquidity: requireValue("token-liquidity"),
    ethLiquidity: requireValue("eth-liquidity"),
    ...(tickLower && tickUpper ? { tickLower: Number(tickLower), tickUpper: Number(tickUpper) } : {})
  };
}

async function main() {
  const [signer] = await ethers.getSigners();
  const wallet = await signer.getAddress();
  const deployment = await readDeployment(network.name);
  const args = readArgs();
  const token = await ethers.getContractAt(
    [
      "function balanceOf(address owner) view returns (uint256)",
      "function ownerKittiesLive(address owner) view returns (uint256)",
      "function notMintableAccount() view returns (address)"
    ],
    deployment.token,
    signer
  );
  const [balanceBefore, kittiesBefore, notMintableAccount] = await Promise.all([
    token.balanceOf(wallet),
    token.ownerKittiesLive(wallet),
    token.notMintableAccount()
  ]);
  const router = await ethers.getContractAt("KPEGV4Router", deployment.router);
  const isInitialized = await router.poolInitialized();
  if (!isInitialized) {
    throw new Error("Pool not initialized. Run bootstrap command first to initialize price.");
  }

  const tickSpacing = Number(await router.tickSpacing());
  const { tickLower, tickUpper } =
    args.tickLower !== undefined && args.tickUpper !== undefined
      ? { tickLower: args.tickLower, tickUpper: args.tickUpper }
      : fullRangeTicks(tickSpacing);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const addResult = await addLiquidityViaPositionManager({
    deployment,
    networkName: network.name,
    tokenLiquidity: args.tokenLiquidity,
    ethLiquidity: args.ethLiquidity,
    tickLower,
    tickUpper,
    deadline
  });
  const [balanceAfter, kittiesAfter] = await Promise.all([token.balanceOf(wallet), token.ownerKittiesLive(wallet)]);

  console.log(
    JSON.stringify(
      {
        wallet,
        network: network.name,
        token: deployment.token,
        router: deployment.router,
        tickLower,
        tickUpper,
        tokenLiquidity: args.tokenLiquidity,
        ethLiquidity: args.ethLiquidity,
        reserveWallet: wallet.toLowerCase() === notMintableAccount.toLowerCase(),
        balanceBefore: ethers.formatEther(balanceBefore),
        balanceAfter: ethers.formatEther(balanceAfter),
        balanceDelta: ethers.formatEther(balanceAfter - balanceBefore),
        ownerKittiesLiveBefore: kittiesBefore.toString(),
        ownerKittiesLiveAfter: kittiesAfter.toString(),
        lpTokenId: addResult.lpTokenId,
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
