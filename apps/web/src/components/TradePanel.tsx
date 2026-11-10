import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  KPEG_QUOTER_ABI,
  KPEG_ROUTER_ABI,
  KPEG_TOKEN_ABI,
  TIER_LABELS,
  tierFromWholeBought,
} from "@kpeg/core";
import {
  useAccount,
  useBalance,
  useConnect,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { formatEther, parseEther } from "viem";
import { useToast } from "../context/toast.js";
import {
  formatFixedDecimals,
  formatPct,
  formatTokenAmount,
} from "../lib/format.js";
import {
  optimisticKittiesFromReceipt,
  optimisticRemovalsFromReceipt,
  type OptimisticKittyRemoval,
} from "../lib/optimisticKitties.js";
import {
  FIXED_TOKEN_SUPPLY_WHOLE,
  SELL_BURN_WARNING,
  buyButtonLabel,
  buyFailureHint,
  capWholeKPEGSupply,
  effectiveMaxBuyWhole,
  maxBuyExceededMessage,
  remainingWholeKPEGSupply,
  sellWouldReduceWholeCapacityBelowLive,
  wholeKPEGFromWei,
} from "../lib/tradePanelBuy.js";
import {
  ensureWagmiConnectorCompatibility,
  openWalletModal,
  reownEnabled,
} from "../lib/wagmi.js";
import type { KittyItem } from "../lib/api.js";
import { RollingNumber } from "./RollingNumber.js";
import { Spinner } from "./Spinner.js";

const DEFAULT_SLIPPAGE_BPS = 200n;
const BPS_DENOMINATOR = 10_000n;

type PoolKey = {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
};

function deadlineFromNow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 1800);
}

function basisPointsDown(value: bigint, bps: bigint): bigint {
  return (value * (BPS_DENOMINATOR - bps)) / BPS_DENOMINATOR;
}

function basisPointsUp(value: bigint, bps: bigint): bigint {
  return (value * (BPS_DENOMINATOR + bps)) / BPS_DENOMINATOR;
}

function chainName(chainId: number): string {
  if (chainId === 84532) return "Base Sepolia";
  if (chainId === 8453) return "Base";
  if (chainId === 31337) return "Localhost";
  return `chain ${chainId}`;
}

function parseWholeAmount(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 1 ? amount : null;
}

function parseSlippageInput(value: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_SLIPPAGE_BPS;
  }
  const percent = Number(trimmed);
  if (!Number.isFinite(percent) || percent < 0) {
    return DEFAULT_SLIPPAGE_BPS;
  }
  return BigInt(Math.round(Math.min(percent, 50) * 100));
}

function SlippageControl({
  editing,
  value,
  display,
  onChange,
  onEdit,
  onApply,
  onCancel,
}: {
  editing: boolean;
  value: string;
  display: string;
  onChange: (value: string) => void;
  onEdit: () => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  if (editing) {
    return (
      <span className="inline-flex min-w-0 items-center justify-end gap-[0.75rem] self-center text-right text-[0.84rem] font-bold max-[480px]:text-[0.72rem]">
        <span className="inline-flex items-center gap-[0.3rem]">
          <input
            className="w-[3.4rem] border-0 bg-transparent p-0 text-right text-[var(--fg)] outline-none"
            value={value}
            inputMode="decimal"
            aria-label="Slippage percent"
            onChange={(event) =>
              onChange(event.target.value.replace(/[^\d.]/g, ""))
            }
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onCancel();
              }
              if (event.key === "Enter") {
                onApply();
              }
            }}
            autoFocus
          />
          <span>%</span>
        </span>
        <button
          className="ml-[0.15rem] inline-flex h-[0.58rem] w-[0.58rem] shrink-0 cursor-pointer items-center justify-center self-center border-0 bg-transparent p-0 text-[0.6rem] leading-none text-[var(--fg-muted)] hover:text-[var(--fg)]"
          type="button"
          aria-label="Cancel slippage edit"
          onClick={onCancel}
        >
          <i
            className="nf nf-cod-close block leading-none"
            aria-hidden="true"
          />
        </button>
        <button
          className="ml-[0.15rem] inline-flex h-[0.58rem] w-[0.58rem] shrink-0 cursor-pointer items-center justify-center self-center border-0 bg-transparent p-0 text-[0.75rem] leading-none text-[var(--fg-muted)] hover:text-[var(--fg)]"
          type="button"
          aria-label="Apply slippage edit"
          onClick={onApply}
        >
          <i
            className="nf nf-cod-check block leading-none"
            aria-hidden="true"
          />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center justify-end gap-[0.75rem] self-center text-right text-[0.84rem] font-bold max-[480px]:text-[0.72rem]">
      <span>{display}</span>
      <button
        className="inline-flex h-[0.58rem] w-[0.58rem] shrink-0 cursor-pointer items-center justify-center self-center border-0 bg-transparent p-0 text-[0.75rem] leading-none text-[var(--fg-muted)] hover:text-[var(--fg)]"
        type="button"
        aria-label="Edit slippage"
        onClick={onEdit}
      >
        <i className="nf nf-cod-edit block leading-none" aria-hidden="true" />
      </button>
    </span>
  );
}

export function TradePanel({
  tokenAddress,
  routerAddress,
  quoterAddress,
  writeChainId,
  onSettled,
}: {
  tokenAddress: `0x${string}` | undefined;
  routerAddress: `0x${string}` | undefined;
  quoterAddress: `0x${string}` | undefined;
  writeChainId: number;
  onSettled: (input: {
    txHash: `0x${string}`;
    action: "buy" | "sell";
    optimisticKitties?: KittyItem[];
    optimisticRemovals?: OptimisticKittyRemoval[];
  }) => void;
}) {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [buyWholeInput, setBuyWholeInput] = useState("1");
  const [sellAmount, setSellAmount] = useState("1");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [isEditingSlippage, setIsEditingSlippage] = useState(false);
  const [slippageInput, setSlippageInput] = useState("2");
  const [isFillingMaxBuy, setIsFillingMaxBuy] = useState(false);
  const [handledHash, setHandledHash] = useState<string | null>(null);
  const [submittedAction, setSubmittedAction] = useState<
    "buy" | "approve" | "sell" | null
  >(null);
  const { address, chainId: connectedChainId } = useAccount();
  const { connect, connectors, isPending: connectPending } = useConnect();
  const primaryConnector = connectors[0];
  const targetChainId =
    Number.isFinite(writeChainId) && writeChainId > 0 ? writeChainId : 84532;
  const publicClient = usePublicClient({ chainId: targetChainId });
  const { pushToast } = useToast();
  const write = useWriteContract();
  const writeWithCompatibility = useCallback(
    async (args: unknown) => {
      ensureWagmiConnectorCompatibility();
      return write.writeContractAsync(
        args as Parameters<typeof write.writeContractAsync>[0],
      );
    },
    [write],
  );
  const receipt = useWaitForTransactionReceipt({ hash: write.data });
  const buyWhole = useMemo(
    () => parseWholeAmount(buyWholeInput),
    [buyWholeInput],
  );

  const poolKeyQuery = useQuery({
    queryKey: ["pool-key", targetChainId, routerAddress],
    enabled: Boolean(routerAddress && publicClient),
    queryFn: async () => {
      return publicClient!.readContract({
        address: routerAddress!,
        abi: KPEG_ROUTER_ABI,
        functionName: "getPoolKey",
      }) as Promise<PoolKey>;
    },
    staleTime: 60_000,
  });

  const tokenIsCurrency0Query = useQuery({
    queryKey: ["token-is-currency0", targetChainId, routerAddress],
    enabled: Boolean(routerAddress && publicClient),
    queryFn: async () =>
      publicClient!.readContract({
        address: routerAddress!,
        abi: KPEG_ROUTER_ABI,
        functionName: "tokenIsCurrency0",
      }) as Promise<boolean>,
    staleTime: 60_000,
  });

  const sellAmountWei = useMemo(() => {
    try {
      return sellAmount.trim() ? parseEther(sellAmount) : null;
    } catch {
      return null;
    }
  }, [sellAmount]);

  const buyQuoteQuery = useQuery({
    queryKey: [
      "quote-buy",
      targetChainId,
      quoterAddress,
      poolKeyQuery.data,
      tokenIsCurrency0Query.data,
      buyWhole,
    ],
    enabled: Boolean(
      mode === "buy" &&
        publicClient &&
        quoterAddress &&
        poolKeyQuery.data &&
        tokenIsCurrency0Query.data !== undefined &&
        buyWhole,
    ),
    queryFn: async () => {
      const simulation = await publicClient!.simulateContract({
        address: quoterAddress!,
        abi: KPEG_QUOTER_ABI,
        functionName: "quoteExactOutputSingle",
        args: [
          {
            poolKey: poolKeyQuery.data!,
            zeroForOne: !tokenIsCurrency0Query.data!,
            exactAmount: parseEther(String(buyWhole)),
            hookData: "0x",
          },
        ],
      });
      const [amountIn, gasEstimate] = simulation.result as readonly [
        bigint,
        bigint,
      ];
      return { amountIn, gasEstimate };
    },
    retry: false,
    staleTime: 10_000,
  });

  const sellQuoteQuery = useQuery({
    queryKey: [
      "quote-sell",
      targetChainId,
      quoterAddress,
      poolKeyQuery.data,
      tokenIsCurrency0Query.data,
      sellAmountWei?.toString(),
    ],
    enabled: Boolean(
      mode === "sell" &&
        publicClient &&
        quoterAddress &&
        poolKeyQuery.data &&
        tokenIsCurrency0Query.data !== undefined &&
        sellAmountWei &&
        sellAmountWei > 0n,
    ),
    queryFn: async () => {
      const simulation = await publicClient!.simulateContract({
        address: quoterAddress!,
        abi: KPEG_QUOTER_ABI,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: poolKeyQuery.data!,
            zeroForOne: tokenIsCurrency0Query.data!,
            exactAmount: sellAmountWei!,
            hookData: "0x",
          },
        ],
      });
      const [amountOut, gasEstimate] = simulation.result as readonly [
        bigint,
        bigint,
      ];
      return { amountOut, gasEstimate };
    },
    retry: false,
    staleTime: 10_000,
  });

  const allowanceQuery = useReadContract({
    abi: KPEG_TOKEN_ABI,
    address: tokenAddress,
    functionName: "allowance",
    args: address && routerAddress ? [address, routerAddress] : undefined,
    chainId: targetChainId,
    query: {
      enabled: Boolean(tokenAddress && routerAddress && address),
      refetchInterval: 10_000,
    },
  });

  const maxBuyQuery = useReadContract({
    abi: KPEG_TOKEN_ABI,
    address: tokenAddress,
    functionName: "maxBuy",
    chainId: targetChainId,
    query: {
      enabled: Boolean(tokenAddress),
      refetchInterval: 30_000,
    },
  });
  const kittiesLiveQuery = useReadContract({
    abi: KPEG_TOKEN_ABI,
    address: tokenAddress,
    functionName: "kittiesLive",
    chainId: targetChainId,
    query: {
      enabled: Boolean(tokenAddress),
      refetchInterval: 30_000,
    },
  });
  const notMintableAccountQuery = useReadContract({
    abi: KPEG_TOKEN_ABI,
    address: tokenAddress,
    functionName: "notMintableAccount",
    chainId: targetChainId,
    query: {
      enabled: Boolean(tokenAddress),
      staleTime: Number.POSITIVE_INFINITY,
    },
  });
  const ownerKittiesLiveQuery = useReadContract({
    abi: KPEG_TOKEN_ABI,
    address: tokenAddress,
    functionName: "ownerKittiesLive",
    args: address ? [address] : undefined,
    chainId: targetChainId,
    query: {
      enabled: Boolean(tokenAddress && address),
      refetchInterval: 10_000,
    },
  });

  const ethBalanceQuery = useBalance({
    address,
    chainId: targetChainId,
    query: {
      enabled: Boolean(address),
      refetchInterval: 10_000,
    },
  });

  const kpegBalanceQuery = useBalance({
    address,
    token: tokenAddress,
    chainId: targetChainId,
    query: {
      enabled: Boolean(address && tokenAddress),
      refetchInterval: 10_000,
    },
  });

  const chainMatches =
    !address ||
    connectedChainId === undefined ||
    connectedChainId === targetChainId;
  const writeReady = Boolean(
    tokenAddress && routerAddress && quoterAddress && address && chainMatches,
  );
  const isPending = write.isPending || receipt.isLoading;
  const reserveWallet =
    Boolean(address) &&
    typeof notMintableAccountQuery.data === "string" &&
    address!.toLowerCase() === notMintableAccountQuery.data.toLowerCase();
  const contractMaxBuyWhole = capWholeKPEGSupply(
    wholeKPEGFromWei(maxBuyQuery.data),
  );
  const liveKittiesWhole =
    typeof kittiesLiveQuery.data === "bigint"
      ? Number(kittiesLiveQuery.data)
      : null;
  const remainingSupplyWhole = remainingWholeKPEGSupply(liveKittiesWhole);
  const maxBuyWhole = effectiveMaxBuyWhole(
    contractMaxBuyWhole,
    liveKittiesWhole,
  );
  const maxBuyMessage = maxBuyExceededMessage(buyWhole, maxBuyWhole);

  const buyTier = TIER_LABELS[tierFromWholeBought(buyWhole ?? 1)];
  const maxEthIn = buyQuoteQuery.data
    ? basisPointsUp(buyQuoteQuery.data.amountIn, slippageBps)
    : null;
  const minEthOut = sellQuoteQuery.data
    ? basisPointsDown(sellQuoteQuery.data.amountOut, slippageBps)
    : null;
  const allowance =
    typeof allowanceQuery.data === "bigint" ? allowanceQuery.data : 0n;
  const refetchAllowance = allowanceQuery.refetch;
  const needsSellApproval = Boolean(sellAmountWei && allowance < sellAmountWei);

  const ethBalanceValue = ethBalanceQuery.data?.value ?? 0n;
  const kpegBalanceValue = kpegBalanceQuery.data?.value ?? 0n;
  const ethBalanceLabel = formatTokenAmount(
    Number(formatEther(ethBalanceValue)),
    "ETH",
  );
  const kpegBalanceLabel = formatTokenAmount(
    Number(formatEther(kpegBalanceValue)),
    "KPEG",
  );
  const estimatedEthPaid = buyQuoteQuery.data
    ? formatFixedDecimals(
        Number(formatEther(buyQuoteQuery.data.amountIn)),
        "ETH",
      )
    : "-";
  const estimatedEthReceived = sellQuoteQuery.data
    ? formatFixedDecimals(
        Number(formatEther(sellQuoteQuery.data.amountOut)),
        "ETH",
      )
    : "-";
  const minimumEthReceived = minEthOut
    ? formatFixedDecimals(Number(formatEther(minEthOut)), "ETH")
    : "-";
  const ownerKittiesLive =
    typeof ownerKittiesLiveQuery.data === "bigint"
      ? Number(ownerKittiesLiveQuery.data)
      : null;
  const showSellBurnWarning = sellWouldReduceWholeCapacityBelowLive({
    ownerKittiesLive,
    balanceWei: kpegBalanceValue,
    sellWei: sellAmountWei,
  });

  const applySlippage = () => {
    const next = parseSlippageInput(slippageInput);
    setSlippageBps(next);
    setSlippageInput(String(Number(next) / 100));
    setIsEditingSlippage(false);
  };

  const resetSlippage = () => {
    setSlippageBps(DEFAULT_SLIPPAGE_BPS);
    setSlippageInput("2");
    setIsEditingSlippage(false);
  };

  const quoteBuyAmountIn = async (whole: number): Promise<bigint | null> => {
    if (
      !publicClient ||
      !quoterAddress ||
      !poolKeyQuery.data ||
      tokenIsCurrency0Query.data === undefined ||
      whole < 1
    ) {
      return null;
    }
    try {
      const simulation = await publicClient.simulateContract({
        address: quoterAddress,
        abi: KPEG_QUOTER_ABI,
        functionName: "quoteExactOutputSingle",
        args: [
          {
            poolKey: poolKeyQuery.data,
            zeroForOne: !tokenIsCurrency0Query.data,
            exactAmount: parseEther(String(whole)),
            hookData: "0x",
          },
        ],
      });
      const [amountIn] = simulation.result as readonly [bigint, bigint];
      return basisPointsUp(amountIn, slippageBps);
    } catch {
      return null;
    }
  };

  const fillMaxBuy = async () => {
    if (ethBalanceValue <= 0n) {
      return;
    }
    setIsFillingMaxBuy(true);
    try {
      const fallbackCap = remainingSupplyWhole ?? FIXED_TOKEN_SUPPLY_WHOLE;
      const cap = Math.min(maxBuyWhole ?? fallbackCap, fallbackCap);
      if (cap < 1) {
        return;
      }
      let low = 0;
      let high = 1;

      while (high <= cap) {
        const quoted = await quoteBuyAmountIn(high);
        if (!quoted || quoted > ethBalanceValue) {
          break;
        }
        low = high;
        high *= 2;
      }

      high = Math.min(high, cap);
      while (low + 1 < high) {
        const mid = Math.floor((low + high) / 2);
        const quoted = await quoteBuyAmountIn(mid);
        if (quoted && quoted <= ethBalanceValue) {
          low = mid;
        } else {
          high = mid;
        }
      }

      if (low > 0) {
        setBuyWholeInput(String(low));
      }
    } finally {
      setIsFillingMaxBuy(false);
    }
  };

  const handleBuy = async () => {
    if (!address) {
      ensureWagmiConnectorCompatibility();
      if (reownEnabled) {
        await openWalletModal("Connect");
        return;
      }
      if (primaryConnector) {
        connect({ connector: primaryConnector });
      }
      return;
    }
    if (
      !routerAddress ||
      !writeReady ||
      !buyWhole ||
      !maxEthIn ||
      reserveWallet
    ) {
      return;
    }
    if (maxBuyMessage) {
      pushToast({
        kind: "error",
        title: "Buy Too Large",
        message: maxBuyMessage,
      });
      return;
    }
    try {
      setSubmittedAction("buy");
      await writeWithCompatibility({
        address: routerAddress,
        abi: KPEG_ROUTER_ABI,
        functionName: "buyExactKPEG",
        args: [
          parseEther(String(buyWhole)),
          address!,
          deadlineFromNow(),
          0n,
          "0x",
        ],
        value: maxEthIn,
        chainId: targetChainId,
      });
      pushToast({
        kind: "info",
        title: "Swap Submitted",
        message: `Buying ${buyWhole} whole kPEG through the pool`,
      });
    } catch (error) {
      const typedError = error as Error;
      pushToast({
        kind: "error",
        title: "Swap Failed",
        message: typedError.message,
        hint: buyFailureHint(typedError, maxBuyMessage),
      });
    }
  };

  const handleApproveSell = async () => {
    if (!tokenAddress || !routerAddress || !writeReady || !sellAmountWei) {
      return;
    }
    try {
      setSubmittedAction("approve");
      await writeWithCompatibility({
        address: tokenAddress,
        abi: KPEG_TOKEN_ABI,
        functionName: "approve",
        args: [routerAddress, sellAmountWei],
        chainId: targetChainId,
      });
      pushToast({
        kind: "info",
        title: "Approval Submitted",
        message: `Approving ${sellAmount} kPEG for the router`,
      });
    } catch (error) {
      pushToast({
        kind: "error",
        title: "Approval Failed",
        message: (error as Error).message,
        hint: "Check wallet network and kPEG balance.",
      });
    }
  };

  const handleSell = async () => {
    if (!routerAddress || !writeReady || !sellAmountWei || !minEthOut) {
      return;
    }
    try {
      setSubmittedAction("sell");
      await writeWithCompatibility({
        address: routerAddress,
        abi: KPEG_ROUTER_ABI,
        functionName: "sellExactKPEG",
        args: [sellAmountWei, minEthOut, address!, deadlineFromNow(), 0n, "0x"],
        chainId: targetChainId,
      });
      pushToast({
        kind: "info",
        title: "Sell Submitted",
        message: `Selling ${sellAmount} kPEG through the pool`,
      });
    } catch (error) {
      pushToast({
        kind: "error",
        title: "Sell Failed",
        message: (error as Error).message,
        hint: "Check approval, wallet network, and whether the pool has enough liquidity for that size.",
      });
    }
  };

  useEffect(() => {
    const hash = receipt.data?.transactionHash ?? null;
    if (!receipt.isSuccess || !hash || handledHash === hash) {
      return;
    }
    setHandledHash(hash);
    if (submittedAction === "approve") {
      void refetchAllowance();
    } else {
      if (submittedAction === "buy") {
        onSettled({
          txHash: hash as `0x${string}`,
          action: "buy",
          optimisticKitties: optimisticKittiesFromReceipt({
            receipt: receipt.data,
            tokenAddress,
          }),
        });
      } else if (submittedAction === "sell") {
        onSettled({
          txHash: hash as `0x${string}`,
          action: "sell",
          optimisticRemovals: optimisticRemovalsFromReceipt({
            receipt: receipt.data,
            tokenAddress,
          }),
        });
      }
    }
    pushToast({
      kind: "success",
      title:
        submittedAction === "approve"
          ? "Router Approved"
          : submittedAction === "sell"
            ? "Sell Confirmed"
            : "Buy Confirmed",
      message:
        submittedAction === "approve"
          ? "Router approval is ready"
          : submittedAction === "sell"
            ? "kPEG sale confirmed; the gallery is catching up"
            : "kPEG swap confirmed; new kitties are being indexed",
    });
  }, [
    handledHash,
    onSettled,
    pushToast,
    receipt.data,
    receipt.isSuccess,
    refetchAllowance,
    submittedAction,
    tokenAddress,
  ]);

  const chainHint = !chainMatches
    ? `Switch wallet to ${chainName(targetChainId)} to use this pool.`
    : null;
  const reserveWalletHint = reserveWallet
    ? "This is the reserve wallet. Whole buys here move kPEG but never mint kitties. Use a second wallet to mint kitties."
    : null;
  const buyButtonDisabled = address
    ? !writeReady ||
      isPending ||
      !buyWhole ||
      !maxEthIn ||
      Boolean(maxBuyMessage) ||
      buyQuoteQuery.isError ||
      reserveWallet
    : !reownEnabled && (!primaryConnector || connectPending);

  return (
    <section className="grid gap-[1.1rem]">
      <div className="inline-flex justify-self-center gap-[0.3rem]">
        <button
          className={
            mode === "buy"
              ? "cursor-pointer border-0 bg-transparent px-3 py-2 font-extrabold tracking-[0.08em] text-[var(--fg)]"
              : "cursor-pointer border-0 bg-transparent px-3 py-2 font-extrabold tracking-[0.08em] text-[var(--fg-muted)] hover:text-[var(--fg)]"
          }
          type="button"
          onClick={() => setMode("buy")}
        >
          BUY
        </button>
        <button
          className={
            mode === "sell"
              ? "cursor-pointer border-0 bg-transparent px-3 py-2 font-extrabold tracking-[0.08em] text-[var(--fg)]"
              : "cursor-pointer border-0 bg-transparent px-3 py-2 font-extrabold tracking-[0.08em] text-[var(--fg-muted)] hover:text-[var(--fg)]"
          }
          type="button"
          onClick={() => setMode("sell")}
        >
          SELL
        </button>
      </div>

      {mode === "buy" ? (
        <div className="grid items-stretch gap-[0.75rem]">
          <div className="grid gap-[0.35rem]">
            <div className="mb-[0.2rem] flex min-w-0 items-center justify-between gap-2">
              <label
                className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.72rem] leading-none font-normal tracking-[0.08em] text-[var(--fg-muted)] max-[480px]:text-[0.62rem] max-[480px]:tracking-[0.04em]"
                htmlFor="buy-amount"
              >
                kPEG Received
              </label>
              <button
                className="ml-auto inline-block min-w-0 max-w-[54%] cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-right font-mono text-[0.72rem] leading-none font-normal tracking-[0.08em] text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-50 max-[480px]:text-[0.62rem] max-[480px]:tracking-[0.04em]"
                style={{
                  WebkitTextSizeAdjust: "none",
                  textSizeAdjust: "none",
                }}
                type="button"
                onClick={() => void fillMaxBuy()}
                disabled={isFillingMaxBuy || ethBalanceValue <= 0n}
              >
                {isFillingMaxBuy ? (
                  "Finding max..."
                ) : (
                  <>
                    Balance: <RollingNumber value={ethBalanceLabel} align="center" />
                  </>
                )}
              </button>
            </div>
            <input
              id="buy-amount"
              className="min-h-[2.55rem] w-full appearance-none rounded border border-[var(--line)] bg-white/[0.045] px-[0.68rem] py-[0.55rem] text-[0.82rem] text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--fg-dim)] focus:border-[var(--accent)] focus:bg-white/[0.07] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={buyWholeInput}
              onChange={(event) =>
                setBuyWholeInput(event.target.value.replace(/\D/g, ""))
              }
            />
            {maxBuyWhole !== null ? (
              <p
                className={
                  maxBuyMessage
                    ? "m-0 font-mono text-[0.68rem] leading-[1.35] tracking-[0.04em] text-[var(--error)] max-[480px]:text-[0.58rem]"
                    : "m-0 font-mono text-[0.68rem] leading-[1.35] tracking-[0.04em] text-[var(--fg-muted)] max-[480px]:text-[0.58rem]"
                }
              >
                {maxBuyMessage ?? (
                  <>
                    Current max buy:{" "}
                    <RollingNumber value={String(maxBuyWhole)} align="center" /> whole kPEG
                  </>
                )}
              </p>
            ) : null}
          </div>
          <div className="relative flex min-w-0 items-center justify-between gap-3">
            <span className="inline-flex items-center gap-[0.32rem] font-mono text-[0.72rem] tracking-[0.08em] text-[var(--fg-muted)] max-[480px]:text-[0.62rem] max-[480px]:tracking-[0.04em]">
              <span>Mint Tier</span>
              <span className="relative inline-flex items-center group max-[640px]:static">
                <button
                  className="inline-flex h-[0.78rem] w-[0.78rem] shrink-0 cursor-help items-center justify-center border-0 bg-transparent p-0 text-[0.66rem] text-[var(--fg-dim)] transition-colors hover:text-[var(--fg)] focus-visible:text-[var(--fg)]"
                  type="button"
                  aria-label="What Mint Tier means"
                >
                  <i
                    className="nf nf-cod-question block leading-none"
                    aria-hidden="true"
                  />
                </button>
                <span className="pointer-events-none absolute left-0 top-[calc(100%+0.45rem)] z-20 w-[16rem] max-w-[80vw] rounded-[5px] border border-[var(--line)] bg-[rgba(11,14,20,0.75)] px-[0.55rem] py-[0.48rem] text-left font-mono text-[0.58rem] leading-[1.45] tracking-[0.03em] text-[var(--fg)] opacity-0 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-[16px] transition-all duration-[180ms] ease-[var(--ease)] translate-y-[3px] whitespace-normal break-words group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 max-[640px]:left-1/2 max-[640px]:top-[calc(100%+0.38rem)] max-[640px]:w-[calc(100%-0.75rem)] max-[640px]:max-w-[18.5rem] max-[640px]:-translate-x-1/2">
                  Mint Tier is based on this buy size. Higher tiers improve your
                  odds to roll rarer kPEG traits, but each kitty still gets its
                  own final Tier after traits are generated.
                </span>
              </span>
            </span>
            <span className="min-w-0 text-right text-[0.84rem] font-bold max-[480px]:text-[0.72rem]">
              {buyTier}
            </span>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="min-w-0 font-mono text-[0.72rem] tracking-[0.08em] text-[var(--fg-muted)] max-[480px]:text-[0.62rem] max-[480px]:tracking-[0.04em]">
              Estimated ETH Paid
            </span>
            <span className="min-w-0 text-right text-[0.84rem] font-bold max-[480px]:text-[0.72rem]">
              {buyQuoteQuery.isLoading ? (
                <Spinner />
              ) : buyQuoteQuery.isError ? (
                "Insufficient pool liquidity"
              ) : (
                <RollingNumber value={estimatedEthPaid} align="center" />
              )}
            </span>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="font-mono text-[0.72rem] tracking-[0.08em] text-[var(--fg-muted)] max-[480px]:text-[0.62rem] max-[480px]:tracking-[0.04em]">
              Slippage
            </span>
            <SlippageControl
              editing={isEditingSlippage}
              value={slippageInput}
              display={formatPct(Number(slippageBps) / 100)}
              onChange={setSlippageInput}
              onEdit={() => setIsEditingSlippage(true)}
              onApply={applySlippage}
              onCancel={resetSlippage}
            />
          </div>
          <button
            className="inline-flex cursor-pointer justify-center rounded-[5px] border border-[var(--line)] bg-[var(--fg)] px-[0.62rem] py-[0.42rem] text-[var(--bg)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            disabled={buyButtonDisabled}
            onClick={() => void handleBuy()}
          >
            <RollingNumber value={buyButtonLabel(buyWhole, isPending)} align="center" />
          </button>
        </div>
      ) : (
        <div className="grid items-stretch gap-[0.75rem]">
          <div className="grid gap-[0.35rem]">
            <div className="mb-[0.2rem] flex min-w-0 items-center justify-between gap-2">
              <label
                className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.72rem] leading-none font-normal tracking-[0.08em] text-[var(--fg-muted)] max-[480px]:text-[0.62rem] max-[480px]:tracking-[0.04em]"
                htmlFor="sell-amount"
              >
                kPEG Sent
              </label>
              <button
                className="ml-auto inline-block min-w-0 max-w-[62%] cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-right font-mono text-[0.72rem] leading-none font-normal tracking-[0.08em] text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-50 max-[480px]:text-[0.62rem] max-[480px]:tracking-[0.04em]"
                style={{
                  WebkitTextSizeAdjust: "none",
                  textSizeAdjust: "none",
                }}
                type="button"
                onClick={() => setSellAmount(formatEther(kpegBalanceValue))}
                disabled={kpegBalanceValue <= 0n}
              >
                Balance: <RollingNumber value={kpegBalanceLabel} align="center" />
              </button>
            </div>
            <input
              id="sell-amount"
              className="min-h-[2.55rem] w-full appearance-none rounded border border-[var(--line)] bg-white/[0.045] px-[0.68rem] py-[0.55rem] text-[0.82rem] text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--fg-dim)] focus:border-[var(--accent)] focus:bg-white/[0.07] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              type="text"
              inputMode="decimal"
              value={sellAmount}
              onChange={(event) => setSellAmount(event.target.value)}
            />
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="min-w-0 font-mono text-[0.72rem] tracking-[0.08em] text-[var(--fg-muted)] max-[480px]:text-[0.62rem] max-[480px]:tracking-[0.04em]">
              Estimated ETH Received
            </span>
            <span className="min-w-0 text-right text-[0.84rem] font-bold max-[480px]:text-[0.72rem]">
              {sellQuoteQuery.isLoading ? (
                <Spinner />
              ) : sellQuoteQuery.isError ? (
                "Insufficient pool liquidity"
              ) : (
                <RollingNumber value={estimatedEthReceived} align="center" />
              )}
            </span>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="min-w-0 font-mono text-[0.72rem] tracking-[0.08em] text-[var(--fg-muted)] max-[480px]:text-[0.62rem] max-[480px]:tracking-[0.04em]">
              Minimum ETH Received
            </span>
            <span className="min-w-0 text-right text-[0.84rem] font-bold max-[480px]:text-[0.72rem]">
              {sellQuoteQuery.isLoading ? (
                <Spinner />
              ) : sellQuoteQuery.isError ? (
                "Insufficient pool liquidity"
              ) : (
                <RollingNumber value={minimumEthReceived} align="center" />
              )}
            </span>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="font-mono text-[0.72rem] tracking-[0.08em] text-[var(--fg-muted)] max-[480px]:text-[0.62rem] max-[480px]:tracking-[0.04em]">
              Slippage
            </span>
            <SlippageControl
              editing={isEditingSlippage}
              value={slippageInput}
              display={formatPct(Number(slippageBps) / 100)}
              onChange={setSlippageInput}
              onEdit={() => setIsEditingSlippage(true)}
              onApply={applySlippage}
              onCancel={resetSlippage}
            />
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="min-w-0 font-mono text-[0.72rem] tracking-[0.08em] text-[var(--fg-muted)] max-[480px]:text-[0.62rem] max-[480px]:tracking-[0.04em]">
              Approved kPEG Allowance
            </span>
            <span className="min-w-0 text-right text-[0.84rem] font-bold max-[480px]:text-[0.72rem]">
              {allowanceQuery.isLoading ? (
                <Spinner />
              ) : (
                <RollingNumber value={`${formatEther(allowance)} kPEG`} align="center" />
              )}
            </span>
          </div>
          <button
            className="inline-flex cursor-pointer justify-center rounded-[5px] border border-[var(--line)] bg-[var(--fg)] px-[0.62rem] py-[0.42rem] text-[var(--bg)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            disabled={
              !writeReady ||
              isPending ||
              !sellAmountWei ||
              !minEthOut ||
              sellQuoteQuery.isError
            }
            onClick={() =>
              void (needsSellApproval ? handleApproveSell() : handleSell())
            }
          >
            {isPending
              ? "CONFIRMING..."
              : needsSellApproval
                ? "APPROVE ROUTER"
                : "SELL KPEG"}
          </button>
          {showSellBurnWarning ? (
            <p className="m-0 font-mono text-[0.68rem] leading-[1.35] tracking-[0.04em] text-[var(--error)] max-[480px]:text-[0.58rem]">
              {SELL_BURN_WARNING}
            </p>
          ) : null}
        </div>
      )}

      {chainHint ? (
        <p className="font-mono text-[0.72rem] tracking-[0.08em] text-[var(--fg-muted)]">
          {chainHint}
        </p>
      ) : null}
      {reserveWalletHint ? (
        <p className="font-mono text-[0.72rem] tracking-[0.08em] text-[var(--fg-muted)]">
          {reserveWalletHint}
        </p>
      ) : null}
    </section>
  );
}
