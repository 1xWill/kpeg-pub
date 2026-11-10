import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ethers } from "hardhat";

const HOOK_FLAGS = (1n << 10n) | (1n << 6n);
const HOOK_FLAG_MASK = (1n << 14n) - 1n;
const POOLS_SLOT = ethers.zeroPadValue(ethers.toBeHex(6), 32);

export type DeploymentRecord = {
  network: string;
  chainId: number;
  deployer: string;
  artSources: {
    backgrounds: ArtSourceRef[][];
    breeds: ArtSourceRef[][];
    clothes: ArtSourceRef[][];
    moods: ArtSourceRef[][];
    marks: ArtSourceRef[][];
    mouths: ArtSourceRef[][];
    eyes: ArtSourceRef[][];
    accessories: ArtSourceRef[][];
  };
  renderer: string;
  token: string;
  tokenDeploymentBlock?: number;
  breedingContract?: string;
  breedingContractRuntimeCodeHash?: string;
  breeding?: string;
  breedingEngine?: string;
  breedingCreate2?: {
    deployer: string;
    salt: string;
    initCodeHash: string;
  };
  breedingGateway?: {
    owner: string;
    token: string;
    initialAuthorizedCaller: string;
  };
  market: string;
  hook: string;
  hookDeployer: string;
  router: string;
  quoter: string;
  poolManager: string;
  weth: string;
  positionManager?: string;
  permit2?: string;
  positionDescriptor?: string;
  tokenIsCurrency0: boolean;
  fee: number;
  tickSpacing: number;
  deployedAt: string;
};

export type ArtSourceRef = {
  source: string;
  index: number;
};

export type LiveNetworkInfra = {
  poolManager: string;
  weth: string;
  positionManager: string;
  permit2: string;
};

type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
};

export const LIVE_NETWORK_INFRA: Record<string, LiveNetworkInfra> = {
  baseSepolia: {
    poolManager: "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408",
    weth: "0x4200000000000000000000000000000000000006",
    positionManager: "0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3"
  },
  baseMainnet: {
    poolManager: "0x498581ff718922c3f8e6a244956af099b2652b2b",
    weth: "0x4200000000000000000000000000000000000006",
    positionManager: "0x7c5f5a4bbd8fd63184577525326123b519429bdc",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3"
  }
};

export function liveNetworkInfra(networkName: string): LiveNetworkInfra | undefined {
  return LIVE_NETWORK_INFRA[networkName];
}

export function deploymentFileFor(networkName: string): string {
  return resolve(process.cwd(), "../deployments", `${networkName}.json`);
}

export async function writeDeployment(networkName: string, payload: DeploymentRecord): Promise<string> {
  const path = deploymentFileFor(networkName);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
}

export function checkpointFileFor(networkName: string): string {
  return resolve(process.cwd(), "../deployments", `${networkName}.checkpoint.json`);
}

export async function writeCheckpoint(networkName: string, payload: unknown): Promise<string> {
  const path = checkpointFileFor(networkName);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
}

export async function readCheckpoint<T = unknown>(networkName: string): Promise<T | undefined> {
  const path = checkpointFileFor(networkName);
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function removeCheckpoint(networkName: string): Promise<void> {
  const path = checkpointFileFor(networkName);
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRpcError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Request timeout") ||
    message.includes("timeout") ||
    message.includes("429") ||
    message.toLowerCase().includes("rate limit") ||
    message.toLowerCase().includes("too many requests") ||
    message.toLowerCase().includes("temporarily unavailable") ||
    message.toLowerCase().includes("gateway timeout")
  );
}

export async function retryRpc<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 6;
  const baseDelayMs = options.baseDelayMs ?? 1500;
  const maxDelayMs = options.maxDelayMs ?? 12_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableRpcError(error)) {
        throw error;
      }
      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const label = options.label ? ` (${options.label})` : "";
      console.warn(`RPC retry${label}: attempt ${attempt} failed, retrying in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("RPC retry failed");
}

export async function readDeployment(networkName: string): Promise<DeploymentRecord> {
  const path = deploymentFileFor(networkName);
  const raw = await readFile(path, "utf8");
  const deployment = JSON.parse(raw) as DeploymentRecord;
  if (typeof deployment.tokenIsCurrency0 !== "boolean") {
    if (!deployment.router || !ethers.isAddress(deployment.router)) {
      throw new Error(
        `${path} has invalid tokenIsCurrency0 and no valid router address to repair it: ${JSON.stringify(deployment.tokenIsCurrency0)}`
      );
    }
    const router = await ethers.getContractAt(["function tokenIsCurrency0() view returns (bool)"], deployment.router);
    const tokenIsCurrency0 = await retryRpc(() => router.tokenIsCurrency0(), {
      label: `${networkName}.deployment.tokenIsCurrency0`
    });
    deployment.tokenIsCurrency0 = Boolean(tokenIsCurrency0);
    await writeDeployment(networkName, deployment);
    console.warn(`${path} had invalid tokenIsCurrency0; repaired from live router as ${deployment.tokenIsCurrency0}`);
  }
  return deployment;
}

export async function mineHookDeployment(
  deployerAddress: string,
  creationCode: string,
  constructorArgs: string
): Promise<{ salt: string; hookAddress: string }> {
  const initCode = ethers.concat([creationCode as `0x${string}`, constructorArgs as `0x${string}`]);
  const initCodeHash = ethers.keccak256(initCode);

  for (let i = 0; i < 200_000; i += 1) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const hookAddress = ethers.getCreate2Address(deployerAddress, salt, initCodeHash);
    if ((BigInt(hookAddress) & HOOK_FLAG_MASK) === HOOK_FLAGS) {
      return { salt, hookAddress };
    }
  }

  throw new Error("failed to mine hook address for required permissions");
}

function sqrtBigInt(value: bigint): bigint {
  if (value < 2n) {
    return value;
  }

  let x0 = value;
  let x1 = (x0 + value / x0) >> 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) >> 1n;
  }
  return x0;
}

export function encodeSqrtPriceX96FromKpegPerEth(priceKpegPerEth: string, tokenIsCurrency0: boolean): bigint {
  const scale = 10n ** 18n;
  const priceQ18 = ethers.parseUnits(priceKpegPerEth, 18);
  const ratioQ18 = tokenIsCurrency0 ? (scale * scale) / priceQ18 : priceQ18;
  return sqrtBigInt((ratioQ18 << 192n) / scale);
}

export function normalizeSqrtPriceX96(value: bigint): bigint {
  const mask = (1n << 160n) - 1n;
  return value & mask;
}

export async function readPoolSqrtPriceX96(poolManager: string, poolKey: {
  currency0: string;
  currency1: string;
  fee: bigint | number;
  tickSpacing: bigint | number;
  hooks: string;
}): Promise<bigint> {
  const encodedPoolKey = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"],
    [poolKey]
  );
  const poolId = ethers.keccak256(encodedPoolKey);
  const stateSlot = ethers.keccak256(ethers.concat([poolId, POOLS_SLOT]));
  const poolManagerContract = await ethers.getContractAt(["function extsload(bytes32 slot) view returns (bytes32)"], poolManager);
  const slot0 = await retryRpc(() => poolManagerContract.extsload(stateSlot), { label: "PoolManager.slot0" });
  return normalizeSqrtPriceX96(BigInt(slot0));
}

export function fullRangeTicks(tickSpacing: number): { tickLower: number; tickUpper: number } {
  const minTick = -887272;
  const maxTick = 887272;
  return {
    tickLower: Math.ceil(minTick / tickSpacing) * tickSpacing,
    tickUpper: Math.floor(maxTick / tickSpacing) * tickSpacing
  };
}

const POSITION_MANAGER_META_ABI = [
  "function poolManager() view returns (address)",
  "function permit2() view returns (address)"
];

export async function assertContractCode(address: string, label: string): Promise<void> {
  if (!ethers.isAddress(address)) {
    throw new Error(`${label} is not a valid address: ${address}`);
  }

  const code = await retryRpc(() => ethers.provider.getCode(address), { label: `${label}.getCode` });
  if (code === "0x") {
    throw new Error(`${label} has no deployed code at ${address}`);
  }
}

export async function waitForContractCode(
  address: string,
  label: string,
  timeoutMs = 60_000,
  intervalMs = 1_000
): Promise<void> {
  if (!ethers.isAddress(address)) {
    throw new Error(`${label} is not a valid address: ${address}`);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const code = await retryRpc(() => ethers.provider.getCode(address), {
      label: `${label}.waitForCode`,
      attempts: 3,
      baseDelayMs: intervalMs
    });
    if (code !== "0x") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`${label} code not available at ${address} after ${timeoutMs}ms`);
}

export async function assertPositionManagerBinding(
  positionManager: string,
  expectedPoolManager: string,
  expectedPermit2: string
): Promise<void> {
  await assertContractCode(positionManager, "PositionManager");

  const posm = await ethers.getContractAt(POSITION_MANAGER_META_ABI, positionManager);
  const poolManager = await retryRpc(() => posm.poolManager(), { label: "PositionManager.poolManager" });
  const permit2 = await retryRpc(() => posm.permit2(), { label: "PositionManager.permit2" });

  if (poolManager.toLowerCase() !== expectedPoolManager.toLowerCase()) {
    throw new Error(
      `PositionManager.poolManager mismatch: expected ${expectedPoolManager}, got ${poolManager} at ${positionManager}`
    );
  }

  if (permit2.toLowerCase() !== expectedPermit2.toLowerCase()) {
    throw new Error(`PositionManager.permit2 mismatch: expected ${expectedPermit2}, got ${permit2} at ${positionManager}`);
  }
}
