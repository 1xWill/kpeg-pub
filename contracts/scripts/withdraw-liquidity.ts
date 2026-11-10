import { ethers, network } from "hardhat";
import { readDeployment } from "./lib";
import { removeLiquidityViaPositionManager } from "./liquidity-position";

type WithdrawLiquidityArgs = {
  tokenId: bigint;
  recipient?: string;
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
  return `KPEG_WITHDRAW_LIQUIDITY_${name.toUpperCase().replaceAll("-", "_")}`;
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

function readArgs(): WithdrawLiquidityArgs {
  const rawTokenId = requireValue("token-id");
  const tokenId = BigInt(rawTokenId);
  if (tokenId < 0n) {
    throw new Error("--token-id must be >= 0");
  }

  const recipient = readValue("recipient");
  if (recipient && !ethers.isAddress(recipient)) {
    throw new Error("--recipient must be a valid address");
  }

  return {
    tokenId,
    ...(recipient ? { recipient } : {})
  };
}

async function main() {
  const [signer] = await ethers.getSigners();
  const deployment = await readDeployment(network.name);
  const args = readArgs();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const removeResult = await removeLiquidityViaPositionManager({
    deployment,
    networkName: network.name,
    tokenId: args.tokenId,
    recipient: args.recipient,
    deadline
  });

  console.log(
    JSON.stringify(
      {
        wallet: await signer.getAddress(),
        network: network.name,
        token: deployment.token,
        router: deployment.router,
        tokenId: args.tokenId.toString(),
        recipient: removeResult.recipient,
        txHash: removeResult.txHash
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
