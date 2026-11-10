import { ethers } from "hardhat";
import { assertContractCode, assertPositionManagerBinding, fullRangeTicks, liveNetworkInfra } from "./lib";
import type { DeploymentRecord } from "./lib";

const ACTION_MINT_POSITION_FROM_DELTAS = 0x05;
const ACTION_BURN_POSITION = 0x03;
const ACTION_SETTLE = 0x0b;
const ACTION_TAKE_PAIR = 0x11;
const ACTION_CLOSE_CURRENCY = 0x12;
const MAX_UINT48 = (1n << 48n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;
const ZERO_BYTES = "0x";

const ERC20_APPROVE_ABI = ["function approve(address spender, uint256 amount) external returns (bool)"];
const PERMIT2_ABI = ["function approve(address token, address spender, uint160 amount, uint48 expiration) external"];
const POSITION_MANAGER_ABI = [
  "function modifyLiquidities(bytes unlockData, uint256 deadline) external payable",
  "function ownerOf(uint256 tokenId) view returns (address)"
];
const TRANSFER_EVENT_ABI = ["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"];
const WETH_ABI = ["function deposit() external payable", ...ERC20_APPROVE_ABI];
const abiCoder = ethers.AbiCoder.defaultAbiCoder();

type PoolKeyStruct = {
  currency0: string;
  currency1: string;
  fee: bigint | number;
  tickSpacing: bigint | number;
  hooks: string;
};

export type AddLiquidityRequest = {
  deployment: DeploymentRecord;
  networkName: string;
  tokenLiquidity: string;
  ethLiquidity: string;
  tickLower?: number;
  tickUpper?: number;
  recipient?: string;
  hookData?: string;
  deadline: bigint;
};

export type RemoveLiquidityRequest = {
  deployment: DeploymentRecord;
  networkName: string;
  tokenId: bigint;
  recipient?: string;
  hookData?: string;
  amount0Min?: bigint;
  amount1Min?: bigint;
  deadline: bigint;
};

function resolvePositionInfra(deployment: DeploymentRecord, networkName: string): { positionManager: string; permit2: string } {
  const liveDefaults = liveNetworkInfra(networkName);
  const isLocal = networkName === "localhost" || networkName === "hardhat";

  const positionManager =
    process.env.KPEG_POSITION_MANAGER_ADDRESS?.trim() ||
    (isLocal ? deployment.positionManager : liveDefaults?.positionManager) ||
    (isLocal ? liveDefaults?.positionManager : deployment.positionManager) ||
    "";
  const permit2 =
    process.env.KPEG_PERMIT2_ADDRESS?.trim() ||
    (isLocal ? deployment.permit2 : liveDefaults?.permit2) ||
    (isLocal ? liveDefaults?.permit2 : deployment.permit2) ||
    "";

  if (!positionManager || !ethers.isAddress(positionManager)) {
    throw new Error(`Missing valid PositionManager address for network ${networkName}`);
  }
  if (!permit2 || !ethers.isAddress(permit2)) {
    throw new Error(`Missing valid Permit2 address for network ${networkName}`);
  }

  return { positionManager, permit2 };
}

function encodeAddPlan(
  poolKey: PoolKeyStruct,
  tickLower: number,
  tickUpper: number,
  amount0Max: bigint,
  amount1Max: bigint,
  recipient: string,
  hookData: string
): string {
  const actions = ethers.hexlify(
    Uint8Array.from([
      ACTION_SETTLE,
      ACTION_SETTLE,
      ACTION_MINT_POSITION_FROM_DELTAS,
      ACTION_CLOSE_CURRENCY,
      ACTION_CLOSE_CURRENCY
    ])
  );

  const params = [
    abiCoder.encode(["address", "uint256", "bool"], [poolKey.currency0, amount0Max, true]),
    abiCoder.encode(["address", "uint256", "bool"], [poolKey.currency1, amount1Max, true]),
    abiCoder.encode(
      [
        "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
        "int24",
        "int24",
        "uint128",
        "uint128",
        "address",
        "bytes"
      ],
      [poolKey, tickLower, tickUpper, amount0Max, amount1Max, recipient, hookData]
    ),
    abiCoder.encode(["address"], [poolKey.currency0]),
    abiCoder.encode(["address"], [poolKey.currency1])
  ];

  return abiCoder.encode(["bytes", "bytes[]"], [actions, params]);
}

function encodeRemovePlan(
  poolKey: PoolKeyStruct,
  tokenId: bigint,
  amount0Min: bigint,
  amount1Min: bigint,
  recipient: string,
  hookData: string
): string {
  const actions = ethers.hexlify(Uint8Array.from([ACTION_BURN_POSITION, ACTION_TAKE_PAIR]));
  const params = [
    abiCoder.encode(["uint256", "uint128", "uint128", "bytes"], [tokenId, amount0Min, amount1Min, hookData]),
    abiCoder.encode(["address", "address", "address"], [poolKey.currency0, poolKey.currency1, recipient])
  ];

  return abiCoder.encode(["bytes", "bytes[]"], [actions, params]);
}

async function approvePermit2(
  tokenAddress: string,
  permit2Address: string,
  positionManagerAddress: string,
  amount: bigint,
  signer: Awaited<ReturnType<typeof ethers.getSigners>>[number]
) {
  const token = await ethers.getContractAt(ERC20_APPROVE_ABI, tokenAddress, signer);
  await (await token.approve(permit2Address, amount)).wait();

  const permit2 = await ethers.getContractAt(PERMIT2_ABI, permit2Address, signer);
  await (await permit2.approve(tokenAddress, positionManagerAddress, MAX_UINT160, Number(MAX_UINT48))).wait();
}

export async function addLiquidityViaPositionManager(
  request: AddLiquidityRequest
): Promise<{ tickLower: number; tickUpper: number; txHash: string | null; lpTokenId: string | null }> {
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  const recipient = request.recipient ?? signerAddress;
  const hookData = request.hookData ?? ZERO_BYTES;
  const { positionManager, permit2 } = resolvePositionInfra(request.deployment, request.networkName);
  await assertContractCode(request.deployment.poolManager, "PoolManager");
  await assertContractCode(request.deployment.weth, "WETH");
  await assertContractCode(permit2, "Permit2");
  await assertPositionManagerBinding(positionManager, request.deployment.poolManager, permit2);

  const router = await ethers.getContractAt("KPEGV4Router", request.deployment.router, signer);
  const rawPoolKey = await router.getPoolKey();
  const tokenIsCurrency0 = String(rawPoolKey.currency0).toLowerCase() === request.deployment.token.toLowerCase();
  const wethIsCurrency0 = String(rawPoolKey.currency0).toLowerCase() === request.deployment.weth.toLowerCase();
  if (!tokenIsCurrency0 && !wethIsCurrency0) {
    throw new Error(
      `Pool currency0 ${rawPoolKey.currency0} is neither token ${request.deployment.token} nor WETH ${request.deployment.weth}`
    );
  }
  const tickSpacing = Number(await router.tickSpacing());
  const { tickLower, tickUpper } =
    request.tickLower !== undefined && request.tickUpper !== undefined
      ? { tickLower: request.tickLower, tickUpper: request.tickUpper }
      : fullRangeTicks(tickSpacing);

  const tokenAmount = ethers.parseEther(request.tokenLiquidity);
  const wethAmount = ethers.parseEther(request.ethLiquidity);
  if (tokenAmount <= 0n) {
    throw new Error("--token-liquidity must be > 0");
  }
  if (wethAmount <= 0n) {
    throw new Error("--eth-liquidity must be > 0");
  }
  if (tokenAmount > MAX_UINT128) {
    throw new Error("--token-liquidity is too large");
  }
  if (wethAmount > MAX_UINT128) {
    throw new Error("--eth-liquidity is too large");
  }

  await approvePermit2(request.deployment.token, permit2, positionManager, tokenAmount, signer);

  const weth = await ethers.getContractAt(WETH_ABI, request.deployment.weth, signer);
  await (await weth.deposit({ value: wethAmount })).wait();
  await approvePermit2(request.deployment.weth, permit2, positionManager, wethAmount, signer);

  const poolKey: PoolKeyStruct = {
    currency0: rawPoolKey.currency0,
    currency1: rawPoolKey.currency1,
    fee: rawPoolKey.fee,
    tickSpacing: rawPoolKey.tickSpacing,
    hooks: rawPoolKey.hooks
  };

  const amount0Max = tokenIsCurrency0 ? tokenAmount : wethAmount;
  const amount1Max = tokenIsCurrency0 ? wethAmount : tokenAmount;
  const unlockData = encodeAddPlan(poolKey, tickLower, tickUpper, amount0Max, amount1Max, recipient, hookData);

  const manager = await ethers.getContractAt(POSITION_MANAGER_ABI, positionManager, signer);
  const tx = await manager.modifyLiquidities(unlockData, request.deadline);
  const receipt = await tx.wait();
  const transferLogInterface = new ethers.Interface(TRANSFER_EVENT_ABI);
  let lpTokenId: string | null = null;
  for (const log of receipt?.logs ?? []) {
    if (log.address.toLowerCase() !== positionManager.toLowerCase()) {
      continue;
    }
    try {
      const parsed = transferLogInterface.parseLog({
        topics: [...log.topics],
        data: log.data
      });
      if (
        parsed.name === "Transfer" &&
        String(parsed.args.from).toLowerCase() === ethers.ZeroAddress.toLowerCase() &&
        String(parsed.args.to).toLowerCase() === signerAddress.toLowerCase()
      ) {
        lpTokenId = parsed.args.tokenId.toString();
        break;
      }
    } catch {
      // ignore non-Transfer logs
    }
  }

  return {
    tickLower,
    tickUpper,
    txHash: receipt?.hash ?? null,
    lpTokenId
  };
}

export async function removeLiquidityViaPositionManager(
  request: RemoveLiquidityRequest
): Promise<{ txHash: string | null; recipient: string }> {
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  const recipient = request.recipient ?? signerAddress;
  const hookData = request.hookData ?? ZERO_BYTES;
  const amount0Min = request.amount0Min ?? 0n;
  const amount1Min = request.amount1Min ?? 0n;
  const { positionManager, permit2 } = resolvePositionInfra(request.deployment, request.networkName);

  if (amount0Min < 0n || amount1Min < 0n) {
    throw new Error("amount mins must be >= 0");
  }
  if (amount0Min > MAX_UINT128 || amount1Min > MAX_UINT128) {
    throw new Error("amount mins must fit uint128");
  }
  if (!ethers.isAddress(recipient)) {
    throw new Error(`Invalid recipient address: ${recipient}`);
  }

  await assertContractCode(request.deployment.poolManager, "PoolManager");
  await assertContractCode(permit2, "Permit2");
  await assertPositionManagerBinding(positionManager, request.deployment.poolManager, permit2);

  const manager = await ethers.getContractAt(POSITION_MANAGER_ABI, positionManager, signer);
  const owner = await manager.ownerOf(request.tokenId);
  if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error(`Signer ${signerAddress} does not own LP token ${request.tokenId.toString()} (owner is ${owner})`);
  }

  const router = await ethers.getContractAt("KPEGV4Router", request.deployment.router, signer);
  const rawPoolKey = await router.getPoolKey();
  const poolKey: PoolKeyStruct = {
    currency0: rawPoolKey.currency0,
    currency1: rawPoolKey.currency1,
    fee: rawPoolKey.fee,
    tickSpacing: rawPoolKey.tickSpacing,
    hooks: rawPoolKey.hooks
  };
  const unlockData = encodeRemovePlan(poolKey, request.tokenId, amount0Min, amount1Min, recipient, hookData);

  const tx = await manager.modifyLiquidities(unlockData, request.deadline);
  const receipt = await tx.wait();

  return {
    txHash: receipt?.hash ?? null,
    recipient
  };
}
