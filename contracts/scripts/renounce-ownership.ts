import { ethers, network } from "hardhat";
import { assertContractCode, readDeployment, retryRpc } from "./lib";
import {
  assertGatewayRenouncePreconditions,
  assertRouterRenouncePreconditions,
  assertTokenRenouncePreconditions,
  requireMarketFinalConfirmation
} from "./renounce-ownership-preflight";

const REQUIRED_CONFIRMATION = "I_UNDERSTAND_THIS_IS_IRREVERSIBLE";

type Target = "token" | "hook" | "router" | "market" | "gateway";

type OwnerContract = {
  owner: () => Promise<string>;
  interface: ethers.Interface;
};

type CliArgs = {
  includeGateway: boolean;
  allowPartial: boolean;
  confirm?: string;
  confirmMarketFinal?: string;
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

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(): CliArgs {
  const confirmMarketFinal = readOption("confirm-market-final");
  return {
    includeGateway: hasFlag("include-gateway"),
    allowPartial: hasFlag("allow-partial"),
    confirm: readOption("confirm"),
    confirmMarketFinal: confirmMarketFinal ?? (hasFlag("confirm-market-final") ? "1" : undefined)
  };
}

function requireLiveConfirmation(args: CliArgs): boolean {
  const isLive = network.name !== "localhost" && network.name !== "hardhat";
  if (!isLive) {
    return false;
  }
  const confirm = args.confirm ?? process.env.KPEG_CONFIRM_RENOUNCE_OWNERSHIP?.trim();
  if (confirm !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `Refusing to renounce on ${network.name}. Pass --confirm ${REQUIRED_CONFIRMATION} or set KPEG_CONFIRM_RENOUNCE_OWNERSHIP=${REQUIRED_CONFIRMATION}.`
    );
  }
  return true;
}

async function verifyOwnerOrHandleManual(
  target: Target,
  contractAddress: string,
  ownerAddress: string,
  signerAddress: string,
  calldata: string,
  allowPartial: boolean
): Promise<"skip" | "proceed"> {
  if (ownerAddress.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
    console.log(`${target}: already renounced at ${contractAddress}`);
    return "skip";
  }
  if (ownerAddress.toLowerCase() !== signerAddress.toLowerCase()) {
    console.log(`${target}: signer is not owner; manual tx required`);
    console.log(`  contract: ${contractAddress}`);
    console.log(`  owner:    ${ownerAddress}`);
    console.log(`  calldata: ${calldata}`);
    if (!allowPartial) {
      throw new Error(`Owner mismatch on ${target}. Re-run with --allow-partial to continue other targets.`);
    }
    return "skip";
  }
  return "proceed";
}

async function waitForSuccessfulReceipt(txHash: string, target: Target, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const receipt = await retryRpc(() => ethers.provider.getTransactionReceipt(txHash), {
      label: `${target}.renounce.receipt`
    });
    if (receipt) {
      if (receipt.status !== 1) {
        throw new Error(`${target} renounce transaction failed: ${txHash}`);
      }
      return receipt;
    }
    await sleep(2_000);
  }
  throw new Error(`${target} renounce transaction not confirmed after ${timeoutMs}ms: ${txHash}`);
}

async function readOwnerAtBlock(contract: OwnerContract, contractAddress: string, blockNumber: number): Promise<string> {
  const data = contract.interface.encodeFunctionData("owner");
  const result = await retryRpc(
    () =>
      ethers.provider.call(
        {
          to: contractAddress,
          data
        },
        blockNumber
      ),
    { label: `${contractAddress}.owner@${blockNumber}` }
  );
  const [owner] = contract.interface.decodeFunctionResult("owner", result) as [string];
  return owner;
}

async function verifyRenouncedOwner(
  target: Target,
  contract: OwnerContract,
  contractAddress: string,
  txHash: string
): Promise<void> {
  const receipt = await waitForSuccessfulReceipt(txHash, target);
  const deadline = Date.now() + 60_000;
  let lastOwner = "";

  while (Date.now() <= deadline) {
    const owner = await readOwnerAtBlock(contract, contractAddress, receipt.blockNumber);
    lastOwner = owner;
    if (owner.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
      return;
    }
    await sleep(2_000);
  }

  throw new Error(
    `${target} renounce verification failed after mined tx ${txHash} at block ${receipt.blockNumber}; owner=${lastOwner}`
  );
}

async function main() {
  const args = parseArgs();
  const isLive = requireLiveConfirmation(args);

  const [signer] = await ethers.getSigners();
  if (!signer) {
    throw new Error("KPEG_DEPLOYER_PRIVATE_KEY is required for this network");
  }
  const signerAddress = await signer.getAddress();
  const deployment = await readDeployment(network.name);

  const targets: Target[] = ["token", "hook", "router", "market"];
  if (args.includeGateway) {
    targets.push("gateway");
  }
  if (targets.length === 0) {
    throw new Error("No renounce targets selected.");
  }

  const token = await ethers.getContractAt("KPEGToken", deployment.token, signer);
  const hook = await ethers.getContractAt("KPEGHook", deployment.hook, signer);
  const router = await ethers.getContractAt("KPEGV4Router", deployment.router, signer);
  const market = await ethers.getContractAt("KPEGMarket", deployment.market, signer);
  const gatewayAddress = deployment.breedingContract;
  const gateway =
    args.includeGateway && gatewayAddress && ethers.isAddress(gatewayAddress)
      ? await ethers.getContractAt("KPEGBirthGateway", gatewayAddress, signer)
      : undefined;

  await assertContractCode(deployment.token, "KPEGToken");
  await assertContractCode(deployment.hook, "KPEGHook");
  await assertContractCode(deployment.router, "KPEGV4Router");
  await assertContractCode(deployment.market, "KPEGMarket");
  if (args.includeGateway && gatewayAddress && ethers.isAddress(gatewayAddress)) {
    await assertContractCode(gatewayAddress, "KPEGBirthGateway");
  }

  assertTokenRenouncePreconditions({
    started: await token.started(),
    tokenHook: await token.hook(),
    expectedHook: deployment.hook,
    deploymentBreedingContract: deployment.breedingContract,
    tokenBreedingContract: await token.breedingContract(),
    deploymentBreedingContractRuntimeCodeHash: deployment.breedingContractRuntimeCodeHash,
    tokenBreedingContractCodeHash: await token.breedingContractCodeHash()
  });
  if ((await hook.token()).toLowerCase() !== deployment.token.toLowerCase()) {
    throw new Error(`Preflight failed: hook.token mismatch. expected ${deployment.token}`);
  }
  const key = await router.getPoolKey();
  assertRouterRenouncePreconditions({
    poolInitialized: await router.poolInitialized(),
    currency0: String(key.currency0),
    currency1: String(key.currency1),
    deploymentToken: deployment.token,
    deploymentWeth: deployment.weth,
    poolHook: String(key.hooks),
    deploymentHook: deployment.hook,
    poolFee: Number(key.fee),
    deploymentFee: deployment.fee,
    poolTickSpacing: Number(key.tickSpacing),
    deploymentTickSpacing: deployment.tickSpacing
  });

  const feeRecipient = await market.feeRecipient();
  const feeBps = Number(await market.feeBps());
  console.log(`market current fee recipient: ${feeRecipient}`);
  console.log(`market current fee bps: ${feeBps}`);
  const marketFinal = args.confirmMarketFinal ?? process.env.KPEG_CONFIRM_MARKET_FINAL?.trim();
  requireMarketFinalConfirmation(marketFinal);

  const engineAddress = deployment.breedingEngine ?? deployment.breeding;
  assertGatewayRenouncePreconditions({
    gatewaySelected: targets.includes("gateway"),
    gatewayPresent: Boolean(gateway),
    authorizationsFrozen: gateway ? await gateway.authorizationsFrozen() : false,
    engineAddress,
    engineAuthorized: gateway && engineAddress ? await gateway.authorizedCallers(engineAddress) : false
  });

  console.log("Renounce preflight passed:");
  console.log(`  network: ${network.name}`);
  console.log(`  signer:  ${signerAddress}`);
  console.log(`  targets: ${targets.join(", ")}`);

  if (isLive) {
    console.log("  confirmation: live-network irreversible confirmation accepted");
  }

  const decisions = new Map<Target, "skip" | "proceed">();
  for (const target of targets) {
    if (target === "token") {
      const owner = await token.owner();
      const calldata = token.interface.encodeFunctionData("renounceOwnership");
      decisions.set(
        target,
        await verifyOwnerOrHandleManual(target, deployment.token, owner, signerAddress, calldata, args.allowPartial)
      );
      continue;
    }
    if (target === "hook") {
      const owner = await hook.owner();
      const calldata = hook.interface.encodeFunctionData("renounceOwnership");
      decisions.set(
        target,
        await verifyOwnerOrHandleManual(target, deployment.hook, owner, signerAddress, calldata, args.allowPartial)
      );
      continue;
    }
    if (target === "router") {
      const owner = await router.owner();
      const calldata = router.interface.encodeFunctionData("renounceOwnership");
      decisions.set(
        target,
        await verifyOwnerOrHandleManual(target, deployment.router, owner, signerAddress, calldata, args.allowPartial)
      );
      continue;
    }
    if (target === "market") {
      const owner = await market.owner();
      const calldata = market.interface.encodeFunctionData("renounceOwnership");
      decisions.set(
        target,
        await verifyOwnerOrHandleManual(target, deployment.market, owner, signerAddress, calldata, args.allowPartial)
      );
      continue;
    }
    if (target === "gateway") {
      if (!gateway || !gatewayAddress) {
        throw new Error("Gateway contract is missing.");
      }
      const owner = await gateway.owner();
      const calldata = gateway.interface.encodeFunctionData("renounceOwnership");
      decisions.set(
        target,
        await verifyOwnerOrHandleManual(target, gatewayAddress, owner, signerAddress, calldata, args.allowPartial)
      );
    }
  }

  let done = 0;
  for (const target of targets) {
    if (target === "token") {
      if (decisions.get(target) === "skip") continue;
      const tx = await token.renounceOwnership();
      await verifyRenouncedOwner(target, token, deployment.token, tx.hash);
      done += 1;
      console.log(`token renounced: ${deployment.token} tx=${tx.hash}`);
      continue;
    }

    if (target === "hook") {
      if (decisions.get(target) === "skip") continue;
      const tx = await hook.renounceOwnership();
      await verifyRenouncedOwner(target, hook, deployment.hook, tx.hash);
      done += 1;
      console.log(`hook renounced: ${deployment.hook} tx=${tx.hash}`);
      continue;
    }

    if (target === "router") {
      if (decisions.get(target) === "skip") continue;
      const tx = await router.renounceOwnership();
      await verifyRenouncedOwner(target, router, deployment.router, tx.hash);
      done += 1;
      console.log(`router renounced: ${deployment.router} tx=${tx.hash}`);
      continue;
    }

    if (target === "market") {
      if (decisions.get(target) === "skip") continue;
      const tx = await market.renounceOwnership();
      await verifyRenouncedOwner(target, market, deployment.market, tx.hash);
      done += 1;
      console.log(`market renounced: ${deployment.market} tx=${tx.hash}`);
      continue;
    }

    if (target === "gateway") {
      if (!gateway || !gatewayAddress) {
        throw new Error("Gateway contract is missing.");
      }
      if (decisions.get(target) === "skip") continue;
      const tx = await gateway.renounceOwnership();
      await verifyRenouncedOwner(target, gateway, gatewayAddress, tx.hash);
      done += 1;
      console.log(`gateway renounced: ${gatewayAddress} tx=${tx.hash}`);
    }
  }

  console.log(`renounce complete: ${done} target(s) updated`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
