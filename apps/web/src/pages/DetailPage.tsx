import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { renderKPEGSvg } from "@kpeg/core";
import { Spinner } from "../components/Spinner.js";
import { SlidingPaneSwap } from "../components/SlidingPaneSwap.js";
import { KPEGArt } from "../components/KPEGArt.js";
import {
  getConfig,
  getKitty,
  type KittyDetailItem,
  type KittyItem,
} from "../lib/api.js";
import { useBodyDataFlag } from "../hooks/useBodyDataFlag.js";
import { getMetallicTierVariant, getTierColor } from "../lib/tierColor.js";
import {
  resolveRuntimeAddress,
  resolveRuntimeChainId,
} from "../lib/runtimeConfig.js";
import {
  formatOneInN,
  formatPct,
  formatPctCompact,
  formatRarityScore,
  shortAddress,
} from "../lib/format.js";

const TRAIT_LABELS: Record<string, string> = {
  background: "Background",
  breed: "Breed",
  clothes: "Clothes",
  mood: "Mood",
  marks: "Marks",
  mouth: "Mouth",
  eyes: "Eyes",
  accessory: "Accessory",
};

type DetailTab = "traits" | "born";
type TraceKey = "timestamp" | "gas" | "baseFee";
type TraitKey = keyof KittyItem["traits"];
type DetailPresentation = "page" | "modal";
type DetailRouteState = {
  detailModal?: boolean;
  detailOrigin?: "explore" | "collections" | "portfolio";
  kittyPreview?: KittyItem;
  backgroundLocation?: {
    pathname?: string;
    search?: string;
    hash?: string;
  };
};

const DETAIL_MODAL_TRANSITION_MS = 200;
const ZERO_TX_HASH = `0x${"0".repeat(64)}`;

function resolveDetailBackTarget(state: DetailRouteState | null): {
  label: string;
  path: string;
} {
  const backgroundPath = state?.backgroundLocation?.pathname;
  const fromCollections =
    state?.detailOrigin === "collections" || backgroundPath === "/collections";
  if (fromCollections) {
    return { label: "BACK TO MY COLLECTION", path: "/collections" };
  }
  if (state?.detailOrigin === "portfolio" && backgroundPath) {
    return { label: "BACK TO COLLECTION", path: backgroundPath };
  }
  return { label: "BACK TO EXPLORE", path: "/explore" };
}

function PortfolioAddressRow({
  address,
  rowLabel,
  portfolioLabel,
  copied,
  onOpen,
  onCopy,
}: {
  address: string;
  rowLabel: string;
  portfolioLabel: string;
  copied: boolean;
  onOpen: (address: string) => void;
  onCopy: () => void;
}) {
  const open = () => onOpen(address);
  return (
    <div
      className="group grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-0 bg-transparent p-0 text-left font-[inherit] text-[inherit]"
      role="button"
      tabIndex={0}
      aria-label={`Open ${portfolioLabel} portfolio`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      }}
    >
      <span className="min-w-0">{rowLabel}</span>
      <span className="inline-flex min-w-0 items-center justify-end gap-[0.55rem] font-bold text-[var(--fg)]">
        <button
          className="inline-flex w-[4.2rem] shrink-0 cursor-pointer justify-end border-0 bg-transparent p-0 text-[0.74em] font-normal text-[var(--fg-muted)] opacity-0 transition-[color,opacity] hover:text-[var(--fg)] group-hover:opacity-100 max-[640px]:hidden"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCopy();
          }}
        >
          {copied ? "COPIED" : "COPY"}
        </button>
        <button
          className="inline-flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[var(--fg-muted)] opacity-0 transition-[color,opacity] hover:text-[var(--fg)] group-hover:opacity-100 max-[640px]:hidden"
          type="button"
          aria-label={`Open ${portfolioLabel} portfolio`}
          onClick={(event) => {
            event.stopPropagation();
            open();
          }}
        >
          <i
            className="nf nf-oct-arrow_up_right self-center text-[1.02rem] leading-none"
            aria-hidden="true"
          />
        </button>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {shortAddress(address)}
        </span>
      </span>
    </div>
  );
}

function chainTxUrl(txHash: string): string | null {
  const chainId = Number(import.meta.env.VITE_KPEG_CHAIN_ID ?? 84532);
  if (chainId === 8453) return `https://basescan.org/tx/${txHash}`;
  if (chainId === 84532) return `https://sepolia.basescan.org/tx/${txHash}`;
  return null;
}

function shouldRetryKittyDetail(failureCount: number, error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("kitty not found")) {
    return false;
  }
  return failureCount < 2;
}

function asKittyDetailPlaceholder(kitty: KittyItem): KittyDetailItem {
  return {
    ...kitty,
    txHash: kitty.txHash ?? ZERO_TX_HASH,
    gasUsed: kitty.gasUsed ?? null,
    baseFeeWei: kitty.baseFeeWei ?? null,
    traitOdds: (kitty.traitOdds ?? {}) as KittyDetailItem["traitOdds"],
  };
}

function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "N/A";
  return new Date(ms).toUTCString();
}

function formatGasUsed(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? Number.NaN)) return "N/A";
  return Math.round(value!).toLocaleString();
}

function formatBaseFee(wei: string | null | undefined): string {
  if (!wei) return "N/A";
  try {
    const gwei = Number(BigInt(wei)) / 1_000_000_000;
    return `${gwei.toLocaleString(undefined, { maximumFractionDigits: 2 })} gwei`;
  } catch {
    return "N/A";
  }
}

function BackToGalleryLink({
  label,
  to,
  onBack,
}: {
  label: string;
  to: string;
  onBack?: () => void;
}) {
  const [highlight, setHighlight] = useState(false);
  const style = { color: highlight ? "var(--fg)" : "var(--fg-muted)" };
  const className =
    "mb-[0.65rem] inline-flex w-fit cursor-pointer items-center justify-self-start gap-[0.35rem] border-0 bg-transparent p-0 font-mono text-[0.78rem] font-bold tracking-[0.06em] transition-colors max-[640px]:mb-0 max-[640px]:text-[0.66rem]";
  if (onBack) {
    return (
      <button
        className={className}
        type="button"
        style={style}
        onClick={onBack}
        onPointerEnter={() => setHighlight(true)}
        onPointerLeave={() => setHighlight(false)}
        onFocus={() => setHighlight(true)}
        onBlur={() => setHighlight(false)}
      >
        <i className="nf nf-fa-chevron_left text-[0.6rem]" aria-hidden="true" />
        <span>{label}</span>
      </button>
    );
  }
  return (
    <Link
      className={className}
      to={to}
      style={style}
      onPointerEnter={() => setHighlight(true)}
      onPointerLeave={() => setHighlight(false)}
      onFocus={() => setHighlight(true)}
      onBlur={() => setHighlight(false)}
    >
      <i className="nf nf-fa-chevron_left text-[0.6rem]" aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

async function saveSvgAsJpeg(svg: string, fileName: string): Promise<void> {
  const size = 1024;
  const canvas = await renderSvgToCanvas(svg, size);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (next) =>
        next ? resolve(next) : reject(new Error("Could not export JPEG")),
      "image/jpeg",
      0.95,
    );
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

async function renderSvgToCanvas(
  svg: string,
  size: number,
): Promise<HTMLCanvasElement> {
  const image = new Image();
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not render kitty art"));
    image.src = source;
  });

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, size, size);
  return canvas;
}

async function copySvgAsPng(svg: string): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("Clipboard image copy is unavailable");
  }
  const size = 1024;
  const canvas = await renderSvgToCanvas(svg, size);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (next) =>
        next ? resolve(next) : reject(new Error("Could not export image")),
      "image/png",
    );
  });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

export function DetailPage({
  presentation = "page",
}: {
  presentation?: DetailPresentation;
}) {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const routeState =
    location.state && typeof location.state === "object"
      ? (location.state as DetailRouteState)
      : null;
  const modalPresentation = presentation === "modal";
  const id = Number(params.id);
  const [activeTab, setActiveTab] = useState<DetailTab>("traits");
  const [copiedTrace, setCopiedTrace] = useState<TraceKey | null>(null);
  const [copiedTrait, setCopiedTrait] = useState<TraitKey | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [copyKpegStatus, setCopyKpegStatus] = useState<
    "idle" | "copying" | "copied"
  >("idle");
  const [modalVisible, setModalVisible] = useState(!modalPresentation);
  const [modalClosing, setModalClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const copyKpegTimer = useRef<number | null>(null);
  const openFrame = useRef<number | null>(null);
  const openFrameNext = useRef<number | null>(null);
  const backTarget = resolveDetailBackTarget(routeState);
  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
    staleTime: 30_000,
  });
  const runtimeChainId = resolveRuntimeChainId(
    configQuery.data?.chainId,
    import.meta.env.VITE_KPEG_CHAIN_ID,
  );
  const runtimeTokenAddress =
    resolveRuntimeAddress(
      configQuery.data?.tokenAddress,
      import.meta.env.VITE_KPEG_TOKEN_ADDRESS,
    )?.toLowerCase() ?? "unknown";
  const routePreview =
    routeState?.kittyPreview && routeState.kittyPreview.id === id
      ? routeState.kittyPreview
      : null;
  useBodyDataFlag("tierMetalModalOpen", modalPresentation);

  const closeDetailModal = () => {
    if (!modalPresentation || modalClosing) return;
    setModalClosing(true);
    setModalVisible(false);
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
    }
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      const backgroundPathname = routeState?.backgroundLocation?.pathname;
      const closeTarget = backgroundPathname
        ? `${backgroundPathname}${routeState?.backgroundLocation?.search ?? ""}${routeState?.backgroundLocation?.hash ?? ""}`
        : backTarget.path;
      navigate(closeTarget, {
        replace: true,
        state: { skipScrollReset: true },
      });
    }, DETAIL_MODAL_TRANSITION_MS);
  };

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
      }
      if (copyKpegTimer.current !== null) {
        window.clearTimeout(copyKpegTimer.current);
      }
      if (openFrame.current !== null) {
        window.cancelAnimationFrame(openFrame.current);
      }
      if (openFrameNext.current !== null) {
        window.cancelAnimationFrame(openFrameNext.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!modalPresentation) return;
    if (openFrame.current !== null) {
      window.cancelAnimationFrame(openFrame.current);
      openFrame.current = null;
    }
    if (openFrameNext.current !== null) {
      window.cancelAnimationFrame(openFrameNext.current);
      openFrameNext.current = null;
    }
    setModalClosing(false);
    setModalVisible(false);
    openFrame.current = window.requestAnimationFrame(() => {
      openFrameNext.current = window.requestAnimationFrame(() =>
        setModalVisible(true),
      );
    });
  }, [id, modalPresentation]);

  useEffect(() => {
    if (!modalPresentation) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modalPresentation]);

  useEffect(() => {
    if (!modalPresentation) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeDetailModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [backTarget.path, modalClosing, modalPresentation, navigate]);

  const kittyQuery = useQuery({
    queryKey: ["kitty", runtimeChainId, runtimeTokenAddress, id],
    queryFn: () => getKitty(id),
    enabled: Number.isFinite(id) && id > 0,
    ...(routePreview
      ? { placeholderData: asKittyDetailPlaceholder(routePreview) }
      : {}),
    retry: shouldRetryKittyDetail,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const renderDetailSurface = (content: ReactNode) => {
    if (!modalPresentation) return content;
    const open = modalVisible && !modalClosing;
    return createPortal(
      <div
        className={
          open
            ? "fixed inset-0 z-50 grid grid-cols-[minmax(0,1fr)_minmax(0,1120px)_minmax(0,1fr)] opacity-100 transition-opacity duration-[200ms] ease-linear max-[1180px]:grid-cols-1 max-[979px]:z-20"
            : "fixed inset-0 z-50 grid grid-cols-[minmax(0,1fr)_minmax(0,1120px)_minmax(0,1fr)] opacity-0 transition-opacity duration-[200ms] ease-linear max-[1180px]:grid-cols-1 max-[979px]:z-20"
        }
      >
        <button
          className="cursor-pointer border-0 bg-transparent p-0 max-[1180px]:hidden"
          // className="cursor-pointer border-0 bg-black/90 backdrop-blur-[12px] p-0 max-[1180px]:hidden"
          type="button"
          aria-label="Close kitty detail"
          onClick={closeDetailModal}
        />
        <div className="overflow-y-auto bg-black/70 px-[var(--page-pad)] backdrop-blur-[24px] max-sm:px-[var(--page-pad-mob)] max-md:pt-10 max-sm:pt-12 pb-6 max-md:pb-12">
          <div
            className={
              open
                ? "min-h-full w-full translate-x-0 translate-y-0 transform-gpu transition-transform duration-[200ms] ease-linear will-change-transform"
                : "min-h-full w-full translate-x-0 translate-y-[120vh] transform-gpu transition-transform duration-[200ms] ease-linear will-change-transform"
            }
          >
            {content}
          </div>
        </div>
        <button
          className="cursor-pointer border-0 bg-transparent p-0 max-[1180px]:hidden"
          type="button"
          aria-label="Close kitty detail"
          onClick={closeDetailModal}
        />
      </div>,
      document.body,
    );
  };
  const backLink = modalPresentation ? (
    <BackToGalleryLink
      label={backTarget.label}
      to={backTarget.path}
      onBack={closeDetailModal}
    />
  ) : (
    <BackToGalleryLink label={backTarget.label} to={backTarget.path} />
  );

  if (kittyQuery.isLoading) {
    return renderDetailSurface(
      <main className="relative z-10 mx-auto max-w-[980px] pt-10 max-[640px]:pt-4">
        <div className="inline-flex min-h-48 items-center gap-2 py-[1.1rem] text-[var(--fg-muted)]">
          <Spinner /> Loading kitty detail...
        </div>
      </main>,
    );
  }

  if (kittyQuery.isError || !kittyQuery.data) {
    return renderDetailSurface(
      <main className="relative z-10 mx-auto max-w-[980px] pt-10 max-[640px]:pt-4">
        <div className="py-[1.1rem]">Kitty not found.</div>
        {backLink}
      </main>,
    );
  }

  const kitty = {
    ...kittyQuery.data,
    displayLabel: `kPEG #${kittyQuery.data.id}`,
  };
  const tierColor = getTierColor(kitty.tierLabel);
  const metallicTierVariant = getMetallicTierVariant(kitty.tierLabel);
  const modalMetallicTierVariant = modalPresentation
    ? metallicTierVariant
    : undefined;
  const globalRarityPct = formatPctCompact(kitty.kpegRarity.percentage);
  const kittySvg = renderKPEGSvg(kitty.traits);
  const traceRows = {
    timestamp: formatTimestamp(kitty.mintedAt),
    gas: formatGasUsed(kitty.gasUsed),
    baseFee: formatBaseFee(kitty.baseFeeWei),
  };
  const txUrl = chainTxUrl(kitty.txHash);
  const openPortfolio = (targetAddress: string) => {
    navigate(`/portfolio/${targetAddress}`);
  };
  const detailTabPane =
    activeTab === "traits" ? (
      <div className="grid gap-[0.45rem] max-[640px]:text-[0.65rem] max-[640px]:leading-[1.24]">
        {(
          Object.entries(kitty.traits) as Array<
            [keyof typeof kitty.traits, string]
          >
        ).map(([key, value]) => {
          const chance = kitty.traitOdds?.[key];
          const probability = chance?.probabilityPct ?? 0;
          return (
            <button
              key={key}
              className="group grid w-full min-w-0 cursor-pointer grid-cols-[minmax(3.4rem,0.35fr)_minmax(0,1fr)_minmax(6.2rem,6.2rem)] items-center gap-2 border-b border-[var(--line)] border-t-0 border-r-0 border-l-0 bg-transparent px-0 py-[0.65rem] text-left font-[inherit] text-[inherit] max-[860px]:gap-3 max-[640px]:grid-cols-[minmax(4.2rem,0.46fr)_minmax(0,1fr)] max-[640px]:py-[0.46rem]"
              type="button"
              onClick={() => void copyTrait(key, value)}
            >
              <div className="min-w-0">{TRAIT_LABELS[key] ?? key}</div>
              <div className="relative inline-flex min-w-0 items-center justify-start gap-3 text-left max-[640px]:justify-end">
                <span
                  className={
                    copiedTrait === key
                      ? "inline-flex w-[4.6rem] shrink-0 items-center justify-end font-normal text-[var(--fg-muted)] opacity-100 max-[640px]:hidden"
                      : "inline-flex w-[4.6rem] shrink-0 items-center justify-end font-normal text-[var(--fg-muted)] opacity-0 transition-opacity group-hover:opacity-100 max-[640px]:hidden"
                  }
                >
                  {copiedTrait === key ? "COPIED" : "COPY"}
                </span>
                <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-right text-[var(--fg)]">
                  {value}
                </strong>
              </div>
              <div className="text-right max-[640px]:hidden">
                <strong>{formatPct(probability)}</strong>
              </div>
            </button>
          );
        })}
      </div>
    ) : (
      <div className="grid gap-[0.45rem] max-[640px]:text-[0.65rem] max-[640px]:leading-[1.24]">
        <button
          className="group grid w-full min-w-0 cursor-pointer grid-cols-[1fr_1fr_auto] items-center border-b border-[var(--line)] border-t-0 border-r-0 border-l-0 bg-transparent px-0 py-[0.65rem] text-left font-[inherit] text-[inherit] disabled:cursor-default disabled:text-[var(--fg-muted)] max-[640px]:grid-cols-[minmax(4.2rem,0.46fr)_minmax(0,1fr)] max-[640px]:py-[0.46rem]"
          type="button"
          disabled={!txUrl}
          onClick={() =>
            txUrl && window.open(txUrl, "_blank", "noopener,noreferrer")
          }
        >
          <div className="min-w-0">BLOCK</div>
          <div className="max-[640px]:hidden" />
          <div className="inline-flex min-w-0 items-center justify-end gap-[0.65rem] font-bold text-[var(--fg)]">
            <i
              className="nf nf-oct-arrow_up_right text-[var(--fg-muted)] text-2xl opacity-0 transition-opacity group-hover:opacity-100 max-[640px]:hidden"
              aria-hidden="true"
            />
            <span className="min-w-0 text-right">
              #{kitty.blockNumber.toLocaleString()}
            </span>
          </div>
        </button>
        {(
          [
            ["timestamp", "TIMESTAMP", traceRows.timestamp],
            ["gas", "GAS USED", traceRows.gas],
            ["baseFee", "BASE FEE", traceRows.baseFee],
          ] as const
        ).map(([key, label, value]) => (
          <button
            key={key}
            className="group grid w-full min-w-0 cursor-pointer grid-cols-[1fr_1fr_auto] items-center border-b border-[var(--line)] border-t-0 border-r-0 border-l-0 bg-transparent px-0 py-[0.65rem] text-left font-[inherit] text-[inherit] max-[640px]:grid-cols-[minmax(4.2rem,0.46fr)_minmax(0,1fr)] max-[640px]:py-[0.46rem]"
            type="button"
            onClick={() => void copyTrace(key, value)}
          >
            <div className="min-w-0">{label}</div>
            <div className="max-[640px]:hidden" />
            <div className="inline-flex min-w-0 w-full items-center justify-end gap-[0.85rem]">
              <span
                className={
                  copiedTrace === key
                    ? "inline-flex w-[4.6rem] shrink-0 items-center justify-end font-normal text-[var(--fg-muted)] opacity-100 max-[640px]:hidden"
                    : "inline-flex w-[4.6rem] shrink-0 items-center justify-end font-normal text-[var(--fg-muted)] opacity-0 transition-opacity group-hover:opacity-100 max-[640px]:hidden"
                }
              >
                {copiedTrace === key ? "COPIED" : "COPY"}
              </span>
              <strong className="min-w-0 max-w-full text-right leading-[1.28]">
                {value}
              </strong>
            </div>
          </button>
        ))}
      </div>
    );

  const copyTrace = async (key: TraceKey, value: string) => {
    if (value === "N/A") return;
    await navigator.clipboard.writeText(value);
    setCopiedTrace(key);
    window.setTimeout(
      () => setCopiedTrace((current) => (current === key ? null : current)),
      3000,
    );
  };

  const copyTrait = async (key: TraitKey, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedTrait(key);
    window.setTimeout(
      () => setCopiedTrait((current) => (current === key ? null : current)),
      3000,
    );
  };

  const copyAddress = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedAddress(key);
    window.setTimeout(
      () => setCopiedAddress((current) => (current === key ? null : current)),
      3000,
    );
  };

  const copyKpeg = async () => {
    if (copyKpegStatus === "copying") return;
    setCopyKpegStatus("copying");
    try {
      await copySvgAsPng(kittySvg);
      setCopyKpegStatus("copied");
      if (copyKpegTimer.current !== null) {
        window.clearTimeout(copyKpegTimer.current);
      }
      copyKpegTimer.current = window.setTimeout(() => {
        setCopyKpegStatus("idle");
        copyKpegTimer.current = null;
      }, 3000);
    } catch {
      setCopyKpegStatus("idle");
    }
  };

  return renderDetailSurface(
    <main className="relative z-10 mx-auto max-w-[980px] pt-10 max-[640px]:pt-4">
      {backLink}
      <section className="grid min-w-0 grid-cols-[300px_1fr] items-start gap-8 py-[1.1rem] max-[980px]:grid-cols-1 max-[640px]:pt-3">
        <div className="grid min-w-0 gap-[0.55rem]">
          <div className="grid min-w-0 aspect-square place-items-center overflow-hidden rounded-md bg-white/[0.055]">
            <KPEGArt
              traits={kitty.traits}
              id={kitty.id}
              className="h-full w-full [image-rendering:pixelated]"
              alt={kitty.displayLabel}
            />
          </div>
          <div className="grid w-full grid-cols-[minmax(0,1fr)_2.3rem] gap-2 text-sm">
            <button
              className="inline-flex w-full min-w-0 cursor-pointer justify-center rounded-[5px] border border-[var(--line)] bg-[var(--fg)] py-[0.25rem] text-[var(--bg)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45"
              type="button"
              onClick={() => void copyKpeg()}
              disabled={copyKpegStatus === "copying"}
            >
              {copyKpegStatus === "copying"
                ? "COPYING..."
                : copyKpegStatus === "copied"
                  ? "COPIED TO CLIPBOARD"
                  : "COPY KPEG"}
            </button>
            <button
              className="inline-flex h-full w-full cursor-pointer items-center justify-center rounded-[5px] border border-[var(--line)] bg-transparent py-[0.25rem] text-[var(--fg-muted)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45"
              type="button"
              aria-label="Save as JPEG"
              onClick={() =>
                void saveSvgAsJpeg(kittySvg, `kpeg-${kitty.id}.jpg`)
              }
            >
              <i className="nf nf-oct-download text-[0.9rem] leading-none" />
            </button>
          </div>
        </div>
        <div className="grid min-w-0 content-start gap-[0.55rem] max-[640px]:text-[0.72rem] max-[640px]:leading-[1.24]">
          <h1 className="mt-0 mb-4 tracking-[-0.04em] max-[640px]:text-[1.1rem] text-2xl">
            {kitty.displayLabel} • {kitty.traits.breed}
          </h1>
          <PortfolioAddressRow
            address={kitty.owner}
            rowLabel="Owner"
            portfolioLabel="owner"
            copied={copiedAddress === "owner"}
            onOpen={openPortfolio}
            onCopy={() => void copyAddress("owner", kitty.owner)}
          />
          <PortfolioAddressRow
            address={kitty.mintedBy}
            rowLabel="Minted By"
            portfolioLabel="minter"
            copied={copiedAddress === "mintedBy"}
            onOpen={openPortfolio}
            onCopy={() => void copyAddress("mintedBy", kitty.mintedBy)}
          />
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <span className="min-w-0">Tier</span>
            <span
              className={
                modalMetallicTierVariant
                  ? "tier-metal-value min-w-0 text-right"
                  : "min-w-0 text-right"
              }
              data-tier-metal={modalMetallicTierVariant}
              style={
                tierColor && !modalMetallicTierVariant
                  ? { color: tierColor }
                  : undefined
              }
            >
              {kitty.tierLabel}
            </span>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <span className="min-w-0">Rarity Score</span>
            <span className="min-w-0 text-right">
              {formatRarityScore(kitty.rarityScore)}
            </span>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <span className="min-w-0">RARITY</span>
            <span
              className={
                globalRarityPct.zeroCount === null
                  ? "min-w-0 text-right"
                  : "inline-flex min-w-0 items-baseline justify-end gap-[0.04rem] text-right"
              }
              aria-label={formatPct(kitty.kpegRarity.percentage)}
              title={formatPct(kitty.kpegRarity.percentage)}
            >
              {globalRarityPct.zeroCount === null ? (
                globalRarityPct.text
              ) : (
                <>
                  {globalRarityPct.text}
                  <sub className="relative top-[0.16em] text-[0.72em] leading-none">
                    {globalRarityPct.zeroCount}
                  </sub>
                  {globalRarityPct.significantText}
                </>
              )}
            </span>
          </div>
          <div
            className="mt-0.5 grid gap-1 border-t border-[var(--line)] pt-3"
            aria-label={kitty.kpegRarity.label}
          >
            <div className="flex min-w-0 items-baseline justify-between gap-3 text-[0.8rem] text-[var(--fg-dim)] max-[640px]:text-[0.72rem]">
              <span className="min-w-0 whitespace-nowrap">
                {formatOneInN(kitty.kpegRarity.oneInN)}
              </span>
              <span className="min-w-0 text-right">
                {kitty.kpegRarity.basis}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="py-[1.1rem]">
        <div
          className="mb-4 inline-flex gap-4"
          role="tablist"
          aria-label="kitty detail"
        >
          <button
            className={
              activeTab === "traits"
                ? "cursor-pointer border-0 border-b border-[var(--fg)] bg-transparent px-0 pb-1 text-[0.92rem] font-extrabold tracking-[0.08em] text-[var(--fg)] transition-colors"
                : "cursor-pointer border-0 border-b border-transparent bg-transparent px-0 pb-1 text-[0.92rem] font-extrabold tracking-[0.08em] text-[var(--fg-muted)] transition-colors hover:border-[var(--fg)] hover:text-[var(--fg)]"
            }
            type="button"
            onClick={() => setActiveTab("traits")}
          >
            TRAITS
          </button>
          <button
            className={
              activeTab === "born"
                ? "cursor-pointer border-0 border-b border-[var(--fg)] bg-transparent px-0 pb-1 text-[0.92rem] font-extrabold tracking-[0.08em] text-[var(--fg)] transition-colors"
                : "cursor-pointer border-0 border-b border-transparent bg-transparent px-0 pb-1 text-[0.92rem] font-extrabold tracking-[0.08em] text-[var(--fg-muted)] transition-colors hover:border-[var(--fg)] hover:text-[var(--fg)]"
            }
            type="button"
            onClick={() => setActiveTab("born")}
          >
            BORN
          </button>
        </div>
        <SlidingPaneSwap
          contentKey={activeTab}
          content={detailTabPane}
          offsetPx={28}
        />
      </section>
    </main>,
  );
}
