import { ethers, network, run } from "hardhat";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readDeployment } from "./lib";
import type { DeploymentRecord } from "./lib";
import { explorerApiKeyEnvName } from "./verify-env";

const ART_SOURCE_MANIFEST = JSON.parse(
  readFileSync(resolve(__dirname, "../src/generated/artSourceManifest.json"), "utf8")
) as Record<string, { contractName: string; index: number }[][]>;

type VerificationTarget = {
  name: string;
  address: string | undefined;
  contract: string;
  constructorArguments: unknown[];
};

type VerificationSkip = {
  name: string;
  address: string;
  reason: string;
};

type ArtSourceGroupKey = keyof DeploymentRecord["artSources"];

function verifyApiKeyEnv(): void {
  if (!explorerApiKeyEnvName()) {
    throw new Error(
      "Missing explorer API key. Set ETHERSCAN_API_KEY in root .env or shell env. BASESCAN_API_KEY is accepted as an alias, but the value must be an Etherscan v2 API key."
    );
  }
}

function artSourceTargets(deployment: DeploymentRecord): VerificationTarget[] {
  const byAddress = new Map<string, { address: string; contractName: string }>();
  for (const [groupKey, manifestGroup] of Object.entries(ART_SOURCE_MANIFEST) as [ArtSourceGroupKey, { contractName: string; index: number }[][]][]) {
    const deployedGroup = deployment.artSources[groupKey];
    if (!deployedGroup || deployedGroup.length !== manifestGroup.length) {
      throw new Error(`Art source manifest mismatch for ${groupKey}`);
    }

    for (let layerIndex = 0; layerIndex < manifestGroup.length; layerIndex += 1) {
      const manifestLayer = manifestGroup[layerIndex];
      const deployedLayer = deployedGroup[layerIndex];
      if (!deployedLayer || deployedLayer.length !== manifestLayer.length) {
        throw new Error(`Art source layer mismatch for ${groupKey}[${layerIndex}]`);
      }

      for (let pieceIndex = 0; pieceIndex < manifestLayer.length; pieceIndex += 1) {
        const manifestRef = manifestLayer[pieceIndex];
        const deployedRef = deployedLayer[pieceIndex];
        if (!manifestRef || !deployedRef || manifestRef.index !== deployedRef.index) {
          throw new Error(`Art source ref mismatch for ${groupKey}[${layerIndex}][${pieceIndex}]`);
        }

        const key = deployedRef.source.toLowerCase();
        const previous = byAddress.get(key);
        if (previous && previous.contractName !== manifestRef.contractName) {
          throw new Error(`Art source address ${deployedRef.source} maps to both ${previous.contractName} and ${manifestRef.contractName}`);
        }
        byAddress.set(key, { address: deployedRef.source, contractName: manifestRef.contractName });
      }
    }
  }

  return [...byAddress.values()]
    .sort((left, right) => left.contractName.localeCompare(right.contractName, undefined, { numeric: true }))
    .map(({ address, contractName }) => ({
      name: contractName,
      address,
      contract: `src/generated/${contractName}.sol:${contractName}`,
      constructorArguments: []
    }));
}

function targetList(deployment: DeploymentRecord): VerificationTarget[] {
  const deployer = deployment.deployer;
  const gateway = deployment.breedingGateway;
  const breedingEngine = deployment.breeding ?? deployment.breedingEngine;
  const targets: VerificationTarget[] = [
    {
      name: "KPEGRenderer",
      address: deployment.renderer,
      contract: "src/KPEGRenderer.sol:KPEGRenderer",
      constructorArguments: [
        deployment.artSources.backgrounds,
        deployment.artSources.breeds,
        deployment.artSources.clothes,
        deployment.artSources.moods,
        deployment.artSources.marks,
        deployment.artSources.mouths,
        deployment.artSources.eyes,
        deployment.artSources.accessories
      ]
    },
    {
      name: "KPEGToken",
      address: deployment.token,
      contract: "src/KPEGToken.sol:KPEGToken",
      constructorArguments: [deployer, deployment.renderer]
    },
    {
      name: "KPEGMarket",
      address: deployment.market,
      contract: "src/KPEGMarket.sol:KPEGMarket",
      constructorArguments: [deployment.token, deployer]
    },
    {
      name: "Create2Deployer",
      address: deployment.hookDeployer,
      contract: "src/Create2Deployer.sol:Create2Deployer",
      constructorArguments: []
    },
    {
      name: "KPEGHook",
      address: deployment.hook,
      contract: "src/KPEGHook.sol:KPEGHook",
      constructorArguments: [deployment.poolManager, deployer]
    },
    {
      name: "KPEGV4Router",
      address: deployment.router,
      contract: "src/KPEGV4Router.sol:KPEGV4Router",
      constructorArguments: [
        deployment.poolManager,
        deployer,
        deployment.token,
        deployment.weth,
        deployment.hook,
        deployment.fee,
        deployment.tickSpacing
      ]
    },
    {
      name: "KPEGV4Quoter",
      address: deployment.quoter,
      contract: "src/KPEGV4Quoter.sol:KPEGV4Quoter",
      constructorArguments: [deployment.poolManager]
    },
    {
      name: "OwnedCreate2Deployer",
      address: deployment.breedingCreate2?.deployer,
      contract: "src/OwnedCreate2Deployer.sol:OwnedCreate2Deployer",
      constructorArguments: [deployer]
    },
    {
      name: "KPEGBirthGateway",
      address: deployment.breedingContract,
      contract: "src/KPEGBirthGateway.sol:KPEGBirthGateway",
      constructorArguments: gateway ? [gateway.owner, gateway.token, gateway.initialAuthorizedCaller] : []
    },
    {
      name: "KPEGBreeding",
      address: breedingEngine,
      contract: "src/KPEGBreeding.sol:KPEGBreeding",
      constructorArguments: breedingEngine ? [deployment.token, deployment.breedingContract, deployment.hook, deployer] : []
    }
  ];

  return [...artSourceTargets(deployment), ...targets].filter((target) => target.address);
}

export async function partitionVerificationTargets(
  targets: VerificationTarget[],
  getCode: (address: string) => Promise<string> = async (address) => ethers.provider.getCode(address)
): Promise<{ ready: VerificationTarget[]; skipped: VerificationSkip[] }> {
  const ready: VerificationTarget[] = [];
  const skipped: VerificationSkip[] = [];

  for (const target of targets) {
    const address = target.address;
    if (!address) {
      continue;
    }

    const code = await getCode(address);
    if (code === "0x") {
      skipped.push({
        name: target.name,
        address,
        reason: "no deployed bytecode yet"
      });
      continue;
    }

    ready.push(target);
  }

  return { ready, skipped };
}

async function verifyTarget(target: VerificationTarget): Promise<void> {
  console.log(`Verifying ${target.name}: ${target.address}`);
  try {
    await run("verify:verify", {
      address: target.address,
      contract: target.contract,
      constructorArguments: target.constructorArguments
    });
    console.log(`Verified ${target.name}: ${target.address}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("already been verified")) {
      console.log(`Already verified ${target.name}: ${target.address}`);
      return;
    }
    throw error;
  }
}

export async function main(): Promise<void> {
  if (network.name !== "baseMainnet" && network.name !== "baseSepolia") {
    throw new Error(`Unsupported verify network: ${network.name}`);
  }
  const deployment = await readDeployment(network.name);
  const targets = targetList(deployment);
  const { ready, skipped } = await partitionVerificationTargets(targets);
  if (process.env.KPEG_VERIFY_DRY_RUN === "1") {
    console.log(JSON.stringify(ready.map(({ name, address, contract }) => ({ name, address, contract })), null, 2));
    if (skipped.length > 0) {
      console.log(JSON.stringify({ skipped }, null, 2));
    }
    return;
  }
  verifyApiKeyEnv();
  for (const target of ready) {
    await verifyTarget(target);
  }
  for (const skippedTarget of skipped) {
    console.log(`Skipping ${skippedTarget.name}: ${skippedTarget.address} (${skippedTarget.reason})`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
