import { ethers, network } from "hardhat";
import { readDeployment } from "./lib";

async function main() {
  const deployment = await readDeployment(network.name);
  const [deployer, signerAlice, signerBob] = await ethers.getSigners();
  const buyWhole = BigInt(process.env.KPEG_E2E_BUY_WHOLE ?? "20");
  if (buyWhole < 3n) {
    throw new Error("KPEG_E2E_BUY_WHOLE must be >= 3");
  }
  const buyAmount = ethers.parseEther(buyWhole.toString());
  const liveFundEth = process.env.KPEG_E2E_FUNDED_WALLET_ETH ?? "0.05";
  const usesEphemeralWallets = !signerAlice || !signerBob;
  const alice = signerAlice ?? ethers.Wallet.createRandom().connect(ethers.provider);
  const bob = signerBob ?? ethers.Wallet.createRandom().connect(ethers.provider);
  const sweepTxHashes: string[] = [];

  if (usesEphemeralWallets) {
    await (await deployer.sendTransaction({ to: alice.address, value: ethers.parseEther(liveFundEth) })).wait();
    await (await deployer.sendTransaction({ to: bob.address, value: ethers.parseEther("0.01") })).wait();
  }

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

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const buyZeroForOne = !deployment.tokenIsCurrency0;
  const sellZeroForOne = deployment.tokenIsCurrency0;

  const [quotedEthIn] = await quoter.quoteExactOutputSingle.staticCall({
    poolKey,
    zeroForOne: buyZeroForOne,
    exactAmount: buyAmount,
    hookData: "0x"
  });

  const buyReceipt = await (
    await router
      .connect(alice)
      .buyExactKPEG(buyAmount, alice.address, deadline, 0, "0x", {
        value: quotedEthIn + quotedEthIn / 5n
      })
  ).wait();

  const aliceKittiesAfterBuy = Array.from(await token.getOwnerKitties(alice.address));
  if (aliceKittiesAfterBuy.length !== Number(buyWhole)) {
    throw new Error(`expected alice to own ${buyWhole.toString()} kitties after swap, got ${aliceKittiesAfterBuy.length}`);
  }

  const marketKittyCount = buyWhole >= 20n ? 10n : 1n;
  const marketKittyIds = aliceKittiesAfterBuy.slice(0, Number(marketKittyCount));
  const marketPrice = ethers.parseEther("0.001");
  const marketApproveReceipt = await (
    await token.connect(alice).setKittyOperator(deployment.market, true)
  ).wait();
  const marketCreateReceipt = await (
    await market.connect(alice).createTradeAndFund(ethers.ZeroAddress, marketPrice, marketKittyIds)
  ).wait();
  const marketTradeId = await market.positionsTotal();
  if (!(await market.getPositionView(marketTradeId)).ready) {
    throw new Error("market listing was not ready after funding");
  }
  const marketBuyReceipt = await (
    await market.connect(bob).buyAndClaimAll(marketTradeId, ethers.ZeroAddress, marketPrice, { value: marketPrice })
  ).wait();

  const movedKittyId = aliceKittiesAfterBuy[Number(marketKittyCount)];
  const transferReceipt = await (await token.connect(alice).directTransferKitty(movedKittyId, bob.address)).wait();
  const bobSellAmount = ethers.parseEther((marketKittyCount + 1n).toString());
  const bobApproveReceipt = await (await token.connect(bob).approve(deployment.router, bobSellAmount)).wait();

  const [quotedEthOut] = await quoter.quoteExactInputSingle.staticCall({
    poolKey,
    zeroForOne: sellZeroForOne,
    exactAmount: bobSellAmount,
    hookData: "0x"
  });

  const bobSellReceipt = await (
    await router
      .connect(bob)
      .sellExactKPEG(bobSellAmount, (quotedEthOut * 98n) / 100n, bob.address, deadline, 0, "0x")
  ).wait();

  const aliceSellAmount = ethers.parseEther((buyWhole - marketKittyCount - 1n).toString());
  const aliceApproveReceipt = await (await token.connect(alice).approve(deployment.router, aliceSellAmount)).wait();
  const [quotedAliceEthOut] = await quoter.quoteExactInputSingle.staticCall({
    poolKey,
    zeroForOne: sellZeroForOne,
    exactAmount: aliceSellAmount,
    hookData: "0x"
  });
  const aliceSellReceipt = await (
    await router
      .connect(alice)
      .sellExactKPEG(aliceSellAmount, (quotedAliceEthOut * 98n) / 100n, alice.address, deadline, 0, "0x")
  ).wait();

  const result = {
    initialBuyer: alice.address.toLowerCase(),
    alice: alice.address.toLowerCase(),
    bob: bob.address.toLowerCase(),
    buyWhole: Number(buyWhole),
    marketTradeId: Number(marketTradeId),
    marketKittyCount: Number(marketKittyCount),
    movedKittyId: Number(movedKittyId),
    kittiesLive: Number(await token.kittiesLive()),
    kittiesEverMinted: Number(await token.kittiesEverMinted()),
    aliceKittiesFinal: (await token.getOwnerKitties(alice.address)).map((value: bigint) => Number(value)),
    bobKittiesFinal: (await token.getOwnerKitties(bob.address)).map((value: bigint) => Number(value)),
    gasUsed: {
      buy: Number(buyReceipt?.gasUsed ?? 0n),
      transfer: Number(transferReceipt?.gasUsed ?? 0n),
      marketApprove: Number(marketApproveReceipt?.gasUsed ?? 0n),
      marketCreate: Number(marketCreateReceipt?.gasUsed ?? 0n),
      marketBuy: Number(marketBuyReceipt?.gasUsed ?? 0n),
      bobApprove: Number(bobApproveReceipt?.gasUsed ?? 0n),
      bobSell: Number(bobSellReceipt?.gasUsed ?? 0n),
      aliceApprove: Number(aliceApproveReceipt?.gasUsed ?? 0n),
      aliceSell: Number(aliceSellReceipt?.gasUsed ?? 0n)
    },
    sweepTxHashes
  };

  if (usesEphemeralWallets || process.env.KPEG_E2E_SWEEP_TO_DEPLOYER === "true") {
    for (const wallet of [alice, bob]) {
      const balance = await ethers.provider.getBalance(wallet.address);
      const feeData = await ethers.provider.getFeeData();
      const gasPrice = feeData.gasPrice ?? ethers.parseUnits("0.1", "gwei");
      const reserve = gasPrice * 21_000n * 2n;
      if (balance > reserve) {
        const tx = await wallet.sendTransaction({
          to: deployer.address,
          value: balance - reserve,
          gasLimit: 21_000
        });
        await tx.wait();
        sweepTxHashes.push(tx.hash);
      }
    }
  }

  console.log(`E2E_FLOW_RESULT=${JSON.stringify(result)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
