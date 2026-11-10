import { expect } from "chai";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { ACCESSORIES, BACKGROUNDS, BREEDS, CLOTHES, EYES, MARKS, MOODS, MOUTHS, renderKPEGSvg, type KPEGTraits } from "@kpeg/core";
import { execFileSync } from "node:child_process";
import { Resvg } from "@resvg/resvg-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ART_SOURCE_MANIFEST = JSON.parse(
  readFileSync(resolve(__dirname, "../src/generated/artSourceManifest.json"), "utf8")
) as Record<string, { contractName: string; index: number }[][]>;

describe("KPEGToken", () => {
  function packTraits(traits: KPEGTraits): bigint {
    return (
      BigInt(BACKGROUNDS.indexOf(traits.background)) |
      (BigInt(BREEDS.indexOf(traits.breed)) << 8n) |
      (BigInt(CLOTHES.indexOf(traits.clothes)) << 16n) |
      (BigInt(MOODS.indexOf(traits.mood)) << 24n) |
      (BigInt(MARKS.indexOf(traits.marks)) << 32n) |
      (BigInt(MOUTHS.indexOf(traits.mouth)) << 40n) |
      (BigInt(EYES.indexOf(traits.eyes)) << 48n) |
      (BigInt(ACCESSORIES.indexOf(traits.accessory)) << 56n)
    );
  }

  function renderPixelMap(svg: string): string {
    const png = new Resvg(svg, { background: "rgba(0,0,0,0)" }).render().asPng();
    return execFileSync("magick", ["png:-", "txt:-"], {
      input: png,
      maxBuffer: 10_000_000
    })
      .toString("utf8")
      .split("\n")
      .slice(1)
      .join("\n");
  }

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

  async function deployTokenFixture() {
    const [owner, poolManager, alice, bob] = await ethers.getSigners();

    const HookFactory = await ethers.getContractFactory("MockSeedHook");
    const hook = await HookFactory.deploy(ethers.encodeBytes32String("kpeg-seed"));
    await hook.waitForDeployment();

    const renderer = await deployRendererFixture();

    const TokenFactory = await ethers.getContractFactory("KPEGToken");
    const token = await TokenFactory.deploy(owner.address, await renderer.getAddress());
    await token.waitForDeployment();

    await (await token.connect(owner).setHook(await hook.getAddress())).wait();
    await (await hook.startToken(await token.getAddress(), poolManager.address)).wait();

    return { token, hook, renderer, owner, poolManager, alice, bob };
  }

  async function deployTokenPreStartFixture() {
    const [owner, poolManager, alice, bob] = await ethers.getSigners();
    const HookFactory = await ethers.getContractFactory("MockSeedHook");
    const hook = await HookFactory.deploy(ethers.encodeBytes32String("kpeg-seed"));
    await hook.waitForDeployment();
    const renderer = await deployRendererFixture();
    const TokenFactory = await ethers.getContractFactory("KPEGToken");
    const token = await TokenFactory.deploy(owner.address, await renderer.getAddress());
    await token.waitForDeployment();
    return { token, hook, renderer, owner, poolManager, alice, bob };
  }

  async function deployBreedingCaller(tokenAddress: string) {
    const BreedingFactory = await ethers.getContractFactory("MockBreedingCaller");
    const breeding = await BreedingFactory.deploy(tokenAddress);
    await breeding.waitForDeployment();
    const code = await ethers.provider.getCode(await breeding.getAddress());
    return { breeding, codeHash: ethers.keccak256(code) };
  }

  async function deployBirthGateway(tokenAddress: string, ownerAddress: string, initialAuthorizedCaller = ethers.ZeroAddress) {
    const GatewayFactory = await ethers.getContractFactory("KPEGBirthGateway");
    const gateway = await GatewayFactory.deploy(ownerAddress, tokenAddress, initialAuthorizedCaller);
    await gateway.waitForDeployment();
    const code = await ethers.provider.getCode(await gateway.getAddress());
    return { gateway, codeHash: ethers.keccak256(code) };
  }

  async function growMaxBuyForLargeBatch() {
    await time.increase(260);
  }

  it("uses a fixed 9,999 token supply", async () => {
    const [owner] = await ethers.getSigners();
    const renderer = await deployRendererFixture();
    const TokenFactory = await ethers.getContractFactory("KPEGToken");
    const token = await TokenFactory.deploy(owner.address, await renderer.getAddress());
    await token.waitForDeployment();

    expect(await token.totalSupply()).to.equal(ethers.parseEther("9999"));
    expect(await token.balanceOf(owner.address)).to.equal(ethers.parseEther("9999"));
    expect(await token.renderer()).to.equal(await renderer.getAddress());
  });

  it("renounces token ownership and blocks owner-only setup calls", async () => {
    const { token, owner, alice } = await deployTokenPreStartFixture();

    await expect(token.connect(alice).renounceOwnership()).to.be.revertedWithCustomError(token, "OnlyOwner");
    await expect(token.connect(owner).renounceOwnership())
      .to.emit(token, "OwnershipRenounced")
      .withArgs(owner.address);
    expect(await token.owner()).to.equal(ethers.ZeroAddress);

    await expect(token.connect(owner).setHook(alice.address)).to.be.revertedWithCustomError(token, "OnlyOwner");
    await expect(token.connect(owner).setBreedingContract(alice.address, ethers.keccak256(ethers.toUtf8Bytes("hash"))))
      .to.be.revertedWithCustomError(token, "OnlyOwner");
  });

  it("sets the breeding contract once before start and blocks updates after start", async () => {
    const { token, hook, owner, poolManager, alice, bob } = await deployTokenPreStartFixture();
    const codeHash = ethers.keccak256(ethers.toUtf8Bytes("future-breeding-runtime"));
    await expect(token.connect(alice).setBreedingContract(alice.address, codeHash)).to.be.revertedWithCustomError(
      token,
      "OnlyOwner"
    );
    await expect(token.connect(owner).setBreedingContract(ethers.ZeroAddress, codeHash)).to.be.revertedWithCustomError(
      token,
      "ZeroBreedingContract"
    );
    await expect(token.connect(owner).setBreedingContract(alice.address, ethers.ZeroHash)).to.be.revertedWithCustomError(
      token,
      "ZeroBreedingContractCodeHash"
    );

    await (await token.connect(owner).setBreedingContract(alice.address, codeHash)).wait();
    expect(await token.breedingContract()).to.equal(alice.address);
    expect(await token.breedingContractCodeHash()).to.equal(codeHash);
    await expect(token.connect(owner).setBreedingContract(bob.address, codeHash)).to.be.revertedWithCustomError(
      token,
      "BreedingContractAlreadySet"
    );

    await (await token.connect(owner).setHook(await hook.getAddress())).wait();
    await (await hook.startToken(await token.getAddress(), poolManager.address)).wait();
    await expect(token.connect(owner).setBreedingContract(bob.address, codeHash)).to.be.revertedWithCustomError(
      token,
      "AlreadyStarted"
    );
  });

  it("rejects an already-deployed breeding contract when runtime code hash does not match", async () => {
    const { token, owner } = await deployTokenPreStartFixture();
    const { breeding } = await deployBreedingCaller(await token.getAddress());
    await expect(
      token.connect(owner).setBreedingContract(await breeding.getAddress(), ethers.keccak256(ethers.toUtf8Bytes("wrong")))
    ).to.be.revertedWithCustomError(token, "BreedingContractCodeHashMismatch");
  });

  it("replaces a staked backing kitty with a born kitty from an authorized breeding caller", async () => {
    const { token, hook, owner, poolManager, bob } = await deployTokenPreStartFixture();
    const { breeding, codeHash } = await deployBreedingCaller(await token.getAddress());
    await (await token.connect(owner).setBreedingContract(await breeding.getAddress(), codeHash)).wait();
    await (await token.connect(owner).setHook(await hook.getAddress())).wait();
    await (await hook.startToken(await token.getAddress(), poolManager.address)).wait();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("2"))).wait();
    await (await token.connect(poolManager).transfer(bob.address, ethers.parseEther("1"))).wait();
    const [backingKittyId] = await token.getOwnerKitties(bob.address);
    await (await token.connect(bob).directTransferKitty(backingKittyId, await breeding.getAddress())).wait();

    const seedSalt = ethers.encodeBytes32String("born-seed");
    const packedTraits = 0n;

    await expect(
      token.connect(bob).replaceBornKPEG(backingKittyId, await breeding.getAddress(), 9, seedSalt, packedTraits)
    ).to.be.revertedWithCustomError(token, "OnlyBreedingContract");

    const tx = await breeding.mint(backingKittyId, await breeding.getAddress(), 9, seedSalt, packedTraits);
    await expect(tx).to.emit(token, "KittyBatchBurned").withArgs(await breeding.getAddress(), backingKittyId, 1);
    await expect(tx).to.emit(token, "KittyBatchMinted").withArgs(await breeding.getAddress(), 2, 1, 4, 1, anyValue);
    await expect(tx).to.emit(token, "BornKPEGMinted").withArgs(await breeding.getAddress(), 2, 4, seedSalt, packedTraits);

    expect(await token.kittiesLive()).to.equal(1);
    expect(await token.kittiesEverMinted()).to.equal(2);
    expect(await token.ownerKittiesLive(await breeding.getAddress())).to.equal(1);
    expect(await token.getOwnerKitties(await breeding.getAddress())).to.deep.equal([2n]);
    expect((await token.getKitty(backingKittyId)).alive).to.equal(false);
  });

  it("allows replacement birth at live cap 9,999 while keeping kittiesLive unchanged", async () => {
    const { token, hook, owner, poolManager, alice, bob } = await deployTokenPreStartFixture();
    const { breeding, codeHash } = await deployBreedingCaller(await token.getAddress());
    await (await token.connect(owner).setBreedingContract(await breeding.getAddress(), codeHash)).wait();
    await (await token.connect(owner).setHook(await hook.getAddress())).wait();
    await (await hook.startToken(await token.getAddress(), poolManager.address)).wait();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("9999"))).wait();
    await time.increase(40_000);
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("9998"))).wait();
    await (await token.connect(poolManager).transfer(bob.address, ethers.parseEther("1"))).wait();

    expect(await token.kittiesLive()).to.equal(9999);
    const [backingKittyId] = await token.getOwnerKitties(bob.address);
    await (await token.connect(bob).directTransferKitty(backingKittyId, await breeding.getAddress())).wait();

    await (await breeding.mint(backingKittyId, await breeding.getAddress(), 2, ethers.encodeBytes32String("cap-born"), 0)).wait();

    expect(await token.kittiesLive()).to.equal(9999);
    expect((await token.getKitty(backingKittyId)).alive).to.equal(false);
  });

  it("supports a future owned-CREATE2 breeding caller without letting a raw address mint", async () => {
    const { token, hook, owner, poolManager, alice, bob } = await deployTokenPreStartFixture();
    const OwnedCreate2Factory = await ethers.getContractFactory("OwnedCreate2Deployer");
    const ownedCreate2 = await OwnedCreate2Factory.deploy(owner.address);
    await ownedCreate2.waitForDeployment();

    const BreedingFactory = await ethers.getContractFactory("MockBreedingCaller");
    const constructorArgs = BreedingFactory.interface.encodeDeploy([await token.getAddress()]);
    const initCode = ethers.concat([BreedingFactory.bytecode as `0x${string}`, constructorArgs as `0x${string}`]);
    const salt = ethers.encodeBytes32String("future-breeding");
    const futureBreedingAddress = ethers.getCreate2Address(await ownedCreate2.getAddress(), salt, ethers.keccak256(initCode));

    const { codeHash } = await deployBreedingCaller(await token.getAddress());
    await (await token.connect(owner).setBreedingContract(futureBreedingAddress, codeHash)).wait();
    await (await token.connect(owner).setHook(await hook.getAddress())).wait();
    await (await hook.startToken(await token.getAddress(), poolManager.address)).wait();
    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("9998"))).wait();

    await expect(
      token.connect(owner).replaceBornKPEG(1, bob.address, 1, ethers.encodeBytes32String("not-contract"), 0)
    ).to.be.revertedWithCustomError(token, "OnlyBreedingContract");

    await (await token.connect(poolManager).transfer(bob.address, ethers.parseEther("1"))).wait();
    const [futureBackingId] = await token.getOwnerKitties(bob.address);
    await (await token.connect(bob).directTransferKitty(futureBackingId, futureBreedingAddress)).wait();

    await expect(ownedCreate2.connect(alice).deployCode(salt, initCode)).to.be.revertedWithCustomError(
      ownedCreate2,
      "OnlyOwner"
    );
    await (await ownedCreate2.connect(owner).deployCode(salt, initCode)).wait();
    const futureBreeding = await ethers.getContractAt("MockBreedingCaller", futureBreedingAddress);
    const tx = await futureBreeding.mint(
      futureBackingId,
      futureBreedingAddress,
      1,
      ethers.encodeBytes32String("future-born"),
      0
    );
    await expect(tx)
      .to.emit(token, "BornKPEGMinted")
      .withArgs(futureBreedingAddress, 2, 1, ethers.encodeBytes32String("future-born"), 0);
  });

  it("routes birth minting through the final birth gateway with authorized callers only", async () => {
    const { token, hook, owner, poolManager, alice, bob } = await deployTokenPreStartFixture();
    const { gateway, codeHash } = await deployBirthGateway(await token.getAddress(), owner.address, alice.address);

    await (await token.connect(owner).setBreedingContract(await gateway.getAddress(), codeHash)).wait();
    await (await token.connect(owner).setHook(await hook.getAddress())).wait();
    await (await hook.startToken(await token.getAddress(), poolManager.address)).wait();
    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("2"))).wait();
    await (await token.connect(poolManager).transfer(bob.address, ethers.parseEther("1"))).wait();
    const [backingKittyId] = await token.getOwnerKitties(bob.address);

    await expect(
      gateway.connect(bob).replaceBornKPEG(backingKittyId, bob.address, 2, ethers.encodeBytes32String("blocked"), 0)
    ).to.be.revertedWithCustomError(gateway, "NotAuthorizedCaller");

    await expect(
      gateway.connect(alice).replaceBornKPEG(backingKittyId, bob.address, 2, ethers.encodeBytes32String("gateway-born"), 0)
    ).to.be.revertedWithCustomError(gateway, "InvalidChildCustody");

    await (await token.connect(bob).directTransferKitty(backingKittyId, alice.address)).wait();

    await expect(
      gateway.connect(alice).replaceBornKPEG(backingKittyId, alice.address, 2, ethers.encodeBytes32String("gateway-born"), 0)
    )
      .to.emit(token, "BornKPEGMinted")
      .withArgs(alice.address, 2, 2, ethers.encodeBytes32String("gateway-born"), 0);
  });

  it("lets gateway owner manage authorized callers", async () => {
    const { token, owner, alice, bob } = await deployTokenPreStartFixture();
    const { gateway } = await deployBirthGateway(await token.getAddress(), owner.address);

    await expect(gateway.connect(alice).setAuthorizedCaller(alice.address, true)).to.be.revertedWithCustomError(
      gateway,
      "OnlyOwner"
    );
    await expect(gateway.connect(owner).setAuthorizedCaller(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(
      gateway,
      "ZeroAddress"
    );

    await (await gateway.connect(owner).setAuthorizedCaller(alice.address, true)).wait();
    expect(await gateway.authorizedCallers(alice.address)).to.equal(true);

    await (await gateway.connect(owner).setAuthorizedCaller(alice.address, false)).wait();
    expect(await gateway.authorizedCallers(alice.address)).to.equal(false);
    expect(await gateway.authorizedCallers(bob.address)).to.equal(false);
  });

  it("freezes gateway authorizations after final setup", async () => {
    const { token, owner, alice, bob } = await deployTokenPreStartFixture();
    const { gateway } = await deployBirthGateway(await token.getAddress(), owner.address);

    await (await gateway.connect(owner).setAuthorizedCaller(alice.address, true)).wait();
    expect(await gateway.authorizedCallers(alice.address)).to.equal(true);
    await (await gateway.connect(owner).freezeAuthorizations()).wait();
    expect(await gateway.authorizationsFrozen()).to.equal(true);

    await expect(gateway.connect(owner).setAuthorizedCaller(bob.address, true)).to.be.revertedWithCustomError(
      gateway,
      "AuthorizationsFrozen"
    );
    await expect(gateway.connect(owner).freezeAuthorizations()).to.be.revertedWithCustomError(
      gateway,
      "AuthorizationsFrozen"
    );
  });

  it("renounces gateway ownership and blocks owner-only authorization updates", async () => {
    const { token, owner, alice } = await deployTokenPreStartFixture();
    const { gateway } = await deployBirthGateway(await token.getAddress(), owner.address);

    await expect(gateway.connect(owner).renounceOwnership())
      .to.emit(gateway, "OwnershipRenounced")
      .withArgs(owner.address);
    expect(await gateway.owner()).to.equal(ethers.ZeroAddress);

    await expect(gateway.connect(owner).setAuthorizedCaller(alice.address, true)).to.be.revertedWithCustomError(
      gateway,
      "OnlyOwner"
    );
    await expect(gateway.connect(owner).freezeAuthorizations()).to.be.revertedWithCustomError(gateway, "OnlyOwner");
  });

  it("mints floor(whole bought) kitties on pool-originated buys and assigns tier by buy batch", async () => {
    const { token, owner, poolManager, alice, bob } = await deployTokenFixture();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("10"))).wait();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("3.9"))).wait();

    const aliceKitties = await token.getOwnerKitties(alice.address);
    expect(aliceKitties.length).to.equal(3);
    expect(await token.ownerKittiesLive(alice.address)).to.equal(3);
    expect(await token.kittiesLive()).to.equal(3);
    expect(await token.kittiesEverMinted()).to.equal(3);

    const firstKitty = await token.getKitty(aliceKitties[0]);
    expect(firstKitty.tier).to.equal(0);

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("25"))).wait();
    await (await token.connect(poolManager).transfer(bob.address, ethers.parseEther("25"))).wait();

    const bobKitties = await token.getOwnerKitties(bob.address);
    expect(bobKitties.length).to.equal(25);
    expect(await token.ownerKittiesLive(bob.address)).to.equal(25);
    expect((await token.getKitty(bobKitties[0])).tier).to.equal(1);
  });

  it("mints a 100-kitty buy as one batch without per-kitty swap storage", async () => {
    const { token, owner, poolManager, alice } = await deployTokenFixture();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("100"))).wait();
    await growMaxBuyForLargeBatch();
    const tx = await token.connect(poolManager).transfer(alice.address, ethers.parseEther("100"));
    await expect(tx)
      .to.emit(token, "KittyBatchMinted")
      .withArgs(alice.address, 1, 100, 3, 100, anyValue);
    const receipt = await tx.wait();

    expect((await token.getOwnerKitties(alice.address)).length).to.equal(100);
    expect(await token.kittiesEverMinted()).to.equal(100);
    expect(await token.kittiesLive()).to.equal(100);
    expect(receipt!.gasUsed).to.be.lessThan(1_000_000n);
  });

  it("moves sender kitties to the receiver on normal transfers before burning the remainder", async () => {
    const { token, owner, poolManager, alice, bob } = await deployTokenFixture();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("10"))).wait();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("3"))).wait();

    const beforeTransferKitties = await token.getOwnerKitties(alice.address);
    await (await token.connect(alice).transfer(bob.address, ethers.parseEther("1.4"))).wait();

    const aliceKitties = await token.getOwnerKitties(alice.address);
    const bobKitties = await token.getOwnerKitties(bob.address);

    expect(aliceKitties.length).to.equal(1);
    expect(bobKitties.length).to.equal(1);
    expect(await token.kittiesEverMinted()).to.equal(3);
    expect(await token.kittiesLive()).to.equal(2);
    expect(beforeTransferKitties.map((value: bigint) => value.toString())).to.include(bobKitties[0].toString());
  });

  it("burns kitties when balances fall below whole-token ownership after selling back to the pool", async () => {
    const { token, owner, poolManager, alice } = await deployTokenFixture();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("10"))).wait();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("3"))).wait();
    await (await token.connect(alice).transfer(poolManager.address, ethers.parseEther("2"))).wait();

    expect((await token.getOwnerKitties(alice.address)).length).to.equal(1);
    expect(await token.kittiesLive()).to.equal(1);
    expect(await token.kittiesEverMinted()).to.equal(3);
  });

  it("directly transfers the chosen kitty together with exactly one token", async () => {
    const { token, owner, poolManager, alice, bob } = await deployTokenFixture();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("10"))).wait();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("2"))).wait();

    const aliceKittiesBefore = Array.from(await token.getOwnerKitties(alice.address));
    const movedKittyId = aliceKittiesBefore[0];

    const aliceBalanceBefore = await token.balanceOf(alice.address);
    const bobBalanceBefore = await token.balanceOf(bob.address);

    await (await token.connect(alice).directTransferKitty(movedKittyId, bob.address)).wait();

    const aliceKittiesAfter = await token.getOwnerKitties(alice.address);
    const bobKittiesAfter = await token.getOwnerKitties(bob.address);

    expect(aliceKittiesAfter.length).to.equal(1);
    expect(bobKittiesAfter.length).to.equal(1);
    expect(bobKittiesAfter[0]).to.equal(movedKittyId);
    expect(await token.balanceOf(alice.address)).to.equal(aliceBalanceBefore - ethers.parseEther("1"));
    expect(await token.balanceOf(bob.address)).to.equal(bobBalanceBefore + ethers.parseEther("1"));
  });

  it("directly transfers a chosen kitty bundle atomically", async () => {
    const { token, owner, poolManager, alice, bob } = await deployTokenFixture();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("10"))).wait();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("3"))).wait();

    const aliceKittiesBefore = Array.from(await token.getOwnerKitties(alice.address));
    const movedKittyIds = [aliceKittiesBefore[0], aliceKittiesBefore[2]];
    const aliceBalanceBefore = await token.balanceOf(alice.address);
    const bobBalanceBefore = await token.balanceOf(bob.address);

    await (await token.connect(alice).directTransferKittiesList(bob.address, movedKittyIds)).wait();

    expect(await token.getOwnerKitties(alice.address)).to.have.length(1);
    expect((await token.getOwnerKitties(bob.address)).map((value: bigint) => value.toString())).to.deep.equal(
      movedKittyIds.map((value: bigint) => value.toString())
    );
    expect(await token.balanceOf(alice.address)).to.equal(aliceBalanceBefore - ethers.parseEther("2"));
    expect(await token.balanceOf(bob.address)).to.equal(bobBalanceBefore + ethers.parseEther("2"));
  });

  it("moves a contiguous 100-kitty bundle with one batched ownership update", async () => {
    const { token, owner, poolManager, alice, bob } = await deployTokenFixture();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("100"))).wait();
    await growMaxBuyForLargeBatch();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("100"))).wait();

    const aliceKittiesBefore = Array.from(await token.getOwnerKitties(alice.address));
    const tx = await token.connect(alice).directTransferKittiesList(bob.address, aliceKittiesBefore);
    await expect(tx).to.emit(token, "KittyBatchMoved").withArgs(alice.address, bob.address, 1, 100);
    const receipt = await tx.wait();

    expect(await token.ownerKittiesLive(alice.address)).to.equal(0);
    expect(await token.ownerKittiesLive(bob.address)).to.equal(100);
    expect((await token.getOwnerKitties(bob.address)).map((value: bigint) => value.toString())).to.deep.equal(
      aliceKittiesBefore.map((value: bigint) => value.toString())
    );
    expect(receipt!.gasUsed).to.be.lessThan(230_000n);
  });

  it("rejects duplicate kitties in a direct bundle transfer without moving any kitty", async () => {
    const { token, owner, poolManager, alice, bob } = await deployTokenFixture();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("10"))).wait();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("2"))).wait();

    const aliceKittiesBefore = await token.getOwnerKitties(alice.address);
    await expect(
      token.connect(alice).directTransferKittiesList(bob.address, [aliceKittiesBefore[0], aliceKittiesBefore[0]])
    ).to.be.revertedWithCustomError(token, "DuplicateKitty");

    expect((await token.getOwnerKitties(alice.address)).map((value: bigint) => value.toString())).to.deep.equal(
      aliceKittiesBefore.map((value: bigint) => value.toString())
    );
    expect(await token.getOwnerKitties(bob.address)).to.have.length(0);
  });

  it("rejects unsorted direct bundle transfers before moving any kitty", async () => {
    const { token, owner, poolManager, alice, bob } = await deployTokenFixture();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("10"))).wait();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("3"))).wait();

    const aliceKittiesBefore = await token.getOwnerKitties(alice.address);
    await expect(
      token.connect(alice).directTransferKittiesList(bob.address, [aliceKittiesBefore[2], aliceKittiesBefore[0]])
    ).to.be.revertedWithCustomError(token, "KittyListNotSorted");

    expect((await token.getOwnerKitties(alice.address)).map((value: bigint) => value.toString())).to.deep.equal(
      aliceKittiesBefore.map((value: bigint) => value.toString())
    );
    expect(await token.getOwnerKitties(bob.address)).to.have.length(0);
  });

  it("requires selected kitty approval for atomic market listings", async () => {
    const { token, owner, poolManager, alice } = await deployTokenFixture();
    const MarketFactory = await ethers.getContractFactory("KPEGMarket");
    const market = await MarketFactory.deploy(await token.getAddress(), owner.address);
    await market.waitForDeployment();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("10"))).wait();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("1"))).wait();

    const [kittyId] = await token.getOwnerKitties(alice.address);
    await expect(
      market.connect(alice).createTradeAndFund(ethers.ZeroAddress, ethers.parseEther("1"), [kittyId])
    ).to.be.revertedWithCustomError(token, "NotKittyOperator");

    await (await token.connect(alice).setKittyTransferApproval(await market.getAddress(), [kittyId], true)).wait();
    await expect(
      market.connect(alice).createTradeAndFund(ethers.ZeroAddress, ethers.parseEther("1"), [kittyId])
    ).to.not.be.reverted;
  });

  it("validates selected kitty approval inputs", async () => {
    const { token, owner, poolManager, alice, bob } = await deployTokenFixture();
    const MarketFactory = await ethers.getContractFactory("KPEGMarket");
    const market = await MarketFactory.deploy(await token.getAddress(), owner.address);
    await market.waitForDeployment();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("3"))).wait();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("2"))).wait();

    const aliceKitties = await token.getOwnerKitties(alice.address);
    const [kittyA, kittyB] = aliceKitties;

    await expect(
      token.connect(alice).setKittyTransferApproval(ethers.ZeroAddress, [kittyA], true)
    ).to.be.revertedWithCustomError(token, "ZeroAddress");

    await expect(
      token.connect(alice).setKittyTransferApproval(await market.getAddress(), [], true)
    ).to.be.revertedWithCustomError(token, "EmptyKittyList");

    await expect(
      token.connect(alice).setKittyTransferApproval(await market.getAddress(), [kittyA, kittyA], true)
    ).to.be.revertedWithCustomError(token, "DuplicateKitty");

    await expect(
      token.connect(alice).setKittyTransferApproval(await market.getAddress(), [kittyB, kittyA], true)
    ).to.be.revertedWithCustomError(token, "KittyListNotSorted");

    await expect(
      token.connect(bob).setKittyTransferApproval(await market.getAddress(), [kittyA], true)
    ).to.be.revertedWithCustomError(token, "NotKittyOwner");
  });

  it("lists, buys, and cancels p2p market kitty bundles atomically", async () => {
    const { token, owner, poolManager, alice, bob } = await deployTokenFixture();
    const MarketFactory = await ethers.getContractFactory("KPEGMarket");
    const market = await MarketFactory.deploy(await token.getAddress(), owner.address);
    await market.waitForDeployment();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("20"))).wait();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("4"))).wait();

    const aliceKitties = await token.getOwnerKitties(alice.address);
    const listedIds = [aliceKitties[0], aliceKitties[1]];
    const price = ethers.parseEther("1");

    await (await token.connect(alice).setKittyTransferApproval(await market.getAddress(), listedIds, true)).wait();
    await (
      await market.connect(alice).createTradeAndFund(ethers.ZeroAddress, price, listedIds)
    ).wait();
    const tradeId = await market.positionsTotal();
    let position = await market.getPositionView(tradeId);
    expect(position.escrowAddress).to.equal(await market.getAddress());
    expect(position.status).to.equal(0);
    expect(position.ready).to.equal(true);
    expect(await market.getOpenPositions(0, 10)).to.deep.equal([tradeId]);
    expect(await market.getOpenPositionsByOwner(alice.address, 0, 10)).to.deep.equal([tradeId]);

    await expect(() =>
      market.connect(bob).buyAndClaimAll(tradeId, ethers.ZeroAddress, price, { value: price })
    ).to.changeEtherBalances([alice, owner], [ethers.parseEther("0.98"), ethers.parseEther("0.02")]);

    const bobKitties = (await token.getOwnerKitties(bob.address)).map((value: bigint) => value.toString());
    expect(bobKitties).to.deep.equal(listedIds.map((value: bigint) => value.toString()));
    expect((await market.getPositionView(tradeId)).status).to.equal(1);

    const cancelIds = [aliceKitties[2], aliceKitties[3]];
    await (await token.connect(alice).setKittyTransferApproval(await market.getAddress(), cancelIds, true)).wait();
    await (
      await market.connect(alice).createTradeAndFund(ethers.ZeroAddress, price, cancelIds)
    ).wait();
    const cancelTradeId = await market.positionsTotal();
    await (await market.connect(alice).deletePosition(cancelTradeId)).wait();

    const aliceKittiesAfterCancel = (await token.getOwnerKitties(alice.address)).map((value: bigint) => value.toString());
    expect(aliceKittiesAfterCancel).to.include.members(cancelIds.map((value: bigint) => value.toString()));
    expect((await market.getPositionView(cancelTradeId)).status).to.equal(2);
  });

  it("lists and buys a 100-kitty market bundle through self-escrow", async () => {
    const { token, owner, poolManager, alice, bob } = await deployTokenFixture();
    const MarketFactory = await ethers.getContractFactory("KPEGMarket");
    const market = await MarketFactory.deploy(await token.getAddress(), owner.address);
    await market.waitForDeployment();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("100"))).wait();
    await growMaxBuyForLargeBatch();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("100"))).wait();

    const listedIds = Array.from(await token.getOwnerKitties(alice.address));
    const price = ethers.parseEther("1");
    await (await token.connect(alice).setKittyTransferApproval(await market.getAddress(), listedIds, true)).wait();
    const createReceipt = await (
      await market.connect(alice).createTradeAndFund(ethers.ZeroAddress, price, listedIds)
    ).wait();
    const tradeId = await market.positionsTotal();
    const position = await market.getPositionView(tradeId);

    expect(position.escrowAddress).to.equal(await market.getAddress());
    expect(position.ready).to.equal(true);
    expect(await token.ownerKittiesLive(await market.getAddress())).to.equal(100);

    const buyReceipt = await (await market.connect(bob).buyAndClaimAll(tradeId, ethers.ZeroAddress, price, { value: price })).wait();
    expect(await token.ownerKittiesLive(bob.address)).to.equal(100);
    expect(await token.ownerKittiesLive(await market.getAddress())).to.equal(0);
    expect((await market.getPositionView(tradeId)).status).to.equal(1);
    expect(createReceipt!.gasUsed).to.be.lessThan(3_300_000n);
    expect(buyReceipt!.gasUsed).to.be.lessThan(520_000n);
  });

  it("rejects market bundles above the max bundle size", async () => {
    const { token, owner, poolManager, alice } = await deployTokenFixture();
    const MarketFactory = await ethers.getContractFactory("KPEGMarket");
    const market = await MarketFactory.deploy(await token.getAddress(), owner.address);
    await market.waitForDeployment();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("101"))).wait();
    await growMaxBuyForLargeBatch();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("101"))).wait();

    const listedIds = Array.from(await token.getOwnerKitties(alice.address));
    await (await token.connect(alice).setKittyTransferApproval(await market.getAddress(), listedIds, true)).wait();
    await expect(
      market.connect(alice).createTradeAndFund(ethers.ZeroAddress, ethers.parseEther("1"), listedIds)
    ).to.be.revertedWithCustomError(market, "MaxBundleSizeExceeded");
  });

  it("renounces market ownership and blocks fee configuration", async () => {
    const { token, owner, alice } = await deployTokenPreStartFixture();
    const MarketFactory = await ethers.getContractFactory("KPEGMarket");
    const market = await MarketFactory.deploy(await token.getAddress(), owner.address);
    await market.waitForDeployment();

    await expect(market.connect(owner).renounceOwnership())
      .to.emit(market, "OwnershipRenounced")
      .withArgs(owner.address);
    expect(await market.owner()).to.equal(ethers.ZeroAddress);
    await expect(market.connect(owner).setFeeAddress(alice.address)).to.be.revertedWithCustomError(market, "OnlyOwner");
    await expect(market.connect(owner).setFeeShare(100)).to.be.revertedWithCustomError(market, "OnlyOwner");
  });

  it("rejects zero listing prices for create and update", async () => {
    const { token, owner, poolManager, alice } = await deployTokenFixture();
    const MarketFactory = await ethers.getContractFactory("KPEGMarket");
    const market = await MarketFactory.deploy(await token.getAddress(), owner.address);
    await market.waitForDeployment();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("10"))).wait();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("1"))).wait();

    const [kittyId] = await token.getOwnerKitties(alice.address);
    await expect(
      market.connect(alice).createTradeAndFund(ethers.ZeroAddress, 0n, [kittyId])
    ).to.be.revertedWithCustomError(market, "ZeroPrice");

    await (await token.connect(alice).setKittyTransferApproval(await market.getAddress(), [kittyId], true)).wait();
    await (
      await market.connect(alice).createTradeAndFund(ethers.ZeroAddress, ethers.parseEther("1"), [kittyId])
    ).wait();
    const tradeId = await market.positionsTotal();
    await expect(
      market.connect(alice).setPositionParams(tradeId, ethers.ZeroAddress, 0n)
    ).to.be.revertedWithCustomError(market, "ZeroPrice");
  });

  it("clears per-kitty market approvals after ownership transfer", async () => {
    const { token, owner, poolManager, alice, bob } = await deployTokenFixture();
    const MarketFactory = await ethers.getContractFactory("KPEGMarket");
    const market = await MarketFactory.deploy(await token.getAddress(), owner.address);
    await market.waitForDeployment();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("3"))).wait();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("2"))).wait();

    const aliceKitties = await token.getOwnerKitties(alice.address);
    const [listedKittyId, movedKittyId] = aliceKitties;
    await (await token.connect(alice).setKittyTransferApproval(await market.getAddress(), [listedKittyId], true)).wait();
    expect(
      await token.kittyTransferApprovedFor(alice.address, await market.getAddress(), listedKittyId)
    ).to.equal(true);

    await (await market.connect(alice).createTradeAndFund(ethers.ZeroAddress, ethers.parseEther("1"), [listedKittyId])).wait();
    expect(
      await token.kittyTransferApprovedFor(alice.address, await market.getAddress(), listedKittyId)
    ).to.equal(false);

    await (await token.connect(alice).directTransferKitty(movedKittyId, bob.address)).wait();
    expect(
      await token.kittyTransferApprovedFor(alice.address, await market.getAddress(), movedKittyId)
    ).to.equal(false);
  });

  it("renders live kitty art through the immutable onchain renderer", async () => {
    const { token, owner, poolManager, alice, renderer } = await deployTokenFixture();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("10"))).wait();
    await (await token.connect(poolManager).transfer(alice.address, ethers.parseEther("1"))).wait();

    const [kittyId] = await token.getOwnerKitties(alice.address);
    const kitty = await token.getKitty(kittyId);
    const tokenSvg = await token.kittySvg(kittyId);
    const rendererSvg = await renderer.kittySvg(kitty.traits, kitty.tier);

    expect(tokenSvg).to.equal(rendererSvg);
    expect(tokenSvg).to.include("viewBox='0 0 32 32'");
    expect(tokenSvg).to.include("<path stroke='");
    expect(await token.tokenURI(kittyId)).to.include('"Art Source","value":"Onchain"');

    const tokenTraits = await token.kittyTraits(kittyId);
    const rendererTraits = await renderer.kittyTraits(kitty.traits);
    expect(tokenTraits.breed).to.equal(rendererTraits.breed);
    expect(tokenTraits.clothes).to.equal(rendererTraits.clothes);
    expect(tokenTraits.mood).to.equal(rendererTraits.mood);
    expect(tokenTraits.marks).to.equal(rendererTraits.marks);
    expect(tokenTraits.accessory).to.equal(rendererTraits.accessory);
    expect(kitty.traits).to.equal(await renderer.generateTraits(kitty.id, kitty.tier, kitty.seed));
  });

  it("keeps the compatibility exclusions in onchain trait generation", async () => {
    const renderer = await deployRendererFixture();
    const blockedClothes = new Set([1, 2, 3, 8, 11]);
    const blockedAccessories = new Set([4, 6, 7, 8]);

    for (let i = 0; i < 300; i += 1) {
      const ids = await renderer.kittyTraitIds(i + 1, i % 5, ethers.keccak256(ethers.toUtf8Bytes(`kpeg-${i}`)));
      const breed = Number(ids.breed);
      const clothes = Number(ids.clothes);
      const background = Number(ids.background);
      const mouth = Number(ids.mouth);
      const mood = Number(ids.mood);
      const marks = Number(ids.marks);
      const accessory = Number(ids.accessory);

      if (blockedAccessories.has(accessory)) {
        expect(blockedClothes.has(clothes)).to.equal(false);
      }
      if (clothes === 12) {
        expect(accessory).to.equal(0);
      }
      if (accessory === 1) {
        expect([6, 7, 12].includes(clothes)).to.equal(false);
      }
      if (breed === 12) {
        expect(clothes).not.to.equal(6);
      }
      if (breed === 15) {
        expect([4, 5, 6, 8, 9, 10, 13, 17].includes(clothes)).to.equal(false);
        expect([0, 6].includes(mouth)).to.equal(false);
        expect(marks).not.to.equal(2);
        expect([4, 6].includes(accessory)).to.equal(false);
      }
      if (breed === 17) {
        expect(marks).not.to.equal(2);
      }
      if (breed === 18) {
        expect(clothes).not.to.equal(6);
      }
      if (breed === 19) {
        expect([4, 5, 6, 7, 9, 10, 13, 14, 15, 16, 17].includes(clothes)).to.equal(false);
        expect(mouth).not.to.equal(0);
        expect(marks).not.to.equal(2);
      }
      if (clothes === 13) {
        expect([2, 3, 8, 15, 19].includes(breed)).to.equal(false);
      }
      if ([14, 15, 16].includes(clothes)) {
        expect([2, 3, 8, 19].includes(breed)).to.equal(false);
      }
      if (clothes === 17) {
        expect([10, 13, 15, 19].includes(breed)).to.equal(false);
      }
      if (mood === 10) {
        expect([4, 5].includes(background)).to.equal(true);
      }
    }
  });

  it("matches the core renderer for placement-sensitive trait combinations", async () => {
    const renderer = await deployRendererFixture();
    const samples: KPEGTraits[] = [
      {
        background: "Sky",
        breed: "American Shorthair",
        clothes: "Blue Bowtie",
        mood: "None",
        marks: "None",
        mouth: "Stoic",
        eyes: "Blue Eyes",
        accessory: "None"
      },
      {
        background: "Sky",
        breed: "Siamese",
        clothes: "Gold Collar",
        mood: "Coin Glow",
        marks: "Cream Muzzle",
        mouth: "Stoic",
        eyes: "Blue Eyes",
        accessory: "Heart Charm"
      },
      {
        background: "Sky",
        breed: "Bombay",
        clothes: "None",
        mood: "Sweat Drop",
        marks: "Tiny Scar",
        mouth: "Stoic",
        eyes: "Blue Eyes",
        accessory: "Round Glasses"
      },
      {
        background: "Sky",
        breed: "Ragdoll",
        clothes: "Space Helmet",
        mood: "Purple Moon",
        marks: "Cream Muzzle",
        mouth: "Stoic",
        eyes: "Blue Eyes",
        accessory: "None"
      },
      {
        background: "Sky",
        breed: "Maine Coon",
        clothes: "Purple Sweater",
        mood: "Hearts",
        marks: "Blush",
        mouth: "Stoic",
        eyes: "Blue Eyes",
        accessory: "None"
      },
      {
        background: "Sky",
        breed: "Munchkin",
        clothes: "Red Bandana",
        mood: "Sparkles",
        marks: "None",
        mouth: "Tongue Out",
        eyes: "Blue Eyes",
        accessory: "Gold Crown"
      },
      {
        background: "Lilac",
        breed: "British Shorthair",
        clothes: "Pink Scarf",
        mood: "Sleep Zzz",
        marks: "Blush",
        mouth: "Smiling W",
        eyes: "Sleepy",
        accessory: "None"
      },
      {
        background: "Sky",
        breed: "Sphynx",
        clothes: "None",
        mood: "Purple Moon",
        marks: "Tiny Scar",
        mouth: "Smirk",
        eyes: "Sleepy",
        accessory: "Round Glasses"
      },
      {
        background: "Mint",
        breed: "Tuxedo",
        clothes: "Gold Collar",
        mood: "Hearts",
        marks: "Blush",
        mouth: "Grumpy",
        eyes: "Emerald Eyes",
        accessory: "None"
      }
    ];

    for (const traits of samples) {
      const packedTraits = packTraits(traits);
      const onchainSvg = await renderer.kittySvg(packedTraits, 0);
      expect(renderPixelMap(onchainSvg)).to.equal(renderPixelMap(renderKPEGSvg(traits)));
    }
  });

  it("enforces the growing max-buy limit on pool-originated buys", async () => {
    const { token, owner, poolManager, alice } = await deployTokenFixture();

    await (await token.connect(owner).transfer(poolManager.address, ethers.parseEther("1000"))).wait();

    const maxBuy = await token.maxBuy();
    expect(maxBuy).to.be.greaterThanOrEqual(ethers.parseEther("24.9975"));
    expect(maxBuy).to.be.lessThan(ethers.parseEther("30"));

    await expect(token.connect(poolManager).transfer(alice.address, ethers.parseEther("30"))).to.be.revertedWithCustomError(
      token,
      "BuyLimitExceeded"
    );
  });
});
