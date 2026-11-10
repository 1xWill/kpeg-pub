import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { KPEG_TOKEN_ABI } from "@kpeg/core";
import { isAddress, zeroAddress, type Address } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { useNavigate, useParams } from "react-router-dom";
import { GalleryCard } from "../components/GalleryCard.js";
import {
  KittySelectionModal,
  type KittySelectionCandidate,
} from "../components/KittySelectionModal.js";
import { ConnectWalletTabPrompt } from "../components/ConnectWalletInlineText.js";
import { InfiniteGalleryGrid } from "../components/InfiniteGalleryGrid.js";
import { RollingNumber } from "../components/RollingNumber.js";
import { SearchField } from "../components/SearchField.js";
import { SlidingPaneSwap } from "../components/SlidingPaneSwap.js";
import { Spinner } from "../components/Spinner.js";
import { useToast } from "../context/toast.js";
import {
  getConfig,
  getKittyOrNull,
  getOwnerStats,
  getStatus,
  getStats,
  isApiUnavailableError,
  listGlobal,
  listOwner,
  searchKitties,
  type KittyItem,
  type OwnerStatsResponse,
  type PagedResponse,
  type SortMode,
  type StatsResponse,
} from "../lib/api.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { useMetallicResyncOnChange } from "../hooks/useMetallicResyncOnChange.js";
import { usePageFreshnessRefetch } from "../hooks/usePageFreshnessRefetch.js";
import {
  getInfiniteBatchSizes,
  useResponsiveGalleryColumns,
} from "../hooks/useResponsiveGalleryColumns.js";
import { useQueryScopePending } from "../hooks/useQueryScopePending.js";
import {
  BACKFILL_REFETCH_MS,
  clearPostTradeRefresh,
  getPostTradeRefreshUntil,
  isPostTradeRefreshActive,
  markPostTradeRefresh,
  NORMAL_GALLERY_REFETCH_MS,
  POST_TRADE_REFETCH_MS,
  POST_TRADE_REFRESH_EVENT,
} from "../lib/postTradeRefresh.js";
import {
  OPTIMISTIC_KITTIES_EVENT,
  clearOptimisticKitties,
  clearOptimisticKittyRemovals,
  nextOptimisticStateExpiryAt,
  readOptimisticKittyRemovals,
  readOptimisticKitties,
  type OptimisticKittyRemoval,
} from "../lib/optimisticKitties.js";
import {
  OPTIMISTIC_OWNER_TRANSFERS_EVENT,
  appendOptimisticOwnerTransfer,
  clearOptimisticOwnerTransfers,
  decideListingBoughtTransferPrune,
  nextOptimisticOwnerTransfersExpiryAt,
  readOptimisticOwnerTransfers,
  settleOptimisticOwnerTransfersByKittyOwners,
  type OptimisticOwnerTransfer,
} from "../lib/optimisticOwnerTransfers.js";
import { shortAddress } from "../lib/format.js";
import {
  resolveRuntimeAddress,
  resolveRuntimeChainId,
} from "../lib/runtimeConfig.js";
import { syncBackfillActive } from "../lib/syncStatus.js";
import { useStableSortReorderToken } from "../lib/reorderAnimation.js";
import { buildMetallicResyncToken } from "../lib/metallicResyncToken.js";
import { enqueueTxSync } from "../lib/syncQueue.js";
import { ensureWagmiConnectorCompatibility } from "../lib/wagmi.js";
import {
  readWalletOwnerKittiesSnapshotFromCache,
  readWalletOwnerKitties,
  upsertWalletOwnerKittiesMetadata,
  useWalletOwnerKitties,
} from "../lib/walletOwnerKitties.js";

type PageMode = "explore" | "collections" | "portfolio";
const FIXED_TOKEN_SUPPLY = 9_999;
const TRANSFER_MODAL_TRANSITION_MS = 200;
const MAX_TRANSFER_BUNDLE_SIZE = 100;
const TRANSFER_SELECTION_NOT_OWNED_ERROR =
  "Selected kPEG is no longer in this wallet";
const INDEXER_API_UNAVAILABLE_MESSAGE =
  "Indexer API is unavailable. Cards cannot load right now.";

type TransferModalAction = "idle" | "transferring";

export function transferRecipientValidationError(input: {
  recipient: string;
  sender: string | undefined;
}): string | null {
  const trimmed = input.recipient.trim();
  if (!trimmed) {
    return "Recipient wallet is required.";
  }
  if (!isAddress(trimmed)) {
    return "Enter a valid recipient wallet address.";
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === zeroAddress) {
    return "Recipient wallet cannot be the zero address.";
  }
  if (input.sender && normalized === input.sender.toLowerCase()) {
    return "Recipient wallet must be different from your wallet.";
  }
  return null;
}

export async function readTransferRecipientFromClipboard(
  clipboard:
    | {
        readText: () => Promise<string>;
      }
    | null
    | undefined,
): Promise<string | null> {
  if (!clipboard?.readText) {
    return null;
  }
  const text = await clipboard.readText();
  return text.trim();
}

export function canShowTransferButton(input: {
  mode: PageMode;
  ownerAddress: string | undefined;
  reserveWallet: boolean;
}): boolean {
  return (
    input.mode === "collections" &&
    Boolean(input.ownerAddress) &&
    !input.reserveWallet
  );
}

function buildTransferCandidates(input: {
  ownerIds: Set<number>;
  kitties: KittyItem[];
}): KittySelectionCandidate[] {
  const kittiesById = new Map(input.kitties.map((kitty) => [kitty.id, kitty]));
  return [...input.ownerIds]
    .sort((a, b) => a - b)
    .map((id) => ({ id, kitty: kittiesById.get(id) ?? null }));
}

type TransferWriteRequest = {
  address: Address;
  abi: unknown;
  functionName: string;
  args: readonly unknown[];
  chainId: number;
};

export function transferSelectionStateError(input: {
  selectedIds: number[];
  ownerIds: Set<number>;
}): string | null {
  if (!input.selectedIds.every((kittyId) => input.ownerIds.has(kittyId))) {
    return TRANSFER_SELECTION_NOT_OWNED_ERROR;
  }
  return null;
}

export async function executeOwnerTransferSubmitFlow(input: {
  selectedIds: number[];
  recipient: Address;
  tokenAddress: Address;
  chainId: number;
  verifyOwnerState: () => Promise<{ ownerIds: Set<number> }>;
  writeContract: (request: TransferWriteRequest) => Promise<`0x${string}`>;
}): Promise<{ kittyIds: number[]; transferHash: `0x${string}` }> {
  const kittyIds = [...input.selectedIds].sort((a, b) => a - b);
  const ownerState = await input.verifyOwnerState();
  const selectionError = transferSelectionStateError({
    selectedIds: kittyIds,
    ownerIds: ownerState.ownerIds,
  });
  if (selectionError) {
    throw new Error(selectionError);
  }
  const transferHash = await input.writeContract({
    address: input.tokenAddress,
    abi: KPEG_TOKEN_ABI,
    functionName: "directTransferKittiesList",
    args: [input.recipient, kittyIds.map(BigInt)],
    chainId: input.chainId,
  });
  return { kittyIds, transferHash };
}

export function onchainCountIsFresh(
  dataUpdatedAt: number,
  latestOptimisticCreatedAt: number,
): boolean {
  return (
    latestOptimisticCreatedAt <= 0 || dataUpdatedAt >= latestOptimisticCreatedAt
  );
}

export function settledOptimisticKittyIdsByIndexedBlock(
  kitties: KittyItem[],
  latestIndexedBlock: number,
): number[] {
  if (latestIndexedBlock <= 0) {
    return [];
  }
  return kitties
    .filter(
      (item) => item.blockNumber > 0 && item.blockNumber <= latestIndexedBlock,
    )
    .map((item) => item.id);
}

export function settledOptimisticRemovalTxHashesByIndexedBlock(
  removals: OptimisticKittyRemoval[],
  latestIndexedBlock: number,
): `0x${string}`[] {
  if (latestIndexedBlock <= 0) {
    return [];
  }
  return removals
    .filter(
      (item) => item.blockNumber > 0 && item.blockNumber <= latestIndexedBlock,
    )
    .map((item) => item.txHash);
}

export function settledCountOnlyOptimisticRemovalTxHashesByFreshCounter(
  removals: OptimisticKittyRemoval[],
  hasFreshScopedLiveCounter: boolean,
): `0x${string}`[] {
  if (!hasFreshScopedLiveCounter) {
    return [];
  }
  return removals
    .filter((item) => item.kittyIds.length === 0)
    .map((item) => item.txHash);
}

export function resolveOptimisticSettlementIndexedBlock(input: {
  statusLatestIndexedBlock?: number | null;
  statsLatestIndexedBlock?: number | null;
}): number {
  return Math.max(
    input.statusLatestIndexedBlock ?? 0,
    input.statsLatestIndexedBlock ?? 0,
  );
}

export function filterItemsByOptimisticRemovalIds(
  items: KittyItem[],
  optimisticRemovalIds: Set<number>,
): KittyItem[] {
  if (items.length === 0 || optimisticRemovalIds.size === 0) {
    return items;
  }
  return items.filter((kitty) => !optimisticRemovalIds.has(kitty.id));
}

export function shouldKeepPostTradeRefresh(input: {
  pendingOptimisticBuyCount: number;
  scopedOptimisticSellCount: number;
  scopedOptimisticTransferCount?: number;
  hasFreshScopedLiveCounter: boolean;
}): boolean {
  if (input.pendingOptimisticBuyCount > 0) {
    return true;
  }
  if (
    input.scopedOptimisticSellCount === 0 &&
    (input.scopedOptimisticTransferCount ?? 0) === 0
  ) {
    return false;
  }
  return !input.hasFreshScopedLiveCounter;
}

function toItems(
  data: PagedResponse | { items: KittyItem[]; total: number } | undefined,
): KittyItem[] {
  return data?.items ?? [];
}

export function mergeOwnerSummary(input: {
  currentFromChain: number | null;
  currentFromApi: number | undefined;
  everFromApi: number | undefined;
  verifiedWalletOwnerIds?: ReadonlySet<number> | null;
  optimisticMintCount?: number;
  optimisticRemovalCount?: number;
  optimisticCurrentDelta?: number;
  optimisticEverDelta?: number;
}) {
  const optimisticMintCount = input.optimisticMintCount ?? 0;
  const optimisticRemovalCount = input.optimisticRemovalCount ?? 0;
  const optimisticCurrentDelta = input.optimisticCurrentDelta ?? 0;
  const optimisticEverDelta = input.optimisticEverDelta ?? 0;
  const currentKitties = resolveOwnerCurrentKitties({
    currentFromFreshChain: input.currentFromChain,
    verifiedWalletOwnerIds: input.verifiedWalletOwnerIds ?? null,
    currentFromApi: input.currentFromApi,
    optimisticCurrentDelta:
      optimisticMintCount - optimisticRemovalCount + optimisticCurrentDelta,
  });
  const everCandidate =
    input.everFromApi ??
    input.currentFromApi ??
    input.currentFromChain ??
    input.verifiedWalletOwnerIds?.size ??
    0;
  const optimisticEver =
    everCandidate + optimisticMintCount + optimisticEverDelta;
  return {
    currentKitties,
    // Historical ownership can never be lower than live current ownership.
    everKitties: Math.max(optimisticEver, currentKitties),
  };
}

export function resolveOwnerCurrentKitties(input: {
  currentFromFreshChain: number | null;
  verifiedWalletOwnerIds: ReadonlySet<number> | null;
  currentFromApi: number | undefined;
  optimisticCurrentDelta: number;
}): number {
  if (input.currentFromFreshChain !== null) {
    return Math.max(0, input.currentFromFreshChain);
  }
  if (input.verifiedWalletOwnerIds) {
    return Math.max(0, input.verifiedWalletOwnerIds.size);
  }
  return Math.max(0, (input.currentFromApi ?? 0) + input.optimisticCurrentDelta);
}

export function mergeExploreStats(input: {
  apiKittiesLive: number | undefined;
  apiKittiesEverMinted: number | undefined;
  onchainKittiesLive: number | null;
  onchainKittiesEverMinted: number | null;
  optimisticMintCount: number;
  optimisticRemovalCount: number;
}) {
  const optimisticLive =
    (input.apiKittiesLive ?? 0) +
    input.optimisticMintCount -
    input.optimisticRemovalCount;
  const optimisticEver =
    (input.apiKittiesEverMinted ?? 0) + input.optimisticMintCount;
  const kittiesLive = input.onchainKittiesLive ?? Math.max(0, optimisticLive);
  const kittiesEverMinted =
    input.onchainKittiesEverMinted ?? Math.max(optimisticEver, kittiesLive);
  return {
    kittiesLive,
    kittiesEverMinted,
  };
}

export function optimisticRemovalCountForOwner(
  removals: OptimisticKittyRemoval[],
  ownerAddress?: string,
): number {
  if (removals.length === 0) {
    return 0;
  }
  const owner = ownerAddress?.toLowerCase();
  return removals.reduce((sum, item) => {
    if (owner && item.owner !== owner) {
      return sum;
    }
    return sum + item.count;
  }, 0);
}

export function optimisticRemovalIdsForScope(
  removals: OptimisticKittyRemoval[],
  ownerAddress?: string,
): Set<number> {
  const owner = ownerAddress?.toLowerCase();
  const out = new Set<number>();
  for (const item of removals) {
    if (owner && item.owner !== owner) {
      continue;
    }
    for (const kittyId of item.kittyIds) {
      out.add(kittyId);
    }
  }
  return out;
}

export function ownerTransferCountForAddress(input: {
  transfers: OptimisticOwnerTransfer[];
  ownerAddress: string | undefined;
  direction: "incoming" | "outgoing";
  reasons?: Array<OptimisticOwnerTransfer["reason"]>;
}): number {
  if (!input.ownerAddress || input.transfers.length === 0) {
    return 0;
  }
  const owner = input.ownerAddress.toLowerCase();
  const reasonSet = input.reasons ? new Set(input.reasons) : null;
  return input.transfers.reduce((sum, transfer) => {
    if (reasonSet && !reasonSet.has(transfer.reason)) {
      return sum;
    }
    const matchesDirection =
      input.direction === "incoming"
        ? transfer.to === owner
        : transfer.from === owner;
    if (!matchesDirection) {
      return sum;
    }
    return sum + transfer.kittyIds.length;
  }, 0);
}

export function ownerCurrentTransferOverlayDelta(input: {
  transfers: OptimisticOwnerTransfer[];
  ownerAddress: string | undefined;
  currentFromChain: number | null;
  currentFromApi: number | undefined;
  hasFreshOwnerLiveCounter: boolean;
  ownerCurrentIds?: ReadonlySet<number> | null;
  apiVisibleOwnerIds?: ReadonlySet<number> | null;
}): number {
  if (!input.ownerAddress || input.transfers.length === 0) {
    return 0;
  }
  if (input.hasFreshOwnerLiveCounter && input.currentFromChain !== null) {
    return 0;
  }
  const owner = input.ownerAddress.toLowerCase();
  const orderedTransfers = [...input.transfers].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  const baselineOwnerIds = input.ownerCurrentIds ?? input.apiVisibleOwnerIds;
  if (baselineOwnerIds) {
    const workingOwnerIds = new Set<number>(baselineOwnerIds);
    let delta = 0;
    for (const transfer of orderedTransfers) {
      if (transfer.from === owner) {
        for (const kittyId of transfer.kittyIds) {
          if (workingOwnerIds.has(kittyId)) {
            delta -= 1;
            workingOwnerIds.delete(kittyId);
          }
        }
      }
      if (transfer.to === owner) {
        for (const kittyId of transfer.kittyIds) {
          if (!workingOwnerIds.has(kittyId)) {
            delta += 1;
            workingOwnerIds.add(kittyId);
          }
        }
      }
    }
    return delta;
  }

  return orderedTransfers.reduce((sum, transfer) => {
    if (transfer.from === owner) {
      return sum - transfer.kittyIds.length;
    }
    if (transfer.to !== owner) {
      return sum;
    }
    if (transfer.reason !== "WALLET_TRANSFER") {
      return sum + transfer.kittyIds.length;
    }
    if ((input.currentFromApi ?? 0) <= 0) {
      return sum + transfer.kittyIds.length;
    }
    return sum;
  }, 0);
}

export function applyOwnerTransfersToItems(input: {
  items: KittyItem[];
  ownerAddress: string | undefined;
  transfers: OptimisticOwnerTransfer[];
}): KittyItem[] {
  if (!input.ownerAddress || input.transfers.length === 0) {
    return input.items;
  }
  const owner = input.ownerAddress.toLowerCase();
  const byId = new Map(input.items.map((kitty) => [kitty.id, kitty]));
  const orderedTransfers = [...input.transfers].sort(
    (a, b) => a.createdAt - b.createdAt,
  );

  for (const transfer of orderedTransfers) {
    if (transfer.from === owner) {
      for (const kittyId of transfer.kittyIds) {
        byId.delete(kittyId);
      }
      continue;
    }
    if (transfer.to === owner) {
      for (const kitty of transfer.kitties) {
        byId.set(kitty.id, { ...kitty, owner });
      }
    }
  }

  return [...byId.values()];
}

export function sortMergedGalleryItems(input: {
  items: KittyItem[];
  sort: SortMode;
  searchValue: string;
}): KittyItem[] {
  if (input.items.length < 2 || input.searchValue.trim()) {
    return input.items;
  }
  const sorted = [...input.items];
  if (input.sort === "scarcity") {
    sorted.sort((a, b) => b.rarityScore - a.rarityScore || b.id - a.id);
    return sorted;
  }
  sorted.sort((a, b) => b.id - a.id);
  return sorted;
}

export function shouldDisableGallerySortDuringSearch(searchValue: string): boolean {
  return searchValue.trim().length > 0;
}

export function ownerWalletDisplayFallback(input: {
  mode: PageMode;
  ownerAddress: string | undefined;
  searchValue: string;
  galleryItems: KittyItem[];
  walletKitties: KittyItem[] | undefined;
}): KittyItem[] {
  if (input.mode !== "collections" && input.mode !== "portfolio") {
    return input.galleryItems;
  }
  if (!input.ownerAddress) {
    return input.galleryItems;
  }
  if (input.searchValue.trim() || input.galleryItems.length > 0) {
    return input.galleryItems;
  }
  return input.walletKitties ?? input.galleryItems;
}

export function indexingProgressMessage(input: {
  scope: "explore" | "owner";
  indexedTotal: number;
  liveOnchainCount: number;
}): string | null {
  if (input.liveOnchainCount <= input.indexedTotal) {
    return null;
  }
  const label = input.scope === "owner" ? "wallet kitties" : "live kitties";
  return `${input.indexedTotal.toLocaleString()} / ${input.liveOnchainCount.toLocaleString()} ${label} indexed from chain. Backfill is running; cards appear as indexing catches up.`;
}

export function ownerEmptyStateMessage(input: {
  reserveWallet: boolean;
  apiUnavailable: boolean;
  indexingMessage: string | null;
  currentKitties: number;
}) {
  if (input.reserveWallet) {
    return "This is the reserve wallet. Whole buys here never mint kitties, so use a second wallet to mint them.";
  }
  if (input.apiUnavailable) {
    return INDEXER_API_UNAVAILABLE_MESSAGE;
  }
  if (input.indexingMessage) {
    return input.indexingMessage;
  }
  if (input.currentKitties > 0) {
    return "Wallet kitties are indexed, but this page has no cards for the current filters yet.";
  }
  return "No kitties are napping in this wallet yet.";
}

export function ownerScopeNeedsWalletConnection(input: {
  isCollections: boolean;
  ownerAddress: string | undefined;
}) {
  return input.isCollections && !input.ownerAddress;
}

export function collectionsMetricsUnavailable(input: {
  mode: PageMode;
  ownerAddress: string | undefined;
}): boolean {
  return input.mode === "collections" && !input.ownerAddress;
}

export function resolveOwnerAddressForMode(input: {
  mode: PageMode;
  accountAddress: string | undefined;
  portfolioOwner: string | undefined;
}) {
  if (input.mode === "portfolio") {
    return input.portfolioOwner;
  }
  if (input.mode === "collections") {
    return input.accountAddress;
  }
  return undefined;
}

export function galleryApiUnavailable(input: {
  statusError: unknown;
  statsError: unknown;
  galleryError: unknown;
  ownerSummaryError: unknown;
  ownerScoped: boolean;
}): boolean {
  return (
    isApiUnavailableError(input.statusError) ||
    isApiUnavailableError(input.statsError) ||
    isApiUnavailableError(input.galleryError) ||
    (input.ownerScoped && isApiUnavailableError(input.ownerSummaryError))
  );
}

export function TransferModal({
  kitties,
  loading,
  loadError,
  selectedIds,
  recipientInput,
  transferAction,
  open,
  maxBundleSize,
  senderAddress,
  onClose,
  onToggle,
  onRecipientChange,
  onPasteRecipient,
  onSubmit,
}: {
  kitties: KittySelectionCandidate[];
  loading: boolean;
  loadError: boolean;
  selectedIds: number[];
  recipientInput: string;
  transferAction: TransferModalAction;
  open: boolean;
  maxBundleSize: number;
  senderAddress: string | undefined;
  onClose: () => void;
  onToggle: (id: number) => void;
  onRecipientChange: (value: string) => void;
  onPasteRecipient: () => void;
  onSubmit: () => void;
}) {
  const actionPending = transferAction !== "idle";
  const recipientError = transferRecipientValidationError({
    recipient: recipientInput,
    sender: senderAddress,
  });
  const hasRecipient = recipientInput.trim().length > 0;
  const canSubmit =
    !actionPending &&
    !loading &&
    !loadError &&
    selectedIds.length > 0 &&
    selectedIds.length <= maxBundleSize &&
    hasRecipient &&
    recipientError === null;
  return (
    <KittySelectionModal
      open={open}
      eyebrow="TRANSFER kPEG"
      title="Pick kitties to transfer"
      kitties={kitties}
      loading={loading}
      loadError={loadError}
      selectedIds={selectedIds}
      selectionLocked={actionPending}
      maxBundleSize={maxBundleSize}
      onClose={onClose}
      onToggle={onToggle}
      footer={
        <div className="grid gap-3 border-t border-[var(--line)] pt-3">
          <label className="grid gap-1">
            <span className="font-mono text-[0.72rem] tracking-[0.08em] text-[var(--fg-muted)]">
              RECIPIENT WALLET
            </span>
            <div className="grid grid-cols-[1fr_auto] items-center rounded border border-[var(--line)] bg-white/[0.045] px-3">
              <input
                className="min-h-[2.25rem] appearance-none border-0 bg-transparent p-0 text-[1rem] text-[var(--fg)] outline-none"
                inputMode="text"
                placeholder="0x..."
                value={recipientInput}
                onChange={(event) => onRecipientChange(event.target.value)}
              />
              <button
                className="cursor-pointer border-0 border-l-2 border-[var(--line)] bg-transparent my-2 pl-3 font-mono text-[1rem] text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45"
                type="button"
                disabled={actionPending}
                onClick={onPasteRecipient}
              >
                PASTE
              </button>
            </div>
            {recipientError ? (
              <span className="font-mono text-[0.68rem] text-[var(--danger,#ff7a7a)]">
                {recipientError}
              </span>
            ) : null}
          </label>
          <button
            className="inline-flex min-h-[2.2rem] cursor-pointer justify-center rounded-[5px] border border-[var(--line)] bg-[var(--fg)] py-[0.4rem] text-[var(--bg)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {actionPending ? (
              "CONFIRMING..."
            ) : selectedIds.length === 0 ? (
              "SELECT KPEGS"
            ) : recipientError !== null ? (
              "ENTER RECIPIENT"
            ) : (
              <span className="inline-flex items-center gap-[0.38rem]">
                <span>TRANSFER</span>
                <RollingNumber
                  value={String(selectedIds.length)}
                  align="center"
                />
                <span>KPEG{selectedIds.length > 1 ? "S" : ""}</span>
              </span>
            )}
          </button>
        </div>
      }
    />
  );
}

export function GalleryPage({ mode }: { mode: PageMode }) {
  const { address, connector } = useAccount();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const write = useWriteContract();
  const { pushToast } = useToast();
  const writeWithCompatibility = useCallback(
    async (args: Parameters<typeof write.writeContractAsync>[0]) => {
      ensureWagmiConnectorCompatibility();
      return write.writeContractAsync(args);
    },
    [write],
  );
  const params = useParams();
  const accountAddress = address?.toLowerCase();
  const portfolioOwner =
    mode === "portfolio" && params.owner && isAddress(params.owner)
      ? params.owner.toLowerCase()
      : undefined;
  const ownerAddress = resolveOwnerAddressForMode({
    mode,
    accountAddress,
    portfolioOwner,
  });
  const [sort, setSort] = useState<SortMode>("latest");
  const [searchInput, setSearchInput] = useState("");
  const [postTradeRefreshUntil, setPostTradeRefreshUntil] = useState(
    getPostTradeRefreshUntil,
  );
  const [optimisticKitties, setOptimisticKitties] = useState<KittyItem[]>([]);
  const [optimisticRemovals, setOptimisticRemovals] = useState<
    OptimisticKittyRemoval[]
  >([]);
  const [optimisticOwnerTransfers, setOptimisticOwnerTransfers] = useState<
    OptimisticOwnerTransfer[]
  >([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferVisible, setTransferVisible] = useState(false);
  const [transferClosing, setTransferClosing] = useState(false);
  const [transferSelectedIds, setTransferSelectedIds] = useState<number[]>([]);
  const [transferRecipientInput, setTransferRecipientInput] = useState("");
  const [transferAction, setTransferAction] =
    useState<TransferModalAction>("idle");
  const transferCloseTimer = useRef<number | null>(null);
  const ownerTransferConflictLogKeys = useRef<Set<string>>(new Set());
  const searchValue = useDebouncedValue(searchInput, 450);
  const sortDisabled = shouldDisableGallerySortDuringSearch(searchValue);
  const columns = useResponsiveGalleryColumns();
  const { initialLimit, nextLimit } = getInfiniteBatchSizes(columns);
  const statusQuery = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    staleTime: 0,
    refetchInterval: (query) => {
      return syncBackfillActive(query.state.data)
        ? BACKFILL_REFETCH_MS
        : NORMAL_GALLERY_REFETCH_MS;
    },
  });
  const backfillActive = syncBackfillActive(statusQuery.data);
  const statusCaughtUp = statusQuery.data?.caughtUp === true;
  const allowOnchainReadRepair =
    !statusCaughtUp || isPostTradeRefreshActive(postTradeRefreshUntil);
  const refetchInterval = isPostTradeRefreshActive(postTradeRefreshUntil)
    ? POST_TRADE_REFETCH_MS
    : backfillActive
      ? BACKFILL_REFETCH_MS
      : NORMAL_GALLERY_REFETCH_MS;
  const sortPrefetchBlocked =
    backfillActive ||
    isPostTradeRefreshActive(postTradeRefreshUntil) ||
    optimisticKitties.length > 0 ||
    optimisticRemovals.length > 0 ||
    optimisticOwnerTransfers.length > 0;

  const statsQuery = useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
    staleTime: 120_000,
    refetchInterval,
  });

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
    staleTime: 30_000,
  });
  const tokenAddress = resolveRuntimeAddress(
    configQuery.data?.tokenAddress,
    import.meta.env.VITE_KPEG_TOKEN_ADDRESS,
  );
  const chainId = resolveRuntimeChainId(
    configQuery.data?.chainId,
    import.meta.env.VITE_KPEG_CHAIN_ID,
  );
  const publicClient = usePublicClient({ chainId });
  const optimisticScope = useMemo(
    () => ({ chainId, tokenAddress }),
    [chainId, tokenAddress],
  );

  const ownerSummaryQuery = useQuery({
    queryKey: ["owner-summary", ownerAddress],
    queryFn: () => getOwnerStats(ownerAddress!),
    enabled: Boolean(ownerAddress),
    staleTime: 120_000,
    refetchInterval,
  });
  const lastStableStatsRef = useRef<StatsResponse | null>(null);
  const lastStableOwnerSummaryRef = useRef<{
    owner: string;
    summary: OwnerStatsResponse;
  } | null>(null);
  useEffect(() => {
    if (statsQuery.data) {
      lastStableStatsRef.current = statsQuery.data;
    }
  }, [statsQuery.data]);
  useEffect(() => {
    if (ownerSummaryQuery.data && ownerAddress) {
      lastStableOwnerSummaryRef.current = {
        owner: ownerAddress,
        summary: ownerSummaryQuery.data,
      };
    }
  }, [ownerAddress, ownerSummaryQuery.data]);

  const galleryQueryKey = [
    "gallery",
    mode,
    ownerAddress,
    sort,
    searchValue,
    columns,
  ] as const;
  const fetchGalleryPage = useCallback(
    async (
      sortKey: SortMode,
      pageParam: { offset: number; limit: number },
    ): Promise<PagedResponse> => {
      const { offset, limit } = pageParam;
      const page = Math.floor(offset / limit);
      const scope = mode === "explore" ? "explore" : "my-collections";

      if (searchValue.trim()) {
        const payload = await searchKitties(
          searchValue,
          scope,
          ownerAddress ?? null,
          page,
          limit,
          offset,
        );
        return {
          page,
          pageSize: limit,
          total: payload.total,
          items: payload.items,
        } satisfies PagedResponse;
      }

      if ((mode === "collections" || mode === "portfolio") && ownerAddress) {
        return listOwner(ownerAddress, page, limit, sortKey, offset);
      }
      if ((mode === "collections" || mode === "portfolio") && !ownerAddress) {
        return {
          page,
          pageSize: limit,
          total: 0,
          items: [],
        } satisfies PagedResponse;
      }
      return listGlobal(page, limit, sortKey, offset);
    },
    [mode, ownerAddress, searchValue],
  );

  const galleryQuery = useInfiniteQuery({
    queryKey: galleryQueryKey,
    initialPageParam: { offset: 0, limit: initialLimit },
    queryFn: ({ pageParam }) =>
      fetchGalleryPage(sort, pageParam as { offset: number; limit: number }),
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0);
      if (loaded >= lastPage.total) return undefined;
      return { offset: loaded, limit: nextLimit };
    },
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      if (!Array.isArray(previousKey) || previousKey[0] !== "gallery") {
        return undefined;
      }
      const previousMode = previousKey[1];
      const previousOwner = previousKey[2];
      const previousSort = previousKey[3];
      const previousSearch = previousKey[4];
      const previousColumns = previousKey[5];
      if (previousMode !== mode) {
        return undefined;
      }
      if (
        (typeof previousOwner === "string" ? previousOwner : "") !==
        (ownerAddress ?? "")
      ) {
        return undefined;
      }
      if (
        (typeof previousSearch === "string" ? previousSearch.trim() : "") !==
        searchValue.trim()
      ) {
        return undefined;
      }
      if (previousSort !== sort) {
        return undefined;
      }
      if (previousColumns !== columns) {
        return undefined;
      }
      return previousData;
    },
    staleTime: 120_000,
    refetchInterval,
  });

  useEffect(() => {
    if (mode !== "explore") return;
    if (searchValue.trim()) return;
    if (sortPrefetchBlocked) return;
    const alternateSort: SortMode = sort === "latest" ? "scarcity" : "latest";
    const prefetchKey = [
      "gallery",
      mode,
      ownerAddress,
      alternateSort,
      searchValue,
      columns,
    ] as const;
    const prefetchState = queryClient.getQueryState(prefetchKey);
    if (
      prefetchState?.data !== undefined ||
      prefetchState?.fetchStatus === "fetching"
    ) {
      return;
    }
    void queryClient.prefetchInfiniteQuery({
      queryKey: prefetchKey,
      initialPageParam: { offset: 0, limit: initialLimit },
      queryFn: ({ pageParam }) =>
        fetchGalleryPage(
          alternateSort,
          pageParam as { offset: number; limit: number },
        ),
      getNextPageParam: (
        lastPage: PagedResponse,
        allPages: PagedResponse[],
      ) => {
        const loaded = allPages.reduce(
          (sum, page) => sum + page.items.length,
          0,
        );
        if (loaded >= lastPage.total) return undefined;
        return { offset: loaded, limit: nextLimit };
      },
      staleTime: 120_000,
    });
  }, [
    columns,
    fetchGalleryPage,
    initialLimit,
    mode,
    nextLimit,
    ownerAddress,
    queryClient,
    searchValue,
    sort,
    sortPrefetchBlocked,
  ]);

  const notMintableAccountQuery = useReadContract({
    abi: KPEG_TOKEN_ABI,
    address: tokenAddress,
    functionName: "notMintableAccount",
    chainId: chainId ?? undefined,
    query: {
      enabled: Boolean(
        tokenAddress &&
          ownerAddress &&
          (mode === "collections" || mode === "portfolio"),
      ),
      staleTime: Number.POSITIVE_INFINITY,
    },
  });

  const kittiesLiveQuery = useReadContract({
    abi: KPEG_TOKEN_ABI,
    address: tokenAddress,
    functionName: "kittiesLive",
    chainId: chainId ?? undefined,
    query: {
      enabled: Boolean(
        tokenAddress && mode === "explore" && allowOnchainReadRepair,
      ),
      refetchInterval,
    },
  });

  const kittiesEverMintedQuery = useReadContract({
    abi: KPEG_TOKEN_ABI,
    address: tokenAddress,
    functionName: "kittiesEverMinted",
    chainId: chainId ?? undefined,
    query: {
      enabled: Boolean(
        tokenAddress && mode === "explore" && allowOnchainReadRepair,
      ),
      refetchInterval,
    },
  });

  const ownerKittiesLiveQuery = useReadContract({
    abi: KPEG_TOKEN_ABI,
    address: tokenAddress,
    functionName: "ownerKittiesLive",
    args: ownerAddress ? [ownerAddress as `0x${string}`] : undefined,
    chainId: chainId ?? undefined,
    query: {
      enabled: Boolean(tokenAddress && ownerAddress && allowOnchainReadRepair),
      refetchInterval,
    },
  });

  useEffect(() => {
    const onPostTradeRefresh = () => {
      setPostTradeRefreshUntil(getPostTradeRefreshUntil());
      void statsQuery.refetch();
      void galleryQuery.refetch();
      void kittiesLiveQuery.refetch();
      void kittiesEverMintedQuery.refetch();
      if (ownerAddress) {
        void ownerSummaryQuery.refetch();
        void ownerKittiesLiveQuery.refetch();
        void queryClient.invalidateQueries({
          queryKey: ["wallet-owner-kitties"],
        });
      }
    };
    window.addEventListener(POST_TRADE_REFRESH_EVENT, onPostTradeRefresh);
    return () =>
      window.removeEventListener(POST_TRADE_REFRESH_EVENT, onPostTradeRefresh);
  }, [
    galleryQuery,
    ownerAddress,
    kittiesEverMintedQuery,
    kittiesLiveQuery,
    ownerKittiesLiveQuery,
    ownerSummaryQuery,
    queryClient,
    statsQuery,
  ]);

  useEffect(() => {
    const onOptimisticTradeState = () => {
      setOptimisticKitties(readOptimisticKitties(optimisticScope));
      setOptimisticRemovals(readOptimisticKittyRemovals(optimisticScope));
      setOptimisticOwnerTransfers(
        readOptimisticOwnerTransfers(optimisticScope),
      );
    };
    onOptimisticTradeState();
    window.addEventListener(OPTIMISTIC_KITTIES_EVENT, onOptimisticTradeState);
    window.addEventListener(
      OPTIMISTIC_OWNER_TRANSFERS_EVENT,
      onOptimisticTradeState,
    );
    window.addEventListener("storage", onOptimisticTradeState);
    return () => {
      window.removeEventListener(
        OPTIMISTIC_KITTIES_EVENT,
        onOptimisticTradeState,
      );
      window.removeEventListener(
        OPTIMISTIC_OWNER_TRANSFERS_EVENT,
        onOptimisticTradeState,
      );
      window.removeEventListener("storage", onOptimisticTradeState);
    };
  }, [optimisticScope]);

  useEffect(() => {
    if (
      optimisticKitties.length === 0 &&
      optimisticRemovals.length === 0 &&
      optimisticOwnerTransfers.length === 0
    ) {
      return;
    }
    const nextTradeExpiryAt = nextOptimisticStateExpiryAt(optimisticScope);
    const nextTransferExpiryAt =
      nextOptimisticOwnerTransfersExpiryAt(optimisticScope);
    const nextExpiryAt = Math.min(
      nextTradeExpiryAt > 0 ? nextTradeExpiryAt : Number.POSITIVE_INFINITY,
      nextTransferExpiryAt > 0
        ? nextTransferExpiryAt
        : Number.POSITIVE_INFINITY,
    );
    const delayMs =
      Number.isFinite(nextExpiryAt) && nextExpiryAt > 0
        ? Math.max(0, nextExpiryAt - Date.now() + 25)
        : 0;
    const timer = window.setTimeout(() => {
      setOptimisticKitties(readOptimisticKitties(optimisticScope));
      setOptimisticRemovals(readOptimisticKittyRemovals(optimisticScope));
      setOptimisticOwnerTransfers(
        readOptimisticOwnerTransfers(optimisticScope),
      );
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [
    optimisticKitties,
    optimisticOwnerTransfers,
    optimisticRemovals,
    optimisticScope,
  ]);

  useEffect(() => {
    if (!isPostTradeRefreshActive(postTradeRefreshUntil)) {
      return;
    }
    const timer = window.setTimeout(
      () => {
        setPostTradeRefreshUntil(getPostTradeRefreshUntil());
      },
      Math.max(0, postTradeRefreshUntil - Date.now() + 250),
    );
    return () => window.clearTimeout(timer);
  }, [postTradeRefreshUntil]);

  const reserveWallet =
    Boolean(ownerAddress) &&
    typeof notMintableAccountQuery.data === "string" &&
    ownerAddress!.toLowerCase() === notMintableAccountQuery.data.toLowerCase();

  const items = useMemo(
    () => galleryQuery.data?.pages.flatMap((page) => toItems(page)) ?? [],
    [galleryQuery.data],
  );
  const ownerScopeActive = Boolean(
    (mode === "collections" || mode === "portfolio") &&
      ownerAddress &&
      tokenAddress,
  );
  const ownerWalletKittiesQuery = useWalletOwnerKitties({
    owner: ownerAddress ? (ownerAddress as Address) : null,
    tokenAddress: tokenAddress ? (tokenAddress as Address) : null,
    chainId,
    publicClient: publicClient ?? null,
    connector,
    enabled: ownerScopeActive,
    seedKitties: items,
  });
  const ownerWalletKittiesCachedSnapshot =
    ownerAddress && tokenAddress
      ? readWalletOwnerKittiesSnapshotFromCache({
          queryClient,
          chainId,
          tokenAddress: tokenAddress as Address,
          owner: ownerAddress as Address,
        })
      : undefined;
  const galleryPageRefetchKey = useMemo(() => {
    if (mode === "explore") {
      return "explore";
    }
    if (mode === "collections") {
      return `collections:${ownerAddress ?? "disconnected"}`;
    }
    return `portfolio:${ownerAddress ?? "unknown"}`;
  }, [mode, ownerAddress]);
  const refetchGalleryPageFreshness = useCallback(() => {
    void statusQuery.refetch();
    void statsQuery.refetch();
    void galleryQuery.refetch();
    if (mode === "explore") {
      void kittiesLiveQuery.refetch();
      void kittiesEverMintedQuery.refetch();
      return;
    }
    if (!ownerAddress) {
      return;
    }
    void ownerSummaryQuery.refetch();
    void ownerKittiesLiveQuery.refetch();
    if (
      ownerScopeActive &&
      !ownerWalletKittiesQuery.data &&
      !ownerWalletKittiesCachedSnapshot
    ) {
      void ownerWalletKittiesQuery.refetch();
    }
  }, [
    galleryQuery,
    kittiesEverMintedQuery,
    kittiesLiveQuery,
    mode,
    ownerAddress,
    ownerScopeActive,
    ownerWalletKittiesCachedSnapshot,
    ownerKittiesLiveQuery,
    ownerSummaryQuery,
    ownerWalletKittiesQuery,
    statsQuery,
    statusQuery,
  ]);
  usePageFreshnessRefetch({
    pageKey: galleryPageRefetchKey,
    forceToken: isPostTradeRefreshActive(postTradeRefreshUntil)
      ? postTradeRefreshUntil
      : 0,
    onRefetch: refetchGalleryPageFreshness,
  });
  const transferCandidates = useMemo(() => {
    const data = ownerWalletKittiesQuery.data;
    if (!data) {
      return [] as KittySelectionCandidate[];
    }
    return buildTransferCandidates({
      ownerIds: data.ownerIds,
      kitties: data.kitties,
    });
  }, [ownerWalletKittiesQuery.data]);
  const transferKittiesLoading =
    Boolean(ownerAddress && transferOpen) &&
    !ownerWalletKittiesQuery.data &&
    (ownerWalletKittiesQuery.isPending || ownerWalletKittiesQuery.isFetching);
  const transferKittiesLoadError =
    Boolean(ownerAddress && transferOpen) &&
    !ownerWalletKittiesQuery.data &&
    ownerWalletKittiesQuery.isError;
  const transferButtonVisible = canShowTransferButton({
    mode,
    ownerAddress,
    reserveWallet,
  });
  const openTransferModal = () => {
    if (!transferButtonVisible) {
      return;
    }
    if (transferCloseTimer.current !== null) {
      window.clearTimeout(transferCloseTimer.current);
      transferCloseTimer.current = null;
    }
    setTransferOpen(true);
    setTransferClosing(false);
    setTransferVisible(false);
    setTransferAction("idle");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setTransferVisible(true));
    });
  };
  const closeTransferModal = () => {
    if (!transferOpen || transferClosing) return;
    setTransferClosing(true);
    setTransferVisible(false);
    transferCloseTimer.current = window.setTimeout(() => {
      setTransferOpen(false);
      setTransferClosing(false);
      setTransferSelectedIds([]);
      setTransferRecipientInput("");
      setTransferAction("idle");
      transferCloseTimer.current = null;
    }, TRANSFER_MODAL_TRANSITION_MS);
  };
  const onToggleTransferSelection = useCallback((id: number) => {
    setTransferSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }, []);
  useEffect(() => {
    return () => {
      if (transferCloseTimer.current !== null) {
        window.clearTimeout(transferCloseTimer.current);
      }
    };
  }, []);
  useEffect(() => {
    if (!transferOpen || !ownerWalletKittiesQuery.data) return;
    const selectableIds = new Set(transferCandidates.map((item) => item.id));
    setTransferSelectedIds((current) => {
      const next = current.filter((kittyId) => selectableIds.has(kittyId));
      return next.length === current.length ? current : next;
    });
  }, [ownerWalletKittiesQuery.data, transferCandidates, transferOpen]);
  useEffect(() => {
    if (!transferOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [transferOpen]);
  useEffect(() => {
    if (
      !ownerScopeActive ||
      !ownerAddress ||
      !tokenAddress ||
      items.length === 0
    ) {
      return;
    }
    upsertWalletOwnerKittiesMetadata({
      queryClient,
      chainId,
      tokenAddress: tokenAddress as Address,
      owner: ownerAddress as Address,
      kitties: items,
    });
  }, [
    chainId,
    items,
    ownerAddress,
    ownerScopeActive,
    queryClient,
    tokenAddress,
  ]);
  const ownerScopedOptimisticRemovals = useMemo(() => {
    if ((mode !== "collections" && mode !== "portfolio") || !ownerAddress) {
      return [] as OptimisticKittyRemoval[];
    }
    const owner = ownerAddress.toLowerCase();
    return optimisticRemovals.filter((item) => item.owner === owner);
  }, [mode, optimisticRemovals, ownerAddress]);
  const ownerScopedOptimisticTransfers = useMemo(() => {
    if ((mode !== "collections" && mode !== "portfolio") || !ownerAddress) {
      return [] as OptimisticOwnerTransfer[];
    }
    const owner = ownerAddress.toLowerCase();
    return optimisticOwnerTransfers.filter(
      (item) => item.from === owner || item.to === owner,
    );
  }, [mode, optimisticOwnerTransfers, ownerAddress]);
  const scopedOptimisticRemovals =
    mode === "explore" ? optimisticRemovals : ownerScopedOptimisticRemovals;
  const optimisticRemovalIds = useMemo(
    () =>
      optimisticRemovalIdsForScope(
        scopedOptimisticRemovals,
        mode === "explore" ? undefined : ownerAddress,
      ),
    [mode, ownerAddress, scopedOptimisticRemovals],
  );
  const ownerWalletDisplayItems = ownerWalletDisplayFallback({
    mode,
    ownerAddress,
    searchValue,
    galleryItems: items,
    walletKitties: ownerWalletKittiesQuery.data?.kitties,
  });
  const filteredItems = useMemo(
    () =>
      filterItemsByOptimisticRemovalIds(
        ownerWalletDisplayItems,
        optimisticRemovalIds,
      ),
    [ownerWalletDisplayItems, optimisticRemovalIds],
  );
  const visibleOptimisticKitties = useMemo(() => {
    if (searchValue.trim()) {
      return [];
    }
    const indexedIds = new Set(filteredItems.map((kitty) => kitty.id));
    return optimisticKitties.filter((kitty) => {
      if (indexedIds.has(kitty.id)) {
        return false;
      }
      if (optimisticRemovalIds.has(kitty.id)) {
        return false;
      }
      if ((mode === "collections" || mode === "portfolio") && ownerAddress) {
        return kitty.owner.toLowerCase() === ownerAddress.toLowerCase();
      }
      return mode === "explore";
    });
  }, [
    filteredItems,
    mode,
    optimisticKitties,
    optimisticRemovalIds,
    ownerAddress,
    searchValue,
  ]);
  const ownerOptimisticMintCount =
    mode === "collections" || mode === "portfolio"
      ? visibleOptimisticKitties.length
      : 0;
  const ownerOptimisticRemovalCount = optimisticRemovalCountForOwner(
    ownerScopedOptimisticRemovals,
  );
  const ownerIncomingBoughtTransferCount = ownerTransferCountForAddress({
    transfers: ownerScopedOptimisticTransfers,
    ownerAddress,
    direction: "incoming",
    reasons: ["LISTING_BOUGHT"],
  });
  const globalOptimisticMintCount =
    mode === "explore" ? visibleOptimisticKitties.length : 0;
  const globalOptimisticRemovalCount =
    mode === "explore"
      ? optimisticRemovalCountForOwner(scopedOptimisticRemovals)
      : 0;
  const latestExploreOptimisticCreatedAt = useMemo(() => {
    if (mode !== "explore") {
      return 0;
    }
    const optimisticMintAt = visibleOptimisticKitties.reduce(
      (max, kitty) => Math.max(max, kitty.mintedAt),
      0,
    );
    const optimisticRemovalAt = scopedOptimisticRemovals.reduce(
      (max, removal) => Math.max(max, removal.createdAt),
      0,
    );
    return Math.max(optimisticMintAt, optimisticRemovalAt);
  }, [mode, scopedOptimisticRemovals, visibleOptimisticKitties]);
  const latestOwnerOptimisticCreatedAt = useMemo(() => {
    if ((mode !== "collections" && mode !== "portfolio") || !ownerAddress) {
      return 0;
    }
    const owner = ownerAddress.toLowerCase();
    const optimisticMintAt = optimisticKitties.reduce((max, kitty) => {
      if (kitty.owner.toLowerCase() !== owner) {
        return max;
      }
      return Math.max(max, kitty.mintedAt);
    }, 0);
    const optimisticRemovalAt = ownerScopedOptimisticRemovals.reduce(
      (max, removal) => Math.max(max, removal.createdAt),
      0,
    );
    const optimisticTransferAt = ownerScopedOptimisticTransfers.reduce(
      (max, transfer) => Math.max(max, transfer.createdAt),
      0,
    );
    return Math.max(
      optimisticMintAt,
      optimisticRemovalAt,
      optimisticTransferAt,
    );
  }, [
    mode,
    optimisticKitties,
    ownerAddress,
    ownerScopedOptimisticRemovals,
    ownerScopedOptimisticTransfers,
  ]);
  const displayItems = useMemo(() => {
    const sortedItems = sortMergedGalleryItems({
      items: [...visibleOptimisticKitties, ...filteredItems],
      sort,
      searchValue,
    });
    if (mode !== "collections" && mode !== "portfolio") {
      return sortedItems;
    }
    return sortMergedGalleryItems({
      items: applyOwnerTransfersToItems({
        items: sortedItems,
        ownerAddress,
        transfers: ownerScopedOptimisticTransfers,
      }),
      sort,
      searchValue,
    });
  }, [
    filteredItems,
    mode,
    ownerAddress,
    ownerScopedOptimisticTransfers,
    searchValue,
    sort,
    visibleOptimisticKitties,
  ]);
  const galleryScopeKey = [mode, ownerAddress ?? "", searchValue.trim()].join(
    "|",
  );
  const galleryScopeWithSortKey = [galleryScopeKey, sort].join("|");
  const galleryScopeHasCachedData =
    queryClient.getQueryData(galleryQueryKey) !== undefined;
  const galleryScopePending = useQueryScopePending({
    scopeKey: galleryScopeWithSortKey,
    scopeHasCachedData: galleryScopeHasCachedData,
    hasData: galleryQuery.data !== undefined,
    isPending: galleryQuery.isPending,
    isFetching: galleryQuery.isFetching,
    isPlaceholderData: galleryQuery.isPlaceholderData,
  });
  const lastStableItemsRef = useRef<KittyItem[]>([]);
  useEffect(() => {
    if (galleryScopePending) {
      return;
    }
    if (
      displayItems.length > 0 ||
      (!galleryQuery.isFetching && !galleryQuery.isPending)
    ) {
      lastStableItemsRef.current = displayItems;
    }
  }, [
    displayItems,
    galleryQuery.isFetching,
    galleryQuery.isPending,
    galleryScopePending,
  ]);
  const visibleDisplayItems = useMemo(() => {
    if (galleryScopePending) {
      return [] as KittyItem[];
    }
    const collectionDisconnected = mode === "collections" && !ownerAddress;
    if (collectionDisconnected) {
      return displayItems;
    }
    if (
      displayItems.length === 0 &&
      galleryQuery.isFetching &&
      lastStableItemsRef.current.length > 0
    ) {
      const filteredStableItems = filterItemsByOptimisticRemovalIds(
        lastStableItemsRef.current,
        optimisticRemovalIds,
      );
      if (mode !== "collections" && mode !== "portfolio") {
        return filteredStableItems;
      }
      return sortMergedGalleryItems({
        items: applyOwnerTransfersToItems({
          items: filteredStableItems,
          ownerAddress,
          transfers: ownerScopedOptimisticTransfers,
        }),
        sort,
        searchValue,
      });
    }
    return displayItems;
  }, [
    displayItems,
    galleryQuery.isFetching,
    galleryScopePending,
    mode,
    ownerAddress,
    optimisticRemovalIds,
    ownerScopedOptimisticTransfers,
    searchValue,
    sort,
  ]);
  useEffect(() => {
    if (mode !== "collections" || ownerAddress) {
      return;
    }
    if (transferCloseTimer.current !== null) {
      window.clearTimeout(transferCloseTimer.current);
      transferCloseTimer.current = null;
    }
    setTransferOpen(false);
    setTransferVisible(false);
    setTransferClosing(false);
    setTransferSelectedIds([]);
    setTransferRecipientInput("");
    setTransferAction("idle");
  }, [mode, ownerAddress]);
  const total = galleryQuery.data?.pages[0]?.total ?? 0;
  const onchainKittiesLive =
    typeof kittiesLiveQuery.data === "bigint"
      ? Number(kittiesLiveQuery.data)
      : null;
  const onchainKittiesEverMinted =
    typeof kittiesEverMintedQuery.data === "bigint"
      ? Number(kittiesEverMintedQuery.data)
      : null;
  const hasFreshExploreLiveCounter =
    onchainKittiesLive !== null &&
    onchainCountIsFresh(
      kittiesLiveQuery.dataUpdatedAt,
      latestExploreOptimisticCreatedAt,
    );
  const hasFreshOwnerLiveCounter =
    typeof ownerKittiesLiveQuery.data === "bigint" &&
    onchainCountIsFresh(
      ownerKittiesLiveQuery.dataUpdatedAt,
      latestOwnerOptimisticCreatedAt,
    );
  const effectiveOnchainKittiesLive = hasFreshExploreLiveCounter
    ? onchainKittiesLive
    : null;
  const effectiveOnchainKittiesEverMinted =
    onchainKittiesEverMinted !== null &&
    onchainCountIsFresh(
      kittiesEverMintedQuery.dataUpdatedAt,
      latestExploreOptimisticCreatedAt,
    )
      ? onchainKittiesEverMinted
      : null;
  const stableStats = statsQuery.data ?? lastStableStatsRef.current;
  const exploreStats = mergeExploreStats({
    apiKittiesLive: stableStats?.kittiesLive,
    apiKittiesEverMinted: stableStats?.kittiesEverMinted,
    onchainKittiesLive: effectiveOnchainKittiesLive,
    onchainKittiesEverMinted: effectiveOnchainKittiesEverMinted,
    optimisticMintCount: globalOptimisticMintCount,
    optimisticRemovalCount: globalOptimisticRemovalCount,
  });
  const stats = {
    tokenSupplyFixed: FIXED_TOKEN_SUPPLY,
    kittiesLive: exploreStats.kittiesLive,
    kittiesEverMinted: exploreStats.kittiesEverMinted,
    holdersLive: stableStats?.holdersLive ?? 0,
    holdersEver: stableStats?.holdersEver ?? 0,
    latestIndexedBlock: stableStats?.latestIndexedBlock ?? 0,
  };
  const isCollections = mode === "collections";
  const isPortfolio = mode === "portfolio";
  const ownerScopedPage = isCollections || isPortfolio;
  const statsApiUnavailable = isApiUnavailableError(statsQuery.error);
  const ownerStatsApiUnavailable = isApiUnavailableError(ownerSummaryQuery.error);
  const activeGalleryApiUnavailable = galleryApiUnavailable({
    statusError: statusQuery.error,
    statsError: statsQuery.error,
    galleryError: galleryQuery.error,
    ownerSummaryError: ownerSummaryQuery.error,
    ownerScoped: ownerScopedPage && Boolean(ownerAddress),
  });
  const hasFreshScopedLiveCounter =
    mode === "explore" ? hasFreshExploreLiveCounter : hasFreshOwnerLiveCounter;
  const ownerDisplay = ownerAddress ? shortAddress(ownerAddress) : "UNKNOWN";

  const stableOwnerSummary =
    ownerAddress &&
    lastStableOwnerSummaryRef.current?.owner === ownerAddress
      ? ownerSummaryQuery.data ?? lastStableOwnerSummaryRef.current.summary
      : ownerSummaryQuery.data ?? null;
  const summary = useMemo(() => {
    const currentFromChain = hasFreshOwnerLiveCounter
      ? Number(ownerKittiesLiveQuery.data)
      : null;
    const verifiedWalletOwnerIds = ownerWalletKittiesQuery.data?.verified
      ? ownerWalletKittiesQuery.data.ownerIds
      : null;
    const apiVisibleOwnerIds =
      !searchValue.trim() &&
      (mode === "collections" || mode === "portfolio") &&
      ownerAddress
        ? new Set(items.map((kitty) => kitty.id))
        : null;
    const ownerCurrentTransferDelta = ownerCurrentTransferOverlayDelta({
      transfers: ownerScopedOptimisticTransfers,
      ownerAddress,
      currentFromChain,
      currentFromApi: stableOwnerSummary?.currentKitties,
      hasFreshOwnerLiveCounter,
      ownerCurrentIds: verifiedWalletOwnerIds,
      apiVisibleOwnerIds,
    });
    return mergeOwnerSummary({
      currentFromChain,
      currentFromApi: stableOwnerSummary?.currentKitties,
      everFromApi: stableOwnerSummary?.everKitties,
      verifiedWalletOwnerIds,
      optimisticMintCount: ownerOptimisticMintCount,
      optimisticRemovalCount: ownerOptimisticRemovalCount,
      optimisticCurrentDelta: ownerCurrentTransferDelta,
      optimisticEverDelta: ownerIncomingBoughtTransferCount,
    });
  }, [
    hasFreshOwnerLiveCounter,
    items,
    mode,
    ownerAddress,
    ownerIncomingBoughtTransferCount,
    ownerKittiesLiveQuery.data,
    ownerOptimisticMintCount,
    ownerOptimisticRemovalCount,
    ownerScopedOptimisticTransfers,
    ownerWalletKittiesQuery.data?.verified,
    ownerWalletKittiesQuery.data?.ownerIds,
    searchValue,
    stableOwnerSummary,
  ]);

  const ownerHasChainCurrent = typeof ownerKittiesLiveQuery.data === "bigint";
  const ownerHasVerifiedCurrent = Boolean(ownerWalletKittiesQuery.data?.verified);
  const ownerStatsLoading =
    Boolean(ownerAddress) &&
    stableOwnerSummary === null &&
    !ownerHasChainCurrent &&
    !ownerHasVerifiedCurrent &&
    !ownerStatsApiUnavailable;
  const showDisconnectedCollectionMetrics = collectionsMetricsUnavailable({
    mode,
    ownerAddress,
  });
  const exploreStatsLoading = stableStats === null && !statsApiUnavailable;
  const ownerCurrentUnavailable =
    ownerStatsApiUnavailable && !ownerHasChainCurrent && !ownerHasVerifiedCurrent;
  const ownerEverUnavailable =
    ownerStatsApiUnavailable && stableOwnerSummary === null;
  const exploreLiveUnavailable =
    statsApiUnavailable && effectiveOnchainKittiesLive === null && stableStats === null;
  const exploreEverUnavailable =
    statsApiUnavailable && effectiveOnchainKittiesEverMinted === null && stableStats === null;
  const metrics =
    ownerScopedPage
      ? [
          {
            label: "KITTIES AT HOME",
            value: showDisconnectedCollectionMetrics
              ? "-"
              : ownerCurrentUnavailable
                ? "-"
                : summary.currentKitties.toLocaleString(),
            loading:
              !showDisconnectedCollectionMetrics &&
              ownerStatsLoading &&
              typeof ownerKittiesLiveQuery.data !== "bigint",
          },
          {
            label: isPortfolio ? "KITTIES EVER OWNED" : "KITTIES EVER YOURS",
            value: showDisconnectedCollectionMetrics
              ? "-"
              : ownerEverUnavailable
                ? "-"
                : summary.everKitties.toLocaleString(),
            loading: !showDisconnectedCollectionMetrics && ownerStatsLoading,
          },
        ]
      : [
          {
            label: "Token Supply",
            value: stats.tokenSupplyFixed.toLocaleString(),
            loading: false,
          },
          {
            label: "Live Kitties",
            value: exploreLiveUnavailable ? "-" : stats.kittiesLive.toLocaleString(),
            loading:
              !exploreLiveUnavailable &&
              exploreStatsLoading &&
              typeof kittiesLiveQuery.data !== "bigint",
          },
          {
            label: "Kitties Ever Born",
            value: exploreEverUnavailable
              ? "-"
              : stats.kittiesEverMinted.toLocaleString(),
            loading:
              !exploreEverUnavailable &&
              exploreStatsLoading &&
              typeof kittiesEverMintedQuery.data !== "bigint",
          },
          {
            label: "Holders",
            value: statsApiUnavailable && stableStats === null
              ? "-"
              : stats.holdersLive.toLocaleString(),
            loading: !statsApiUnavailable && exploreStatsLoading,
          },
        ];

  const transferCandidatesById = useMemo(
    () =>
      new Map(transferCandidates.map((candidate) => [candidate.id, candidate])),
    [transferCandidates],
  );
  const pasteTransferRecipient = useCallback(async () => {
    try {
      const clipboardText = await readTransferRecipientFromClipboard(
        typeof navigator === "undefined" ? null : navigator.clipboard,
      );
      if (clipboardText === null) {
        pushToast({
          kind: "info",
          title: "Paste Unavailable",
          message: "Clipboard access is unavailable on this browser.",
        });
        return;
      }
      setTransferRecipientInput(clipboardText);
    } catch {
      // Clipboard reads can fail due to browser permission policy.
    }
  }, [pushToast]);
  const submitTransfer = useCallback(async () => {
    if (
      !ownerAddress ||
      !tokenAddress ||
      !chainId ||
      !address ||
      !transferButtonVisible
    ) {
      return;
    }

    if (
      transferSelectedIds.length === 0 ||
      transferSelectedIds.length > MAX_TRANSFER_BUNDLE_SIZE
    ) {
      return;
    }
    const recipient = transferRecipientInput.trim();
    const recipientError = transferRecipientValidationError({
      recipient,
      sender: ownerAddress,
    });
    if (recipientError) {
      pushToast({
        kind: "error",
        title: "Transfer Failed",
        message: recipientError,
      });
      return;
    }

    let transferHash: `0x${string}` | null = null;
    try {
      setTransferAction("transferring");
      const flow = await executeOwnerTransferSubmitFlow({
        selectedIds: transferSelectedIds,
        recipient: recipient as Address,
        tokenAddress: tokenAddress as Address,
        chainId,
        verifyOwnerState: () =>
          readWalletOwnerKitties({
            publicClient: publicClient ?? null,
            owner: ownerAddress as Address,
            tokenAddress: tokenAddress as Address,
            chainId,
            connector,
          }),
        writeContract: (request) =>
          writeWithCompatibility(
            request as Parameters<typeof write.writeContractAsync>[0],
          ),
      });
      const kittyIds = flow.kittyIds;
      transferHash = flow.transferHash;
      const selectedKitties = kittyIds.flatMap((kittyId) => {
        const kitty = transferCandidatesById.get(kittyId)?.kitty;
        return kitty ? [{ ...kitty, owner: recipient.toLowerCase() }] : [];
      });
      appendOptimisticOwnerTransfer(optimisticScope, {
        txHash: transferHash,
        blockNumber: 0,
        from: ownerAddress,
        to: recipient.toLowerCase(),
        kittyIds,
        kitties: selectedKitties,
        reason: "WALLET_TRANSFER",
      });
      markPostTradeRefresh();
      enqueueTxSync(transferHash, { immediate: true });
      closeTransferModal();
      pushToast({
        kind: "success",
        title: "Transfer Submitted",
        message: "Waiting for onchain confirmation.",
      });
      void statusQuery.refetch();
      void ownerSummaryQuery.refetch();
      void ownerKittiesLiveQuery.refetch();
      void galleryQuery.refetch();
      void queryClient.invalidateQueries({
        queryKey: ["wallet-owner-kitties"],
      });

      if (publicClient) {
        void (async () => {
          try {
            const receipt = await publicClient.waitForTransactionReceipt({
              hash: transferHash!,
            });
            appendOptimisticOwnerTransfer(optimisticScope, {
              txHash: transferHash!,
              blockNumber: Number(receipt.blockNumber),
              from: ownerAddress,
              to: recipient.toLowerCase(),
              kittyIds,
              kitties: selectedKitties,
              reason: "WALLET_TRANSFER",
            });
          } catch (error) {
            console.warn(
              "KPEG transfer receipt read failed; optimistic overlay retained.",
              error,
            );
          }
        })();
      }
    } catch (error) {
      if (!transferHash) {
        pushToast({
          kind: "error",
          title: "Transfer Failed",
          message: (error as Error).message,
        });
      }
    } finally {
      setTransferAction("idle");
    }
  }, [
    address,
    chainId,
    closeTransferModal,
    connector,
    galleryQuery,
    ownerAddress,
    ownerKittiesLiveQuery,
    ownerSummaryQuery,
    optimisticScope,
    publicClient,
    pushToast,
    queryClient,
    statusQuery,
    tokenAddress,
    transferButtonVisible,
    transferCandidatesById,
    transferRecipientInput,
    transferSelectedIds,
    writeWithCompatibility,
  ]);
  const currentInitialLoading =
    galleryScopePending ||
    (galleryQuery.isPending && visibleDisplayItems.length === 0);
  const sortRefetching =
    !galleryScopePending &&
    galleryQuery.isPlaceholderData &&
    galleryQuery.isFetching;
  const galleryPaneKey = [mode, ownerAddress ?? "", searchValue, sort].join("|");
  const reorderToken = useStableSortReorderToken({
    scopeKey: galleryPaneKey,
    sortKey: sort,
    isPlaceholderData: galleryQuery.isPlaceholderData,
  });
  const metallicResyncToken = useMemo(
    () =>
      buildMetallicResyncToken({
        scope: galleryPaneKey,
        ids: visibleDisplayItems.map((kitty) => kitty.id),
        extra: `${sort}|${searchValue.trim()}|${galleryScopePending ? "pending" : "ready"}`,
      }),
    [
      galleryPaneKey,
      galleryScopePending,
      searchValue,
      sort,
      visibleDisplayItems,
    ],
  );
  useMetallicResyncOnChange(metallicResyncToken);
  const ownerNeedsWalletConnection = ownerScopeNeedsWalletConnection({
    isCollections,
    ownerAddress,
  });
  const renderedOwnerScopeEmptyMessage: ReactNode =
    ownerNeedsWalletConnection ? (
      <ConnectWalletTabPrompt />
    ) : (
      ownerEmptyStateMessage({
        reserveWallet,
        apiUnavailable: activeGalleryApiUnavailable,
        indexingMessage: indexingProgressMessage({
          scope: "owner",
          indexedTotal: total,
          liveOnchainCount: searchValue.trim() ? total : summary.currentKitties,
        }),
        currentKitties: summary.currentKitties,
      })
    );
  const galleryPane = (
    <InfiniteGalleryGrid
      initialLoading={currentInitialLoading}
      loadingLabel="Calling the kitties..."
      initialSkeletonCount={initialLimit}
      hasMore={Boolean(galleryQuery.hasNextPage) && !sortRefetching}
      fetchingMore={galleryQuery.isFetchingNextPage}
      animateReorder
      reorderToken={reorderToken}
      onLoadMore={() => {
        if (
          !sortRefetching &&
          !galleryQuery.isFetchingNextPage &&
          galleryQuery.hasNextPage
        ) {
          void galleryQuery.fetchNextPage();
        }
      }}
      empty={
        visibleDisplayItems.length === 0 ? (
          <div className="inline-flex min-h-48 items-center text-[var(--fg-muted)]">
            {isCollections || isPortfolio
              ? renderedOwnerScopeEmptyMessage
              : activeGalleryApiUnavailable
                ? INDEXER_API_UNAVAILABLE_MESSAGE
                : (indexingProgressMessage({
                  scope: "explore",
                  indexedTotal: total,
                  liveOnchainCount: searchValue.trim()
                    ? total
                    : stats.kittiesLive,
                }) ??
                (total === 0 &&
                stats.kittiesEverMinted === 0 &&
                !searchValue.trim()
                  ? "No kitties have been born on this deployment yet. A non-reserve wallet must buy whole kPEG first."
                  : total === 0 &&
                      stats.kittiesEverMinted > 0 &&
                      !searchValue.trim()
                    ? "No live kitty cards are indexed yet. Backfill is running; cards appear as indexing catches up."
                    : "No kitties found."))}
          </div>
        ) : null
      }
    >
      {visibleDisplayItems.map((kitty) => (
        <GalleryCard
          key={kitty.id}
          kitty={kitty}
          origin={mode}
          detailQueryScope={{ chainId, tokenAddress: tokenAddress ?? null }}
        />
      ))}
    </InfiniteGalleryGrid>
  );

  useEffect(() => {
    const latestIndexedBlock = resolveOptimisticSettlementIndexedBlock({
      statusLatestIndexedBlock: statusQuery.data?.latestIndexedBlock ?? null,
      statsLatestIndexedBlock: stats.latestIndexedBlock,
    });
    const resolvedOptimisticKittyIds = settledOptimisticKittyIdsByIndexedBlock(
      optimisticKitties,
      latestIndexedBlock,
    );
    if (resolvedOptimisticKittyIds.length > 0) {
      clearOptimisticKitties(optimisticScope, resolvedOptimisticKittyIds);
    }

    const resolvedRemovalTxHashes =
      settledOptimisticRemovalTxHashesByIndexedBlock(
        optimisticRemovals,
        latestIndexedBlock,
      );
    const countOnlyResolvedTxHashes =
      settledCountOnlyOptimisticRemovalTxHashesByFreshCounter(
        scopedOptimisticRemovals,
        hasFreshScopedLiveCounter,
      );
    const resolvedRemovalTxHashSet = new Set<`0x${string}`>([
      ...resolvedRemovalTxHashes,
      ...countOnlyResolvedTxHashes,
    ]);
    if (resolvedRemovalTxHashSet.size > 0) {
      clearOptimisticKittyRemovals(optimisticScope, [
        ...resolvedRemovalTxHashSet,
      ]);
    }

    const normalizedOwner = ownerAddress?.toLowerCase();
    const verifiedOwnerIds = ownerWalletKittiesQuery.data?.verified
      ? ownerWalletKittiesQuery.data.ownerIds
      : null;
    const ownerVisibleIds =
      !searchValue.trim() &&
      (mode === "collections" || mode === "portfolio")
        ? new Set(items.map((kitty) => kitty.id))
        : null;
    const ownerSourceSettledTransferTxHashes: `0x${string}`[] = [];
    const ownerTransferCandidates = optimisticOwnerTransfers.filter((transfer) => {
      if (
        !Number.isFinite(transfer.blockNumber) ||
        transfer.blockNumber <= 0 ||
        transfer.blockNumber > latestIndexedBlock
      ) {
        return false;
      }
      if (transfer.reason !== "LISTING_BOUGHT") {
        return true;
      }
      const pruneDecision = decideListingBoughtTransferPrune({
        transfer,
        ownerAddress: normalizedOwner,
        verifiedOwnerIds,
        ownerVisibleIds,
        latestIndexedBlock,
        hasFreshOwnerLiveCounter,
      });
      if (pruneDecision === "clear") {
        ownerSourceSettledTransferTxHashes.push(transfer.txHash);
        return false;
      }
      if (pruneDecision === "retain-conflict") {
        const key = `${transfer.txHash}:listing-bought:owner-mismatch`;
        if (!ownerTransferConflictLogKeys.current.has(key)) {
          ownerTransferConflictLogKeys.current.add(key);
          console.warn(
            "KPEG listing-bought overlay retained due to owner mismatch.",
            {
              txHash: transfer.txHash,
              expectedOwner: transfer.to,
              currentOwnerScope: normalizedOwner ?? "UNKNOWN",
            },
          );
        }
      }
      return false;
    });
    if (
      ownerTransferCandidates.length === 0 &&
      ownerSourceSettledTransferTxHashes.length === 0
    ) {
      return;
    }

    let cancelled = false;
    void (async () => {
      let settledTxHashes: `0x${string}`[] = [
        ...ownerSourceSettledTransferTxHashes,
      ];
      if (ownerTransferCandidates.length > 0) {
        const kittyDetailsById = new Map<number, KittyItem | null | undefined>(
          await Promise.all(
            [
              ...new Set(
                ownerTransferCandidates.flatMap((item) => item.kittyIds),
              ),
            ].map(async (kittyId) => {
              try {
                const kitty = await getKittyOrNull(kittyId);
                return [kittyId, kitty] as const;
              } catch (error) {
                console.warn(
                  "KPEG owner-transfer overlay kitty detail fetch failed during prune.",
                  { kittyId, error },
                );
                return [kittyId, undefined] as const;
              }
            }),
          ),
        );
        if (cancelled) {
          return;
        }
        const settledByKittyDetail =
          settleOptimisticOwnerTransfersByKittyOwners({
            transfers: ownerTransferCandidates,
            latestIndexedBlock,
            kittyDetailsById,
          });
        settledTxHashes = [
          ...new Set([
            ...settledTxHashes,
            ...settledByKittyDetail.settledTxHashes,
          ]),
        ];
        for (const conflict of settledByKittyDetail.conflicts) {
          const key = `${conflict.txHash}:${conflict.kittyId ?? "na"}:${conflict.expectedOwner}`;
          if (ownerTransferConflictLogKeys.current.has(key)) {
            continue;
          }
          ownerTransferConflictLogKeys.current.add(key);
          console.warn(
            "KPEG owner-transfer overlay retained due to stale indexed conflict.",
            {
              ...conflict,
              latestIndexedBlock,
            },
          );
        }
      }
      if (settledTxHashes.length > 0) {
        clearOptimisticOwnerTransfers(optimisticScope, settledTxHashes);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hasFreshScopedLiveCounter,
    optimisticKitties,
    optimisticOwnerTransfers,
    optimisticRemovals,
    optimisticScope,
    scopedOptimisticRemovals,
    hasFreshOwnerLiveCounter,
    items,
    mode,
    ownerAddress,
    ownerWalletKittiesQuery.data?.ownerIds,
    ownerWalletKittiesQuery.data?.verified,
    searchValue,
    stats.latestIndexedBlock,
    statusQuery.data?.latestIndexedBlock,
  ]);

  useEffect(() => {
    if (!isPostTradeRefreshActive(postTradeRefreshUntil)) {
      return;
    }
    const keepRefresh = shouldKeepPostTradeRefresh({
      pendingOptimisticBuyCount: visibleOptimisticKitties.length,
      scopedOptimisticSellCount: scopedOptimisticRemovals.length,
      scopedOptimisticTransferCount: ownerScopedOptimisticTransfers.length,
      hasFreshScopedLiveCounter,
    });
    if (!keepRefresh) {
      clearPostTradeRefresh();
    }
  }, [
    hasFreshScopedLiveCounter,
    ownerScopedOptimisticTransfers.length,
    postTradeRefreshUntil,
    scopedOptimisticRemovals.length,
    visibleOptimisticKitties.length,
  ]);

  return (
    <main className="relative z-10 mx-auto max-w-[var(--page-max)] pt-10 max-[640px]:pt-4">
      <section className="grid pb-4 max-[640px]:pb-0">
        <div>
          {isPortfolio ? (
            <button
              id="nav-surface-trigger-portfolio"
              className="m-0 inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 font-mono text-[0.75rem] font-extrabold tracking-[0.28em] text-[var(--accent-cool)] transition-colors hover:text-[var(--fg)] max-[640px]:text-[0.62rem] max-[640px]:tracking-[0.12em]"
              type="button"
              onClick={() => navigate(-1)}
            >
              <i
                className="nf nf-fa-chevron_left text-[0.72em]"
                aria-hidden="true"
              />
              <span>{ownerDisplay}&apos;s COLLECTION</span>
            </button>
          ) : (
            <>
              <p className="m-0 font-mono text-[0.75rem] font-extrabold tracking-[0.28em] text-[var(--accent-cool)] max-[640px]:hidden">
                {isCollections ? "COLLECTION" : "EXPLORE"}
              </p>
              <h1
                id={
                  isCollections
                    ? "nav-surface-trigger-kitty-nest"
                    : "nav-surface-trigger-gallery"
                }
                className="mt-[0.45rem] mb-0 text-[3.6rem] leading-[0.96] tracking-[-0.08em] max-[640px]:text-[1.5rem]"
              >
                {isCollections ? "Kitty Kin" : "Gallery"}
              </h1>
            </>
          )}
          {!isPortfolio ? (
            transferButtonVisible ? (
              <div className="flex justify-between items-end gap-4 text-[1rem] max-md:flex-col max-md:items-start max-md:mt-3">
                <p className="mt-3 max-w-[38rem] text-[0.88rem] leading-[1.5] text-[var(--fg-muted)] max-[640px]:hidden">
                  Your live onchain kitties stay here while this wallet holds
                  their backing whole kPEG.
                </p>
                <button
                  className="flex gap-2 cursor-pointer justify-center rounded-[6px] border border-[var(--line)] bg-[var(--fg)] px-[1rem] py-[0.4rem] text-[var(--bg)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 max-md:w-full max-[640px]:text-[0.8rem]"
                  type="button"
                  onClick={openTransferModal}
                >
                  <i className="nf nf-fa-send_o text-[1rem] max-[640px]:text-[0.8rem] self-center mb-0.5" />
                  TRANSFER
                </button>
              </div>
            ) : (
              <p className="mt-3 max-w-[38rem] text-[0.88rem] leading-[1.5] text-[var(--fg-muted)] max-[640px]:hidden">
                {isCollections
                  ? reserveWallet
                    ? "This is the reserve wallet. It can hold kPEG, but whole buys here do not mint kitties."
                    : "Your live onchain kitties stay here while this wallet holds their backing whole kPEG."
                  : "Meet the live onchain kitties born from whole kPEG buys. Every one has a wallet, a mood, and a little pixel soul."}
              </p>
            )
          ) : null}
          <div
            className="mt-4 grid grid-cols-4 gap-4 max-[480px]:grid-cols-2"
            aria-label={
              isCollections || isPortfolio ? "owned kitty stats" : "token stats"
            }
          >
            {metrics.map((metric) => (
              <div className="grid gap-1" key={metric.label}>
                <span className="font-mono text-[0.65rem] tracking-[0.08em] text-[var(--fg-muted)] max-[640px]:text-[0.55rem] uppercase">
                  {metric.label}
                </span>
                <strong className="font-mono text-[1.75rem] leading-none font-semibold max-[640px]:text-[1rem]">
                  {metric.loading ? (
                    <Spinner />
                  ) : (
                    <RollingNumber value={metric.value} />
                  )}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="pt-2 max-[640px]:pt-5">
        <SearchField
          value={searchInput}
          placeholder={
            isCollections
              ? "Search your kitties by #id or traits"
              : isPortfolio
                ? "Search their kitties by #id or traits"
                : "Search wallet, #id, or traits"
          }
          onChange={setSearchInput}
          sort={sort}
          sortDisabled={sortDisabled}
          onSortChange={setSort}
        />
      </section>

      <SlidingPaneSwap
        contentKey={galleryPaneKey}
        content={galleryPane}
        offsetPx={28}
      />
      {transferOpen ? (
        <TransferModal
          kitties={transferCandidates}
          loading={transferKittiesLoading}
          loadError={transferKittiesLoadError}
          selectedIds={transferSelectedIds}
          recipientInput={transferRecipientInput}
          transferAction={transferAction}
          open={transferVisible && !transferClosing}
          maxBundleSize={MAX_TRANSFER_BUNDLE_SIZE}
          senderAddress={ownerAddress}
          onClose={closeTransferModal}
          onToggle={onToggleTransferSelection}
          onRecipientChange={setTransferRecipientInput}
          onPasteRecipient={() => void pasteTransferRecipient()}
          onSubmit={() => void submitTransfer()}
        />
      ) : null}
    </main>
  );
}
