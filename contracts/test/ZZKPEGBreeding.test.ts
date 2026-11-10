import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ART_SOURCE_MANIFEST = JSON.parse(
  readFileSync(resolve(__dirname, "../src/generated/artSourceManifest.json"), "utf8")
) as Record<string, { contractName: string; index: number }[][]>;

type SignerWithAddress = Awaited<ReturnType<typeof ethers.getSigners>>[number];

type ParsedArgs = ReturnType<typeof ethers.Interface.prototype.parseLog>["args"];

function parseEventArgs(
  receipt: Awaited<ReturnType<ReturnType<SignerWithAddress["sendTransaction"]>["wait"]>>,
  contractAddress: string,
  iface: typeof ethers.Interface.prototype,
  eventName: string
): ParsedArgs | null {
  for (const log of receipt?.logs ?? []) {
    if (!("address" in log) || log.address.toLowerCase() !== contractAddress.toLowerCase()) {
      continue;
    }
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === eventName) {
        return parsed.args;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

describe("KPEGBreeding", () => {
  async function deployRendererFixture() {
    const deployedSources = new Map<string, string>();
    const deployArtSourceGroup = async (groupKey: string): Promise<{ source: string; index: number }[][]> => {
      const group = ART_SOURCE_MANIFEST[groupKey];
      if (!group) {
        throw new Error(`Missing art source manifest group: ${groupKey}`);
      }
      const layerAddresses: { source: string; index: number }[][] = [];
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
        layerAddresses.push(pieces);
      }
      return layerAddresses;
    };

    const backgrounds = await deployArtSourceGroup("backgrounds");
    const breeds = await deployArtSourceGroup("breeds");
    const clothes = await deployArtSourceGroup("clothes");
    const moods = await deployArtSourceGroup("moods");
    const marks = await deployArtSourceGroup("marks");
    const mouths = await deployArtSourceGroup("mouths");
    const eyes = await deployArtSourceGroup("eyes");
    const accessories = await deployArtSourceGroup("accessories");

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

  async function deployFixture() {
    const [owner, poolManager, host, joiner, outsider] = await ethers.getSigners();

    const HookFactory = await ethers.getContractFactory("MockSeedHook");
    const hook = await HookFactory.deploy(ethers.encodeBytes32String("kpeg-seed"));
    await hook.waitForDeployment();

    const renderer = await deployRendererFixture();
    const TokenFactory = await ethers.getContractFactory("KPEGToken");
    const token = await TokenFactory.deploy(owner.address, await renderer.getAddress());
    await token.waitForDeployment();

    const GatewayFactory = await ethers.getContractFactory("KPEGBirthGateway");
    const gateway = await GatewayFactory.deploy(owner.address, await token.getAddress(), ethers.ZeroAddress);
    await gateway.waitForDeployment();
    const gatewayCode = await ethers.provider.getCode(await gateway.getAddress());
    await (await token.connect(owner).setBreedingContract(await gateway.getAddress(), ethers.keccak256(gatewayCode))).wait();

    await (await token.connect(owner).setHook(await hook.getAddress())).wait();
    await (await hook.startToken(await token.getAddress(), poolManager.address)).wait();

    const BreedingFactory = await ethers.getContractFactory("KPEGBreeding");
    const breeding = await BreedingFactory.deploy(
      await token.getAddress(),
      await gateway.getAddress(),
      await hook.getAddress(),
      owner.address
    );
    await breeding.waitForDeployment();
    await (await gateway.connect(owner).setAuthorizedCaller(await breeding.getAddress(), true)).wait();
    await (await gateway.connect(owner).freezeAuthorizations()).wait();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("160"))).wait();

    return { owner, poolManager, host, joiner, outsider, token, gateway, breeding };
  }

  async function buyOne(
    token: Awaited<ReturnType<typeof ethers.getContractAt>>,
    poolManager: SignerWithAddress,
    buyer: SignerWithAddress
  ): Promise<bigint> {
    await (await token.connect(poolManager).transfer(buyer.address, ethers.parseEther("1"))).wait();
    const ids = await token.getOwnerKitties(buyer.address);
    return ids[ids.length - 1] as bigint;
  }

  async function advanceToPoolReady(breeding: Awaited<ReturnType<typeof ethers.getContractAt>>, poolId: bigint) {
    const pool = await breeding.pools(poolId);
    if (Number(pool.cycleStartedAt) === 0) {
      return;
    }
    const readyAt = Number(pool.cycleStartedAt) + Number(pool.cycleDays) * 24 * 60 * 60;
    const now = await time.latest();
    if (readyAt > now) {
      await time.increase(readyAt - now + 1);
    }
  }

  async function settleUntilResult(
    breeding: Awaited<ReturnType<typeof ethers.getContractAt>>,
    caller: SignerWithAddress,
    poolId: bigint,
    expectedResult: number,
    maxAttempts = 40
  ) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await advanceToPoolReady(breeding, poolId);
      const settleReceipt = await (await breeding.connect(caller).settle(poolId)).wait();
      const settled = parseEventArgs(settleReceipt, await breeding.getAddress(), breeding.interface, "BreedingSettled");
      if (settled && Number(settled.result) === expectedResult) {
        return settled;
      }
    }
    throw new Error(`expected settlement result ${expectedResult} within ${maxAttempts} attempts`);
  }

  it("starts public breeding only after backing exists and enforces one backing slot per side", async () => {
    const { host, joiner, token, poolManager, breeding } = await deployFixture();

    const hostParent = await buyOne(token, poolManager, host);
    const hostBacking = await buyOne(token, poolManager, host);
    const hostExtraBacking = await buyOne(token, poolManager, host);

    const joinerParent = await buyOne(token, poolManager, joiner);
    const joinerBacking = await buyOne(token, poolManager, joiner);
    const joinerExtraBacking = await buyOne(token, poolManager, joiner);

    await (await token.connect(host).setKittyOperator(await breeding.getAddress(), true)).wait();
    await (await token.connect(joiner).setKittyOperator(await breeding.getAddress(), true)).wait();

    await (await breeding.connect(host).createPublicPool(hostParent, [], [])).wait();
    await (await breeding.connect(joiner).joinPublicPool(1, joinerParent)).wait();

    let pool = await breeding.pools(1);
    expect(pool.status).to.equal(0n); // OPEN (no current backing)

    await (await breeding.connect(host).stakeBacking(1, hostBacking)).wait();
    pool = await breeding.pools(1);
    expect(pool.status).to.equal(1n); // CYCLING
    expect(pool.currentBackingKittyId).to.equal(hostBacking);
    expect(pool.currentBackingProvider.toLowerCase()).to.equal(host.address.toLowerCase());
    expect(pool.currentBackingSide).to.equal(0n);

    await (await breeding.connect(joiner).stakeBacking(1, joinerBacking)).wait();
    pool = await breeding.pools(1);
    expect(pool.queuedBackingKittyId).to.equal(joinerBacking);
    expect(pool.queuedBackingProvider.toLowerCase()).to.equal(joiner.address.toLowerCase());
    expect(pool.queuedBackingSide).to.equal(1n);

    await expect(breeding.connect(host).stakeBacking(1, hostExtraBacking)).to.be.revertedWithCustomError(
      breeding,
      "BackingAlreadyStaked"
    );
    await expect(breeding.connect(joiner).stakeBacking(1, joinerExtraBacking)).to.be.revertedWithCustomError(
      breeding,
      "BackingAlreadyStaked"
    );
  });

  it("uses replacement birth in private pools and keeps kittiesLive unchanged on success", async () => {
    const { host, token, poolManager, breeding } = await deployFixture();

    const parentA = await buyOne(token, poolManager, host);
    const parentB = await buyOne(token, poolManager, host);
    const backing = await buyOne(token, poolManager, host);

    await (await token.connect(host).setKittyOperator(await breeding.getAddress(), true)).wait();
    await (await breeding.connect(host).createPrivatePool(parentA, parentB, backing)).wait();

    const liveBefore = await token.kittiesLive();
    const settled = await settleUntilResult(breeding, host, 1n, 0, 50);

    expect(await token.kittiesLive()).to.equal(liveBefore);
    expect((await token.getKitty(backing)).alive).to.equal(false);
    expect((await token.getKitty(parentA)).owner.toLowerCase()).to.equal((await breeding.getAddress()).toLowerCase());
    expect((await token.getKitty(parentB)).owner.toLowerCase()).to.equal((await breeding.getAddress()).toLowerCase());

    const claimId = BigInt(settled.claimId.toString());
    const childKittyId = BigInt(settled.childKittyId.toString());
    const claim = await breeding.claims(claimId);
    expect(claim.childOwner.toLowerCase()).to.equal(host.address.toLowerCase());
    expect(claim.claimed).to.equal(false);

    await (await breeding.connect(host).claimChild(claimId)).wait();
    expect((await token.getKitty(childKittyId)).owner.toLowerCase()).to.equal(host.address.toLowerCase());
  });

  it("keeps current backing staked after a failed settlement roll", async () => {
    const { host, token, poolManager, breeding } = await deployFixture();

    const parentA = await buyOne(token, poolManager, host);
    const parentB = await buyOne(token, poolManager, host);
    const backingA = await buyOne(token, poolManager, host);
    await (await token.connect(host).setKittyOperator(await breeding.getAddress(), true)).wait();
    await (await breeding.connect(host).createPrivatePool(parentA, parentB, backingA)).wait();

    let failed = false;
    let currentBacking = backingA;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      await advanceToPoolReady(breeding, 1n);
      const settleReceipt = await (await breeding.connect(host).settle(1)).wait();
      const settled = parseEventArgs(settleReceipt, await breeding.getAddress(), breeding.interface, "BreedingSettled");
      if (!settled) {
        continue;
      }
      const result = Number(settled.result);
      if (result === 1) {
        failed = true;
        break;
      }
      if (result === 0) {
        const pool = await breeding.pools(1);
        if (pool.currentBackingKittyId === 0n) {
          const refillBacking = await buyOne(token, poolManager, host);
          await (await breeding.connect(host).stakeBacking(1, refillBacking)).wait();
          currentBacking = refillBacking;
        } else {
          currentBacking = pool.currentBackingKittyId;
        }
      }
    }

    expect(failed).to.equal(true);
    const pool = await breeding.pools(1);
    expect(pool.currentBackingKittyId).to.equal(currentBacking);
    expect(await breeding.kittyPool(currentBacking)).to.equal(1n);
    expect((await token.getKitty(currentBacking)).owner.toLowerCase()).to.equal((await breeding.getAddress()).toLowerCase());
  });

  it("rotates current and queued backings after a failed roll in public pools", async () => {
    const { host, joiner, token, poolManager, breeding } = await deployFixture();

    const hostParent = await buyOne(token, poolManager, host);
    const hostBacking = await buyOne(token, poolManager, host);
    const joinerParent = await buyOne(token, poolManager, joiner);
    const joinerBacking = await buyOne(token, poolManager, joiner);

    await (await token.connect(host).setKittyOperator(await breeding.getAddress(), true)).wait();
    await (await token.connect(joiner).setKittyOperator(await breeding.getAddress(), true)).wait();

    await (await breeding.connect(host).createPublicPool(hostParent, [], [])).wait();
    await (await breeding.connect(joiner).joinPublicPool(1, joinerParent)).wait();
    await (await breeding.connect(host).stakeBacking(1, hostBacking)).wait();
    await (await breeding.connect(joiner).stakeBacking(1, joinerBacking)).wait();

    let rotated = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      let poolBefore = await breeding.pools(1);
      if (poolBefore.currentBackingKittyId === 0n) {
        const refill = await buyOne(token, poolManager, host);
        await (await breeding.connect(host).stakeBacking(1, refill)).wait();
        poolBefore = await breeding.pools(1);
      }
      if (poolBefore.queuedBackingKittyId === 0n) {
        if (poolBefore.currentBackingSide === 0n) {
          const refillJoiner = await buyOne(token, poolManager, joiner);
          await (await breeding.connect(joiner).stakeBacking(1, refillJoiner)).wait();
        } else {
          const refillHost = await buyOne(token, poolManager, host);
          await (await breeding.connect(host).stakeBacking(1, refillHost)).wait();
        }
        poolBefore = await breeding.pools(1);
      }

      const preCurrentKitty = poolBefore.currentBackingKittyId;
      const preCurrentProvider = poolBefore.currentBackingProvider;
      const preQueuedKitty = poolBefore.queuedBackingKittyId;
      const preQueuedProvider = poolBefore.queuedBackingProvider;

      await advanceToPoolReady(breeding, 1n);
      const settleReceipt = await (await breeding.connect(host).settle(1)).wait();
      const settled = parseEventArgs(settleReceipt, await breeding.getAddress(), breeding.interface, "BreedingSettled");
      if (!settled || Number(settled.result) !== 1) {
        continue;
      }

      const pool = await breeding.pools(1);
      expect(pool.currentBackingKittyId).to.equal(preQueuedKitty);
      expect(pool.currentBackingProvider.toLowerCase()).to.equal(String(preQueuedProvider).toLowerCase());
      expect(pool.queuedBackingKittyId).to.equal(preCurrentKitty);
      expect(pool.queuedBackingProvider.toLowerCase()).to.equal(String(preCurrentProvider).toLowerCase());
      rotated = true;
      break;
    }

    expect(rotated).to.equal(true);
  });

  it("auto-settles a ready pool before stake/leave interactions", async () => {
    const { host, joiner, token, poolManager, breeding } = await deployFixture();

    const hostParent = await buyOne(token, poolManager, host);
    const hostBacking = await buyOne(token, poolManager, host);
    const joinerParent = await buyOne(token, poolManager, joiner);
    const joinerBacking = await buyOne(token, poolManager, joiner);

    await (await token.connect(host).setKittyOperator(await breeding.getAddress(), true)).wait();
    await (await token.connect(joiner).setKittyOperator(await breeding.getAddress(), true)).wait();

    await (await breeding.connect(host).createPublicPool(hostParent, [], [])).wait();
    await (await breeding.connect(joiner).joinPublicPool(1, joinerParent)).wait();
    await (await breeding.connect(host).stakeBacking(1, hostBacking)).wait();

    await advanceToPoolReady(breeding, 1n);
    const stakeReceipt = await (await breeding.connect(joiner).stakeBacking(1, joinerBacking)).wait();
    const stakeSettled = parseEventArgs(stakeReceipt, await breeding.getAddress(), breeding.interface, "BreedingSettled");
    expect(stakeSettled).to.not.equal(null);

    const poolAfterStake = await breeding.pools(1);
    const current = poolAfterStake.currentBackingKittyId;
    const queued = poolAfterStake.queuedBackingKittyId;
    expect(current === hostBacking || current === joinerBacking).to.equal(true);
    expect(queued === 0n || queued === hostBacking || queued === joinerBacking).to.equal(true);

    await advanceToPoolReady(breeding, 1n);
    const leaveReceipt = await (await breeding.connect(host).leavePool(1)).wait();
    const leaveSettled = parseEventArgs(leaveReceipt, await breeding.getAddress(), breeding.interface, "BreedingSettled");
    const left = parseEventArgs(leaveReceipt, await breeding.getAddress(), breeding.interface, "BreedingPoolLeft");
    expect(leaveSettled).to.not.equal(null);
    expect(left).to.not.equal(null);
  });

  it("uses current then queued backing ownership for public successful children", async () => {
    const { host, joiner, token, poolManager, breeding } = await deployFixture();

    const hostParent = await buyOne(token, poolManager, host);
    const hostBackingA1 = await buyOne(token, poolManager, host);
    const hostBackingA2 = await buyOne(token, poolManager, host);

    const joinerParent = await buyOne(token, poolManager, joiner);
    const joinerBackingB1 = await buyOne(token, poolManager, joiner);
    const joinerBackingB2 = await buyOne(token, poolManager, joiner);

    await (await token.connect(host).setKittyOperator(await breeding.getAddress(), true)).wait();
    await (await token.connect(joiner).setKittyOperator(await breeding.getAddress(), true)).wait();

    await (await breeding.connect(host).createPublicPool(hostParent, [], [])).wait();
    await (await breeding.connect(joiner).joinPublicPool(1, joinerParent)).wait();
    await (await breeding.connect(host).stakeBacking(1, hostBackingA1)).wait();
    await (await breeding.connect(joiner).stakeBacking(1, joinerBackingB1)).wait();

    let firstSuccessOwner = "";
    let firstSuccessCurrentBacking = 0n;
    let firstSuccessQueuedBacking = 0n;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await advanceToPoolReady(breeding, 1n);
      const poolBefore = await breeding.pools(1);
      const settleReceipt = await (await breeding.connect(host).settle(1)).wait();
      const settled = parseEventArgs(settleReceipt, await breeding.getAddress(), breeding.interface, "BreedingSettled");
      if (!settled || Number(settled.result) !== 0) {
        continue;
      }
      firstSuccessOwner = String(settled.childOwner).toLowerCase();
      expect(firstSuccessOwner).to.equal(poolBefore.currentBackingProvider.toLowerCase());
      firstSuccessCurrentBacking = poolBefore.currentBackingKittyId;
      firstSuccessQueuedBacking = poolBefore.queuedBackingKittyId;
      break;
    }
    expect(firstSuccessOwner).to.not.equal("");
    expect(firstSuccessCurrentBacking).to.not.equal(0n);

    let pool = await breeding.pools(1);
    if (firstSuccessQueuedBacking !== 0n) {
      expect(pool.currentBackingKittyId).to.equal(firstSuccessQueuedBacking);
    } else {
      expect(pool.currentBackingKittyId).to.equal(0n);
    }

    if (pool.currentBackingSide === 0n) {
      await (await breeding.connect(joiner).stakeBacking(1, joinerBackingB2)).wait();
    } else {
      await (await breeding.connect(host).stakeBacking(1, hostBackingA2)).wait();
    }

    let secondSuccessOwner = "";
    let secondSuccessCurrentBacking = 0n;
    let secondSuccessQueuedBacking = 0n;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await advanceToPoolReady(breeding, 1n);
      const poolBefore = await breeding.pools(1);
      const settleReceipt = await (await breeding.connect(host).settle(1)).wait();
      const settled = parseEventArgs(settleReceipt, await breeding.getAddress(), breeding.interface, "BreedingSettled");
      if (!settled || Number(settled.result) !== 0) {
        continue;
      }
      secondSuccessOwner = String(settled.childOwner).toLowerCase();
      expect(secondSuccessOwner).to.equal(poolBefore.currentBackingProvider.toLowerCase());
      secondSuccessCurrentBacking = poolBefore.currentBackingKittyId;
      secondSuccessQueuedBacking = poolBefore.queuedBackingKittyId;
      break;
    }
    expect(secondSuccessOwner).to.not.equal("");
    expect(secondSuccessCurrentBacking).to.not.equal(0n);

    pool = await breeding.pools(1);
    if (secondSuccessQueuedBacking !== 0n) {
      expect(pool.currentBackingKittyId).to.equal(secondSuccessQueuedBacking);
    } else {
      expect(pool.currentBackingKittyId).to.equal(0n);
    }
  });

  it("withdraws current backing, promotes queued backing, and keeps cycle running", async () => {
    const { host, joiner, token, poolManager, breeding } = await deployFixture();

    const hostParent = await buyOne(token, poolManager, host);
    const hostBacking = await buyOne(token, poolManager, host);
    const joinerParent = await buyOne(token, poolManager, joiner);
    const joinerBacking = await buyOne(token, poolManager, joiner);

    await (await token.connect(host).setKittyOperator(await breeding.getAddress(), true)).wait();
    await (await token.connect(joiner).setKittyOperator(await breeding.getAddress(), true)).wait();

    await (await breeding.connect(host).createPublicPool(hostParent, [], [])).wait();
    await (await breeding.connect(joiner).joinPublicPool(1, joinerParent)).wait();
    await (await breeding.connect(host).stakeBacking(1, hostBacking)).wait();
    await (await breeding.connect(joiner).stakeBacking(1, joinerBacking)).wait();

    await (await breeding.connect(host).withdrawBacking(1)).wait();

    const pool = await breeding.pools(1);
    expect(pool.currentBackingKittyId).to.equal(joinerBacking);
    expect(pool.currentBackingProvider.toLowerCase()).to.equal(joiner.address.toLowerCase());
    expect(pool.queuedBackingKittyId).to.equal(0n);
    expect(pool.status).to.equal(1n); // CYCLING
    expect((await token.getKitty(hostBacking)).owner.toLowerCase()).to.equal(host.address.toLowerCase());
  });
});
