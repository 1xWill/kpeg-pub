import { ethers, network } from "hardhat";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertContractCode,
  assertPositionManagerBinding,
  checkpointFileFor,
  liveNetworkInfra,
  mineHookDeployment,
  readCheckpoint,
  removeCheckpoint,
  retryRpc,
  waitForContractCode,
  writeCheckpoint,
  writeDeployment
} from "./lib";
import type { ArtSourceRef } from "./lib";

const ART_SOURCE_MANIFEST = JSON.parse(
  readFileSync(resolve(__dirname, "../src/generated/artSourceManifest.json"), "utf8")
) as Record<string, { contractName: string; index: number }[][]>;

function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function envOptional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function assertBytes32(value: string, label: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a bytes32 hex string`);
  }
}

type BreedingAuthorizationPlan = {
  create2Deployer?: string;
  salt: string;
  initCodeHash: string;
  runtimeCodeHash: string;
};

type DeployCheckpoint = {
  network: string;
  chainId: number;
  deployer: string;
  fee: number;
  tickSpacing: number;
  poolManager?: string;
  weth?: string;
  positionManager?: string;
  permit2?: string;
  positionDescriptor?: string;
  artSourceContracts?: Record<string, string>;
  pendingTxs?: Record<string, string>;
  artSources?: {
    backgrounds?: ArtSourceRef[][];
    breeds?: ArtSourceRef[][];
    clothes?: ArtSourceRef[][];
    moods?: ArtSourceRef[][];
    marks?: ArtSourceRef[][];
    mouths?: ArtSourceRef[][];
    eyes?: ArtSourceRef[][];
    accessories?: ArtSourceRef[][];
  };
  renderer?: string;
  breedingContract?: string;
  breedingContractRuntimeCodeHash?: string;
  breedingCreate2?: {
    deployer?: string;
    salt: string;
    initCodeHash: string;
  };
  breedingAuthSet?: boolean;
  token?: string;
  tokenDeploymentBlock?: number;
  market?: string;
  hookDeployer?: string;
  hook?: string;
  hookSalt?: string;
  tokenHookSet?: boolean;
  hookTokenSet?: boolean;
  router?: string;
  quoter?: string;
  tokenIsCurrency0?: boolean;
  deployedAt?: string;
};

type ArtSourceGroupKey = keyof NonNullable<DeployCheckpoint["artSources"]>;

function readBreedingAuthorizationPlan(): BreedingAuthorizationPlan | undefined {
  const legacyAddress = envOptional("KPEG_BREEDING_CONTRACT_ADDRESS");
  if (legacyAddress) {
    throw new Error(
      "KPEG_BREEDING_CONTRACT_ADDRESS is no longer accepted. Use KPEG_BREEDING_CREATE2_SALT, KPEG_BREEDING_INIT_CODE_HASH, and KPEG_BREEDING_RUNTIME_CODE_HASH."
    );
  }

  const create2Deployer = envOptional("KPEG_BREEDING_CREATE2_DEPLOYER_ADDRESS");
  const salt = envOptional("KPEG_BREEDING_CREATE2_SALT");
  const initCodeHash = envOptional("KPEG_BREEDING_INIT_CODE_HASH");
  const runtimeCodeHash = envOptional("KPEG_BREEDING_RUNTIME_CODE_HASH");
  const provided = [create2Deployer, salt, initCodeHash, runtimeCodeHash].filter(Boolean).length;
  if (provided === 0) {
    return undefined;
  }

  if (!salt || !initCodeHash || !runtimeCodeHash) {
    throw new Error(
      "Breeding authorization requires KPEG_BREEDING_CREATE2_SALT, KPEG_BREEDING_INIT_CODE_HASH, and KPEG_BREEDING_RUNTIME_CODE_HASH."
    );
  }
  if (create2Deployer && !ethers.isAddress(create2Deployer)) {
    throw new Error("KPEG_BREEDING_CREATE2_DEPLOYER_ADDRESS must be a valid address");
  }
  assertBytes32(salt, "KPEG_BREEDING_CREATE2_SALT");
  assertBytes32(initCodeHash, "KPEG_BREEDING_INIT_CODE_HASH");
  assertBytes32(runtimeCodeHash, "KPEG_BREEDING_RUNTIME_CODE_HASH");

  return { create2Deployer, salt, initCodeHash, runtimeCodeHash };
}

async function getOwnedCreate2DeployerOwner(address: string): Promise<string> {
  await assertContractCode(address, "KPEG_BREEDING_CREATE2_DEPLOYER_ADDRESS");
  const ownedCreate2 = await ethers.getContractAt(["function owner() view returns (address)"], address);
  return ownedCreate2.owner();
}

function sameAddress(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function requireCheckpointNumber(value: number | undefined, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} is missing from deploy checkpoint.`);
  }
  return value;
}

async function ensureCheckpointContract(address: string | undefined, label: string): Promise<string | undefined> {
  if (!address) {
    return undefined;
  }
  await assertContractCode(address, label);
  return address;
}

async function checkpointCanResume(checkpoint: DeployCheckpoint, deployerAddress: string, fee: number, tickSpacing: number): Promise<boolean> {
  if (checkpoint.network !== network.name) {
    console.log(`Ignoring checkpoint for ${checkpoint.network}; current network is ${network.name}`);
    return false;
  }
  if (Number(network.config.chainId ?? 0) !== checkpoint.chainId) {
    console.log(`Ignoring checkpoint with chainId ${checkpoint.chainId}; current chainId is ${network.config.chainId}`);
    return false;
  }
  if (checkpoint.deployer.toLowerCase() !== deployerAddress.toLowerCase()) {
    console.log(`Ignoring checkpoint for deployer ${checkpoint.deployer}; current deployer is ${deployerAddress}`);
    return false;
  }
  if (checkpoint.fee !== fee || checkpoint.tickSpacing !== tickSpacing) {
    console.log("Ignoring checkpoint because fee/tickSpacing changed.");
    return false;
  }
  return true;
}

async function loadDeployCheckpoint(deployerAddress: string, fee: number, tickSpacing: number): Promise<DeployCheckpoint> {
  const loaded = await readCheckpoint<DeployCheckpoint>(network.name);
  if (loaded && network.name === "hardhat") {
    console.log("Ignoring hardhat deploy checkpoint because the in-process hardhat network is ephemeral.");
  } else if (loaded && (await checkpointCanResume(loaded, deployerAddress, fee, tickSpacing))) {
    console.log(`Resuming deploy checkpoint: ${checkpointFileFor(network.name)}`);
    return loaded;
  }
  if (loaded && network.name !== "hardhat") {
    console.log("Existing deploy checkpoint is not compatible; starting a new checkpoint.");
  }
  const checkpoint: DeployCheckpoint = {
    network: network.name,
    chainId: Number(network.config.chainId ?? 0),
    deployer: deployerAddress,
    fee,
    tickSpacing,
    deployedAt: new Date().toISOString()
  };
  await writeCheckpoint(network.name, checkpoint);
  return checkpoint;
}

async function saveDeployCheckpoint(checkpoint: DeployCheckpoint): Promise<void> {
  checkpoint.deployedAt = new Date().toISOString();
  await writeCheckpoint(network.name, checkpoint);
}

async function waitForReceipt(hash: string, label: string, timeoutMs = 180_000): Promise<Awaited<ReturnType<typeof ethers.provider.getTransactionReceipt>>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const receipt = await retryRpc(() => ethers.provider.getTransactionReceipt(hash), { label: `${label}.receipt` });
    if (receipt) {
      if (receipt.status !== 1) {
        throw new Error(`${label} transaction failed: ${hash}`);
      }
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`${label} transaction not confirmed after ${timeoutMs}ms: ${hash}`);
}

async function waitForReceiptOutcome(
  hash: string,
  label: string,
  timeoutMs = 180_000
): Promise<Awaited<ReturnType<typeof ethers.provider.getTransactionReceipt>> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const receipt = await retryRpc(() => ethers.provider.getTransactionReceipt(hash), { label: `${label}.receipt` });
    if (receipt) {
      return receipt.status === 1 ? receipt : null;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`${label} transaction not confirmed after ${timeoutMs}ms: ${hash}`);
}

async function waitForCheckpointedTx(
  checkpoint: DeployCheckpoint,
  key: string,
  label: string,
  timeoutMs = 180_000
): Promise<void> {
  const pendingHash = checkpoint.pendingTxs?.[key];
  if (!pendingHash) {
    return;
  }
  await waitForReceipt(pendingHash, label, timeoutMs);
  delete checkpoint.pendingTxs?.[key];
  await saveDeployCheckpoint(checkpoint);
}

async function resumeCheckpointedContract(
  checkpoint: DeployCheckpoint,
  address: string | undefined,
  pendingKey: string,
  label: string
): Promise<string | undefined> {
  if (!address) {
    return undefined;
  }
  const code = await retryRpc(() => ethers.provider.getCode(address), { label: `${label}.checkpointCode` });
  if (code !== "0x") {
    if (checkpoint.pendingTxs?.[pendingKey]) {
      delete checkpoint.pendingTxs[pendingKey];
      await saveDeployCheckpoint(checkpoint);
    }
    return address;
  }
  const pendingHash = checkpoint.pendingTxs?.[pendingKey];
  if (!pendingHash) {
    throw new Error(`${label} checkpoint has no code and no pending tx hash at ${address}`);
  }
  console.log(`${label} waiting for checkpointed tx: ${pendingHash}`);
  const receipt = await waitForReceipt(pendingHash, label);
  if (receipt.contractAddress && receipt.contractAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`${label} checkpoint address mismatch: expected ${address}, got ${receipt.contractAddress}`);
  }
  await waitForContractCode(address, label);
  delete checkpoint.pendingTxs?.[pendingKey];
  await saveDeployCheckpoint(checkpoint);
  return address;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("KPEG_DEPLOYER_PRIVATE_KEY is required for this network");
  }

  const fee = Number(process.env.KPEG_POOL_FEE ?? 3000);
  const tickSpacing = Number(process.env.KPEG_POOL_TICK_SPACING ?? 60);
  const artSourceDeployGasLimit = process.env.KPEG_ART_SOURCE_DEPLOY_GAS_LIMIT
    ? BigInt(process.env.KPEG_ART_SOURCE_DEPLOY_GAS_LIMIT)
    : BigInt("12000000");
  const rendererDeployGasLimit = BigInt(process.env.KPEG_RENDERER_DEPLOY_GAS_LIMIT ?? "12000000");
  const tokenDeployGasLimit = BigInt(process.env.KPEG_TOKEN_DEPLOY_GAS_LIMIT ?? "6000000");
  const marketDeployGasLimit = BigInt(process.env.KPEG_MARKET_DEPLOY_GAS_LIMIT ?? "5000000");
  const create2DeployGasLimit = BigInt(process.env.KPEG_CREATE2_DEPLOY_GAS_LIMIT ?? "1000000");
  const routerDeployGasLimit = BigInt(process.env.KPEG_ROUTER_DEPLOY_GAS_LIMIT ?? "5000000");
  const quoterDeployGasLimit = BigInt(process.env.KPEG_QUOTER_DEPLOY_GAS_LIMIT ?? "2000000");
  const hookDeployGasLimit = BigInt(process.env.KPEG_HOOK_DEPLOY_GAS_LIMIT ?? "8000000");
  const linkGasLimit = BigInt(process.env.KPEG_LINK_GAS_LIMIT ?? "200000");
  const breedingAuthorizationPlan = readBreedingAuthorizationPlan();
  const checkpoint = await loadDeployCheckpoint(deployer.address, fee, tickSpacing);

  const isLocal = network.name === "localhost" || network.name === "hardhat";
  const liveDefaults = liveNetworkInfra(network.name);

  let poolManagerAddress: string;
  let wethAddress: string;
  let positionManagerAddress: string;
  let permit2Address: string;
  let positionDescriptorAddress = "";

  if (isLocal) {
    const checkpointPoolManager = await ensureCheckpointContract(checkpoint.poolManager, "LocalPoolManager");
    if (checkpointPoolManager) {
      poolManagerAddress = checkpointPoolManager;
      console.log(`LocalPoolManager reused from checkpoint: ${poolManagerAddress}`);
    } else {
      const PoolManagerFactory = await ethers.getContractFactory("LocalPoolManager");
      const poolManager = await PoolManagerFactory.deploy(deployer.address);
      await poolManager.waitForDeployment();
      poolManagerAddress = await poolManager.getAddress();
      await waitForContractCode(poolManagerAddress, "LocalPoolManager");
      checkpoint.poolManager = poolManagerAddress;
      await saveDeployCheckpoint(checkpoint);
    }

    const checkpointWeth = await ensureCheckpointContract(checkpoint.weth, "MockWETH");
    if (checkpointWeth) {
      wethAddress = checkpointWeth;
      console.log(`MockWETH reused from checkpoint: ${wethAddress}`);
    } else {
      const WethFactory = await ethers.getContractFactory("MockWETH");
      const weth = await WethFactory.deploy();
      await weth.waitForDeployment();
      wethAddress = await weth.getAddress();
      await waitForContractCode(wethAddress, "MockWETH");
      checkpoint.weth = wethAddress;
      await saveDeployCheckpoint(checkpoint);
    }

    const checkpointPermit2 = await ensureCheckpointContract(checkpoint.permit2, "Permit2Anchor");
    if (checkpointPermit2) {
      permit2Address = checkpointPermit2;
      console.log(`Permit2Anchor reused from checkpoint: ${permit2Address}`);
    } else {
      const Permit2Factory = await ethers.getContractFactory("Permit2Anchor");
      const permit2 = await Permit2Factory.deploy();
      await permit2.waitForDeployment();
      permit2Address = await permit2.getAddress();
      await waitForContractCode(permit2Address, "Permit2Anchor");
      checkpoint.permit2 = permit2Address;
      await saveDeployCheckpoint(checkpoint);
    }

    const checkpointPositionDescriptor = await ensureCheckpointContract(checkpoint.positionDescriptor, "MockPositionDescriptor");
    if (checkpointPositionDescriptor) {
      positionDescriptorAddress = checkpointPositionDescriptor;
      console.log(`MockPositionDescriptor reused from checkpoint: ${positionDescriptorAddress}`);
    } else {
      const PositionDescriptorFactory = await ethers.getContractFactory("MockPositionDescriptor");
      const positionDescriptor = await PositionDescriptorFactory.deploy(
        poolManagerAddress,
        wethAddress,
        "ETH"
      );
      await positionDescriptor.waitForDeployment();
      positionDescriptorAddress = await positionDescriptor.getAddress();
      await waitForContractCode(positionDescriptorAddress, "MockPositionDescriptor");
      checkpoint.positionDescriptor = positionDescriptorAddress;
      await saveDeployCheckpoint(checkpoint);
    }

    const checkpointPositionManager = await ensureCheckpointContract(checkpoint.positionManager, "PositionManager");
    if (checkpointPositionManager) {
      positionManagerAddress = checkpointPositionManager;
      await assertPositionManagerBinding(positionManagerAddress, poolManagerAddress, permit2Address);
      console.log(`PositionManager reused from checkpoint: ${positionManagerAddress}`);
    } else {
      const PositionManagerFactory = await ethers.getContractFactory(
        "@uniswap/v4-periphery/src/PositionManager.sol:PositionManager"
      );
      const unsubscribeGasLimit = BigInt(process.env.KPEG_POSITION_UNSUBSCRIBE_GAS_LIMIT ?? "100000");
      const positionManager = await PositionManagerFactory.deploy(
        poolManagerAddress,
        permit2Address,
        unsubscribeGasLimit,
        positionDescriptorAddress,
        wethAddress
      );
      await positionManager.waitForDeployment();
      positionManagerAddress = await positionManager.getAddress();
      await waitForContractCode(positionManagerAddress, "PositionManager");
      checkpoint.positionManager = positionManagerAddress;
      await saveDeployCheckpoint(checkpoint);
    }
  } else {
    if (!liveDefaults) {
      throw new Error(`Unsupported live network: ${network.name}`);
    }
    poolManagerAddress = envOrDefault("KPEG_POOL_MANAGER_ADDRESS", liveDefaults.poolManager);
    wethAddress = envOrDefault("KPEG_WETH_ADDRESS", liveDefaults.weth);
    positionManagerAddress = envOrDefault("KPEG_POSITION_MANAGER_ADDRESS", liveDefaults.positionManager);
    permit2Address = envOrDefault("KPEG_PERMIT2_ADDRESS", liveDefaults.permit2);

    await assertContractCode(poolManagerAddress, "PoolManager");
    await assertContractCode(wethAddress, "WETH");
    await assertContractCode(permit2Address, "Permit2");
    await assertPositionManagerBinding(positionManagerAddress, poolManagerAddress, permit2Address);
    checkpoint.poolManager = poolManagerAddress;
    checkpoint.weth = wethAddress;
    checkpoint.positionManager = positionManagerAddress;
    checkpoint.permit2 = permit2Address;
    await saveDeployCheckpoint(checkpoint);
  }

  checkpoint.artSources = checkpoint.artSources ?? {};
  checkpoint.artSourceContracts = checkpoint.artSourceContracts ?? {};
  const deployedSources = new Map<string, string>(Object.entries(checkpoint.artSourceContracts));

  async function deployOrResumeArtSource(contractName: string): Promise<string> {
    const existingAddress = deployedSources.get(contractName);
    if (existingAddress) {
      const code = await retryRpc(() => ethers.provider.getCode(existingAddress), {
        label: `${contractName}.checkpointCode`
      });
      if (code !== "0x") {
        return existingAddress;
      }

      const pendingHash = checkpoint.pendingTxs?.[`artSource:${contractName}`];
      if (!pendingHash) {
        throw new Error(`${contractName} checkpoint has no code and no pending tx hash at ${existingAddress}`);
      }
      const receipt = await waitForReceiptOutcome(pendingHash, contractName);
      if (!receipt) {
        delete checkpoint.pendingTxs?.[`artSource:${contractName}`];
        delete checkpoint.artSourceContracts?.[contractName];
        await saveDeployCheckpoint(checkpoint);
        return deployOrResumeArtSource(contractName);
      }
      await waitForContractCode(existingAddress, contractName);
      delete checkpoint.pendingTxs?.[`artSource:${contractName}`];
      await saveDeployCheckpoint(checkpoint);
      return existingAddress;
    }

    const Factory = await ethers.getContractFactory(contractName);
    const contract = await Factory.deploy({ gasLimit: artSourceDeployGasLimit });
    const tx = contract.deploymentTransaction();
    if (!tx) {
      throw new Error(`${contractName} deployment transaction is unavailable`);
    }
    const address = await contract.getAddress();
    console.log(`    deploying ${contractName}`);
    deployedSources.set(contractName, address);
    checkpoint.artSourceContracts[contractName] = address;
    checkpoint.pendingTxs = { ...(checkpoint.pendingTxs ?? {}), [`artSource:${contractName}`]: tx.hash };
    await saveDeployCheckpoint(checkpoint);
    await waitForReceipt(tx.hash, contractName);
    await waitForContractCode(address, contractName);
    delete checkpoint.pendingTxs[`artSource:${contractName}`];
    await saveDeployCheckpoint(checkpoint);
    return address;
  }

  const materializeArtSourceGroup = async (
    groupKey: ArtSourceGroupKey,
    checkpointGroup?: ArtSourceRef[][]
  ): Promise<ArtSourceRef[][]> => {
    const group = ART_SOURCE_MANIFEST[groupKey];
    if (!group) {
      throw new Error(`Missing art source manifest group: ${groupKey}`);
    }
    if (checkpointGroup) {
      return checkpointGroup;
    }

    let canHydrateFromContracts = true;
    const hydratedGroup: ArtSourceRef[][] = [];
    for (const layer of group) {
      const pieces: ArtSourceRef[] = [];
      for (const { contractName, index } of layer) {
        const source = deployedSources.get(contractName);
        if (!source) {
          canHydrateFromContracts = false;
          break;
        }
        const code = await retryRpc(() => ethers.provider.getCode(source), {
          label: `${contractName}.hydrateCode`
        });
        if (code === "0x") {
          canHydrateFromContracts = false;
          break;
        }
        pieces.push({ source, index });
      }
      if (!canHydrateFromContracts) {
        break;
      }
      hydratedGroup.push(pieces);
    }
    if (canHydrateFromContracts) {
      checkpoint.artSources = { ...(checkpoint.artSources ?? {}), [groupKey]: hydratedGroup };
      await saveDeployCheckpoint(checkpoint);
      console.log(`Reused art sources for ${groupKey}: ${group.length} layer(s)`);
      return hydratedGroup;
    }

    const layerAddresses: ArtSourceRef[][] = [];
    console.log(`Deploying art sources for ${groupKey}: ${group.length} layer(s)`);
    for (let layerIndex = 0; layerIndex < group.length; layerIndex += 1) {
      const layer = group[layerIndex];
      console.log(`  ${groupKey} layer ${layerIndex + 1}/${group.length}: ${layer.length} source ref(s)`);
      const pieces: ArtSourceRef[] = [];
      for (let pieceIndex = 0; pieceIndex < layer.length; pieceIndex += 1) {
        const { contractName, index } = layer[pieceIndex];
        const source = await deployOrResumeArtSource(contractName);
        pieces.push({ source, index });
      }
      layerAddresses.push(pieces);
    }
    checkpoint.artSources = { ...(checkpoint.artSources ?? {}), [groupKey]: layerAddresses };
    await saveDeployCheckpoint(checkpoint);
    return layerAddresses;
  };

  const backgrounds = await materializeArtSourceGroup("backgrounds", checkpoint.artSources?.backgrounds);
  const breeds = await materializeArtSourceGroup("breeds", checkpoint.artSources?.breeds);
  const clothes = await materializeArtSourceGroup("clothes", checkpoint.artSources?.clothes);
  const moods = await materializeArtSourceGroup("moods", checkpoint.artSources?.moods);
  const marks = await materializeArtSourceGroup("marks", checkpoint.artSources?.marks);
  const mouths = await materializeArtSourceGroup("mouths", checkpoint.artSources?.mouths);
  const eyes = await materializeArtSourceGroup("eyes", checkpoint.artSources?.eyes);
  const accessories = await materializeArtSourceGroup("accessories", checkpoint.artSources?.accessories);

  const RendererFactory = await ethers.getContractFactory("KPEGRenderer");
  let rendererAddress = await resumeCheckpointedContract(checkpoint, checkpoint.renderer, "renderer", "KPEGRenderer");
  if (rendererAddress) {
    console.log(`KPEGRenderer reused from checkpoint: ${rendererAddress}`);
  } else {
    const renderer = await RendererFactory.deploy(
      backgrounds,
      breeds,
      clothes,
      moods,
      marks,
      mouths,
      eyes,
      accessories,
      { gasLimit: rendererDeployGasLimit }
    );
    checkpoint.renderer = await renderer.getAddress();
    checkpoint.artSources = { backgrounds, breeds, clothes, moods, marks, mouths, eyes, accessories };
    const rendererTx = renderer.deploymentTransaction();
    if (!rendererTx) {
      throw new Error("KPEGRenderer deployment transaction is unavailable");
    }
    checkpoint.pendingTxs = { ...(checkpoint.pendingTxs ?? {}), renderer: rendererTx.hash };
    await saveDeployCheckpoint(checkpoint);
    await waitForReceipt(rendererTx.hash, "KPEGRenderer");
    rendererAddress = await renderer.getAddress();
    await waitForContractCode(rendererAddress, "KPEGRenderer");
    delete checkpoint.pendingTxs.renderer;
    await saveDeployCheckpoint(checkpoint);
    console.log(`KPEGRenderer deployed: ${rendererAddress}`);
  }

  let breedingContractAddress: string | undefined;
  let breedingCreate2DeployerAddress: string | undefined;
  if (breedingAuthorizationPlan) {
    if (breedingAuthorizationPlan.create2Deployer) {
      breedingCreate2DeployerAddress = breedingAuthorizationPlan.create2Deployer;
      const create2Owner = await getOwnedCreate2DeployerOwner(breedingCreate2DeployerAddress);
      console.log(`OwnedCreate2Deployer owner: ${create2Owner}`);
    } else {
      const OwnedCreate2Factory = await ethers.getContractFactory("OwnedCreate2Deployer");
      const ownedCreate2 = await OwnedCreate2Factory.deploy(deployer.address, { gasLimit: create2DeployGasLimit });
      const ownedCreate2Address = await ownedCreate2.getAddress();
      const ownedCreate2Tx = ownedCreate2.deploymentTransaction();
      if (!ownedCreate2Tx) {
        throw new Error("OwnedCreate2Deployer deployment transaction is unavailable");
      }
      checkpoint.pendingTxs = { ...(checkpoint.pendingTxs ?? {}), breedingCreate2Deployer: ownedCreate2Tx.hash };
      checkpoint.breedingCreate2 = {
        ...(checkpoint.breedingCreate2 ?? { salt: breedingAuthorizationPlan.salt, initCodeHash: breedingAuthorizationPlan.initCodeHash }),
        deployer: ownedCreate2Address,
        salt: breedingAuthorizationPlan.salt,
        initCodeHash: breedingAuthorizationPlan.initCodeHash
      };
      await saveDeployCheckpoint(checkpoint);
      await waitForReceipt(ownedCreate2Tx.hash, "OwnedCreate2Deployer");
      await waitForContractCode(ownedCreate2Address, "OwnedCreate2Deployer");
      delete checkpoint.pendingTxs.breedingCreate2Deployer;
      await saveDeployCheckpoint(checkpoint);
      breedingCreate2DeployerAddress = ownedCreate2Address;
      console.log(`OwnedCreate2Deployer deployed for breeding: ${breedingCreate2DeployerAddress}`);
    }
    breedingContractAddress = ethers.getCreate2Address(
      breedingCreate2DeployerAddress,
      breedingAuthorizationPlan.salt,
      breedingAuthorizationPlan.initCodeHash
    );
    const existingBreedingCode = await ethers.provider.getCode(breedingContractAddress);
    if (existingBreedingCode !== "0x") {
      const existingRuntimeHash = ethers.keccak256(existingBreedingCode as `0x${string}`);
      if (existingRuntimeHash.toLowerCase() !== breedingAuthorizationPlan.runtimeCodeHash.toLowerCase()) {
        throw new Error(
          `Breeding contract code hash mismatch at ${breedingContractAddress}: expected ${breedingAuthorizationPlan.runtimeCodeHash}, got ${existingRuntimeHash}`
        );
      }
    }
    checkpoint.breedingCreate2 = {
      deployer: breedingCreate2DeployerAddress,
      salt: breedingAuthorizationPlan.salt,
      initCodeHash: breedingAuthorizationPlan.initCodeHash
    };
    checkpoint.breedingContract = breedingContractAddress;
    checkpoint.breedingContractRuntimeCodeHash = breedingAuthorizationPlan.runtimeCodeHash;
    await saveDeployCheckpoint(checkpoint);
    console.log(`KPEGToken breeding CREATE2 address: ${breedingContractAddress}`);
  }

  const TokenFactory = await ethers.getContractFactory("KPEGToken");
  let tokenAddress = await resumeCheckpointedContract(checkpoint, checkpoint.token, "token", "KPEGToken");
  let tokenDeploymentBlock = checkpoint.tokenDeploymentBlock ?? 0;
  if (tokenAddress) {
    tokenDeploymentBlock = requireCheckpointNumber(checkpoint.tokenDeploymentBlock, "KPEGToken deployment block");
    console.log(`KPEGToken reused from checkpoint: ${tokenAddress}`);
  } else {
    const token = await TokenFactory.deploy(deployer.address, rendererAddress, { gasLimit: tokenDeployGasLimit });
    tokenAddress = await token.getAddress();
    const tokenDeploymentTx = token.deploymentTransaction();
    if (!tokenDeploymentTx) {
      throw new Error("KPEGToken deployment transaction is unavailable");
    }
    checkpoint.token = tokenAddress;
    checkpoint.pendingTxs = { ...(checkpoint.pendingTxs ?? {}), token: tokenDeploymentTx.hash };
    await saveDeployCheckpoint(checkpoint);
    const tokenDeploymentReceipt = await waitForReceipt(tokenDeploymentTx.hash, "KPEGToken");
    tokenDeploymentBlock = Number(tokenDeploymentReceipt?.blockNumber ?? 0);
    if (!Number.isInteger(tokenDeploymentBlock) || tokenDeploymentBlock <= 0) {
      throw new Error("Failed to resolve KPEGToken deployment block number");
    }
    checkpoint.tokenDeploymentBlock = tokenDeploymentBlock;
    delete checkpoint.pendingTxs.token;
    await saveDeployCheckpoint(checkpoint);
    console.log(`KPEGToken deployed: ${tokenAddress}`);
  }
  if (breedingContractAddress && breedingAuthorizationPlan) {
    const tokenContract = await ethers.getContractAt("KPEGToken", tokenAddress);
    const currentBreedingContract = await tokenContract.breedingContract();
    if (sameAddress(currentBreedingContract, breedingContractAddress)) {
      console.log(`KPEGToken breeding contract already set: ${breedingContractAddress}`);
    } else {
      const breedingAuthTx = await tokenContract.setBreedingContract(
        breedingContractAddress,
        breedingAuthorizationPlan.runtimeCodeHash,
        { gasLimit: linkGasLimit }
      );
      checkpoint.pendingTxs = { ...(checkpoint.pendingTxs ?? {}), breedingAuthSet: breedingAuthTx.hash };
      await saveDeployCheckpoint(checkpoint);
      await waitForCheckpointedTx(checkpoint, "breedingAuthSet", "KPEGToken.setBreedingContract");
      console.log(`KPEGToken breeding contract set: ${breedingContractAddress}`);
    }
    const currentBreedingHash = await tokenContract.breedingContractCodeHash();
    if (currentBreedingHash.toLowerCase() !== breedingAuthorizationPlan.runtimeCodeHash.toLowerCase()) {
      throw new Error(
        `KPEGToken breeding contract code hash mismatch after link: expected ${breedingAuthorizationPlan.runtimeCodeHash}, got ${currentBreedingHash}`
      );
    }
    checkpoint.breedingAuthSet = true;
    await saveDeployCheckpoint(checkpoint);
  }

  const MarketFactory = await ethers.getContractFactory("KPEGMarket");
  let marketAddress = await resumeCheckpointedContract(checkpoint, checkpoint.market, "market", "KPEGMarket");
  if (marketAddress) {
    console.log(`KPEGMarket reused from checkpoint: ${marketAddress}`);
  } else {
    const market = await MarketFactory.deploy(tokenAddress, deployer.address, { gasLimit: marketDeployGasLimit });
    marketAddress = await market.getAddress();
    const marketTx = market.deploymentTransaction();
    if (!marketTx) {
      throw new Error("KPEGMarket deployment transaction is unavailable");
    }
    checkpoint.market = marketAddress;
    checkpoint.pendingTxs = { ...(checkpoint.pendingTxs ?? {}), market: marketTx.hash };
    await saveDeployCheckpoint(checkpoint);
    await waitForReceipt(marketTx.hash, "KPEGMarket");
    delete checkpoint.pendingTxs.market;
    await saveDeployCheckpoint(checkpoint);
    console.log(`KPEGMarket deployed: ${marketAddress}`);
  }

  const HookDeployerFactory = await ethers.getContractFactory("Create2Deployer");
  let hookDeployerAddress = await resumeCheckpointedContract(checkpoint, checkpoint.hookDeployer, "hookDeployer", "Create2Deployer");
  if (hookDeployerAddress) {
    console.log(`Create2Deployer reused from checkpoint: ${hookDeployerAddress}`);
  } else {
    const hookDeployer = await HookDeployerFactory.deploy({ gasLimit: create2DeployGasLimit });
    hookDeployerAddress = await hookDeployer.getAddress();
    const hookDeployerTx = hookDeployer.deploymentTransaction();
    if (!hookDeployerTx) {
      throw new Error("Create2Deployer deployment transaction is unavailable");
    }
    checkpoint.hookDeployer = hookDeployerAddress;
    checkpoint.pendingTxs = { ...(checkpoint.pendingTxs ?? {}), hookDeployer: hookDeployerTx.hash };
    await saveDeployCheckpoint(checkpoint);
    await waitForReceipt(hookDeployerTx.hash, "Create2Deployer");
    delete checkpoint.pendingTxs.hookDeployer;
    await saveDeployCheckpoint(checkpoint);
    console.log(`Create2Deployer deployed: ${hookDeployerAddress}`);
  }

  const HookFactory = await ethers.getContractFactory("KPEGHook");
  const hookConstructorArgs = HookFactory.interface.encodeDeploy([poolManagerAddress, deployer.address]);
  const hookInitCode = ethers.concat([HookFactory.bytecode as `0x${string}`, hookConstructorArgs as `0x${string}`]);
  const hookDeployer = await ethers.getContractAt("Create2Deployer", hookDeployerAddress);
  let hookAddress = await resumeCheckpointedContract(checkpoint, checkpoint.hook, "hook", "KPEGHook");
  if (hookAddress) {
    const expectedHook = checkpoint.hookSalt
      ? ethers.getCreate2Address(hookDeployerAddress, checkpoint.hookSalt, ethers.keccak256(hookInitCode))
      : hookAddress;
    if (hookAddress.toLowerCase() !== expectedHook.toLowerCase()) {
      throw new Error(`checkpoint hook mismatch: expected ${expectedHook}, got ${hookAddress}`);
    }
    console.log(`KPEGHook reused from checkpoint: ${hookAddress}`);
  } else {
    const mined = await mineHookDeployment(hookDeployerAddress, HookFactory.bytecode, hookConstructorArgs);
    const expectedHook = ethers.getCreate2Address(hookDeployerAddress, mined.salt, ethers.keccak256(hookInitCode));
    if (expectedHook.toLowerCase() !== mined.hookAddress.toLowerCase()) {
      throw new Error(`mined hook address mismatch: expected ${expectedHook}, got ${mined.hookAddress}`);
    }
    const existingHookCode = await ethers.provider.getCode(expectedHook);
    if (existingHookCode !== "0x") {
      throw new Error(`mined hook address already has code: ${expectedHook}`);
    }
    const deployHook = hookDeployer.getFunction("deployCode");
    try {
      await deployHook.estimateGas(mined.salt, hookInitCode);
    } catch (error) {
      throw new Error(`KPEGHook CREATE2 preflight failed for ${expectedHook}: ${(error as Error).message}`);
    }
    console.log(`KPEGHook mined address: ${expectedHook}`);
    const hookTx = await deployHook(mined.salt, hookInitCode, { gasLimit: hookDeployGasLimit });
    checkpoint.pendingTxs = { ...(checkpoint.pendingTxs ?? {}), hook: hookTx.hash };
    checkpoint.hookSalt = mined.salt;
    checkpoint.hook = expectedHook;
    await saveDeployCheckpoint(checkpoint);
    await waitForReceipt(hookTx.hash, "KPEGHook");
    hookAddress = expectedHook;
    delete checkpoint.pendingTxs.hook;
    await saveDeployCheckpoint(checkpoint);
    console.log(`KPEGHook deployed: ${expectedHook}`);
  }
  const hook = await ethers.getContractAt("KPEGHook", hookAddress);

  console.log("Linking token and hook");
  const tokenContract = await ethers.getContractAt("KPEGToken", tokenAddress);
  if ((await tokenContract.hook()).toLowerCase() !== hookAddress.toLowerCase()) {
    const hookLinkTx = await tokenContract.setHook(hookAddress, { gasLimit: linkGasLimit });
    checkpoint.pendingTxs = { ...(checkpoint.pendingTxs ?? {}), tokenHookSet: hookLinkTx.hash };
    await saveDeployCheckpoint(checkpoint);
    await waitForCheckpointedTx(checkpoint, "tokenHookSet", "KPEGToken.setHook");
    console.log(`KPEGToken hook set: ${hookAddress}`);
  } else {
    console.log(`KPEGToken hook already set: ${hookAddress}`);
  }
  if ((await hook.token()).toLowerCase() !== tokenAddress.toLowerCase()) {
    const tokenLinkTx = await hook.setToken(tokenAddress, { gasLimit: linkGasLimit });
    checkpoint.pendingTxs = { ...(checkpoint.pendingTxs ?? {}), hookTokenSet: tokenLinkTx.hash };
    await saveDeployCheckpoint(checkpoint);
    await waitForCheckpointedTx(checkpoint, "hookTokenSet", "KPEGHook.setToken");
    console.log(`KPEGHook token set: ${tokenAddress}`);
  } else {
    console.log(`KPEGHook token already set: ${tokenAddress}`);
  }
  checkpoint.tokenHookSet = true;
  checkpoint.hookTokenSet = true;
  await saveDeployCheckpoint(checkpoint);

  const RouterFactory = await ethers.getContractFactory("KPEGV4Router");
  let routerAddress = await resumeCheckpointedContract(checkpoint, checkpoint.router, "router", "KPEGV4Router");
  if (routerAddress) {
    console.log(`KPEGV4Router reused from checkpoint: ${routerAddress}`);
  } else {
    const router = await RouterFactory.deploy(
      poolManagerAddress,
      deployer.address,
      tokenAddress,
      wethAddress,
      hookAddress,
      fee,
      tickSpacing,
      { gasLimit: routerDeployGasLimit }
    );
    routerAddress = await router.getAddress();
    const routerTx = router.deploymentTransaction();
    if (!routerTx) {
      throw new Error("KPEGV4Router deployment transaction is unavailable");
    }
    checkpoint.router = routerAddress;
    checkpoint.pendingTxs = { ...(checkpoint.pendingTxs ?? {}), router: routerTx.hash };
    await saveDeployCheckpoint(checkpoint);
    await waitForReceipt(routerTx.hash, "KPEGV4Router");
    await waitForContractCode(routerAddress, "KPEGV4Router");
    checkpoint.tokenIsCurrency0 = await router.tokenIsCurrency0();
    delete checkpoint.pendingTxs.router;
    await saveDeployCheckpoint(checkpoint);
    console.log(`KPEGV4Router deployed: ${routerAddress}`);
  }

  const QuoterFactory = await ethers.getContractFactory("KPEGV4Quoter");
  let quoterAddress = await resumeCheckpointedContract(checkpoint, checkpoint.quoter, "quoter", "KPEGV4Quoter");
  if (quoterAddress) {
    console.log(`KPEGV4Quoter reused from checkpoint: ${quoterAddress}`);
  } else {
    const quoter = await QuoterFactory.deploy(poolManagerAddress, { gasLimit: quoterDeployGasLimit });
    quoterAddress = await quoter.getAddress();
    const quoterTx = quoter.deploymentTransaction();
    if (!quoterTx) {
      throw new Error("KPEGV4Quoter deployment transaction is unavailable");
    }
    checkpoint.quoter = quoterAddress;
    checkpoint.pendingTxs = { ...(checkpoint.pendingTxs ?? {}), quoter: quoterTx.hash };
    await saveDeployCheckpoint(checkpoint);
    await waitForReceipt(quoterTx.hash, "KPEGV4Quoter");
    await waitForContractCode(quoterAddress, "KPEGV4Quoter");
    delete checkpoint.pendingTxs.quoter;
    await saveDeployCheckpoint(checkpoint);
    console.log(`KPEGV4Quoter deployed: ${quoterAddress}`);
  }

  const payload = {
    network: network.name,
    chainId: Number(network.config.chainId ?? 0),
    deployer: deployer.address,
    artSources: {
      backgrounds,
      breeds,
      clothes,
      moods,
      marks,
      mouths,
      eyes,
      accessories
    },
    renderer: rendererAddress,
    token: tokenAddress,
    tokenDeploymentBlock,
    ...(breedingContractAddress && breedingAuthorizationPlan
      ? {
          breedingContract: breedingContractAddress,
          breedingContractRuntimeCodeHash: breedingAuthorizationPlan.runtimeCodeHash,
          breedingCreate2: {
            deployer: breedingCreate2DeployerAddress,
            salt: breedingAuthorizationPlan.salt,
            initCodeHash: breedingAuthorizationPlan.initCodeHash
          }
        }
      : {}),
    market: marketAddress,
    hook: hookAddress,
    hookDeployer: hookDeployerAddress,
    router: routerAddress,
    quoter: quoterAddress,
    poolManager: poolManagerAddress,
    weth: wethAddress,
    positionManager: positionManagerAddress,
    permit2: permit2Address,
    ...(positionDescriptorAddress ? { positionDescriptor: positionDescriptorAddress } : {}),
    tokenIsCurrency0: checkpoint.tokenIsCurrency0 ?? (await (await ethers.getContractAt("KPEGV4Router", routerAddress)).tokenIsCurrency0()),
    fee,
    tickSpacing,
    deployedAt: new Date().toISOString()
  };

  const outPath = await writeDeployment(network.name, payload);
  await removeCheckpoint(network.name);
  console.log(JSON.stringify({ ...payload, outPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
