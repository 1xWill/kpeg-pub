import { ethers, network } from "hardhat";
import { readDeployment } from "./lib";

async function buyWholeKpeg(
  router: any,
  quoter: any,
  poolKey: any,
  buyZeroForOne: boolean,
  buyer: any,
  wholeAmount: bigint,
  deadline: bigint
) {
  const exactAmount = ethers.parseEther(wholeAmount.toString());
  const [quotedEthIn] = await quoter.quoteExactOutputSingle.staticCall({
    poolKey,
    zeroForOne: buyZeroForOne,
    exactAmount,
    hookData: "0x"
  });
  const tx = await router
    .connect(buyer)
    .buyExactKPEG(exactAmount, buyer.address, deadline, 0, "0x", {
      value: quotedEthIn + quotedEthIn / 5n
    });
  await tx.wait();
}

async function main() {
  const deployment = await readDeployment(network.name);
  const [deployer, alice, bob, carol] = await ethers.getSigners();
  if (!deployer || !alice || !bob || !carol) {
    throw new Error("seed-demo requires at least 4 signers from the local Hardhat node");
  }

  // Advance local chain clock so maxBuy() reaches full supply immediately for demo users.
  await ethers.provider.send("evm_increaseTime", [36_000]);
  await ethers.provider.send("evm_mine", []);

  const token = await ethers.getContractAt("KPEGToken", deployment.token);
  const market = await ethers.getContractAt("KPEGMarket", deployment.market);
  const router = await ethers.getContractAt("KPEGV4Router", deployment.router);
  const quoter = await ethers.getContractAt("KPEGV4Quoter", deployment.quoter);

  const rawPoolKey = await router.getPoolKey();
  const poolKey = {
    currency0: rawPoolKey.currency0,
    currency1: rawPoolKey.currency1,
    fee: rawPoolKey.fee,
    tickSpacing: rawPoolKey.tickSpacing,
    hooks: rawPoolKey.hooks
  };

  const latestBlock = await ethers.provider.getBlock("latest");
  const deadline = BigInt((latestBlock?.timestamp ?? Math.floor(Date.now() / 1000)) + 7200);
  const buyZeroForOne = !deployment.tokenIsCurrency0;
  const sellZeroForOne = deployment.tokenIsCurrency0;

  // 1) Mint kitties across multiple wallets and batch sizes (58 total ever minted)
  await buyWholeKpeg(router, quoter, poolKey, buyZeroForOne, alice, 32n, deadline);
  await buyWholeKpeg(router, quoter, poolKey, buyZeroForOne, alice, 8n, deadline);
  await buyWholeKpeg(router, quoter, poolKey, buyZeroForOne, bob, 12n, deadline);
  await buyWholeKpeg(router, quoter, poolKey, buyZeroForOne, carol, 6n, deadline);

  const aliceInitialIds = (await token.getOwnerKitties(alice.address)).map((id: bigint) => Number(id));
  const bobInitialIds = (await token.getOwnerKitties(bob.address)).map((id: bigint) => Number(id));

  // 2) Market activity: 1 completed sale + 3 open listings (single + bundles)
  await (await token.connect(alice).setKittyOperator(deployment.market, true)).wait();
  await (await token.connect(bob).setKittyOperator(deployment.market, true)).wait();

  const soldPrice = ethers.parseEther("0.025");
  await (await market.connect(alice).createTradeAndFund(ethers.ZeroAddress, soldPrice, [aliceInitialIds[0]])).wait();
  const soldTradeId = await market.positionsTotal();
  await (
    await market.connect(bob).buyAndClaimAll(soldTradeId, ethers.ZeroAddress, soldPrice, { value: soldPrice })
  ).wait();

  const openSinglePrice = ethers.parseEther("0.04");
  await (
    await market.connect(alice).createTradeAndFund(ethers.ZeroAddress, openSinglePrice, [aliceInitialIds[1]])
  ).wait();
  const openSingleTradeId = await market.positionsTotal();

  const openBundlePrice = ethers.parseEther("0.11");
  await (
    await market
      .connect(alice)
      .createTradeAndFund(ethers.ZeroAddress, openBundlePrice, aliceInitialIds.slice(2, 5))
  ).wait();
  const openBundleTradeId = await market.positionsTotal();

  const bobBundlePrice = ethers.parseEther("0.075");
  await (
    await market.connect(bob).createTradeAndFund(ethers.ZeroAddress, bobBundlePrice, bobInitialIds.slice(0, 2))
  ).wait();
  const bobBundleTradeId = await market.positionsTotal();

  // 3) Direct kitty transfer + partial sell so activity & burn metrics are populated
  const transferredKittyId = aliceInitialIds[5];
  await (await token.connect(alice).directTransferKitty(transferredKittyId, carol.address)).wait();

  const carolSellAmount = ethers.parseEther("2");
  await (await token.connect(carol).approve(deployment.router, carolSellAmount)).wait();
  const [quotedEthOut] = await quoter.quoteExactInputSingle.staticCall({
    poolKey,
    zeroForOne: sellZeroForOne,
    exactAmount: carolSellAmount,
    hookData: "0x"
  });
  await (
    await router
      .connect(carol)
      .sellExactKPEG(carolSellAmount, (quotedEthOut * 95n) / 100n, carol.address, deadline, 0, "0x")
  ).wait();

  const summary = {
    alice: alice.address,
    bob: bob.address,
    carol: carol.address,
    kittiesEverMinted: Number(await token.kittiesEverMinted()),
    kittiesLive: Number(await token.kittiesLive()),
    openTradeIds: [Number(openSingleTradeId), Number(openBundleTradeId), Number(bobBundleTradeId)],
    soldTradeId: Number(soldTradeId),
    transferredKittyId
  };

  console.log(`DEMO_SEED_RESULT=${JSON.stringify(summary)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
