import { expect } from "chai";
import { ethers } from "hardhat";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FULL_RANGE_LOWER = -887220;
const FULL_RANGE_UPPER = 887220;
const HOOK_FLAGS = (1n << 10n) | (1n << 6n);
const ACTION_MINT_POSITION_FROM_DELTAS = 0x05;
const ACTION_SETTLE = 0x0b;
const ACTION_CLOSE_CURRENCY = 0x12;
const MAX_UINT48 = (1n << 48n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;

const ART_SOURCE_MANIFEST = JSON.parse(
  readFileSync(resolve(__dirname, "../src/generated/artSourceManifest.json"), "utf8")
) as Record<string, { contractName: string; index: number }[][]>;

function toSalt(counter: number): string {
  return ethers.zeroPadValue(ethers.toBeHex(counter), 32);
}

async function mineHookAddress(
  deployerAddress: string,
  creationCode: string,
  constructorArgs: string
): Promise<{ salt: string; address: string }> {
  const initCode = ethers.concat([creationCode as `0x${string}`, constructorArgs as `0x${string}`]);
  const initCodeHash = ethers.keccak256(initCode);
  const mask = (1n << 14n) - 1n;

  for (let i = 0; i < 200_000; i += 1) {
    const salt = toSalt(i);
    const predicted = ethers.getCreate2Address(deployerAddress, salt, initCodeHash);
    if ((BigInt(predicted) & mask) === HOOK_FLAGS) {
      return { salt, address: predicted };
    }
  }

  throw new Error("failed to mine hook address");
}

describe("KPEGHook + real Uniswap v4 flow", () => {
  async function deployRendererFixture() {
    const deployedSources = new Map<string, string>();
    const deployArtSourceSeries = async (baseName: string): Promise<{ source: string; index: number }[][]> => {
      const group = ART_SOURCE_MANIFEST[baseName];
      if (!group) {
        throw new Error(`Missing art source manifest group: ${baseName}`);
      }
      const addresses: { source: string; index: number }[][] = [];
      for (const layer of group) {
        const pieces: { source: string; index: number }[] = [];
        for (const { contractName, index } of layer) {
          let source = deployedSources.get(contractName);
          if (!source) {
            const Factory = await ethers.getContractFactory(contractName);
            const contract = await Factory.deploy();
            await contract.waitForDeployment();
            source = await contract.getAddress();
            deployedSources.set(contractName, source);
          }
          pieces.push({ source, index });
        }
        addresses.push(pieces);
      }
      return addresses;
    };

    const backgrounds = await deployArtSourceSeries("backgrounds");
    const breeds = await deployArtSourceSeries("breeds");
    const clothes = await deployArtSourceSeries("clothes");
    const moods = await deployArtSourceSeries("moods");
    const marks = await deployArtSourceSeries("marks");
    const mouths = await deployArtSourceSeries("mouths");
    const eyes = await deployArtSourceSeries("eyes");
    const accessories = await deployArtSourceSeries("accessories");

    const RendererFactory = await ethers.getContractFactory("KPEGRenderer");
    const renderer = await RendererFactory.deploy(
      backgrounds,
      breeds,
      clothes,
      moods,
      marks,
      mouths,
      eyes,
      accessories
    );
    await renderer.waitForDeployment();
    return renderer;
  }

  async function approvePermit2Spender(
    signer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
    tokenAddress: string,
    permit2Address: string,
    positionManagerAddress: string,
    amount: bigint
  ) {
    const erc20 = await ethers.getContractAt(
      ["function approve(address spender, uint256 amount) external returns (bool)"],
      tokenAddress,
      signer
    );
    await (await erc20.approve(permit2Address, amount)).wait();

    const permit2 = await ethers.getContractAt(
      ["function approve(address token, address spender, uint160 amount, uint48 expiration) external"],
      permit2Address,
      signer
    );
    await (await permit2.approve(tokenAddress, positionManagerAddress, MAX_UINT160, Number(MAX_UINT48))).wait();
  }

  async function addLiquidityViaPositionManager(params: {
    signer: Awaited<ReturnType<typeof ethers.getSigners>>[number];
    tokenAddress: string;
    wethAddress: string;
    permit2Address: string;
    positionManagerAddress: string;
    routerAddress: string;
    tokenIsCurrency0: boolean;
    tokenLiquidity: bigint;
    ethLiquidity: bigint;
  }): Promise<void> {
    const {
      signer,
      tokenAddress,
      wethAddress,
      permit2Address,
      positionManagerAddress,
      routerAddress,
      tokenIsCurrency0,
      tokenLiquidity,
      ethLiquidity
    } = params;
    const recipient = await signer.getAddress();
    const router = await ethers.getContractAt("KPEGV4Router", routerAddress, signer);

    await approvePermit2Spender(signer, tokenAddress, permit2Address, positionManagerAddress, tokenLiquidity);

    const weth = await ethers.getContractAt(
      ["function deposit() external payable", "function approve(address spender, uint256 amount) external returns (bool)"],
      wethAddress,
      signer
    );
    await (await weth.deposit({ value: ethLiquidity })).wait();
    await approvePermit2Spender(signer, wethAddress, permit2Address, positionManagerAddress, ethLiquidity);

    const rawPoolKey = await router.getPoolKey();
    const amount0Max = tokenIsCurrency0 ? tokenLiquidity : ethLiquidity;
    const amount1Max = tokenIsCurrency0 ? ethLiquidity : tokenLiquidity;

    const actions = ethers.hexlify(
      Uint8Array.from([
        ACTION_SETTLE,
        ACTION_SETTLE,
        ACTION_MINT_POSITION_FROM_DELTAS,
        ACTION_CLOSE_CURRENCY,
        ACTION_CLOSE_CURRENCY
      ])
    );

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const unlockData = abiCoder.encode(
      ["bytes", "bytes[]"],
      [
        actions,
        [
          abiCoder.encode(["address", "uint256", "bool"], [rawPoolKey.currency0, amount0Max, true]),
          abiCoder.encode(["address", "uint256", "bool"], [rawPoolKey.currency1, amount1Max, true]),
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
            [
              {
                currency0: rawPoolKey.currency0,
                currency1: rawPoolKey.currency1,
                fee: rawPoolKey.fee,
                tickSpacing: rawPoolKey.tickSpacing,
                hooks: rawPoolKey.hooks
              },
              FULL_RANGE_LOWER,
              FULL_RANGE_UPPER,
              amount0Max,
              amount1Max,
              recipient,
              "0x"
            ]
          ),
          abiCoder.encode(["address"], [rawPoolKey.currency0]),
          abiCoder.encode(["address"], [rawPoolKey.currency1])
        ]
      ]
    );

    const positionManager = await ethers.getContractAt(
      ["function modifyLiquidities(bytes unlockData, uint256 deadline) external payable"],
      positionManagerAddress,
      signer
    );
    await (await positionManager.modifyLiquidities(unlockData, BigInt(Math.floor(Date.now() / 1000) + 3600))).wait();
  }

  async function deployV4Fixture() {
    const [owner, alice, bob] = await ethers.getSigners();

    const PoolManagerFactory = await ethers.getContractFactory("LocalPoolManager");
    const manager = await PoolManagerFactory.deploy(owner.address);
    await manager.waitForDeployment();

    const WethFactory = await ethers.getContractFactory("MockWETH");
    const weth = await WethFactory.deploy();
    await weth.waitForDeployment();

    const Permit2Factory = await ethers.getContractFactory("Permit2Anchor");
    const permit2 = await Permit2Factory.deploy();
    await permit2.waitForDeployment();

    const PositionDescriptorFactory = await ethers.getContractFactory("MockPositionDescriptor");
    const positionDescriptor = await PositionDescriptorFactory.deploy(
      await manager.getAddress(),
      await weth.getAddress(),
      "ETH"
    );
    await positionDescriptor.waitForDeployment();

    const PositionManagerFactory = await ethers.getContractFactory(
      "@uniswap/v4-periphery/src/PositionManager.sol:PositionManager"
    );
    const positionManager = await PositionManagerFactory.deploy(
      await manager.getAddress(),
      await permit2.getAddress(),
      100_000,
      await positionDescriptor.getAddress(),
      await weth.getAddress()
    );
    await positionManager.waitForDeployment();

    const renderer = await deployRendererFixture();

    const TokenFactory = await ethers.getContractFactory("KPEGToken");
    const token = await TokenFactory.deploy(owner.address, await renderer.getAddress());
    await token.waitForDeployment();

    const Create2Factory = await ethers.getContractFactory("Create2Deployer");
    const create2 = await Create2Factory.deploy();
    await create2.waitForDeployment();

    const HookFactory = await ethers.getContractFactory("KPEGHook");
    const constructorArgs = HookFactory.interface.encodeDeploy([await manager.getAddress(), owner.address]);
    const mined = await mineHookAddress(await create2.getAddress(), HookFactory.bytecode, constructorArgs);
    const initCode = ethers.concat([HookFactory.bytecode as `0x${string}`, constructorArgs as `0x${string}`]);

    await (await create2.deployCode(mined.salt, initCode)).wait();
    const hook = await ethers.getContractAt("KPEGHook", mined.address);

    await (await token.connect(owner).setHook(await hook.getAddress())).wait();
    await (await hook.connect(owner).setToken(await token.getAddress())).wait();

    const RouterFactory = await ethers.getContractFactory("KPEGV4Router");
    const router = await RouterFactory.deploy(
      await manager.getAddress(),
      owner.address,
      await token.getAddress(),
      await weth.getAddress(),
      await hook.getAddress(),
      3000,
      60
    );
    await router.waitForDeployment();

    const QuoterFactory = await ethers.getContractFactory("KPEGV4Quoter");
    const quoter = await QuoterFactory.deploy(await manager.getAddress());
    await quoter.waitForDeployment();

    const sqrtPriceX96 = 1n << 96n;
    await (await router.connect(owner).initializePool(sqrtPriceX96)).wait();

    await addLiquidityViaPositionManager({
      signer: owner,
      tokenAddress: await token.getAddress(),
      wethAddress: await weth.getAddress(),
      permit2Address: await permit2.getAddress(),
      positionManagerAddress: await positionManager.getAddress(),
      routerAddress: await router.getAddress(),
      tokenIsCurrency0: await router.tokenIsCurrency0(),
      tokenLiquidity: ethers.parseEther("1000"),
      ethLiquidity: ethers.parseEther("1000")
    });

    return { manager, weth, token, hook, router, quoter, permit2, positionManager, owner, alice, bob };
  }

  it("renounces hook ownership and blocks setToken", async () => {
    const { hook, owner, alice } = await deployV4Fixture();

    await expect(hook.connect(alice).renounceOwnership()).to.be.revertedWithCustomError(hook, "OnlyOwner");
    await expect(hook.connect(owner).renounceOwnership())
      .to.emit(hook, "OwnershipRenounced")
      .withArgs(owner.address);
    expect(await hook.owner()).to.equal(ethers.ZeroAddress);
    await expect(hook.connect(owner).setToken(owner.address)).to.be.revertedWithCustomError(hook, "OnlyOwner");
  });

  it("renounces router ownership and blocks initializePool on fresh router", async () => {
    const { router, owner, alice } = await deployV4Fixture();

    await expect(router.connect(alice).renounceOwnership()).to.be.revertedWithCustomError(router, "OnlyOwner");
    await expect(router.connect(owner).renounceOwnership())
      .to.emit(router, "OwnershipRenounced")
      .withArgs(owner.address);
    expect(await router.owner()).to.equal(ethers.ZeroAddress);
    await expect(router.connect(owner).initializePool(1n << 96n)).to.be.revertedWithCustomError(router, "OnlyOwner");
  });

  it("starts on first liquidity add, quotes the pool, mints on real swaps, and burns on real sells", async () => {
    const { token, hook, router, quoter, alice, bob } = await deployV4Fixture();

    expect(await token.started()).to.equal(true);

    const hookSeedBefore = await hook.randomSeed();
    const rawPoolKey = await router.getPoolKey();
    const poolKey = {
      currency0: rawPoolKey.currency0,
      currency1: rawPoolKey.currency1,
      fee: rawPoolKey.fee,
      tickSpacing: rawPoolKey.tickSpacing,
      hooks: rawPoolKey.hooks
    };
    const zeroForOneBuy = !(await router.tokenIsCurrency0());

    const [quotedEthIn] = await quoter.quoteExactOutputSingle.staticCall({
      poolKey,
      zeroForOne: zeroForOneBuy,
      exactAmount: ethers.parseEther("3"),
      hookData: "0x"
    });

    await (
      await router
        .connect(alice)
        .buyExactKPEG(
          ethers.parseEther("3"),
          alice.address,
          BigInt(Math.floor(Date.now() / 1000) + 3600),
          0,
          "0x",
          { value: quotedEthIn + quotedEthIn / 5n }
        )
    ).wait();

    const hookSeedAfterBuy = await hook.randomSeed();
    expect(hookSeedAfterBuy).to.not.equal(hookSeedBefore);
    expect((await token.getOwnerKitties(alice.address)).length).to.equal(3);
    expect(await token.kittiesEverMinted()).to.equal(3);
    expect(await token.kittiesLive()).to.equal(3);

    const movedKittyId = (await token.getOwnerKitties(alice.address))[0];
    await (await token.connect(alice).directTransferKitty(movedKittyId, bob.address)).wait();
    expect((await token.getOwnerKitties(bob.address)).length).to.equal(1);

    await (await token.connect(bob).approve(await router.getAddress(), ethers.parseEther("1"))).wait();

    const [quotedEthOut] = await quoter.quoteExactInputSingle.staticCall({
      poolKey,
      zeroForOne: await router.tokenIsCurrency0(),
      exactAmount: ethers.parseEther("1"),
      hookData: "0x"
    });

    await (
      await router
        .connect(bob)
        .sellExactKPEG(
          ethers.parseEther("1"),
          (quotedEthOut * 98n) / 100n,
          bob.address,
          BigInt(Math.floor(Date.now() / 1000) + 3600),
          0,
          "0x"
        )
    ).wait();

    expect((await token.getOwnerKitties(alice.address)).length).to.equal(2);
    expect((await token.getOwnerKitties(bob.address)).length).to.equal(0);
    expect(await token.kittiesLive()).to.equal(2);
    expect(await token.kittiesEverMinted()).to.equal(3);

    const burnedKitty = await token.getKitty(movedKittyId);
    expect(burnedKitty.owner).to.equal(ethers.ZeroAddress);
    expect(burnedKitty.alive).to.equal(false);
  });

  it("allows non-owner wallets to add liquidity through position manager", async () => {
    const { owner, alice, token, weth, permit2, positionManager, router } = await deployV4Fixture();

    await (await token.connect(owner).transfer(alice.address, ethers.parseEther("200"))).wait();

    await addLiquidityViaPositionManager({
      signer: alice,
      tokenAddress: await token.getAddress(),
      wethAddress: await weth.getAddress(),
      permit2Address: await permit2.getAddress(),
      positionManagerAddress: await positionManager.getAddress(),
      routerAddress: await router.getAddress(),
      tokenIsCurrency0: await router.tokenIsCurrency0(),
      tokenLiquidity: ethers.parseEther("100"),
      ethLiquidity: ethers.parseEther("100")
    });

    expect(await token.started()).to.equal(true);
  });
});
