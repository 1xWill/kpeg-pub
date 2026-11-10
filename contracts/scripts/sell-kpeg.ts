import { ethers, network } from "hardhat";
import { readDeployment, retryRpc } from "./lib";
import {
    applySlippage,
    DEFAULT_DEADLINE_SECONDS,
    DEFAULT_MAX_TX_GAS_LIMIT,
    DEFAULT_SLIPPAGE_BPS,
    findMaxWholeSellable,
    isTxGasCapError,
    parseWholeSellArg,
    wholeToAmount
} from "./sell-kpeg-lib";

function envValue(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value && value.length > 0 ? value : undefined;
}

function parseBigIntEnv(name: string, fallback: bigint): bigint {
    const raw = envValue(name);
    if (!raw) {
        return fallback;
    }
    if (!/^\d+$/.test(raw)) {
        throw new Error(`Invalid ${name}: ${raw}`);
    }
    return BigInt(raw);
}

function formatEth(value: bigint): string {
    return ethers.formatEther(value);
}

async function detectProviderTxGasCap(provider: ethers.Provider, requestedLimit: bigint): Promise<bigint> {
    const network = await provider.getNetwork();
    const chainId = BigInt(network.chainId);

    const isOverCap = async (gasLimit: bigint): Promise<boolean> => {
        const wallet = ethers.Wallet.createRandom();
        const raw = await wallet.signTransaction({
            chainId,
            type: 2,
            nonce: 0,
            to: "0x0000000000000000000000000000000000000001",
            value: 0,
            gasLimit,
            maxFeePerGas: 1_000_000_000n,
            maxPriorityFeePerGas: 100_000_000n,
            data: "0x"
        });

        try {
            await provider.broadcastTransaction(raw);
            return false;
        } catch (error) {
            return isTxGasCapError(error);
        }
    };

    if (!(await isOverCap(requestedLimit))) {
        return requestedLimit;
    }

    let low = 21_000n;
    let high = requestedLimit - 1n;

    while (low < high) {
        const mid = (low + high + 1n) / 2n;
        if (await isOverCap(mid)) {
            high = mid - 1n;
        } else {
            low = mid;
        }
    }

    return low;
}

async function main() {
    const deployment = await readDeployment(network.name);
    const privateKey = envValue("KPEG_SELL_PRIVATE_KEY");
    const from = envValue("KPEG_SELL_FROM");
    const dryRun = envValue("KPEG_SELL_DRY_RUN") === "1";
    const slippageBps = parseBigIntEnv("KPEG_SELL_SLIPPAGE_BPS", DEFAULT_SLIPPAGE_BPS);
    const deadlineSeconds = parseBigIntEnv("KPEG_SELL_DEADLINE_SECONDS", DEFAULT_DEADLINE_SECONDS);
    const requestedMaxTxGasLimit = parseBigIntEnv("KPEG_SELL_MAX_TX_GAS_LIMIT", DEFAULT_MAX_TX_GAS_LIMIT);

    if (!privateKey && !from) {
        throw new Error("Set KPEG_SELL_PRIVATE_KEY or KPEG_SELL_FROM.");
    }
    if (!privateKey && !dryRun) {
        throw new Error("Execution requires KPEG_SELL_PRIVATE_KEY. Use --dry-run with --from for read-only checks.");
    }

    const actor = privateKey
        ? new ethers.Wallet(privateKey, ethers.provider)
        : new ethers.VoidSigner(from as string, ethers.provider);
    const sender = await actor.getAddress();
    const requestedWholeArg = parseWholeSellArg(envValue("KPEG_SELL_WHOLE"));
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + deadlineSeconds;
    const maxTxGasLimit = await detectProviderTxGasCap(ethers.provider, requestedMaxTxGasLimit);

    const token = await ethers.getContractAt("KPEGToken", deployment.token, actor);
    const router = await ethers.getContractAt("KPEGV4Router", deployment.router, actor);
    const quoteSell = async (whole: bigint): Promise<bigint> => {
        const amount = wholeToAmount(whole);
        const data = router.interface.encodeFunctionData("sellExactKPEG", [amount, 0n, sender, deadline, 0n, "0x"]);
        const raw = await retryRpc(
            () =>
                ethers.provider.call({
                    from: sender,
                    to: deployment.router,
                    data,
                    gasLimit: maxTxGasLimit
                }),
            { label: `sell.quote.${whole.toString()}` }
        );
        const [quotedEthOut] = router.interface.decodeFunctionResult("sellExactKPEG", raw);
        return quotedEthOut as bigint;
    };

    const balance = await retryRpc(() => token.balanceOf(sender), { label: "sell.balance" });
    const balanceWhole = balance / (10n ** 18n);
    if (balanceWhole <= 0n) {
        throw new Error(`${sender} has no whole KPEG to sell.`);
    }

    const requestedWhole = requestedWholeArg === "max"
        ? balanceWhole
        : (requestedWholeArg > balanceWhole ? balanceWhole : requestedWholeArg);
    const requestedAmount = wholeToAmount(requestedWhole);

    const allowance = await retryRpc(() => token.allowance(sender, deployment.router), { label: "sell.allowance" });
    if (!dryRun && allowance < requestedAmount) {
        const approveTx = await token.approve(deployment.router, requestedAmount);
        await approveTx.wait();
    }

    let remainingWhole = requestedWhole;
    let soldWhole = 0n;
    let totalQuotedEthOut = 0n;
    const chunks: Array<{
        whole: string;
        amountWei: string;
        quotedEthOutWei: string;
        quotedEthOutEth: string;
        minEthOutWei: string;
        minEthOutEth: string;
        gasLimit: string;
    }> = [];
    const receipts: Array<{ txHash: string; gasUsed: string | null }> = [];

    while (remainingWhole > 0n) {
        const chunkWhole = await findMaxWholeSellable(remainingWhole, async (whole) => {
            if (whole <= 0n) {
                return true;
            }
            try {
                await quoteSell(whole);
                return true;
            } catch {
                return false;
            }
        });

        if (chunkWhole <= 0n) {
            if (soldWhole == 0n) {
                throw new Error("No sellable whole-KPEG amount found with the current balance, gas cap, and pool state.");
            }
            break;
        }

        const chunkAmount = wholeToAmount(chunkWhole);
        const quotedEthOut = await quoteSell(chunkWhole);
        const minEthOut = applySlippage(quotedEthOut, slippageBps);
        chunks.push({
            whole: chunkWhole.toString(),
            amountWei: chunkAmount.toString(),
            quotedEthOutWei: quotedEthOut.toString(),
            quotedEthOutEth: formatEth(quotedEthOut),
            minEthOutWei: minEthOut.toString(),
            minEthOutEth: formatEth(minEthOut),
            gasLimit: maxTxGasLimit.toString()
        });
        totalQuotedEthOut += quotedEthOut;
        soldWhole += chunkWhole;
        remainingWhole -= chunkWhole;

        if (dryRun) {
            continue;
        }

        if (!privateKey) {
            throw new Error("Missing private key.");
        }

        const tx = await router.sellExactKPEG(chunkAmount, minEthOut, sender, deadline, 0n, "0x", {
            gasLimit: maxTxGasLimit
        });
        const receipt = await tx.wait();
        receipts.push({
            txHash: tx.hash,
            gasUsed: receipt?.gasUsed?.toString() ?? null
        });
    }

    if (soldWhole <= 0n) {
        throw new Error("No sell chunks were created.");
    }

    const summary = {
        network: network.name,
        sender,
        requestedWhole: requestedWhole.toString(),
        selectedWhole: soldWhole.toString(),
        selectedAmountWei: wholeToAmount(soldWhole).toString(),
        balanceWhole: balanceWhole.toString(),
        remainingWhole: remainingWhole.toString(),
        quotedEthOutWei: totalQuotedEthOut.toString(),
        quotedEthOutEth: formatEth(totalQuotedEthOut),
        requestedMaxTxGasLimit: requestedMaxTxGasLimit.toString(),
        maxTxGasLimit: maxTxGasLimit.toString(),
        slippageBps: slippageBps.toString(),
        deadline: deadline.toString(),
        chunks,
        dryRun
    };

    if (dryRun) {
        console.log(`KPEG_SELL_PLAN=${JSON.stringify(summary)}`);
        return;
    }
    const finalBalance = await retryRpc(() => token.balanceOf(sender), { label: "sell.finalBalance" });
    const finalKitties = await retryRpc(() => token.ownerKittiesLive(sender), { label: "sell.finalKitties" });

    console.log(
        `KPEG_SELL_RESULT=${JSON.stringify({
            ...summary,
            receipts,
            finalBalanceWei: finalBalance.toString(),
            finalBalanceWhole: (finalBalance / (10n ** 18n)).toString(),
            finalKitties: finalKitties.toString()
        })}`
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
