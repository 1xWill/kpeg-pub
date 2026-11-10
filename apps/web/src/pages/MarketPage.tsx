import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  useInfiniteQuery,
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { KPEG_MARKET_ABI, KPEG_TOKEN_ABI } from "@kpeg/core";
import {
  decodeEventLog,
  formatEther,
  parseEther,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import { readContract as readContractAction } from "viem/actions";
import {
  useAccount,
  useBalance,
  useConnect,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import { getConnectorClient } from "wagmi/actions";
import { useLocation, useNavigate } from "react-router-dom";
import { CardMetaPanel } from "../components/CardMetaPanel.js";
import { ConnectWalletTabPrompt } from "../components/ConnectWalletInlineText.js";
import { KPEGArt } from "../components/KPEGArt.js";
import {
  KittySelectionModal,
  type KittySelectionCandidate,
} from "../components/KittySelectionModal.js";
import { InfiniteGalleryGrid } from "../components/InfiniteGalleryGrid.js";
import { RollingNumber } from "../components/RollingNumber.js";
import { SearchField } from "../components/SearchField.js";
import { SlidingPaneSwap } from "../components/SlidingPaneSwap.js";
import { Spinner } from "../components/Spinner.js";
import { useToast } from "../context/toast.js";
import {
  getConfig,
  getKitty,
  getMarketListing,
  getMarketListingOrNull,
  getMarketStats,
  getStatus,
  isApiUnavailableError,
  listMarketListings,
  listOwner,
  type KittyItem,
  type MarketListing,
  type MarketTab,
  type SortMode,
} from "../lib/api.js";
import {
  formatFixedDecimals,
  formatPct,
  formatPctCompact,
  formatRarityScore,
  shortAddress,
} from "../lib/format.js";
import { getMetallicTierVariant, getTierColor } from "../lib/tierColor.js";
import {
  getInfiniteBatchSizes,
  useResponsiveGalleryColumns,
} from "../hooks/useResponsiveGalleryColumns.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { useBodyDataFlag } from "../hooks/useBodyDataFlag.js";
import { useMetallicResyncOnChange } from "../hooks/useMetallicResyncOnChange.js";
import { usePageFreshnessRefetch } from "../hooks/usePageFreshnessRefetch.js";
import { useQueryScopePending } from "../hooks/useQueryScopePending.js";
import { useKittyDetailPrefetch } from "../hooks/useKittyDetailPrefetch.js";
import {
  displayListingId,
  canBuyMarketListing,
  canManageMarketListing,
  mergeMarketListingViews,
  pruneMarketListingOverrides,
  reconcileTemporaryListingsByCreatedTxHash,
  withoutMarketListingPhase,
  type MarketListingPhase,
  type MarketListingView,
} from "../lib/marketListingState.js";
import {
  OPTIMISTIC_MARKET_LISTINGS_EVENT,
  clearOptimisticMarketListings,
  filterSettleableOptimisticMarketListingTradeIds,
  nextOptimisticMarketListingsExpiryAt,
  readOptimisticMarketListings,
  settleOptimisticMarketListingsByDetails,
  upsertOptimisticMarketListing,
} from "../lib/optimisticMarketListings.js";
import {
  OPTIMISTIC_OWNER_TRANSFERS_EVENT,
  appendOptimisticOwnerTransfer,
  clearOptimisticOwnerTransfers,
} from "../lib/optimisticOwnerTransfers.js";
import {
  getPostTradeRefreshUntil,
  isPostTradeRefreshActive,
  NORMAL_GALLERY_REFETCH_MS,
  markPostTradeRefresh,
  POST_TRADE_REFRESH_EVENT,
} from "../lib/postTradeRefresh.js";
import {
  resolveRuntimeAddress,
  resolveRuntimeChainId,
} from "../lib/runtimeConfig.js";
import { syncBackfillActive } from "../lib/syncStatus.js";
import { useStableSortReorderToken } from "../lib/reorderAnimation.js";
import { buildMetallicResyncToken } from "../lib/metallicResyncToken.js";
import {
  ensureWagmiConnectorCompatibility,
  getWagmiConfig,
  openWalletModal,
  reownEnabled,
} from "../lib/wagmi.js";
import {
  readOwnerSeedKittiesFromCache,
  readWalletOwnerKittiesSnapshotFromCache,
  upsertWalletOwnerKittiesOwnedIds,
  useWalletOwnerKitties,
} from "../lib/walletOwnerKitties.js";
import { enqueueTxSync } from "../lib/syncQueue.js";
import {
  findListingFromApiByCreatedTxHash,
  findOwnerOpenListingMatchByChain,
  findOwnerOpenListingMatchByChainViaConnectedWallet as findOwnerOpenListingMatchByChainViaConnectedWalletWithDelegate,
  MARKET_BUY_LISTING_CHANGED_ERROR,
  MARKET_BUY_LISTING_VERIFY_FAILED_ERROR,
  readMarketPositionViewViaConnectedWallet as readMarketPositionViewViaConnectedWalletWithDelegate,
  readMarketPositionViewViaPublicClient,
  resolveBuyReadBack,
  resolveCancelReadBack,
  resolveListingReadBack,
  resolveUpdateReadBack,
  verifyMarketBuyListing,
  waitForMarketTxOutcome,
  type MarketReadBackContext,
  type ReadContractDelegate as MarketReadBackContractDelegate,
} from "../lib/marketReadBack.js";

const MARKET_TABS: Array<{ id: MarketTab; label: string }> = [
  { id: "all", label: "ALL" },
  { id: "my-listings", label: "MY LISTINGS" },
  { id: "bought", label: "BOUGHT" },
  { id: "sold", label: "SOLD" },
];
const LIST_MODAL_TRANSITION_MS = 200;
const ETH_USD_QUERY_STALE_MS = 60 * 60 * 1000;
const ETH_USD_SPOT_URL = "https://api.coinbase.com/v2/prices/ETH-USD/spot";
const MAX_MARKET_BUNDLE_SIZE = 100;
const BACKFILL_REFETCH_MS = 15_000;
const MARKET_CARD_MAX_DECIMALS = 4;
const MARKET_CARD_COMPACT_ZERO_THRESHOLD = 3;
const LISTING_PRICE_REQUIRED_ERROR = "Enter a listing price in ETH.";
const LISTING_PRICE_ZERO_ERROR = "Price must be greater than 0 ETH.";
const LISTING_PRICE_INVALID_ERROR = "Enter a valid ETH price.";
const LISTING_SELECTION_NOT_OWNED_ERROR =
  "Selected kPEG is no longer in this wallet";
const LISTING_SELECTION_RESERVED_ERROR =
  "Selected kPEG is already reserved in the market";
const LISTING_SELECTION_VERIFY_FAILED_ERROR =
  "Could not verify selected kPEGs from chain. Try again.";
const MARKET_API_UNAVAILABLE_MESSAGE =
  "Indexer API is unavailable. Market listings cannot load right now.";
const BACKGROUND_STYLES: Record<
  string,
  { bg: string; fg: string; muted: string }
> = {
  White: { bg: "#F5F4EE", fg: "#171410", muted: "#4d473d" },
  Sky: { bg: "#BFDFFF", fg: "#111820", muted: "#405466" },
  Mint: { bg: "#CDEDD4", fg: "#101a12", muted: "#435847" },
  Coral: { bg: "#FFC8B5", fg: "#21100b", muted: "#6b4033" },
  Lilac: { bg: "#E2D5FF", fg: "#191323", muted: "#51456d" },
  Midnight: { bg: "#232A3A", fg: "#f4f0e8", muted: "#c8c0b4" },
};
const TRAIT_LABELS: Record<keyof KittyItem["traits"], string> = {
  background: "Background",
  breed: "Breed",
  clothes: "Clothes",
  mood: "Mood",
  marks: "Marks",
  mouth: "Mouth",
  eyes: "Eyes",
  accessory: "Accessory",
};
type ListingDetailTab = "list" | "traits" | "born";
type ListModalAction = "idle" | "approving" | "listing";
type ListingAction = "canceling" | "buying" | "updating";
type ListingKittyCandidate = KittySelectionCandidate;
type MarketPaneSnapshot = {
  tab: MarketTab;
  reorderToken: string;
  listings: MarketListingView[];
  marketQueryEnabled: boolean;
  hasMore: boolean;
  fetchingMore: boolean;
};

export type MarketTxRefreshAction =
  | "list"
  | "cancel-listing"
  | "buy-listing"
  | "update-price";
export { waitForMarketTxOutcome };

export function marketTxHasOwnershipImpact(
  action: MarketTxRefreshAction,
): boolean {
  return action !== "update-price";
}

export async function syncMarketQueriesForAction(input: {
  txHash: `0x${string}`;
  action: MarketTxRefreshAction;
  enqueueSync: (
    txHash: `0x${string}`,
    options: { immediate?: boolean },
  ) => void;
  markPostTradeRefreshFn: () => void;
}): Promise<void> {
  input.enqueueSync(input.txHash, { immediate: true });
  if (marketTxHasOwnershipImpact(input.action)) {
    input.markPostTradeRefreshFn();
  }
}

export function validateListingPriceInput(input: string): {
  priceWei: bigint | null;
  error: string | null;
} {
  const value = input.trim();
  if (!value) {
    return { priceWei: null, error: LISTING_PRICE_REQUIRED_ERROR };
  }
  try {
    const priceWei = parseEther(value);
    if (priceWei <= 0n) {
      return { priceWei: null, error: LISTING_PRICE_ZERO_ERROR };
    }
    return { priceWei, error: null };
  } catch {
    return { priceWei: null, error: LISTING_PRICE_INVALID_ERROR };
  }
}

export function marketEmptyStateMessage(input: {
  activeTab: MarketTab;
  apiUnavailable: boolean;
  backfillActive: boolean;
  searchValue: string;
  knownListed: number;
}): string {
  if (input.apiUnavailable) {
    return MARKET_API_UNAVAILABLE_MESSAGE;
  }
  if (input.searchValue.trim()) {
    return "No listings match this search.";
  }
  if (
    input.activeTab === "all" &&
    input.backfillActive &&
    input.knownListed > 0
  ) {
    return "Market index is catching up. Listings appear as indexing reaches the latest blocks.";
  }
  if (input.activeTab === "my-listings") {
    return "You don't have any listings.";
  }
  if (input.activeTab === "bought") {
    return "You haven't bought any kPEG yet.";
  }
  if (input.activeTab === "sold") {
    return "You haven't sold any kPEG yet.";
  }
  return "No market listings here yet.";
}

export function marketScopeNeedsWalletConnection(input: {
  marketQueryEnabled: boolean;
}) {
  return !input.marketQueryEnabled;
}

export function marketApiUnavailable(input: {
  statusError: unknown;
  statsError: unknown;
  listingsError: unknown;
}): boolean {
  return (
    isApiUnavailableError(input.statusError) ||
    isApiUnavailableError(input.statsError) ||
    isApiUnavailableError(input.listingsError)
  );
}

export function marketListingsOwnerScope(
  activeTab: MarketTab,
  address: string | undefined,
): string {
  return activeTab === "all" ? "" : (address ?? "");
}

function ethLabel(wei: string, fallback = "0 ETH"): string {
  try {
    return `${formatFixedDecimals(Number(formatEther(BigInt(wei))), "ETH", 4)}`;
  } catch {
    return fallback;
  }
}

type MarketCardEthLabel =
  | { mode: "standard"; value: string }
  | { mode: "compact"; zeroCount: number; significantText: string };

export function marketCardEthLabel(wei: string): MarketCardEthLabel {
  try {
    const ethText = formatEther(BigInt(wei));
    const [whole, decimalsRaw = ""] = ethText.split(".");
    const decimals = decimalsRaw.replace(/0+$/, "");
    const leadingZeroCount = decimals.match(/^0+/)?.[0].length ?? 0;

    if (
      whole === "0" &&
      leadingZeroCount > MARKET_CARD_COMPACT_ZERO_THRESHOLD &&
      decimals.length > leadingZeroCount
    ) {
      const significantText = decimals.slice(
        leadingZeroCount,
        leadingZeroCount + 2,
      );
      return {
        mode: "compact",
        zeroCount: leadingZeroCount,
        significantText: significantText.replace(/0+$/, "") || "0",
      };
    }

    const ethAmount = Number(ethText);
    if (!Number.isFinite(ethAmount) || ethAmount <= 0) {
      return { mode: "standard", value: "0" };
    }
    return {
      mode: "standard",
      value: ethAmount.toLocaleString(undefined, {
        maximumFractionDigits: MARKET_CARD_MAX_DECIMALS,
        minimumFractionDigits: 0,
      }),
    };
  } catch {
    return { mode: "standard", value: "0" };
  }
}

function exactEthAmountLabel(wei: string, fallback = "0"): string {
  try {
    return formatEther(BigInt(wei));
  } catch {
    return fallback;
  }
}

export function listingBuyInsufficientEth(input: {
  walletConnected: boolean;
  ethBalance: bigint | null;
  priceWei: string;
}): boolean {
  if (!input.walletConnected) return false;
  if (input.ethBalance === null) return false;
  return input.ethBalance < BigInt(input.priceWei);
}

async function getEthUsdSpot(): Promise<number | null> {
  const response = await fetch(ETH_USD_SPOT_URL);
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    data?: { amount?: string };
  };
  const price = Number(payload.data?.amount);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function usdLabelFromEth(ethAmount: number, ethUsd: number | null | undefined) {
  if (!ethUsd || !Number.isFinite(ethAmount)) return null;
  return `≈ $${(ethAmount * ethUsd).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function minWei(a: string, b: string): string {
  return BigInt(a) <= BigInt(b) ? a : b;
}

function addWei(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

function marketStatsFromListings(listings: MarketListing[]): {
  listed: number;
  floorWei: string;
  volumeWei: string;
} | null {
  if (listings.length === 0) return null;
  return listings.reduce(
    (stats, listing) => {
      const priceWei = listing.priceWei;
      return {
        listed: stats.listed + 1,
        floorWei:
          stats.floorWei === "0" ? priceWei : minWei(stats.floorWei, priceWei),
        volumeWei:
          listing.status === "SOLD"
            ? addWei(stats.volumeWei, priceWei)
            : stats.volumeWei,
      };
    },
    { listed: 0, floorWei: "0", volumeWei: "0" },
  );
}

export function marketStatsFromVisibleListings(input: {
  activeTab: MarketTab;
  pageReady: boolean;
  pageTotal: number | null;
  listings: MarketListing[];
  serverListingCount: number;
  globalStats:
    | { listed: number; floorWei: string; volumeWei: string }
    | undefined;
}): { listed: number; floorWei: string; volumeWei: string } {
  const listingStats = marketStatsFromListings(input.listings);
  const localDelta = input.listings.length - input.serverListingCount;
  const pageListed = input.pageReady
    ? Math.max(0, (input.pageTotal ?? input.serverListingCount) + localDelta)
    : input.listings.length;
  if (input.activeTab !== "all") {
    return {
      listed: pageListed,
      floorWei: listingStats?.floorWei ?? "0",
      volumeWei: listingStats?.volumeWei ?? "0",
    };
  }
  if (localDelta !== 0) {
    const listedBase =
      input.globalStats?.listed ?? input.pageTotal ?? input.serverListingCount;
    return {
      listed: Math.max(0, listedBase + localDelta),
      floorWei: listingStats?.floorWei ?? "0",
      volumeWei: input.globalStats?.volumeWei ?? "0",
    };
  }
  const listed = Math.max(
    input.globalStats?.listed ?? 0,
    pageListed,
    listingStats?.listed ?? 0,
  );
  const floorWei =
    input.globalStats?.floorWei && input.globalStats.floorWei !== "0"
      ? listingStats?.floorWei && listingStats.floorWei !== "0"
        ? minWei(input.globalStats.floorWei, listingStats.floorWei)
        : input.globalStats.floorWei
      : (listingStats?.floorWei ?? "0");
  return { listed, floorWei, volumeWei: input.globalStats?.volumeWei ?? "0" };
}

export function marketStatsAreFreshForPage(input: {
  hasStats: boolean;
  dataUpdatedAt: number;
  pageEnteredAt: number;
}): boolean {
  return (
    input.hasStats &&
    Number.isFinite(input.dataUpdatedAt) &&
    input.dataUpdatedAt >= input.pageEnteredAt
  );
}

export function resolveVisibleMarketListings(input: {
  marketScopePending: boolean;
  scopeKey: string;
  lastStableScopeKey: string;
  listings: MarketListingView[];
  isFetching: boolean;
  lastStableListings: MarketListingView[];
}): MarketListingView[] {
  if (input.marketScopePending) {
    return [];
  }
  if (
    input.scopeKey === input.lastStableScopeKey &&
    input.listings.length === 0 &&
    input.isFetching &&
    input.lastStableListings.length > 0
  ) {
    return input.lastStableListings;
  }
  return input.listings;
}

export function shouldDisableMarketSortDuringSearch(searchValue: string): boolean {
  return searchValue.trim().length > 0;
}

export function buildSelectableListingCandidates(
  kitties: KittyItem[],
  ownerIds: Set<number>,
  reservedIds: Set<number>,
): ListingKittyCandidate[] {
  const kittiesById = new Map(kitties.map((kitty) => [kitty.id, kitty]));
  return [...ownerIds]
    .filter((id) => !reservedIds.has(id))
    .sort((a, b) => a - b)
    .map((id) => ({ id, kitty: kittiesById.get(id) ?? null }));
}

type InfiniteGalleryData = {
  pages?: Array<{ items?: KittyItem[] }>;
};

type InfiniteMarketData = {
  pages?: Array<{ items?: MarketListing[] }>;
};

export type MarketWalletState = {
  tokenAddress: Address;
  ownerIds: Set<number>;
  reservedIds: Set<number>;
};

type OwnedKittiesQueryData = MarketWalletState & {
  items: ListingKittyCandidate[];
};

type ReadContractDelegate = (request: {
  address: Address;
  abi: typeof KPEG_MARKET_ABI | typeof KPEG_TOKEN_ABI;
  functionName: string;
  args?: readonly unknown[];
}) => Promise<unknown>;

function flattenGalleryItems(data: unknown): KittyItem[] {
  const pages = (data as InfiniteGalleryData | undefined)?.pages;
  if (!Array.isArray(pages)) {
    return [];
  }
  return pages.flatMap((page) => page.items ?? []);
}

function flattenMarketItems(data: unknown): MarketListing[] {
  const pages = (data as InfiniteMarketData | undefined)?.pages;
  if (!Array.isArray(pages)) {
    return [];
  }
  return pages.flatMap((page) => page.items ?? []);
}

function mergeUniqueKitties(kitties: KittyItem[]): KittyItem[] {
  const byId = new Map<number, KittyItem>();
  for (const kitty of kitties) {
    byId.set(kitty.id, kitty);
  }
  return [...byId.values()];
}

function readCachedOwnerKitties(
  queryClient: QueryClient,
  owner: string,
): KittyItem[] {
  const seedKitties = readOwnerSeedKittiesFromCache(queryClient, owner);
  return mergeUniqueKitties(seedKitties);
}

function readCachedReservedKittyIds(
  queryClient: QueryClient,
  marketAddress: string,
  owner: string,
) {
  const normalizedOwner = owner.toLowerCase();
  const normalizedMarket = marketAddress.toLowerCase();
  const reservedIds = new Set<number>();
  for (const [queryKey, data] of queryClient.getQueriesData({
    queryKey: ["market-listings"],
  })) {
    if (
      !Array.isArray(queryKey) ||
      queryKey[0] !== "market-listings" ||
      typeof queryKey[1] !== "string" ||
      queryKey[1].toLowerCase() !== normalizedMarket
    ) {
      continue;
    }
    for (const listing of flattenMarketItems(data)) {
      if (
        listing.seller.toLowerCase() !== normalizedOwner ||
        listing.status === "SOLD" ||
        listing.status === "DELETED"
      ) {
        continue;
      }
      for (const kittyId of listing.kittyIds) {
        reservedIds.add(kittyId);
      }
    }
  }
  return reservedIds;
}

function readCachedMarketListingTradeIds(
  queryClient: QueryClient,
  marketAddress: string,
): Set<number> {
  const normalizedMarket = marketAddress.toLowerCase();
  const tradeIds = new Set<number>();
  for (const [queryKey, data] of queryClient.getQueriesData({
    queryKey: ["market-listings"],
  })) {
    if (
      !Array.isArray(queryKey) ||
      queryKey[0] !== "market-listings" ||
      typeof queryKey[1] !== "string" ||
      queryKey[1].toLowerCase() !== normalizedMarket
    ) {
      continue;
    }
    for (const listing of flattenMarketItems(data)) {
      tradeIds.add(listing.tradeId);
    }
  }
  return tradeIds;
}

function hasAllOwnerKitties(
  kittyById: Map<number, KittyItem>,
  ownerIds: Set<number>,
) {
  for (const ownerId of ownerIds) {
    if (!kittyById.has(ownerId)) {
      return false;
    }
  }
  return true;
}

async function loadCompleteOwnerKitties(
  owner: string,
  ownerIds: Set<number>,
  seedKitties: KittyItem[],
) {
  const kittyById = new Map(seedKitties.map((kitty) => [kitty.id, kitty]));
  if (hasAllOwnerKitties(kittyById, ownerIds)) {
    return [...kittyById.values()];
  }

  const pageSize = 100;
  let offset = 0;
  while (true) {
    const page = await listOwner(
      owner,
      Math.floor(offset / pageSize),
      pageSize,
      "latest",
      offset,
    );
    for (const kitty of page.items) {
      kittyById.set(kitty.id, kitty);
    }
    offset += page.items.length;
    if (
      page.items.length === 0 ||
      offset >= page.total ||
      hasAllOwnerKitties(kittyById, ownerIds)
    ) {
      break;
    }
  }

  if (!hasAllOwnerKitties(kittyById, ownerIds)) {
    await Promise.all(
      [...ownerIds]
        .filter((kittyId) => !kittyById.has(kittyId))
        .map(async (kittyId) => {
          try {
            kittyById.set(kittyId, await getKitty(kittyId));
          } catch {
            // Leave a placeholder card when the index has not repaired this kitty yet.
          }
        }),
    );
  }
  return [...kittyById.values()];
}

async function loadOwnerKittiesFromApi(
  owner: string,
  seedKitties: KittyItem[],
) {
  const kittyById = new Map(seedKitties.map((kitty) => [kitty.id, kitty]));
  const pageSize = 100;
  let offset = 0;

  while (true) {
    const page = await listOwner(
      owner,
      Math.floor(offset / pageSize),
      pageSize,
      "latest",
      offset,
    );
    for (const kitty of page.items) {
      kittyById.set(kitty.id, kitty);
    }
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) {
      break;
    }
  }

  return [...kittyById.values()];
}

async function loadReservedKittyIdsFromApi(owner: string) {
  const reservedIds = new Set<number>();
  const pageSize = 100;
  let offset = 0;

  while (true) {
    const page = await listMarketListings(
      Math.floor(offset / pageSize),
      pageSize,
      "my-listings",
      "latest",
      owner,
      offset,
    );
    for (const listing of page.items) {
      if (listing.status === "SOLD" || listing.status === "DELETED") {
        continue;
      }
      for (const kittyId of listing.kittyIds) {
        reservedIds.add(kittyId);
      }
    }
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) {
      break;
    }
  }

  return reservedIds;
}

async function readMarketWalletStateWithDelegate(input: {
  readContract: ReadContractDelegate;
  owner: Address;
  tokenAddress: Address;
  marketAddress: Address;
}): Promise<MarketWalletState> {
  const marketTokenAddress = (await input.readContract({
    address: input.marketAddress,
    abi: KPEG_MARKET_ABI,
    functionName: "token",
  })) as Address;
  const [ownerKittyIds, tradeIds] = await Promise.all([
    input.readContract({
      address: marketTokenAddress,
      abi: KPEG_TOKEN_ABI,
      functionName: "getOwnerKitties",
      args: [input.owner],
    }) as Promise<readonly bigint[]>,
    input.readContract({
      address: input.marketAddress,
      abi: KPEG_MARKET_ABI,
      functionName: "getOpenPositionsByOwner",
      args: [input.owner, 0n, 100n],
    }) as Promise<readonly bigint[]>,
  ]);
  const positions = await Promise.all(
    tradeIds.map(
      (tradeId) =>
        input.readContract({
          address: input.marketAddress,
          abi: KPEG_MARKET_ABI,
          functionName: "getPositionView",
          args: [tradeId],
        }) as Promise<{ kittyIds: readonly bigint[] }>,
    ),
  );
  const reservedIds = new Set<number>();
  for (const position of positions) {
    for (const kittyId of position.kittyIds) {
      reservedIds.add(Number(kittyId));
    }
  }
  return {
    tokenAddress: marketTokenAddress,
    ownerIds: new Set(ownerKittyIds.map((kittyId) => Number(kittyId))),
    reservedIds,
  };
}

async function readMarketWalletState(input: {
  publicClient: PublicClient;
  owner: Address;
  tokenAddress: Address;
  marketAddress: Address;
}): Promise<MarketWalletState> {
  return readMarketWalletStateWithDelegate({
    ...input,
    readContract: (request) =>
      input.publicClient.readContract(request as never) as Promise<unknown>,
  });
}

async function readMarketWalletStateViaConnectedWallet(input: {
  owner: Address;
  tokenAddress: Address;
  marketAddress: Address;
  chainId: number;
  connector?: unknown;
}): Promise<MarketWalletState> {
  const connectorClient = await getConnectorClient(getWagmiConfig(), {
    chainId: input.chainId,
    connector: input.connector as never,
    account: input.owner,
  });
  return readMarketWalletStateWithDelegate({
    ...input,
    readContract: (request) =>
      readContractAction(connectorClient as never, request as never),
  });
}

async function readMarketSelectedKittyApproval(input: {
  publicClient: PublicClient;
  owner: Address;
  tokenAddress: Address;
  marketAddress: Address;
  kittyIds: number[];
}): Promise<boolean> {
  if (input.kittyIds.length === 0) {
    return false;
  }
  return (await input.publicClient.readContract({
    address: input.tokenAddress,
    abi: KPEG_TOKEN_ABI,
    functionName: "kittiesTransferApprovedFor",
    args: [
      input.owner,
      input.marketAddress,
      input.kittyIds.map((kittyId) => BigInt(kittyId)),
    ],
  } as never)) as boolean;
}

async function readMarketSelectedKittyApprovalViaConnectedWallet(input: {
  owner: Address;
  tokenAddress: Address;
  marketAddress: Address;
  kittyIds: number[];
  chainId: number;
  connector?: unknown;
}): Promise<boolean> {
  if (input.kittyIds.length === 0) {
    return false;
  }
  const connectorClient = await getConnectorClient(getWagmiConfig(), {
    chainId: input.chainId,
    connector: input.connector as never,
    account: input.owner,
  });
  return (await readContractAction(connectorClient as never, {
    address: input.tokenAddress,
    abi: KPEG_TOKEN_ABI,
    functionName: "kittiesTransferApprovedFor",
    args: [
      input.owner,
      input.marketAddress,
      input.kittyIds.map((kittyId) => BigInt(kittyId)),
    ],
  } as never)) as boolean;
}

export async function readSelectedApprovalForIdsWithFallback(input: {
  kittyIds: number[];
  readViaPublicClient?: (() => Promise<boolean>) | undefined;
  readViaConnectedWallet?: (() => Promise<boolean>) | undefined;
  onPublicClientFailure?: (error: unknown) => void;
  onConnectedWalletFailure?: (error: unknown) => void;
}): Promise<boolean> {
  if (input.kittyIds.length === 0) {
    return false;
  }

  if (input.readViaPublicClient) {
    try {
      const approved = await input.readViaPublicClient();
      if (approved) {
        return true;
      }
    } catch (error) {
      input.onPublicClientFailure?.(error);
    }
  }

  if (input.readViaConnectedWallet) {
    try {
      return await input.readViaConnectedWallet();
    } catch (error) {
      input.onConnectedWalletFailure?.(error);
    }
  }

  return false;
}

export function deriveSelectedKittyApprovalState(input: {
  sortedSelectedIds: number[];
  debouncedSortedSelectedIds: number[];
  queryApproved: boolean | undefined;
  queryLoading: boolean;
  queryFetching: boolean;
}): { selectedApproved: boolean; approvalChecking: boolean } {
  const selectedIdsKey = input.sortedSelectedIds.join(",");
  const approvalQueryIdsKey = input.debouncedSortedSelectedIds.join(",");
  const selectedApproved =
    input.sortedSelectedIds.length > 0 &&
    selectedIdsKey === approvalQueryIdsKey &&
    (input.queryApproved ?? false);
  const approvalChecking =
    input.sortedSelectedIds.length > 0 &&
    (selectedIdsKey !== approvalQueryIdsKey ||
      input.queryLoading ||
      input.queryFetching);
  return { selectedApproved, approvalChecking };
}

export async function runListingApprovalStep(input: {
  kittyIds: number[];
  readSelectedApprovalForIds: (kittyIds: number[]) => Promise<boolean>;
  approveSelectedKitties: (
    kittyIds: number[],
  ) => Promise<"approved" | "pending">;
  onApprovalRequired?: () => void;
}): Promise<"already-approved" | "approved" | "pending"> {
  const currentApproved = await input.readSelectedApprovalForIds(input.kittyIds);
  if (currentApproved) {
    return "already-approved";
  }
  input.onApprovalRequired?.();
  const approvalOutcome = await input.approveSelectedKitties(input.kittyIds);
  return approvalOutcome === "pending" ? "pending" : "approved";
}

async function getMarketReadBackDelegateViaConnectedWallet(input: {
  chainId: number;
  owner: Address;
  connector?: unknown;
}): Promise<MarketReadBackContractDelegate> {
  const connectorClient = await getConnectorClient(getWagmiConfig(), {
    chainId: input.chainId,
    connector: input.connector as never,
    account: input.owner,
  });
  return (request) =>
    readContractAction(connectorClient as never, request as never);
}

function isTerminalSelectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message === LISTING_SELECTION_NOT_OWNED_ERROR ||
    error.message === LISTING_SELECTION_RESERVED_ERROR
  );
}

export function selectedListingStateError(
  selectedIds: number[],
  walletState: Pick<MarketWalletState, "ownerIds" | "reservedIds">,
): string | null {
  if (!selectedIds.every((kittyId) => walletState.ownerIds.has(kittyId))) {
    return LISTING_SELECTION_NOT_OWNED_ERROR;
  }
  if (!selectedIds.every((kittyId) => !walletState.reservedIds.has(kittyId))) {
    return LISTING_SELECTION_RESERVED_ERROR;
  }
  return null;
}

export async function verifyMarketListingSelection(input: {
  selectedIds: number[];
  verifyWithPublicClient: () => Promise<MarketWalletState>;
  verifyWithConnectedWallet?: (() => Promise<MarketWalletState>) | undefined;
  onPublicClientFailure?: (error: unknown) => void;
  onConnectedWalletFailure?: (error: unknown) => void;
}): Promise<MarketWalletState> {
  try {
    const state = await input.verifyWithPublicClient();
    const stateError = selectedListingStateError(input.selectedIds, state);
    if (stateError) {
      throw new Error(stateError);
    }
    return state;
  } catch (error) {
    if (isTerminalSelectionError(error)) {
      throw error;
    }
    input.onPublicClientFailure?.(error);
  }

  if (!input.verifyWithConnectedWallet) {
    throw new Error(LISTING_SELECTION_VERIFY_FAILED_ERROR);
  }

  try {
    const state = await input.verifyWithConnectedWallet();
    const stateError = selectedListingStateError(input.selectedIds, state);
    if (stateError) {
      throw new Error(stateError);
    }
    return state;
  } catch (error) {
    if (isTerminalSelectionError(error)) {
      throw error;
    }
    input.onConnectedWalletFailure?.(error);
    throw new Error(LISTING_SELECTION_VERIFY_FAILED_ERROR);
  }
}

type ListingWriteRequest = {
  address: Address;
  abi: unknown;
  functionName: string;
  args: readonly unknown[];
  chainId: number;
};

type BuyWriteRequest = ListingWriteRequest & {
  value?: bigint;
};

type ListingReceiptLog = {
  data: `0x${string}`;
  topics: readonly `0x${string}`[];
};

export type MarketListingFlowReceipt = {
  blockNumber: bigint;
  logs: readonly ListingReceiptLog[];
};

export type MarketListingSubmitFlowResult =
  {
    walletState: MarketWalletState;
    listingHash: `0x${string}`;
    listingReceipt: MarketListingFlowReceipt;
    tradeId: number;
    escrowAddress: Address;
  };

function decodePositionCreatedFromReceipt(receipt: MarketListingFlowReceipt): {
  tradeId: number;
  escrowAddress: Address;
} {
  const created = receipt.logs
    .map((log) => {
      try {
        return decodeEventLog({
          abi: KPEG_MARKET_ABI,
          data: log.data,
          topics: log.topics as unknown as [
            signature: `0x${string}`,
            ...args: `0x${string}`[],
          ],
        });
      } catch {
        return null;
      }
    })
    .find((event) => event?.eventName === "PositionCreated");
  if (!created || created.eventName !== "PositionCreated") {
    throw new Error("Market did not emit PositionCreated");
  }
  return {
    tradeId: Number(created.args.tradeId),
    escrowAddress: created.args.escrowAddress as Address,
  };
}

export async function executeMarketListingSubmitFlow(input: {
  selectedIds: number[];
  priceWei: bigint;
  marketAddress: Address;
  chainId: number;
  verifyWalletState: () => Promise<MarketWalletState>;
  writeContract: (request: ListingWriteRequest) => Promise<`0x${string}`>;
  waitForReceipt: (hash: `0x${string}`) => Promise<MarketListingFlowReceipt>;
  decodeListingReceipt?: (receipt: MarketListingFlowReceipt) => {
    tradeId: number;
    escrowAddress: Address;
  };
  onListingSubmitted?: (
    listingHash: `0x${string}`,
    walletState: MarketWalletState,
  ) => Promise<void> | void;
}): Promise<MarketListingSubmitFlowResult> {
  const kittyIds = [...input.selectedIds].sort((a, b) => a - b);
  const walletState = await input.verifyWalletState();
  const listingHash = await input.writeContract({
    address: input.marketAddress,
    abi: KPEG_MARKET_ABI,
    functionName: "createTradeAndFund",
    args: [zeroAddress, input.priceWei, kittyIds.map(BigInt)],
    chainId: input.chainId,
  });
  await input.onListingSubmitted?.(listingHash, walletState);
  const listingReceipt = await input.waitForReceipt(listingHash);
  const { tradeId, escrowAddress } = (
    input.decodeListingReceipt ?? decodePositionCreatedFromReceipt
  )(listingReceipt);
  return {
    walletState,
    listingHash,
    listingReceipt,
    tradeId,
    escrowAddress,
  };
}

export async function executeMarketBuySubmitFlow(input: {
  listing: MarketListing;
  marketAddress: Address;
  chainId: number;
  verifyListing: () => Promise<void>;
  onVerificationPassed?: () => Promise<void> | void;
  writeContract: (request: BuyWriteRequest) => Promise<`0x${string}`>;
}): Promise<`0x${string}`> {
  await input.verifyListing();
  await input.onVerificationPassed?.();
  const priceWei = BigInt(input.listing.priceWei);
  return input.writeContract({
    address: input.marketAddress,
    abi: KPEG_MARKET_ABI,
    functionName: "buyAndClaimAll",
    args: [BigInt(input.listing.tradeId), zeroAddress, priceWei],
    value: priceWei,
    chainId: input.chainId,
  });
}

export function shouldClearBuyListingActionAfterError(input: {
  buyVerified: boolean;
  hash: `0x${string}` | null;
}): boolean {
  return input.buyVerified && input.hash === null;
}

export async function resolveOwnedKittiesQueryData(input: {
  owner: Address;
  tokenAddress: Address;
  seedKitties: KittyItem[];
  verifyWalletState?: () => Promise<MarketWalletState>;
  loadApiOwnerKitties?: (
    owner: string,
    seedKitties: KittyItem[],
  ) => Promise<KittyItem[]>;
  loadApiReservedKittyIds?: (owner: string) => Promise<Set<number>>;
  loadCompleteOwnerKittiesFn?: (
    owner: string,
    ownerIds: Set<number>,
    seedKitties: KittyItem[],
  ) => Promise<KittyItem[]>;
  onVerificationError?: (error: unknown) => void;
}): Promise<OwnedKittiesQueryData> {
  const loadApiOwnerKitties =
    input.loadApiOwnerKitties ?? loadOwnerKittiesFromApi;
  const loadApiReservedKittyIds =
    input.loadApiReservedKittyIds ?? loadReservedKittyIdsFromApi;
  const completeOwnerKitties =
    input.loadCompleteOwnerKittiesFn ?? loadCompleteOwnerKitties;
  const reportVerificationError =
    input.onVerificationError ??
    ((error: unknown) => {
      console.warn(
        "MARKET wallet verification failed; using API-derived wallet kPEGs.",
        error,
      );
    });
  const apiKitties = await loadApiOwnerKitties(input.owner, input.seedKitties);
  let ownerIds = new Set(apiKitties.map((kitty) => kitty.id));
  let reservedIds = await loadApiReservedKittyIds(input.owner);
  let tokenAddress = input.tokenAddress;

  if (input.verifyWalletState) {
    try {
      const verified = await input.verifyWalletState();
      tokenAddress = verified.tokenAddress;
      ownerIds = verified.ownerIds;
      reservedIds = verified.reservedIds;
    } catch (error) {
      reportVerificationError(error);
    }
  }

  const completeKitties = await completeOwnerKitties(
    input.owner,
    ownerIds,
    apiKitties,
  );
  return {
    tokenAddress,
    ownerIds,
    reservedIds,
    items: buildSelectableListingCandidates(
      completeKitties,
      ownerIds,
      reservedIds,
    ),
  };
}

function marketTxUrl(txHash: string): string | null {
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

function formatTimestamp(ms: number | null): string {
  if (!ms) return "N/A";
  return new Date(ms).toUTCString();
}

function firstKitty(listing: MarketListing): KittyItem | null {
  return listing.kitties[0] ?? null;
}

function makeOptimisticListing({
  tradeId,
  escrowAddress,
  seller,
  priceWei,
  kittyIds,
  kitties,
  createdBlock,
  createdTxHash,
  feeBps,
  phase,
}: {
  tradeId: number;
  escrowAddress: Address;
  seller: Address;
  priceWei: string;
  kittyIds: number[];
  kitties: KittyItem[];
  createdBlock: number;
  createdTxHash: string;
  feeBps: number;
  phase: MarketListingPhase;
}): MarketListingView {
  return {
    tradeId,
    escrowAddress,
    seller,
    buyer: null,
    paymentToken: zeroAddress,
    priceWei,
    feeBps,
    kittyIds,
    kittyCount: kittyIds.length,
    status: "OPEN",
    createdBlock,
    createdTxHash,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    closedBlock: null,
    closedTxHash: null,
    closedAt: null,
    kitties,
    optimisticPhase: phase,
    optimisticLabelId: kitties[0]?.id ?? kittyIds[0] ?? tradeId,
  };
}

export function MarketCard({
  listing,
  ownerActions,
  buyerAction,
  onOpen,
  onCancel,
  onUpdate,
  detailQueryScope,
}: {
  listing: MarketListingView;
  ownerActions: boolean;
  buyerAction: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onUpdate: () => void;
  detailQueryScope?: {
    chainId?: number | null;
    tokenAddress?: string | null;
  };
}) {
  const kitty = firstKitty(listing);
  const background =
    BACKGROUND_STYLES[kitty?.traits.background ?? "White"] ??
    BACKGROUND_STYLES.White!;
  const displayId = displayListingId(listing);
  const pendingListing =
    listing.optimisticPhase === "listing" ||
    listing.optimisticPhase === "canceling" ||
    listing.optimisticPhase === "buying" ||
    listing.optimisticPhase === "updating";
  const confirmedListing =
    listing.optimisticPhase === "listed" ||
    listing.optimisticPhase === "canceled" ||
    listing.optimisticPhase === "bought" ||
    listing.optimisticPhase === "updated";
  const canOpen = !listing.optimisticPhase && listing.tradeId > 0;
  const optimisticName =
    listing.kittyCount === 1
      ? `#${displayId.toLocaleString()}`
      : `${listing.kittyCount} KPEGS`;
  const actionLabel =
    listing.optimisticPhase === "canceling"
      ? "Canceling"
      : listing.optimisticPhase === "canceled"
        ? "Canceled"
        : listing.optimisticPhase === "buying"
          ? "Buying"
          : listing.optimisticPhase === "bought"
            ? "Bought"
            : listing.optimisticPhase === "updating"
              ? "Updating"
              : listing.optimisticPhase === "updated"
                ? "Updated"
                : listing.optimisticPhase === "listed"
                  ? "Listed"
                  : listing.optimisticPhase
                    ? "Listing"
                    : null;
  const primaryLeft =
    actionLabel
      ? `${actionLabel} ${optimisticName}`
      : listing.kittyCount === 1 && kitty
        ? `KPEG #${kitty.id.toLocaleString()}`
        : `${listing.kittyCount} KPEGS`;
  const tierColor =
    listing.kittyCount === 1 && kitty
      ? getTierColor(kitty.tierLabel)
      : undefined;
  const metallicTierVariant =
    listing.kittyCount === 1 && kitty
      ? getMetallicTierVariant(kitty.tierLabel)
      : undefined;
  const prefetchHandlers = useKittyDetailPrefetch(
    canOpen ? kitty?.id : undefined,
    detailQueryScope,
  );
  const cardPriceLabel = marketCardEthLabel(listing.priceWei);
  return (
    <article
      className={clsx(
        "group grid min-w-0 gap-0 border-0 bg-transparent p-0 text-left text-[var(--fg)] transition-opacity",
        canOpen ? "cursor-pointer hover:opacity-95" : "cursor-default",
        metallicTierVariant && "tier-metal-card",
      )}
      data-tier-metal={metallicTierVariant}
      role="button"
      tabIndex={canOpen ? 0 : -1}
      onClick={() => {
        if (canOpen) onOpen();
      }}
      onKeyDown={(event) => {
        if (!canOpen || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onOpen();
      }}
      {...prefetchHandlers}
      style={
        {
          "--card-bg": background.bg,
          "--card-hover-fg": background.fg,
          "--card-hover-muted": background.muted,
        } as CSSProperties
      }
    >
      <div className="mb-[-1px] grid aspect-square place-items-center overflow-hidden rounded-[5px] bg-white/[0.055] transition-[border-radius] duration-[var(--dur-mid)] ease-[var(--ease)] group-hover:rounded-b-none max-[979px]:rounded-b-none">
        {kitty ? (
          <KPEGArt
            traits={kitty.traits}
            id={kitty.id}
            className="h-full w-full [image-rendering:pixelated]"
            alt={`market kPEG #${kitty.id}`}
          />
        ) : (
          <div className="font-mono text-[0.72rem] text-[var(--fg-muted)]">
            BUNDLE
          </div>
        )}
      </div>
      <CardMetaPanel
        primaryLeft={primaryLeft}
        primaryLeftNode={
          <span className="inline-flex min-w-0">
            <RollingNumber value={primaryLeft} />
          </span>
        }
        primaryRight=""
        primaryRightNode={
          pendingListing ? (
            <span className="shrink-0 text-[0.76rem] text-[var(--fg-muted)]">
              <Spinner />
            </span>
          ) : confirmedListing ? (
            <span className="shrink-0 text-[0.82rem] text-[var(--success)]">
              <i className="nf nf-cod-check" aria-hidden="true" />
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-baseline gap-2 whitespace-nowrap max-[979px]:gap-1">
              <span
                className="text-[clamp(0.75rem,1.6vw,1rem)] font-bold text-[var(--fg)] transition-[color,font-size] duration-[var(--dur-mid)] ease-[var(--ease)] group-hover:text-[var(--card-hover-fg)] group-hover:text-[clamp(0.65rem,1.25vw,0.85rem)] max-[979px]:text-[clamp(0.55rem,1vw,0.65rem)] max-[979px]:group-hover:text-[clamp(0.55rem,1vw,0.65rem)] max-[979px]:text-[var(--card-hover-fg)]"
                aria-label={`${exactEthAmountLabel(listing.priceWei)} ETH`}
                title={`${exactEthAmountLabel(listing.priceWei)} ETH`}
              >
                {cardPriceLabel.mode === "compact" ? (
                  <span className="inline-flex items-baseline gap-[0.04rem]">
                    <RollingNumber value="0.0" />
                    <sub className="relative top-[0.16em] text-[0.72em] leading-none">
                      {cardPriceLabel.zeroCount}
                    </sub>
                    {cardPriceLabel.significantText}
                  </span>
                ) : (
                  <RollingNumber value={cardPriceLabel.value} />
                )}
              </span>
              <span className="text-[clamp(0.6rem,1.1vw,0.7rem)] font-extrabold tracking-[0.08em] text-[var(--fg-muted)] transition-[color,font-size] duration-[var(--dur-mid)] ease-[var(--ease)] group-hover:text-[var(--card-hover-muted)] group-hover:text-[clamp(0.5rem,1vw,0.6rem)] max-[979px]:text-[clamp(0.45rem,0.8vw,0.55rem)] max-[979px]:group-hover:text-[clamp(0.45rem,0.8vw,0.55rem)] max-[979px]:text-[var(--card-hover-muted)]">
                ETH
              </span>
            </span>
          )
        }
        secondaryLeft={
          listing.kittyCount === 1 && kitty
            ? kitty.tierLabel.toUpperCase()
            : "BUNDLE"
        }
        secondaryLeftStyle={tierColor ? { color: tierColor } : undefined}
        secondaryRight={buyerAction ? "BUY" : ""}
        secondaryRightNode={
          ownerActions && !listing.optimisticPhase ? (
            <span className="inline-flex shrink-0 items-baseline gap-3 font-mono text-[clamp(0.5rem,0.95vw,0.58rem)] font-extrabold tracking-[0.08em] text-[var(--card-hover-muted)]">
              <button
                className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] tracking-[inherit] text-[inherit] transition-colors hover:text-[var(--card-hover-fg)]"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onCancel();
                }}
              >
                CANCEL
              </button>
              <button
                className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] tracking-[inherit] text-[inherit] transition-colors hover:text-[var(--card-hover-fg)]"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onUpdate();
                }}
              >
                UPDATE
              </button>
            </span>
          ) : buyerAction && !listing.optimisticPhase ? (
            <span className="inline-flex shrink-0 cursor-pointer items-baseline font-mono text-[clamp(0.5rem,0.95vw,0.58rem)] font-extrabold tracking-[0.08em] text-[var(--card-hover-muted)] transition-colors hover:text-[var(--card-hover-fg)]">
              BUY NOW
            </span>
          ) : undefined
        }
      />
    </article>
  );
}

function MarketListingsPane({
  snapshot,
  initialLoading,
  initialSkeletonCount,
  address,
  detailQueryScope,
  canLoadMore,
  animateReorder,
  emptyMessage,
  onLoadMore,
  onOpenListing,
  onCancelListing,
  onUpdateListing,
}: {
  snapshot: MarketPaneSnapshot;
  initialLoading: boolean;
  initialSkeletonCount: number;
  address: string | undefined;
  detailQueryScope?: {
    chainId?: number | null;
    tokenAddress?: string | null;
  };
  canLoadMore: boolean;
  animateReorder: boolean;
  emptyMessage: ReactNode;
  onLoadMore: () => void;
  onOpenListing: (tradeId: number) => void;
  onCancelListing: (listing: MarketListing) => void;
  onUpdateListing: (listing: MarketListing) => void;
}) {
  return (
    <div>
      <InfiniteGalleryGrid
        initialLoading={initialLoading}
        loadingLabel="Fetching listings..."
        initialSkeletonCount={initialSkeletonCount}
        hasMore={canLoadMore ? snapshot.hasMore : false}
        fetchingMore={canLoadMore ? snapshot.fetchingMore : false}
        animateReorder={animateReorder}
        reorderToken={snapshot.reorderToken}
        onLoadMore={canLoadMore ? onLoadMore : () => {}}
        empty={
          snapshot.listings.length === 0 ? (
            <div className="inline-flex min-h-48 items-center text-[var(--fg-muted)]">
              {emptyMessage}
            </div>
          ) : null
        }
      >
        {snapshot.listings.map((listing) => (
          <MarketCard
            key={listing.tradeId}
            listing={listing}
            ownerActions={canManageMarketListing(listing, address)}
            buyerAction={canBuyMarketListing(listing, address)}
            onOpen={() => onOpenListing(listing.tradeId)}
            onCancel={() => onCancelListing(listing)}
            onUpdate={() => onUpdateListing(listing)}
            {...(detailQueryScope ? { detailQueryScope } : {})}
          />
        ))}
      </InfiniteGalleryGrid>
    </div>
  );
}

export function ListingModal({
  kitties,
  loading,
  loadError,
  selectedIds,
  priceInput,
  feeBps,
  listAction,
  selectedApproved,
  approvalChecking,
  open,
  maxBundleSize,
  onClose,
  onToggle,
  onPriceChange,
  onSubmit,
}: {
  kitties: ListingKittyCandidate[];
  loading: boolean;
  loadError: boolean;
  selectedIds: number[];
  priceInput: string;
  feeBps: number;
  listAction: ListModalAction;
  selectedApproved: boolean;
  approvalChecking: boolean;
  open: boolean;
  maxBundleSize: number;
  onClose: () => void;
  onToggle: (id: number) => void;
  onPriceChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const priceValidation = validateListingPriceInput(priceInput);
  const priceError = priceInput.trim() ? priceValidation.error : null;
  const price = Number(priceInput);
  const receive = Number.isFinite(price) ? price * (1 - feeBps / 10_000) : 0;
  const approvalRequired = !selectedApproved;
  const actionPending = listAction !== "idle";
  const actionLabel =
    listAction === "approving"
      ? "APPROVING..."
      : listAction === "listing"
        ? "LISTING..."
        : null;
  const selectionLocked = actionPending;
  return (
    <KittySelectionModal
      open={open}
      eyebrow="LIST kPEG"
      title="Pick kitties for listing"
      kitties={kitties}
      loading={loading}
      loadError={loadError}
      selectedIds={selectedIds}
      selectionLocked={selectionLocked}
      maxBundleSize={maxBundleSize}
      onClose={onClose}
      onToggle={onToggle}
      footer={
        <div className="grid gap-3 border-t border-[var(--line)] pt-3">
          <label className="grid gap-1">
            <span className="font-mono text-[0.72rem] tracking-[0.08em] text-[var(--fg-muted)]">
              EXPECTED SELL PRICE
            </span>
            <div className="grid grid-cols-[1fr_auto] items-center rounded border border-[var(--line)] bg-white/[0.045] px-3">
              <input
                className="min-h-[2.25rem] appearance-none border-0 bg-transparent p-0 text-[1rem] text-[var(--fg)] outline-none"
                inputMode="decimal"
                placeholder="0.00"
                value={priceInput}
                onChange={(event) =>
                  onPriceChange(event.target.value.replace(/[^\d.]/g, ""))
                }
              />
              <span className="font-mono text-[1rem] text-[var(--fg-muted)] pl-3 border-l-2 border-[var(--line)]">
                ETH
              </span>
            </div>
            {priceError ? (
              <span className="font-mono text-[0.68rem] text-[var(--danger,#ff7a7a)]">
                {priceError}
              </span>
            ) : null}
          </label>
          <p className="m-0 text-[0.75rem] text-[var(--fg-muted)]">
            A {feeBps / 100}% protocol fee is deducted. You&apos;ll receive{" "}
            <RollingNumber
              value={
                receive > 0
                  ? receive.toLocaleString(undefined, {
                      maximumFractionDigits: 4,
                    })
                  : "0"
              }
            />{" "}
            ETH on sale.
          </p>
          <button
            className="inline-flex min-h-[2.2rem] cursor-pointer justify-center rounded-[5px] border border-[var(--line)] bg-[var(--fg)] py-[0.4rem] text-[var(--bg)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            disabled={
              approvalRequired
                ? actionPending ||
                  approvalChecking ||
                  loading ||
                  loadError ||
                  selectedIds.length === 0 ||
                  selectedIds.length > maxBundleSize ||
                  !priceInput ||
                  priceValidation.error !== null
                : actionPending ||
                  loading ||
                  loadError ||
                  selectedIds.length === 0 ||
                  selectedIds.length > maxBundleSize ||
                  !priceInput ||
                  priceValidation.error !== null
            }
            onClick={onSubmit}
          >
            {actionLabel ? (
              actionLabel
            ) : approvalRequired ? (
              approvalChecking ? "CHECKING APPROVAL..." : "APPROVE SELECTED KPEGS"
            ) : selectedIds.length > 0 ? (
              <span className="inline-flex items-center gap-[0.38rem]">
                <span>LIST</span>
                <RollingNumber
                  value={String(selectedIds.length)}
                  align="center"
                />
                <span>KPEG{selectedIds.length > 1 ? "S" : ""}</span>
              </span>
            ) : (
              "SELECT KPEGS"
            )}
          </button>
          {approvalRequired ? (
            <p className="m-0 text-[0.7rem] text-[var(--fg-muted)]">
              Approval applies only to the selected kPEGs.
            </p>
          ) : null}
        </div>
      }
    />
  );
}

export function SellerListingControls({
  actionBusy,
  priceInput,
  priceInputRef,
  onPriceInputChange,
  onCancel,
  onUpdatePrice,
  className = "",
}: {
  actionBusy: boolean;
  priceInput: string;
  priceInputRef: RefObject<HTMLInputElement | null>;
  onPriceInputChange: (value: string) => void;
  onCancel: () => void;
  onUpdatePrice: (value: string) => void;
  className?: string;
}) {
  const priceValidation = validateListingPriceInput(priceInput);
  const priceError = priceInput.trim() ? priceValidation.error : null;

  return (
    <div
      className={`grid min-w-0 gap-3 border-t border-[var(--line)] pt-3 max-[640px]:gap-2 max-[640px]:pb-[calc(0.1rem+env(safe-area-inset-bottom))] max-[640px]:pt-3 ${className}`}
    >
      <div className="grid gap-1">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="font-mono text-[0.66rem] tracking-[0.08em] text-[var(--fg-muted)] max-[640px]:text-[0.58rem]">
            UPDATE PRICE
          </span>
          <button
            className="shrink-0 whitespace-nowrap cursor-pointer border-0 bg-transparent p-0 text-right font-mono text-[0.68rem] text-[var(--fg-muted)] hover:text-[var(--danger,#ff7a7a)] disabled:cursor-not-allowed disabled:opacity-45 max-[640px]:text-[0.62rem]"
            type="button"
            disabled={actionBusy}
            onClick={onCancel}
          >
            CANCEL LISTING
          </button>
        </div>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center rounded border border-[var(--line)] bg-white/[0.045] px-3">
          <input
            ref={priceInputRef}
            className="min-h-[2.12rem] min-w-0 appearance-none border-0 bg-transparent p-0 text-[0.9rem] text-[var(--fg)] outline-none max-[640px]:min-h-[2rem] max-[640px]:text-[0.78rem]"
            inputMode="decimal"
            placeholder="0.00"
            value={priceInput}
            onChange={(event) =>
              onPriceInputChange(event.target.value.replace(/[^\d.]/g, ""))
            }
          />
          <span className="border-l-2 border-[var(--line)] pl-3 font-mono text-[0.9rem] text-[var(--fg-muted)] max-[640px]:text-[0.78rem]">
            ETH
          </span>
        </div>
        {priceError ? (
          <span className="font-mono text-[0.62rem] text-[var(--danger,#ff7a7a)]">
            {priceError}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <button
          className="inline-flex min-w-0 flex-1 cursor-pointer justify-center overflow-hidden rounded-[5px] border border-[var(--line)] bg-[var(--fg)] px-2 py-[0.42rem] text-[0.86rem] text-[var(--bg)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 max-[640px]:text-[0.78rem]"
          type="button"
          disabled={actionBusy || !priceInput || priceValidation.error !== null}
          onClick={() => onUpdatePrice(priceInput)}
        >
          UPDATE PRICE
        </button>
      </div>
    </div>
  );
}

function BuyerListingControls({
  actionBusy,
  insufficient,
  disabled,
  onBuy,
  className = "",
}: {
  actionBusy: boolean;
  insufficient: boolean;
  disabled: boolean;
  onBuy: () => void;
  className?: string;
}) {
  return (
    <div
      className={`grid gap-3 border-t border-[var(--line)] pt-3 max-[640px]:gap-2 max-[640px]:pb-[calc(0.85rem+env(safe-area-inset-bottom))] max-[640px]:pt-3 ${className}`}
    >
      <button
        className="inline-flex cursor-pointer justify-center rounded-[5px] border border-[var(--line)] bg-[var(--fg)] px-[0.62rem] py-[0.56rem] text-[0.82rem] text-[var(--bg)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 max-[700px]:px-2 max-[700px]:py-[0.48rem] max-[700px]:text-[0.66rem]"
        type="button"
        disabled={disabled}
        onClick={onBuy}
      >
        {insufficient ? "INSUFFICIENT ETH" : actionBusy ? "CONFIRMING..." : "BUY NOW"}
      </button>
    </div>
  );
}

function ListingDetail({
  listing,
  isSeller,
  canManage,
  canBuy,
  walletConnected,
  showSoldTo,
  ethBalance,
  actionBusy,
  copied,
  focusPriceInput,
  open,
  onClose,
  onCopy,
  onOpenPortfolio,
  onOpenKitty,
  onBuy,
  onCancel,
  onUpdatePrice,
  detailQueryScope,
}: {
  listing: MarketListing;
  isSeller: boolean;
  canManage: boolean;
  canBuy: boolean;
  walletConnected: boolean;
  showSoldTo: boolean;
  ethBalance: bigint | null;
  actionBusy: boolean;
  copied: string | null;
  focusPriceInput: boolean;
  open: boolean;
  onClose: () => void;
  onCopy: (key: string, value: string) => void;
  onOpenPortfolio: (address: string) => void;
  onOpenKitty: (kittyId: number) => void;
  onBuy: () => void;
  onCancel: () => void;
  onUpdatePrice: (value: string) => void;
  detailQueryScope?: {
    chainId?: number | null;
    tokenAddress?: string | null;
  };
}) {
  const [priceInput, setPriceInput] = useState(
    formatEther(BigInt(listing.priceWei)),
  );
  const [activeTab, setActiveTab] = useState<ListingDetailTab>("list");
  const [selectedKittyId, setSelectedKittyId] = useState(
    firstKitty(listing)?.id ?? 0,
  );
  const [kittyMenuOpen, setKittyMenuOpen] = useState(false);
  const [kittyMenuRendered, setKittyMenuRendered] = useState(false);
  const priceInputRef = useRef<HTMLInputElement | null>(null);
  const kittyMenuTimer = useRef<number | null>(null);
  const selectedKitty =
    listing.kitties.find((item) => item.id === selectedKittyId) ??
    firstKitty(listing);
  const needsKittyDetail = Boolean(
    selectedKitty &&
      (!selectedKitty.traitOdds ||
        selectedKitty.txHash === undefined ||
        selectedKitty.gasUsed === undefined ||
        selectedKitty.baseFeeWei === undefined),
  );
  const kittyDetailQuery = useQuery({
    queryKey: [
      "kitty",
      detailQueryScope?.chainId ?? 0,
      detailQueryScope?.tokenAddress?.trim().toLowerCase() ?? "unknown",
      selectedKitty?.id,
    ],
    queryFn: () => getKitty(selectedKitty!.id),
    enabled:
      open &&
      activeTab !== "list" &&
      Boolean(selectedKitty) &&
      needsKittyDetail,
    retry: shouldRetryKittyDetail,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const kitty = kittyDetailQuery.data ?? selectedKitty;
  const kittyTierColor = kitty ? getTierColor(kitty.tierLabel) : undefined;
  const kittyMetallicTierVariant = kitty
    ? getMetallicTierVariant(kitty.tierLabel)
    : undefined;
  const kittyGlobalRarity = kitty ? kitty.kpegRarity : null;
  const kittyGlobalRarityPct = kittyGlobalRarity
    ? formatPctCompact(kittyGlobalRarity.percentage)
    : null;
  const txUrl = marketTxUrl(listing.createdTxHash);
  const insufficient = listingBuyInsufficientEth({
    walletConnected,
    ethBalance,
    priceWei: listing.priceWei,
  });
  const listedEthExact = exactEthAmountLabel(listing.priceWei);
  const listedEth = Number(listedEthExact);
  const ethUsdQuery = useQuery({
    queryKey: ["eth-usd-spot"],
    queryFn: getEthUsdSpot,
    enabled: open,
    staleTime: ETH_USD_QUERY_STALE_MS,
    gcTime: ETH_USD_QUERY_STALE_MS,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const listedUsd = usdLabelFromEth(listedEth, ethUsdQuery.data);
  const tabs: Array<{ id: ListingDetailTab; label: string }> = [
    { id: "list", label: "LIST INFO" },
    { id: "traits", label: "TRAITS" },
    { id: "born", label: "BORN" },
  ];
  useEffect(() => {
    setPriceInput(formatEther(BigInt(listing.priceWei)));
  }, [listing.priceWei, listing.tradeId]);
  useEffect(() => {
    setSelectedKittyId(firstKitty(listing)?.id ?? 0);
    setKittyMenuOpen(false);
    setKittyMenuRendered(false);
  }, [listing.tradeId]);
  useEffect(() => {
    if (!focusPriceInput || !canManage) return;
    window.requestAnimationFrame(() => {
      priceInputRef.current?.focus();
      priceInputRef.current?.select();
    });
  }, [canManage, focusPriceInput]);
  useEffect(
    () => () => {
      if (kittyMenuTimer.current) window.clearTimeout(kittyMenuTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!open) {
      setKittyMenuOpen(false);
      setKittyMenuRendered(false);
    }
  }, [open]);

  const openKittyMenu = () => {
    if (kittyMenuTimer.current) {
      window.clearTimeout(kittyMenuTimer.current);
      kittyMenuTimer.current = null;
    }
    setKittyMenuRendered(true);
    window.requestAnimationFrame(() => setKittyMenuOpen(true));
  };
  const closeKittyMenu = () => {
    setKittyMenuOpen(false);
    if (kittyMenuTimer.current) window.clearTimeout(kittyMenuTimer.current);
    kittyMenuTimer.current = window.setTimeout(() => {
      setKittyMenuRendered(false);
      kittyMenuTimer.current = null;
    }, LIST_MODAL_TRANSITION_MS);
  };

  const controls = canManage ? (
    <SellerListingControls
      actionBusy={actionBusy}
      priceInput={priceInput}
      priceInputRef={priceInputRef}
      onPriceInputChange={setPriceInput}
      onCancel={onCancel}
      onUpdatePrice={onUpdatePrice}
    />
  ) : canBuy ? (
    <BuyerListingControls
      actionBusy={actionBusy}
      insufficient={insufficient}
      disabled={actionBusy || insufficient || listing.status !== "OPEN"}
      onBuy={onBuy}
    />
  ) : null;
  const artPanel = kitty ? (
    <div className="aspect-square w-full overflow-hidden rounded-[5px] bg-white/[0.035]">
      <KPEGArt
        traits={kitty.traits}
        id={kitty.id}
        className="h-full w-full object-contain [image-rendering:pixelated]"
        alt={`kPEG #${kitty.id}`}
      />
    </div>
  ) : null;
  const listInfoRowClass =
    "grid w-full min-w-0 grid-cols-[minmax(3.7rem,0.65fr)_minmax(0,1.35fr)] items-center border-b border-[var(--line)] border-t-0 border-r-0 border-l-0 bg-transparent px-0 py-[0.46rem] text-left font-[inherit] text-[inherit] max-[860px]:grid-cols-[minmax(2.8rem,0.64fr)_minmax(0,1.36fr)] max-[860px]:py-[0.36rem]";
  const listInfoLabelClass = "min-w-0 truncate";
  const listInfoValueClass = "min-w-0 truncate text-right";
  const detailTabPane =
    activeTab === "list" ? (
      <>
        <div className="grid gap-[0.45rem]">
          {(
            [
              ...(isSeller
                ? []
                : [
                    {
                      label: "SELLER",
                      display: shortAddress(listing.seller),
                      value: listing.seller,
                      kind: "address",
                    } as const,
                  ]),
              {
                label: "TRADE ID",
                display: `#${listing.tradeId}`,
                value: String(listing.tradeId),
                kind: "copy",
              } as const,
              {
                label: "LISTED",
                display: formatTimestamp(listing.createdAt),
                value: formatTimestamp(listing.createdAt),
                kind: "copy",
              } as const,
              ...(showSoldTo && listing.buyer
                ? [
                    {
                      label: "BUYER",
                      display: shortAddress(listing.buyer),
                      value: listing.buyer,
                      kind: "address",
                    } as const,
                  ]
                : []),
            ] satisfies Array<{
              label: string;
              display: string;
              value: string;
              kind: "address" | "copy";
            }>
          ).map((row) =>
            row.kind === "address" ? (
              <div
                key={row.label}
                className={`group cursor-pointer ${listInfoRowClass}`}
                role="button"
                tabIndex={0}
                onClick={() => onOpenPortfolio(row.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onOpenPortfolio(row.value);
                }}
              >
                <span className={listInfoLabelClass}>{row.label}</span>
                <span className="inline-flex min-w-0 items-center justify-end gap-[0.45rem]">
                  <button
                    className="mt-[-1px] inline-flex w-[4.25rem] shrink-0 cursor-pointer justify-end border-0 bg-transparent p-0 text-[0.6rem] leading-none font-normal tracking-[0.03em] text-[var(--fg-muted)] opacity-0 transition-[color,opacity] hover:text-[var(--fg)] group-hover:opacity-100 max-[860px]:hidden"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCopy(row.label, row.value);
                    }}
                  >
                    {copied === row.label ? "COPIED" : "COPY"}
                  </button>
                  <button
                    className="mt-[-1px] inline-flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[var(--fg-muted)] opacity-0 transition-[color,opacity] hover:text-[var(--fg)] group-hover:opacity-100 max-[860px]:hidden"
                    type="button"
                    aria-label={`Open ${row.label.toLowerCase()} portfolio`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenPortfolio(row.value);
                    }}
                  >
                    <i
                      className="nf nf-oct-arrow_up_right self-center text-[0.8rem] leading-none"
                      aria-hidden="true"
                    />
                  </button>
                  <strong className="min-w-0 truncate">{row.display}</strong>
                </span>
              </div>
            ) : (
              <button
                key={row.label}
                className={`group cursor-pointer ${listInfoRowClass}`}
                type="button"
                onClick={() => onCopy(row.label, row.value)}
              >
                <span className={listInfoLabelClass}>{row.label}</span>
                <span className="inline-flex min-w-0 items-center justify-end gap-[0.55rem]">
                  <span className="inline-flex w-[3.5rem] shrink-0 justify-end font-normal text-[var(--fg-muted)] opacity-0 transition-opacity group-hover:opacity-100 max-[860px]:hidden">
                    {copied === row.label ? "COPIED" : "COPY"}
                  </span>
                  <strong className="min-w-0 truncate">{row.display}</strong>
                </span>
              </button>
            ),
          )}
          {kitty && kittyGlobalRarity && kittyGlobalRarityPct ? (
            <>
              <div className={listInfoRowClass}>
                <span className={listInfoLabelClass}>TIER</span>
                <strong
                  className={
                    kittyMetallicTierVariant
                      ? `tier-metal-value ${listInfoValueClass}`
                      : listInfoValueClass
                  }
                  data-tier-metal={kittyMetallicTierVariant}
                  style={
                    kittyTierColor && !kittyMetallicTierVariant
                      ? { color: kittyTierColor }
                      : undefined
                  }
                >
                  {kitty.tierLabel}
                </strong>
              </div>
              <div className={listInfoRowClass}>
                <span className={listInfoLabelClass}>RARITY SCORE</span>
                <strong className={listInfoValueClass}>
                  {formatRarityScore(kitty.rarityScore)}
                </strong>
              </div>
              <div className={listInfoRowClass}>
                <span className={listInfoLabelClass}>RARITY</span>
                <strong
                  className={
                    kittyGlobalRarityPct.zeroCount === null
                      ? listInfoValueClass
                      : "inline-flex min-w-0 items-baseline justify-end gap-[0.04rem] truncate text-right"
                  }
                  aria-label={formatPct(kittyGlobalRarity.percentage)}
                  title={formatPct(kittyGlobalRarity.percentage)}
                >
                  {kittyGlobalRarityPct.zeroCount === null ? (
                    kittyGlobalRarityPct.text
                  ) : (
                    <>
                      {kittyGlobalRarityPct.text}
                      <sub className="relative top-[0.16em] text-[0.72em] leading-none">
                        {kittyGlobalRarityPct.zeroCount}
                      </sub>
                      {kittyGlobalRarityPct.significantText}
                    </>
                  )}
                </strong>
              </div>
            </>
          ) : null}
        </div>
        <div className="pt-3">
          <p className="m-0 font-mono text-[0.5rem] tracking-[0.12em] text-[var(--fg-muted)] max-[860px]:text-[0.4rem]">
            {listing.status === "SOLD" ? "SOLD PRICE" : "LISTED PRICE"}
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <strong className="text-[2.5rem] leading-none tracking-[-0.05em] max-[860px]:text-[2rem]">
              {listedEthExact}
            </strong>
            <span className="text-[0.75rem] leading-none text-[var(--fg-muted)] max-[860px]:text-[0.6rem]">
              ETH
            </span>
          </div>
          {listedUsd ? (
            <p className="mt-1 mb-0 text-[0.75rem] text-[var(--fg-muted)] max-[860px]:text-[0.6rem]">
              {listedUsd}
            </p>
          ) : null}
        </div>
      </>
    ) : activeTab === "traits" && kitty ? (
      <div className="grid gap-[0.45rem]">
        {(
          Object.entries(kitty.traits) as Array<
            [keyof KittyItem["traits"], string]
          >
        ).map(([key, value]) => (
          <button
            key={key}
            className="group grid w-full min-w-0 cursor-pointer grid-cols-[minmax(2.65rem,0.28fr)_minmax(0,1fr)_minmax(6.2rem,6.2rem)] items-center gap-2 border-b border-[var(--line)] border-t-0 border-r-0 border-l-0 bg-transparent px-0 py-[0.5rem] text-left font-[inherit] text-[inherit] max-[860px]:grid-cols-[minmax(2.8rem,0.7fr)_minmax(0,1fr)] max-[860px]:py-[0.4rem]"
            type="button"
            onClick={() => onCopy(`TRAIT_${key}`, value)}
          >
            <span className="min-w-0 truncate">{TRAIT_LABELS[key]}</span>
            <span className="relative inline-flex min-w-0 items-center justify-start gap-3 text-left max-[860px]:justify-end">
              <span className="inline-flex w-[4.6rem] shrink-0 justify-end font-normal text-[var(--fg-muted)] opacity-0 transition-opacity group-hover:opacity-100 max-[860px]:hidden">
                {copied === `TRAIT_${key}` ? "COPIED" : "COPY"}
              </span>
              <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-right text-[var(--fg)]">
                {value}
              </strong>
            </span>
            <div className="text-right max-[860px]:hidden">
              <strong>
                {formatPct(kitty.traitOdds?.[key]?.probabilityPct ?? 0)}
              </strong>
            </div>
          </button>
        ))}
      </div>
    ) : activeTab === "born" && kitty ? (
      <div className="grid gap-[0.45rem]">
        {txUrl ? (
          <button
            className="group grid w-full min-w-0 cursor-pointer grid-cols-[minmax(4.2rem,0.72fr)_minmax(0,1.28fr)] items-center border-b border-[var(--line)] border-t-0 border-r-0 border-l-0 bg-transparent px-0 py-[0.5rem] text-left font-[inherit] text-[inherit] max-[860px]:grid-cols-[minmax(3.2rem,0.7fr)_minmax(0,1.3fr)] max-[860px]:py-[0.4rem]"
            type="button"
            onClick={() => window.open(txUrl, "_blank", "noopener,noreferrer")}
          >
            <span className="min-w-0 truncate">BLOCK</span>
            <span className="inline-flex min-w-0 items-center justify-end gap-[0.55rem]">
              <i
                className="nf nf-cod-link_external shrink-0 text-[var(--fg-muted)] opacity-0 transition-opacity group-hover:opacity-100 max-[860px]:hidden"
                aria-hidden="true"
              />
              <strong className="min-w-0 truncate">
                #{listing.createdBlock.toLocaleString()}
              </strong>
            </span>
          </button>
        ) : null}
        {(
          [
            ["TIMESTAMP", formatTimestamp(kitty.mintedAt)],
            [
              "GAS USED",
              kitty.gasUsed ? kitty.gasUsed.toLocaleString() : "N/A",
            ],
            [
              "BASE FEE",
              kitty.baseFeeWei
                ? `${(Number(BigInt(kitty.baseFeeWei)) / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} gwei`
                : "N/A",
            ],
          ] satisfies Array<[string, string]>
        ).map(([label, value]) => (
          <button
            key={label}
            className="group grid w-full min-w-0 cursor-pointer grid-cols-[minmax(4.2rem,0.72fr)_minmax(0,1.28fr)] items-center border-b border-[var(--line)] border-t-0 border-r-0 border-l-0 bg-transparent px-0 py-[0.5rem] text-left font-[inherit] text-[inherit] max-[860px]:grid-cols-[minmax(3.2rem,0.7fr)_minmax(0,1.3fr)] max-[860px]:py-[0.4rem]"
            type="button"
            onClick={() => onCopy(`BORN_${label}`, value)}
          >
            <span className="min-w-0 truncate">{label}</span>
            <span className="inline-flex min-w-0 items-center justify-end gap-[0.55rem]">
              <span className="inline-flex w-[3.5rem] shrink-0 justify-end font-normal text-[var(--fg-muted)] opacity-0 transition-opacity group-hover:opacity-100 max-[860px]:hidden">
                {copied === `BORN_${label}` ? "COPIED" : "COPY"}
              </span>
              <strong className="min-w-0 truncate">{value}</strong>
            </span>
          </button>
        ))}
      </div>
    ) : null;
  return createPortal(
    <div
      className={
        open
          ? "fixed inset-0 z-[1000] grid place-items-center bg-black/55 px-[var(--page-pad)] opacity-100 backdrop-blur-sm transition-opacity duration-[200ms] ease-linear max-[980px]:px-[var(--page-pad-mob)]"
          : "fixed inset-0 z-[1000] grid place-items-center bg-black/55 px-[var(--page-pad)] opacity-0 backdrop-blur-sm transition-opacity duration-[200ms] ease-linear max-[980px]:px-[var(--page-pad-mob)]"
      }
      onClick={onClose}
    >
      <section
        className={
          open
            ? "mt-[4vh] grid max-h-[80vh] w-full max-w-[900px] translate-x-0 translate-y-0 transform-gpu grid-cols-[360px_minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] gap-x-4 gap-y-3 overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--bg)] p-4 shadow-2xl transition-transform duration-[200ms] ease-linear will-change-transform max-[980px]:mt-[-2vh] max-[980px]:h-[92svh] max-[980px]:max-h-[92svh] max-[980px]:max-w-[min(92vw,720px)] max-[980px]:grid-cols-1 max-[980px]:grid-rows-[auto_minmax(0,1fr)_auto] max-sm:p-2 max-sm:max-w-none min-h-[75svh]"
            : "mt-[4vh] grid max-h-[80vh] w-full max-w-[900px] translate-x-0 translate-y-[120vh] transform-gpu grid-cols-[360px_minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] gap-x-4 gap-y-3 overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--bg)] p-5 shadow-2xl transition-transform duration-[200ms] ease-linear will-change-transform max-[980px]:mt-[-2vh] max-[980px]:h-[92svh] max-[980px]:max-h-[92svh] max-[980px]:max-w-[min(92vw,720px)] max-[980px]:grid-cols-1 max-[980px]:grid-rows-[auto_minmax(0,1fr)_auto] max-sm:p-2 max-sm:max-w-none"
        }
        onClick={(event) => {
          event.stopPropagation();
          closeKittyMenu();
        }}
      >
        <div className="relative z-[2] col-start-2 row-start-1 flex min-w-0 items-start justify-between gap-3 bg-[var(--bg)] max-[980px]:col-start-1 max-[980px]:row-start-1">
          {listing.kittyCount > 1 && kitty ? (
            <div
              className="relative min-w-0 flex-1"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="inline-flex w-full cursor-pointer items-center justify-between gap-3 rounded-[5px] border border-[var(--line)] bg-white/[0.035] px-3 py-[0.5rem] font-mono text-[0.75rem] font-bold tracking-[0.04em] text-[var(--fg-muted)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--fg)] max-[640px]:text-[0.65rem]"
                type="button"
                onClick={() => {
                  if (kittyMenuOpen) closeKittyMenu();
                  else openKittyMenu();
                }}
              >
                {/* <span className="truncate"> */}
                {/*   View KPEG #{kitty.id} of {listing.kittyCount} */}
                {/* </span> */}
                <div className="flex gap-1.5">
                  View KPEG
                  <span className="text-[var(--accent)]"> #{kitty.id}</span>
                  of
                  <span className="text-[var(--accent)]">
                    {listing.kittyCount}
                  </span>
                </div>
                <i
                  className={
                    kittyMenuOpen
                      ? "nf nf-cod-chevron_down shrink-0 rotate-180 text-[0.62rem] transition-transform duration-[200ms] ease-linear"
                      : "nf nf-cod-chevron_down shrink-0 text-[0.62rem] transition-transform duration-[200ms] ease-linear"
                  }
                  aria-hidden="true"
                />
              </button>
              {kittyMenuRendered ? (
                <div className="pointer-events-none absolute left-0 right-0 top-full z-[60] pt-2">
                  <div
                    className={
                      kittyMenuOpen
                        ? "grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] duration-[200ms] ease-linear"
                        : "grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-[200ms] ease-linear"
                    }
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div
                        className={
                          kittyMenuOpen
                            ? "pointer-events-auto grid max-h-[16rem] translate-y-0 overflow-auto rounded-[5px] border border-[var(--line)] bg-[var(--bg)] transition-transform duration-[200ms] ease-linear will-change-transform"
                            : "pointer-events-none grid max-h-[16rem] -translate-y-full overflow-auto rounded-[5px] border border-[var(--line)] bg-[var(--bg)] transition-transform duration-[200ms] ease-linear will-change-transform"
                        }
                      >
                        {listing.kitties.map((item) => (
                          <button
                            key={item.id}
                            className={
                              kitty.id === item.id
                                ? "cursor-pointer border-0 bg-white/[0.08] px-3 py-[0.48rem] text-left font-mono text-[0.62rem] font-bold text-[var(--fg)]"
                                : "cursor-pointer border-0 bg-transparent px-3 py-[0.48rem] text-left font-mono text-[0.62rem] font-bold text-[var(--fg-muted)] hover:bg-white/[0.045] hover:text-[var(--fg)]"
                            }
                            type="button"
                            onClick={() => {
                              setSelectedKittyId(item.id);
                              closeKittyMenu();
                            }}
                          >
                            KPEG #{item.id}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : kitty ? (
            <div className="min-w-0 flex-1">
              <div className="inline-flex w-full items-center rounded-[5px] border border-[var(--line)] bg-white/[0.035] px-3 py-[0.46rem] font-mono text-[0.66rem] font-bold tracking-[0.04em] text-[var(--fg-muted)] max-[640px]:text-[0.62rem]">
                {`KPEG #${kitty.id}`}
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="m-0 font-mono text-[0.52rem] font-bold tracking-[0.14em] text-[var(--fg-muted)] max-[640px]:text-[0.52rem]">
                LIST INFO
              </p>
            </div>
          )}
          <button
            className="inline-flex h-[2.05rem] w-[1.75rem] shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[var(--fg-muted)] hover:text-[var(--fg)]"
            type="button"
            onClick={onClose}
          >
            <i className="nf nf-fa-close text-[0.72rem]" />
          </button>
        </div>
        <div className="col-start-1 row-span-3 row-start-1 grid min-w-0 content-start gap-3 max-[980px]:hidden">
          {artPanel}
          {controls ? <div className="min-w-0">{controls}</div> : null}
        </div>
        <div className="col-start-2 row-span-2 row-start-2 grid min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-y-3 overflow-hidden pr-1 max-[980px]:col-start-1 max-[980px]:row-span-1 max-[980px]:row-start-2 max-[980px]:grid-rows-[auto_auto_auto] max-[980px]:auto-rows-min max-[980px]:overflow-auto max-[980px]:content-start max-[980px]:pr-0">
          <div className="hidden min-w-0 content-start max-[980px]:grid">
            {kitty ? (
              <div className="aspect-square w-full overflow-hidden rounded-[5px] bg-white/[0.035]">
                <KPEGArt
                  traits={kitty.traits}
                  id={kitty.id}
                  className="h-full w-full object-contain [image-rendering:pixelated]"
                  alt={`kPEG #${kitty.id}`}
                />
              </div>
            ) : null}
          </div>
          <div className="col-start-1 row-start-1 grid min-w-0 content-start gap-2 text-[0.65rem] max-[980px]:row-start-2">
            <div className="inline-flex mt-2 min-w-0 gap-4 border-b border-[var(--line)] tracking-[0.08em] max-[980px]:mt-0">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={
                    activeTab === tab.id
                      ? "mb-[-1px] cursor-pointer border-0 border-b-1 border-[var(--fg)] bg-transparent px-0 pb-2 text-[var(--fg)] max-md:pb-1"
                      : "mb-[-1px] cursor-pointer border-0 border-b-1 border-transparent bg-transparent px-0 pb-2 text-[var(--fg-muted)] hover:text-[var(--fg)] max-md:pb-1"
                  }
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="col-start-1 row-start-2 min-h-0 overflow-auto pb-2 text-[0.65rem] max-[980px]:row-start-3 max-[980px]:overflow-visible max-[980px]:pb-0">
            <SlidingPaneSwap
              contentKey={activeTab}
              content={detailTabPane}
              offsetPx={28}
            />
          </div>
        </div>
        {controls ? (
          <div className="hidden min-w-0 max-[980px]:block">
            <div className="min-w-0">{controls}</div>
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

export function MarketPage() {
  const { address, connector } = useAccount();
  const { connect, connectors } = useConnect();
  const primaryConnector = connectors[0];
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const { pushToast } = useToast();
  const [activeTab, setActiveTab] = useState<MarketTab>("all");
  const [listOpen, setListOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [priceInput, setPriceInput] = useState("");
  const [openedTradeId, setOpenedTradeId] = useState<number | null>(null);
  const [focusUpdateTradeId, setFocusUpdateTradeId] = useState<number | null>(
    null,
  );
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailClosing, setDetailClosing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [listModalAction, setListModalAction] = useState<ListModalAction>("idle");
  const [listingActions, setListingActions] = useState<Record<number, ListingAction>>({});
  const [postTradeRefreshUntil, setPostTradeRefreshUntil] = useState<number>(
    () => getPostTradeRefreshUntil(),
  );
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState<SortMode>("latest");
  const [optimisticListings, setOptimisticListings] = useState<
    Record<number, MarketListingView>
  >({});
  const [persistentOptimisticListings, setPersistentOptimisticListings] =
    useState<Record<number, MarketListingView>>({});
  const [listVisible, setListVisible] = useState(false);
  const [listClosing, setListClosing] = useState(false);
  const listCloseTimer = useRef<number | null>(null);
  const detailCloseTimer = useRef<number | null>(null);
  const optimisticTimers = useRef<number[]>([]);
  const marketConflictLogKeys = useRef<Set<string>>(new Set());
  const searchValue = useDebouncedValue(searchInput, 450);
  const sortDisabled = shouldDisableMarketSortDuringSearch(searchValue);
  const sortedSelectedIds = useMemo(
    () => [...selectedIds].sort((a, b) => a - b),
    [selectedIds],
  );
  const onToggleSelectedId = useCallback((id: number) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }, []);
  const debouncedSortedSelectedIds = useDebouncedValue(sortedSelectedIds, 200);

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
    staleTime: 30_000,
  });
  const statusQuery = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    staleTime: 0,
    refetchInterval: (query) =>
      syncBackfillActive(query.state.data)
        ? BACKFILL_REFETCH_MS
        : NORMAL_GALLERY_REFETCH_MS,
  });
  const marketAddress = (resolveRuntimeAddress(
    configQuery.data?.marketAddress,
    import.meta.env.VITE_KPEG_MARKET_ADDRESS,
  ) || "") as Address;
  const tokenAddress = (resolveRuntimeAddress(
    configQuery.data?.tokenAddress,
    import.meta.env.VITE_KPEG_TOKEN_ADDRESS,
  ) || "") as Address;
  const targetChainId = resolveRuntimeChainId(
    configQuery.data?.chainId,
    import.meta.env.VITE_KPEG_CHAIN_ID,
  );
  const optimisticMarketScope = useMemo(
    () => ({
      chainId: targetChainId,
      marketAddress,
    }),
    [marketAddress, targetChainId],
  );
  const optimisticOwnerTransfersScope = useMemo(
    () => ({
      chainId: targetChainId,
      tokenAddress,
    }),
    [targetChainId, tokenAddress],
  );
  const publicClient = usePublicClient({ chainId: targetChainId });
  useEffect(() => {
    const onPostTradeRefresh = () => {
      setPostTradeRefreshUntil(getPostTradeRefreshUntil());
    };
    window.addEventListener(POST_TRADE_REFRESH_EVENT, onPostTradeRefresh);
    return () =>
      window.removeEventListener(POST_TRADE_REFRESH_EVENT, onPostTradeRefresh);
  }, []);
  const backfillActive = syncBackfillActive(statusQuery.data);
  const marketRefetchInterval = backfillActive
    ? BACKFILL_REFETCH_MS
    : NORMAL_GALLERY_REFETCH_MS;
  const statsQuery = useQuery({
    queryKey: ["market-stats", marketAddress],
    queryFn: getMarketStats,
    refetchInterval: marketRefetchInterval,
    refetchOnMount: "always",
    staleTime: 0,
  });
  const marketStatsPageEnteredAtRef = useRef(Date.now());
  const marketStatsFreshForPage = marketStatsAreFreshForPage({
    hasStats: statsQuery.data !== undefined,
    dataUpdatedAt: statsQuery.dataUpdatedAt,
    pageEnteredAt: marketStatsPageEnteredAtRef.current,
  });
  const columns = useResponsiveGalleryColumns();
  const { initialLimit, nextLimit } = getInfiniteBatchSizes(columns);
  const walletTabDisconnected = activeTab !== "all" && !address;
  const marketQueryEnabled = !walletTabDisconnected;
  const listingsOwnerScope = marketListingsOwnerScope(activeTab, address);
  const marketListingsQueryKey = [
    "market-listings",
    marketAddress,
    activeTab,
    listingsOwnerScope,
    sort,
    searchValue,
    columns,
  ] as const;
  const listingsQuery = useInfiniteQuery({
    queryKey: marketListingsQueryKey,
    initialPageParam: { offset: 0, limit: initialLimit },
    queryFn: ({ pageParam }) => {
      const { offset, limit } = pageParam as { offset: number; limit: number };
      const page = Math.floor(offset / limit);
      return listMarketListings(
        page,
        limit,
        activeTab,
        sort,
        activeTab === "all" ? undefined : address,
        offset,
        searchValue,
      );
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0);
      if (loaded >= lastPage.total) return undefined;
      return { offset: loaded, limit: nextLimit };
    },
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      if (!Array.isArray(previousKey) || previousKey[0] !== "market-listings") {
        return undefined;
      }
      const previousMarket = previousKey[1];
      const previousTab = previousKey[2];
      const previousOwner = previousKey[3];
      const previousSort = previousKey[4];
      const previousSearch = previousKey[5];
      const previousColumns = previousKey[6];
      if (
        (typeof previousMarket === "string" ? previousMarket : "") !==
        marketAddress
      ) {
        return undefined;
      }
      if (previousTab !== activeTab) {
        return undefined;
      }
      if (
        (typeof previousOwner === "string" ? previousOwner : "") !==
        listingsOwnerScope
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
    enabled: marketQueryEnabled,
    refetchInterval: marketRefetchInterval,
  });
  const getCachedReservedKittyIdsSnapshot = () => {
    if (!address || !marketAddress) {
      return new Set<number>();
    }
    return readCachedReservedKittyIds(queryClient, marketAddress, address);
  };
  const ownerSeedKitties = address
    ? readCachedOwnerKitties(queryClient, address)
    : [];
  const walletOwnerKittiesQuery = useWalletOwnerKitties({
    owner: (address as Address | undefined) ?? null,
    tokenAddress: tokenAddress ? (tokenAddress as Address) : null,
    chainId: targetChainId,
    publicClient: publicClient ?? null,
    connector,
    enabled: Boolean(address && listOpen && tokenAddress),
    seedKitties: ownerSeedKitties,
    readChainOwned: async () => {
      if (!address || !tokenAddress || !marketAddress) {
        throw new Error("MARKET owner query is missing address/token/market");
      }
      if (publicClient) {
        try {
          const verified = await readMarketWalletState({
            publicClient,
            owner: address,
            tokenAddress,
            marketAddress,
          });
          return {
            tokenAddress: verified.tokenAddress,
            ownerIds: verified.ownerIds,
            verified: true,
          };
        } catch (error) {
          console.warn(
            "MARKET owner IDs via public client failed; retrying via connected wallet.",
            error,
          );
        }
      }
      if (connector) {
        const verified = await readMarketWalletStateViaConnectedWallet({
          owner: address,
          tokenAddress,
          marketAddress,
          chainId: targetChainId,
          connector,
        });
        return {
          tokenAddress: verified.tokenAddress,
          ownerIds: verified.ownerIds,
          verified: true,
        };
      }
      throw new Error("MARKET owner IDs unavailable from chain verification");
    },
  });
  const walletOwnerKittiesCachedSnapshot =
    address && tokenAddress
      ? readWalletOwnerKittiesSnapshotFromCache({
          queryClient,
          chainId: targetChainId,
          tokenAddress: tokenAddress as Address,
          owner: address as Address,
        })
      : undefined;
  const reservedKittyIdsQueryEnabled = Boolean(
    address && listOpen && tokenAddress && marketAddress,
  );
  const reservedKittyIdsQuery = useQuery({
    queryKey: [
      "market-owner-reserved-kitty-ids",
      targetChainId,
      marketAddress,
      address ?? "",
    ],
    queryFn: async () => {
      if (!address || !tokenAddress || !marketAddress) {
        return new Set<number>();
      }
      const loadApiFallback = async () => {
        const apiReservedIds = await loadReservedKittyIdsFromApi(address);
        if (apiReservedIds.size > 0) {
          return apiReservedIds;
        }
        return getCachedReservedKittyIdsSnapshot();
      };
      try {
        if (publicClient) {
          const verifiedState = await readMarketWalletState({
            publicClient,
            owner: address,
            tokenAddress,
            marketAddress,
          });
          return verifiedState.reservedIds;
        }
      } catch (error) {
        console.warn(
          "MARKET reserved kPEG verification via public client failed; retrying via connected wallet.",
          error,
        );
      }
      if (connector) {
        try {
          const verifiedState = await readMarketWalletStateViaConnectedWallet({
            owner: address,
            tokenAddress,
            marketAddress,
            chainId: targetChainId,
            connector,
          });
          return verifiedState.reservedIds;
        } catch (error) {
          console.warn(
            "MARKET reserved kPEG verification via connected wallet failed; using API fallback.",
            error,
          );
        }
      }
      return loadApiFallback();
    },
    enabled: reservedKittyIdsQueryEnabled,
    refetchOnMount: true,
    staleTime: NORMAL_GALLERY_REFETCH_MS,
    refetchInterval: marketRefetchInterval,
  });
  const reservedKittyIdsReady =
    !reservedKittyIdsQueryEnabled || reservedKittyIdsQuery.isSuccess;
  const selectedKittyApprovalQueryKeyFor = useCallback(
    (kittyIds: readonly number[]) =>
      [
        "market-selected-kitty-approval",
        targetChainId,
        tokenAddress,
        marketAddress,
        address ?? "",
        kittyIds.join(","),
      ] as const,
    [address, marketAddress, targetChainId, tokenAddress],
  );
  const selectedKittyApprovalQueryKey =
    selectedKittyApprovalQueryKeyFor(debouncedSortedSelectedIds);
  const selectedKittyApprovalQuery = useQuery({
    queryKey: selectedKittyApprovalQueryKey,
    queryFn: async () => {
      if (
        !address ||
        !tokenAddress ||
        !marketAddress ||
        debouncedSortedSelectedIds.length === 0
      ) {
        return false;
      }
      try {
        if (publicClient) {
          return await readMarketSelectedKittyApproval({
            publicClient,
            owner: address,
            tokenAddress,
            marketAddress,
            kittyIds: debouncedSortedSelectedIds,
          });
        }
      } catch (error) {
        console.warn(
          "MARKET selected kitty approval check via public client failed; retrying via connected wallet.",
          error,
        );
      }
      if (connector) {
        try {
          return await readMarketSelectedKittyApprovalViaConnectedWallet({
            owner: address,
            tokenAddress,
            marketAddress,
            kittyIds: debouncedSortedSelectedIds,
            chainId: targetChainId,
            connector,
          });
        } catch (error) {
          console.warn(
            "MARKET selected kitty approval check via connected wallet failed.",
            error,
          );
        }
      }
      return false;
    },
    enabled: Boolean(
      address &&
      tokenAddress &&
      marketAddress &&
      listOpen &&
      debouncedSortedSelectedIds.length > 0
    ),
    staleTime: NORMAL_GALLERY_REFETCH_MS,
    refetchInterval: marketRefetchInterval,
  });
  const ownedKittiesQuery = walletOwnerKittiesQuery;
  const openedListingQuery = useQuery({
    queryKey: ["market-listing", marketAddress, openedTradeId],
    queryFn: () => getMarketListing(openedTradeId!),
    enabled: openedTradeId !== null,
    refetchInterval: backfillActive ? BACKFILL_REFETCH_MS : 20_000,
  });
  const ethBalanceQuery = useBalance({
    address,
    chainId: targetChainId,
    query: { enabled: Boolean(address), refetchInterval: 10_000 },
  });
  const marketModalOpen = listOpen || openedTradeId !== null;
  useBodyDataFlag("tierMetalModalOpen", openedTradeId !== null);

  useEffect(() => {
    if (!marketModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [marketModalOpen]);

  const feeBps = openedListingQuery.data?.feeBps ?? 200;
  const { selectedApproved: selectedKittyApproved, approvalChecking } =
    deriveSelectedKittyApprovalState({
      sortedSelectedIds,
      debouncedSortedSelectedIds,
      queryApproved: selectedKittyApprovalQuery.data,
      queryLoading: selectedKittyApprovalQuery.isLoading,
      queryFetching: selectedKittyApprovalQuery.isFetching,
    });
  const requestWalletConnection = async () => {
    ensureWagmiConnectorCompatibility();
    if (reownEnabled) {
      await openWalletModal("Connect");
      return;
    }
    if (primaryConnector) {
      connect({ connector: primaryConnector });
    }
  };
  const openListModal = async () => {
    if (!address) {
      await requestWalletConnection();
      return;
    }
    if (listCloseTimer.current !== null) {
      window.clearTimeout(listCloseTimer.current);
      listCloseTimer.current = null;
    }
    setListOpen(true);
    setListClosing(false);
    setListVisible(false);
    setListModalAction("idle");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setListVisible(true));
    });
  };
  const closeListModal = () => {
    if (!listOpen || listClosing) return;
    setListClosing(true);
    setListVisible(false);
    listCloseTimer.current = window.setTimeout(() => {
      setListOpen(false);
      setListClosing(false);
      setSelectedIds([]);
      setPriceInput("");
      setListModalAction("idle");
      listCloseTimer.current = null;
    }, LIST_MODAL_TRANSITION_MS);
  };
  const openDetailModal = (tradeId: number, focusPrice = false) => {
    if (detailCloseTimer.current !== null) {
      window.clearTimeout(detailCloseTimer.current);
      detailCloseTimer.current = null;
    }
    setFocusUpdateTradeId(focusPrice ? tradeId : null);
    setOpenedTradeId(tradeId);
    setDetailClosing(false);
    setDetailVisible(false);
  };
  const closeDetailModal = () => {
    if (openedTradeId === null || detailClosing) return;
    setDetailClosing(true);
    setDetailVisible(false);
    detailCloseTimer.current = window.setTimeout(() => {
      setOpenedTradeId(null);
      setFocusUpdateTradeId(null);
      setDetailClosing(false);
      detailCloseTimer.current = null;
    }, LIST_MODAL_TRANSITION_MS);
  };

  useEffect(() => {
    return () => {
      if (listCloseTimer.current !== null) {
        window.clearTimeout(listCloseTimer.current);
      }
      if (detailCloseTimer.current !== null) {
        window.clearTimeout(detailCloseTimer.current);
      }
      optimisticTimers.current.forEach((timer) => window.clearTimeout(timer));
      optimisticTimers.current = [];
    };
  }, []);

  const reloadPersistentOptimisticListings = useCallback(() => {
    const nextEntries = readOptimisticMarketListings(optimisticMarketScope).map(
      (listing) => [listing.tradeId, listing as MarketListingView] as const,
    );
    setPersistentOptimisticListings(Object.fromEntries(nextEntries));
  }, [optimisticMarketScope]);

  useEffect(() => {
    reloadPersistentOptimisticListings();
    const onChanged = () => reloadPersistentOptimisticListings();
    const onStorage = () => reloadPersistentOptimisticListings();
    window.addEventListener(OPTIMISTIC_MARKET_LISTINGS_EVENT, onChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(OPTIMISTIC_MARKET_LISTINGS_EVENT, onChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [reloadPersistentOptimisticListings]);

  useEffect(() => {
    const nextExpiryAt = nextOptimisticMarketListingsExpiryAt(
      optimisticMarketScope,
    );
    if (!nextExpiryAt) {
      return;
    }
    const timer = window.setTimeout(
      () => reloadPersistentOptimisticListings(),
      Math.max(0, nextExpiryAt - Date.now() + 25),
    );
    return () => window.clearTimeout(timer);
  }, [
    optimisticMarketScope,
    persistentOptimisticListings,
    reloadPersistentOptimisticListings,
  ]);

  const persistOptimisticMarketListing = (
    listing: MarketListing,
    txHash: `0x${string}`,
    blockNumber: number,
  ) => {
    upsertOptimisticMarketListing(optimisticMarketScope, {
      ...listing,
      txHash,
      blockNumber,
    });
  };

  const persistOptimisticOwnerTransfer = (input: {
    txHash: `0x${string}`;
    blockNumber: number;
    from: string;
    to: string;
    kittyIds: number[];
    kitties: KittyItem[];
    reason: "LISTING_FUNDED" | "LISTING_CANCELED" | "LISTING_BOUGHT";
  }) => {
    appendOptimisticOwnerTransfer(optimisticOwnerTransfersScope, {
      txHash: input.txHash,
      blockNumber: input.blockNumber,
      from: input.from,
      to: input.to,
      kittyIds: input.kittyIds,
      kitties: input.kitties,
      reason: input.reason,
    });
  };

  const syncAndRefreshMarketAction = async (
    txHash: `0x${string}`,
    action: MarketTxRefreshAction,
  ) => {
    await syncMarketQueriesForAction({
      txHash,
      action,
      enqueueSync: enqueueTxSync,
      markPostTradeRefreshFn: markPostTradeRefresh,
    });
  };
  const restoreListingOverride = (
    tradeId: number,
    previous: MarketListingView | undefined,
  ) => {
    setOptimisticListings((current) => {
      if (previous) {
        return { ...current, [tradeId]: previous };
      }
      const { [tradeId]: _removed, ...rest } = current;
      void _removed;
      return rest;
    });
  };
  const setLocalListingPhase = (
    listing: MarketListing,
    phase: MarketListingPhase,
    patch: Partial<MarketListing> = {},
  ) => {
    setOptimisticListings((current) => {
      const base = (current[listing.tradeId] ?? listing) as MarketListingView;
      return {
        ...current,
        [listing.tradeId]: {
          ...base,
          ...patch,
          optimisticPhase: phase,
          optimisticLabelId: displayListingId(base),
          updatedAt: Date.now(),
        },
      };
    });
  };
  const settleLocalListingPhase = (
    tradeId: number,
    patch: Partial<MarketListing> = {},
  ) => {
    setOptimisticListings((current) => {
      const listing = current[tradeId];
      if (!listing) return current;
      return {
        ...current,
        [tradeId]: {
          ...withoutMarketListingPhase(listing),
          ...patch,
          updatedAt: Date.now(),
        },
      };
    });
  };
  const setListingAction = (
    tradeId: number,
    action: ListingAction | null,
  ) => {
    setListingActions((current) => {
      if (action === null) {
        if (!(tradeId in current)) return current;
        const { [tradeId]: _removed, ...rest } = current;
        void _removed;
        return rest;
      }
      if (current[tradeId] === action) {
        return current;
      }
      return {
        ...current,
        [tradeId]: action,
      };
    });
  };
  const listingActionBusy = (tradeId: number): boolean =>
    listingActions[tradeId] !== undefined;

  const readSelectedApprovalForIds = async (
    kittyIds: number[],
  ): Promise<boolean> => {
    if (!address || !tokenAddress || !marketAddress || kittyIds.length === 0) {
      return false;
    }
    return readSelectedApprovalForIdsWithFallback({
      kittyIds,
      ...(publicClient
        ? {
            readViaPublicClient: () =>
              readMarketSelectedKittyApproval({
                publicClient,
                owner: address,
                tokenAddress,
                marketAddress,
                kittyIds,
              }),
            onPublicClientFailure: (error: unknown) => {
              console.warn(
                "MARKET selected kitty approval check via public client failed; retrying via connected wallet.",
                error,
              );
            },
          }
        : {}),
      ...(connector
        ? {
            readViaConnectedWallet: () =>
              readMarketSelectedKittyApprovalViaConnectedWallet({
                owner: address,
                tokenAddress,
                marketAddress,
                kittyIds,
                chainId: targetChainId,
                connector,
              }),
            onConnectedWalletFailure: (error: unknown) => {
              console.warn(
                "MARKET selected kitty approval check via connected wallet failed.",
                error,
              );
            },
          }
        : {}),
    });
  };

  const approveSelectedKitties = async (
    kittyIds: number[],
  ): Promise<"approved" | "pending"> => {
    if (!address || !tokenAddress || !marketAddress || !publicClient) {
      throw new Error("Wallet is not ready for approval.");
    }
    if (kittyIds.length === 0) {
      return "approved";
    }
    const hash = await writeWithCompatibility({
      address: tokenAddress,
      abi: KPEG_TOKEN_ABI,
      functionName: "setKittyTransferApproval",
      args: [marketAddress, kittyIds.map(BigInt), true],
      chainId: targetChainId,
    });
    const outcome = await waitForMarketTxOutcome<boolean>({
      hash,
      publicClient,
      raceReadBack: true,
      readBackPollIntervalMs: 2_000,
      readBack: async (_ctx) => {
        try {
          const approved = publicClient
            ? await readMarketSelectedKittyApproval({
                publicClient,
                owner: address,
                tokenAddress,
                marketAddress,
                kittyIds,
              })
            : false;
          return approved ? true : null;
        } catch {
          return null;
        }
      },
      ...(connector
        ? {
            readBackViaConnectedWallet: async (_ctx: MarketReadBackContext) => {
              try {
                const approved =
                  await readMarketSelectedKittyApprovalViaConnectedWallet({
                    owner: address,
                    tokenAddress,
                    marketAddress,
                    kittyIds,
                    chainId: targetChainId,
                    connector,
                  });
                return approved ? true : null;
              } catch {
                return null;
              }
            },
          }
        : {}),
    });
    if (outcome.status === "success") {
      queryClient.setQueryData(selectedKittyApprovalQueryKeyFor(kittyIds), true);
      void queryClient.invalidateQueries({
        queryKey: selectedKittyApprovalQueryKeyFor(kittyIds),
      });
      return "approved";
    }
    if (outcome.status === "reverted") {
      throw outcome.error;
    }
    return "pending";
  };

  const submitListing = async () => {
    if (!address || !marketAddress || !tokenAddress || !publicClient) {
      return;
    }
    const kittyIds = [...selectedIds].sort((a, b) => a - b);
    if (kittyIds.length === 0 || kittyIds.length > MAX_MARKET_BUNDLE_SIZE) {
      return;
    }
    const priceValidation = validateListingPriceInput(priceInput);
    if (priceValidation.error || !priceValidation.priceWei) {
      pushToast({
        kind: "error",
        title: "Listing Failed",
        message: priceValidation.error ?? LISTING_PRICE_INVALID_ERROR,
      });
      return;
    }

    const priceWei = priceValidation.priceWei;
    let temporaryTradeId: number | null = null;
    let approvalStepActive = false;
    try {
      const approvalOutcome = await runListingApprovalStep({
        kittyIds,
        readSelectedApprovalForIds,
        approveSelectedKitties,
        onApprovalRequired: () => {
          approvalStepActive = true;
          setListModalAction("approving");
        },
      });
      if (approvalOutcome === "pending") {
        pushToast({
          kind: "info",
          title: "Approval Pending",
          message:
            "Approval is pending confirmation. You can retry listing shortly.",
        });
        return;
      }
      approvalStepActive = false;
      setListModalAction("listing");
      const selectedKitties = ownedKitties
        .filter((candidate) => kittyIds.includes(candidate.id))
        .flatMap((candidate) => (candidate.kitty ? [candidate.kitty] : []));

      await verifyMarketListingSelection({
        selectedIds: kittyIds,
        verifyWithPublicClient: () =>
          readMarketWalletState({
            publicClient,
            owner: address,
            tokenAddress,
            marketAddress,
          }),
        verifyWithConnectedWallet: connector
          ? () =>
              readMarketWalletStateViaConnectedWallet({
                owner: address,
                tokenAddress,
                marketAddress,
                chainId: targetChainId,
                connector,
              })
          : undefined,
        onPublicClientFailure: (error) => {
          console.warn(
            "MARKET submit verification via public client failed; retrying via connected wallet.",
            error,
          );
        },
        onConnectedWalletFailure: (error) => {
          console.warn(
            "MARKET submit verification via connected wallet also failed.",
            error,
          );
        },
      });

      const listingHash = await writeWithCompatibility({
        address: marketAddress,
        abi: KPEG_MARKET_ABI,
        functionName: "createTradeAndFund",
        args: [zeroAddress, priceWei, kittyIds.map(BigInt)],
        chainId: targetChainId,
      });

      temporaryTradeId = -Date.now();
      setActiveTab("my-listings");
      setSearchInput("");
      setSort("latest");
      setOptimisticListings((current) => ({
        ...current,
        [temporaryTradeId!]: makeOptimisticListing({
          tradeId: temporaryTradeId!,
          escrowAddress: marketAddress,
          seller: address,
          priceWei: priceWei.toString(),
          kittyIds,
          kitties: selectedKitties,
          createdBlock: 0,
          createdTxHash: listingHash,
          feeBps,
          phase: "listing",
        }),
      }));
      persistOptimisticOwnerTransfer({
        txHash: listingHash,
        blockNumber: 0,
        from: address,
        to: marketAddress,
        kittyIds,
        kitties: selectedKitties,
        reason: "LISTING_FUNDED",
      });
      void queryClient.invalidateQueries({
        queryKey: ["wallet-owner-kitties"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["market-owner-reserved-kitty-ids"],
      });
      closeListModal();
      setListModalAction("idle");
      pushToast({
        kind: "success",
        title: "Listing Submitted",
        message: "Waiting for onchain confirmation.",
      });
      void syncAndRefreshMarketAction(listingHash, "list");

      void (async () => {
        try {
          const outcome = await waitForMarketTxOutcome<{
            tradeId: number;
            escrowAddress: Address;
            createdBlock: number;
          }>({
            hash: listingHash,
            publicClient,
            readBack: async (ctx) => {
              return resolveListingReadBack({
                ctx,
                seller: address,
                kittyIds,
                priceWei,
                readFromReceipt: async () => {
                  if (ctx.receiptBlock === null) {
                    return null;
                  }
                  const receipt = (await publicClient.getTransactionReceipt({
                    hash: listingHash,
                  })) as MarketListingFlowReceipt;
                  const decoded = decodePositionCreatedFromReceipt(receipt);
                  return {
                    tradeId: decoded.tradeId,
                    escrowAddress: decoded.escrowAddress,
                    createdBlock: Number(receipt.blockNumber),
                  };
                },
                readFromApi: () =>
                  findListingFromApiByCreatedTxHash({
                    owner: address,
                    txHash: listingHash,
                    listMyListingsPage: (offset, pageSize) =>
                      listMarketListings(
                        Math.floor(offset / pageSize),
                        pageSize,
                        "my-listings",
                        "latest",
                        address,
                        offset,
                      ),
                  }),
                readFromChain: () =>
                  findOwnerOpenListingMatchByChain({
                    publicClient,
                    marketAddress,
                    owner: address,
                    kittyIds,
                    priceWei,
                  }),
              });
            },
            ...(connector
              ? {
                  readBackViaConnectedWallet: async (ctx: MarketReadBackContext) => {
                    const readContract =
                      await getMarketReadBackDelegateViaConnectedWallet({
                        chainId: targetChainId,
                        owner: address,
                        connector,
                      });
                    return resolveListingReadBack({
                      ctx,
                      seller: address,
                      kittyIds,
                      priceWei,
                      readFromReceipt: async () => null,
                      readFromApi: async () => null,
                      readFromChain: () =>
                        findOwnerOpenListingMatchByChainViaConnectedWalletWithDelegate(
                          {
                            marketAddress,
                            owner: address,
                            kittyIds,
                            priceWei,
                            readContract,
                          },
                        ),
                    });
                  },
                }
              : {}),
          });

          if (outcome.status === "reverted") {
            throw outcome.error;
          }
          if (outcome.status === "pending") {
            void selectedKittyApprovalQuery.refetch();
            return;
          }

          const { tradeId, escrowAddress, createdBlock } = outcome.value;
          const listedAt = Date.now();
          const listedListing: MarketListing = {
            tradeId,
            escrowAddress,
            seller: address,
            buyer: null,
            paymentToken: zeroAddress,
            priceWei: priceWei.toString(),
            feeBps,
            kittyIds,
            kittyCount: kittyIds.length,
            status: "OPEN",
            createdBlock,
            createdTxHash: listingHash,
            createdAt: listedAt,
            updatedAt: listedAt,
            closedBlock: null,
            closedTxHash: null,
            closedAt: null,
            kitties: selectedKitties,
          };
          setOptimisticListings((current) => {
            const tempTradeId = temporaryTradeId;
            const temporary = tempTradeId === null ? undefined : current[tempTradeId];
            if (tempTradeId !== null && temporary) {
              const { [tempTradeId]: _removed, ...rest } = current;
              void _removed;
              return {
                ...rest,
                [tradeId]: {
                  ...temporary,
                  ...listedListing,
                  optimisticPhase: "listed",
                  optimisticLabelId: displayListingId(temporary),
                },
              };
            }
            return {
              ...current,
              [tradeId]: {
                ...listedListing,
                optimisticPhase: "listed",
                optimisticLabelId:
                  selectedKitties[0]?.id ?? kittyIds[0] ?? tradeId,
              },
            };
          });
          persistOptimisticMarketListing(
            listedListing,
            listingHash,
            createdBlock,
          );
          persistOptimisticOwnerTransfer({
            txHash: listingHash,
            blockNumber: createdBlock,
            from: address,
            to: escrowAddress,
            kittyIds,
            kitties: selectedKitties,
            reason: "LISTING_FUNDED",
          });
          const settleTimer = window.setTimeout(() => {
            settleLocalListingPhase(tradeId, listedListing);
          }, 2000);
          optimisticTimers.current.push(settleTimer);
          pushToast({
            kind: "success",
            title: "Listing Confirmed",
            message: "Selected kPEGs are escrowed for sale.",
          });
          void syncAndRefreshMarketAction(listingHash, "list");
          void selectedKittyApprovalQuery.refetch();
        } catch (error) {
          if (temporaryTradeId !== null) {
            const tempTradeId = temporaryTradeId;
            setOptimisticListings((current) => {
              const { [tempTradeId]: _removed, ...rest } = current;
              void _removed;
              return rest;
            });
          }
          clearOptimisticOwnerTransfers(optimisticOwnerTransfersScope, [
            listingHash,
          ]);
          pushToast({
            kind: "error",
            title: "Listing Failed",
            message: (error as Error).message,
          });
          void ownedKittiesQuery.refetch();
          void reservedKittyIdsQuery.refetch();
          void selectedKittyApprovalQuery.refetch();
        }
      })();
    } catch (error) {
      if (
        isTerminalSelectionError(error) ||
        (error instanceof Error &&
          error.message === LISTING_SELECTION_VERIFY_FAILED_ERROR)
      ) {
        void ownedKittiesQuery.refetch();
        void reservedKittyIdsQuery.refetch();
      }
      if (temporaryTradeId !== null) {
        const tempTradeId = temporaryTradeId;
        setOptimisticListings((current) => {
          const { [tempTradeId]: _removed, ...rest } = current;
          void _removed;
          return rest;
        });
      }
      pushToast({
        kind: "error",
        title: approvalStepActive ? "Approval Failed" : "Listing Failed",
        message: (error as Error).message,
      });
    } finally {
      setListModalAction("idle");
    }
  };

  const buyListing = async (listing: MarketListing) => {
    if (!address) {
      await requestWalletConnection();
      return;
    }
    if (!marketAddress || !publicClient || !tokenAddress) return;
    if (listingActionBusy(listing.tradeId)) return;

    const previousOverride = optimisticListings[listing.tradeId];
    let hash: `0x${string}` | null = null;
    let buyVerified = false;
    try {
      hash = await executeMarketBuySubmitFlow({
        listing,
        marketAddress,
        chainId: targetChainId,
        verifyListing: async () => {
          try {
            await verifyMarketBuyListing({
              listing,
              readChainPosition: () =>
                readMarketPositionViewViaPublicClient({
                  publicClient,
                  marketAddress,
                  tradeId: BigInt(listing.tradeId),
                }),
            });
          } catch (publicClientError) {
            if (!(connector && address)) {
              throw publicClientError;
            }
            const readContract =
              await getMarketReadBackDelegateViaConnectedWallet({
                chainId: targetChainId,
                owner: address,
                connector,
              });
            await verifyMarketBuyListing({
              listing,
              readChainPosition: () =>
                readMarketPositionViewViaConnectedWalletWithDelegate({
                  marketAddress,
                  tradeId: BigInt(listing.tradeId),
                  readContract,
                }),
            });
          }
        },
        onVerificationPassed: () => {
          buyVerified = true;
          setListingAction(listing.tradeId, "buying");
        },
        writeContract: (request) => writeWithCompatibility(request),
      });
    } catch (error) {
      if (!buyVerified) {
        restoreListingOverride(listing.tradeId, undefined);
        void queryClient.invalidateQueries({
          queryKey: ["market-listings", marketAddress],
        });
        void queryClient.invalidateQueries({
          queryKey: ["market-listing", marketAddress, listing.tradeId],
        });
        pushToast({
          kind: "error",
          title: "Listing Changed",
          message: "This listing changed on-chain. Refreshing market data.",
        });
        const typedError = error as Error;
        if (
          typedError.message !== MARKET_BUY_LISTING_CHANGED_ERROR &&
          typedError.message !== MARKET_BUY_LISTING_VERIFY_FAILED_ERROR
        ) {
          console.warn(
            "MARKET buy verification failed unexpectedly before wallet prompt.",
            typedError,
          );
        }
        return;
      }
      if (
        shouldClearBuyListingActionAfterError({
          buyVerified,
          hash,
        })
      ) {
        setListingAction(listing.tradeId, null);
      }
      restoreListingOverride(listing.tradeId, previousOverride);
      pushToast({
        kind: "error",
        title: "Purchase Failed",
        message: (error as Error).message,
      });
      return;
    }

    try {
      closeDetailModal();
      setActiveTab("bought");
      setSearchInput("");
      setSort("latest");
      setLocalListingPhase(listing, "buying", {
        buyer: address,
        status: "SOLD",
        closedTxHash: hash,
      });
      persistOptimisticOwnerTransfer({
        txHash: hash,
        blockNumber: 0,
        from: listing.escrowAddress,
        to: address,
        kittyIds: [...listing.kittyIds],
        kitties: listing.kitties,
        reason: "LISTING_BOUGHT",
      });
      setListingAction(listing.tradeId, null);
      pushToast({
        kind: "success",
        title: "Purchase Submitted",
        message: "Waiting for onchain confirmation.",
      });
      void syncAndRefreshMarketAction(hash, "buy-listing");
      void (async () => {
        try {
          const outcome = await waitForMarketTxOutcome<{
            blockNumber: number;
          }>({
            hash,
            publicClient,
            readBack: async (_ctx) => {
              return resolveBuyReadBack({
                readChainPosition: () =>
                  readMarketPositionViewViaPublicClient({
                    publicClient,
                    marketAddress,
                    tradeId: BigInt(listing.tradeId),
                  }),
                readIndexedListing: () => getMarketListingOrNull(listing.tradeId),
                verifyOwnership: async () => {
                  const walletState = await readMarketWalletState({
                    publicClient,
                    owner: address,
                    tokenAddress,
                    marketAddress,
                  });
                  return listing.kittyIds.every((kittyId) =>
                    walletState.ownerIds.has(kittyId),
                  );
                },
              });
            },
            ...(connector
              ? {
                  readBackViaConnectedWallet: async (_ctx: MarketReadBackContext) => {
                    const readContract =
                      await getMarketReadBackDelegateViaConnectedWallet({
                        chainId: targetChainId,
                        owner: address,
                        connector,
                      });
                    return resolveBuyReadBack({
                      readChainPosition: () =>
                        readMarketPositionViewViaConnectedWalletWithDelegate({
                          marketAddress,
                          tradeId: BigInt(listing.tradeId),
                          readContract,
                        }),
                      readIndexedListing: async () => null,
                      verifyOwnership: async () => {
                        const walletState =
                          await readMarketWalletStateViaConnectedWallet({
                            owner: address,
                            tokenAddress,
                            marketAddress,
                            chainId: targetChainId,
                            connector,
                          });
                        return listing.kittyIds.every((kittyId) =>
                          walletState.ownerIds.has(kittyId),
                        );
                      },
                    });
                  },
                }
              : {}),
          });
          if (outcome.status === "reverted") {
            throw outcome.error;
          }
          if (outcome.status === "pending") {
            return;
          }
          const soldAt = Date.now();
          const soldListing: MarketListing = {
            ...listing,
            buyer: address,
            status: "SOLD",
            closedTxHash: hash,
            closedAt: soldAt,
            updatedAt: soldAt,
          };
          setLocalListingPhase(listing, "bought", {
            buyer: soldListing.buyer,
            status: soldListing.status,
            closedTxHash: soldListing.closedTxHash,
            closedAt: soldListing.closedAt,
          });
          const settledBlock =
            outcome.receiptBlock > 0
              ? outcome.receiptBlock
              : outcome.value.blockNumber;
          persistOptimisticMarketListing(soldListing, hash, settledBlock);
          persistOptimisticOwnerTransfer({
            txHash: hash,
            blockNumber: settledBlock,
            from: listing.escrowAddress,
            to: address,
            kittyIds: [...listing.kittyIds],
            kitties: listing.kitties,
            reason: "LISTING_BOUGHT",
          });
          upsertWalletOwnerKittiesOwnedIds({
            queryClient,
            chainId: targetChainId,
            tokenAddress: tokenAddress as Address,
            owner: address as Address,
            ownerIds: listing.kittyIds,
            kitties: listing.kitties.map((kitty) => ({
              ...kitty,
              owner: address.toLowerCase(),
            })),
            verified: true,
          });
          void queryClient.invalidateQueries({
            queryKey: ["owner-summary", address],
          });
          void queryClient.invalidateQueries({
            queryKey: ["gallery", "collections", address],
          });
          void queryClient.invalidateQueries({
            queryKey: ["wallet-owner-kitties"],
          });
          const settleTimer = window.setTimeout(() => {
            settleLocalListingPhase(listing.tradeId, {
              buyer: soldListing.buyer,
              status: soldListing.status,
              closedTxHash: soldListing.closedTxHash,
            });
          }, 2000);
          optimisticTimers.current.push(settleTimer);
          void syncAndRefreshMarketAction(hash, "buy-listing");
          void ownedKittiesQuery.refetch();
          pushToast({
            kind: "success",
            title: "Purchase Confirmed",
            message: "The market moved the kPEGs to your wallet",
          });
        } catch (error) {
          restoreListingOverride(listing.tradeId, previousOverride);
          clearOptimisticOwnerTransfers(optimisticOwnerTransfersScope, [hash]);
          pushToast({
            kind: "error",
            title: "Purchase Failed",
            message: (error as Error).message,
          });
        }
      })();
    } catch (error) {
      try {
        restoreListingOverride(listing.tradeId, previousOverride);
        if (hash) {
          clearOptimisticOwnerTransfers(optimisticOwnerTransfersScope, [hash]);
        }
        pushToast({
          kind: "error",
          title: "Purchase Failed",
          message: (error as Error).message,
        });
      } finally {
        setListingAction(listing.tradeId, null);
      }
    }
  };

  const cancelListing = async (listing: MarketListing) => {
    if (!marketAddress || !publicClient) return;
    if (listingActionBusy(listing.tradeId)) return;
    setListingAction(listing.tradeId, "canceling");
    const previousOverride = optimisticListings[listing.tradeId];
    let hash: `0x${string}` | null = null;
    try {
      hash = await writeWithCompatibility({
        address: marketAddress,
        abi: KPEG_MARKET_ABI,
        functionName: "deletePosition",
        args: [BigInt(listing.tradeId)],
        chainId: targetChainId,
      });
      closeDetailModal();
      setLocalListingPhase(listing, "canceling", {
        status: "DELETED",
        closedTxHash: hash,
      });
      persistOptimisticOwnerTransfer({
        txHash: hash,
        blockNumber: 0,
        from: listing.escrowAddress,
        to: listing.seller,
        kittyIds: [...listing.kittyIds],
        kitties: listing.kitties,
        reason: "LISTING_CANCELED",
      });
      void queryClient.invalidateQueries({
        queryKey: ["wallet-owner-kitties"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["market-owner-reserved-kitty-ids"],
      });
      setListingAction(listing.tradeId, null);
      pushToast({
        kind: "success",
        title: "Cancel Submitted",
        message: "Waiting for onchain confirmation.",
      });
      void syncAndRefreshMarketAction(hash, "cancel-listing");
      void (async () => {
        try {
          const outcome = await waitForMarketTxOutcome<{
            blockNumber: number;
          }>({
            hash,
            publicClient,
            readBack: async (ctx) => {
              return resolveCancelReadBack({
                ctx,
                latestIndexedBlock: statusQuery.data?.latestIndexedBlock,
                readChainPosition: () =>
                  readMarketPositionViewViaPublicClient({
                    publicClient,
                    marketAddress,
                    tradeId: BigInt(listing.tradeId),
                  }),
                readIndexedListing: () => getMarketListingOrNull(listing.tradeId),
              });
            },
            ...(connector && address
              ? {
                  readBackViaConnectedWallet: async (ctx: MarketReadBackContext) => {
                    const readContract =
                      await getMarketReadBackDelegateViaConnectedWallet({
                        chainId: targetChainId,
                        owner: address,
                        connector,
                      });
                    return resolveCancelReadBack({
                      ctx,
                      latestIndexedBlock: statusQuery.data?.latestIndexedBlock,
                      readChainPosition: () =>
                        readMarketPositionViewViaConnectedWalletWithDelegate({
                          marketAddress,
                          tradeId: BigInt(listing.tradeId),
                          readContract,
                        }),
                      readIndexedListing: async () => null,
                    });
                  },
                }
              : {}),
          });
          if (outcome.status === "reverted") {
            throw outcome.error;
          }
          if (outcome.status === "pending") {
            return;
          }
          const canceledAt = Date.now();
          const canceledListing: MarketListing = {
            ...listing,
            status: "DELETED",
            closedTxHash: hash,
            closedAt: canceledAt,
            updatedAt: canceledAt,
          };
          setLocalListingPhase(listing, "canceled", {
            status: canceledListing.status,
            closedTxHash: canceledListing.closedTxHash,
            closedAt: canceledListing.closedAt,
          });
          const settledBlock =
            outcome.receiptBlock > 0
              ? outcome.receiptBlock
              : outcome.value.blockNumber;
          persistOptimisticMarketListing(canceledListing, hash, settledBlock);
          persistOptimisticOwnerTransfer({
            txHash: hash,
            blockNumber: settledBlock,
            from: listing.escrowAddress,
            to: listing.seller,
            kittyIds: [...listing.kittyIds],
            kitties: listing.kitties,
            reason: "LISTING_CANCELED",
          });
          void queryClient.invalidateQueries({
            queryKey: ["wallet-owner-kitties"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["market-owner-reserved-kitty-ids"],
          });
          const settleTimer = window.setTimeout(() => {
            settleLocalListingPhase(listing.tradeId, {
              status: canceledListing.status,
            });
          }, 2000);
          optimisticTimers.current.push(settleTimer);
          void syncAndRefreshMarketAction(hash, "cancel-listing");
          void ownedKittiesQuery.refetch();
          pushToast({
            kind: "success",
            title: "Listing Canceled",
            message: "Escrowed kPEGs returned to your wallet",
          });
        } catch (error) {
          restoreListingOverride(listing.tradeId, previousOverride);
          clearOptimisticOwnerTransfers(optimisticOwnerTransfersScope, [hash]);
          pushToast({
            kind: "error",
            title: "Cancel Failed",
            message: (error as Error).message,
          });
        }
      })();
    } catch (error) {
      restoreListingOverride(listing.tradeId, previousOverride);
      if (hash) {
        clearOptimisticOwnerTransfers(optimisticOwnerTransfersScope, [hash]);
      }
      pushToast({
        kind: "error",
        title: "Cancel Failed",
        message: (error as Error).message,
      });
    } finally {
      setListingAction(listing.tradeId, null);
    }
  };

  const updateListingPrice = async (listing: MarketListing, value: string) => {
    if (!marketAddress || !publicClient || !value) return;
    if (listingActionBusy(listing.tradeId)) return;
    const priceValidation = validateListingPriceInput(value);
    if (priceValidation.error || !priceValidation.priceWei) {
      pushToast({
        kind: "error",
        title: "Price Update Failed",
        message: priceValidation.error ?? LISTING_PRICE_INVALID_ERROR,
      });
      return;
    }
    setListingAction(listing.tradeId, "updating");
    const previousOverride = optimisticListings[listing.tradeId];
    let hash: `0x${string}` | null = null;
    try {
      const priceWei = priceValidation.priceWei;
      hash = await writeWithCompatibility({
        address: marketAddress,
        abi: KPEG_MARKET_ABI,
        functionName: "setPositionParams",
        args: [BigInt(listing.tradeId), zeroAddress, priceWei],
        chainId: targetChainId,
      });
      closeDetailModal();
      setLocalListingPhase(listing, "updating", {
        priceWei: priceWei.toString(),
      });
      setListingAction(listing.tradeId, null);
      pushToast({
        kind: "success",
        title: "Price Update Submitted",
        message: "Waiting for onchain confirmation.",
      });
      void syncAndRefreshMarketAction(hash, "update-price");
      void (async () => {
        try {
          const outcome = await waitForMarketTxOutcome<{
            blockNumber: number;
          }>({
            hash,
            publicClient,
            readBack: async (_ctx) => {
              return resolveUpdateReadBack({
                expectedPriceWei: priceWei,
                readChainPosition: () =>
                  readMarketPositionViewViaPublicClient({
                    publicClient,
                    marketAddress,
                    tradeId: BigInt(listing.tradeId),
                  }),
                readIndexedListing: () => getMarketListingOrNull(listing.tradeId),
              });
            },
            ...(connector && address
              ? {
                  readBackViaConnectedWallet: async (_ctx: MarketReadBackContext) => {
                    const readContract =
                      await getMarketReadBackDelegateViaConnectedWallet({
                        chainId: targetChainId,
                        owner: address,
                        connector,
                      });
                    return resolveUpdateReadBack({
                      expectedPriceWei: priceWei,
                      readChainPosition: () =>
                        readMarketPositionViewViaConnectedWalletWithDelegate({
                          marketAddress,
                          tradeId: BigInt(listing.tradeId),
                          readContract,
                        }),
                      readIndexedListing: async () => null,
                    });
                  },
                }
              : {}),
          });
          if (outcome.status === "reverted") {
            throw outcome.error;
          }
          if (outcome.status === "pending") {
            return;
          }
          const updatedAt = Date.now();
          const priceUpdatedListing: MarketListing = {
            ...listing,
            priceWei: priceWei.toString(),
            updatedAt,
          };
          setLocalListingPhase(listing, "updated", {
            priceWei: priceUpdatedListing.priceWei,
          });
          const settledBlock =
            outcome.receiptBlock > 0
              ? outcome.receiptBlock
              : outcome.value.blockNumber;
          persistOptimisticMarketListing(
            priceUpdatedListing,
            hash,
            settledBlock,
          );
          const settleTimer = window.setTimeout(() => {
            settleLocalListingPhase(listing.tradeId, {
              priceWei: priceUpdatedListing.priceWei,
            });
          }, 2000);
          optimisticTimers.current.push(settleTimer);
          void syncAndRefreshMarketAction(hash, "update-price");
          pushToast({
            kind: "success",
            title: "Price Updated",
            message: "Listing price changed onchain",
          });
        } catch (error) {
          restoreListingOverride(listing.tradeId, previousOverride);
          pushToast({
            kind: "error",
            title: "Price Update Failed",
            message: (error as Error).message,
          });
        }
      })();
    } catch (error) {
      restoreListingOverride(listing.tradeId, previousOverride);
      pushToast({
        kind: "error",
        title: "Price Update Failed",
        message: (error as Error).message,
      });
    } finally {
      setListingAction(listing.tradeId, null);
    }
  };

  const copyValue = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(
      () => setCopied((current) => (current === key ? null : current)),
      3000,
    );
  };
  const openPortfolio = (targetAddress: string) => {
    closeDetailModal();
    navigate(`/portfolio/${targetAddress}`);
  };
  const openKittyDetail = (kittyId: number) => {
    closeDetailModal();
    navigate(`/kpeg/${kittyId}`, {
      state: {
        detailModal: true,
        detailOrigin: "explore",
        backgroundLocation: location,
      },
    });
  };

  const serverListings = useMemo(
    () => listingsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [listingsQuery.data],
  );
  useEffect(() => {
    setOptimisticListings((current) =>
      reconcileTemporaryListingsByCreatedTxHash(current, serverListings),
    );
  }, [serverListings]);
  useEffect(() => {
    if (searchValue.trim()) {
      return;
    }
    const latestIndexedBlock = statusQuery.data?.latestIndexedBlock ?? 0;
    if (latestIndexedBlock <= 0) {
      return;
    }
    const storedItems = readOptimisticMarketListings(optimisticMarketScope);
    const candidates = storedItems.filter(
      (item) =>
        Number.isFinite(item.blockNumber) &&
        item.blockNumber > 0 &&
        item.blockNumber <= latestIndexedBlock,
    );
    if (candidates.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const detailByTradeId = new Map<number, MarketListing | null | undefined>(
        await Promise.all(
          [...new Set(candidates.map((item) => item.tradeId))].map(
            async (tradeId) => {
              try {
                const listing = await getMarketListingOrNull(tradeId);
                return [tradeId, listing] as const;
              } catch (error) {
                console.warn(
                  "KPEG market overlay detail fetch failed during prune.",
                  { tradeId, error },
                );
                return [tradeId, undefined] as const;
              }
            },
          ),
        ),
      );
      if (cancelled) {
        return;
      }
      const { settledTradeIds, conflicts } =
        settleOptimisticMarketListingsByDetails({
          items: candidates,
          latestIndexedBlock,
          detailsByTradeId: detailByTradeId,
        });
      for (const conflict of conflicts) {
        const key = `${conflict.tradeId}:${conflict.txHash}:${conflict.expectedStatus}`;
        if (marketConflictLogKeys.current.has(key)) {
          continue;
        }
        marketConflictLogKeys.current.add(key);
        console.warn(
          "KPEG market overlay retained due to stale indexed conflict.",
          {
            ...conflict,
            latestIndexedBlock,
          },
        );
      }
      if (settledTradeIds.length > 0) {
        const cachedTradeIds = marketAddress
          ? readCachedMarketListingTradeIds(queryClient, marketAddress)
          : new Set<number>();
        const { clearableTradeIds, blockedTradeIds } =
          filterSettleableOptimisticMarketListingTradeIds({
            settledTradeIds,
            items: candidates,
            detailsByTradeId: detailByTradeId,
            cachedTradeIds,
          });
        if (blockedTradeIds.length > 0) {
          console.warn(
            "KPEG market overlay retained because cached listings still include canceled trade ids.",
            { blockedTradeIds, latestIndexedBlock },
          );
        }
        if (clearableTradeIds.length > 0) {
          clearOptimisticMarketListings(
            optimisticMarketScope,
            clearableTradeIds,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    marketAddress,
    optimisticMarketScope,
    persistentOptimisticListings,
    queryClient,
    searchValue,
    statusQuery.data?.latestIndexedBlock,
  ]);
  useEffect(() => {
    setOptimisticListings((current) => {
      const remaining = pruneMarketListingOverrides(current, serverListings);
      return Object.keys(remaining).length === Object.keys(current).length
        ? current
        : remaining;
    });
  }, [serverListings]);
  const mergedOptimisticListings = useMemo(
    () => ({
      ...persistentOptimisticListings,
      ...optimisticListings,
    }),
    [optimisticListings, persistentOptimisticListings],
  );
  const listings = useMemo(
    () =>
      mergeMarketListingViews({
        activeTab,
        address,
        searchValue,
        serverListings,
        localListings: mergedOptimisticListings,
      }),
    [activeTab, address, mergedOptimisticListings, searchValue, serverListings],
  );
  const marketScopeKey = [
    marketAddress,
    activeTab,
    listingsOwnerScope,
    searchValue.trim(),
    sort,
  ].join("|");
  const marketScopeHasCachedData =
    queryClient.getQueryData(marketListingsQueryKey) !== undefined;
  const marketScopePending = useQueryScopePending({
    scopeKey: marketScopeKey,
    scopeHasCachedData: walletTabDisconnected ? true : marketScopeHasCachedData,
    hasData: walletTabDisconnected ? true : listingsQuery.data !== undefined,
    isPending: walletTabDisconnected ? false : listingsQuery.isPending,
    isFetching: walletTabDisconnected ? false : listingsQuery.isFetching,
    isPlaceholderData: walletTabDisconnected
      ? false
      : listingsQuery.isPlaceholderData,
  });
  const lastStableListingsRef = useRef<MarketListingView[]>([]);
  const lastStableScopeKeyRef = useRef(marketScopeKey);
  useEffect(() => {
    if (marketScopePending) {
      return;
    }
    if (
      listings.length > 0 ||
      (!listingsQuery.isFetching && !listingsQuery.isPending)
    ) {
      lastStableListingsRef.current = listings;
      lastStableScopeKeyRef.current = marketScopeKey;
    }
  }, [
    listings,
    marketScopeKey,
    listingsQuery.isFetching,
    listingsQuery.isPending,
    marketScopePending,
  ]);
  const visibleListings = useMemo(() => {
    return resolveVisibleMarketListings({
      marketScopePending,
      scopeKey: marketScopeKey,
      lastStableScopeKey: lastStableScopeKeyRef.current,
      listings,
      isFetching: listingsQuery.isFetching,
      lastStableListings: lastStableListingsRef.current,
    });
  }, [listings, listingsQuery.isFetching, marketScopeKey, marketScopePending]);
  const visibleMarketStats = useMemo(() => {
    const pageReady =
      Boolean(listingsQuery.data) &&
      !listingsQuery.isPlaceholderData &&
      !marketScopePending;
    return marketStatsFromVisibleListings({
      activeTab,
      pageReady,
      pageTotal: listingsQuery.data?.pages[0]?.total ?? null,
      listings: visibleListings,
      serverListingCount: serverListings.length,
      globalStats:
        searchValue.trim() || !marketStatsFreshForPage
          ? undefined
          : statsQuery.data,
    });
  }, [
    activeTab,
    listingsQuery.data,
    listingsQuery.isPlaceholderData,
    marketScopePending,
    searchValue,
    serverListings.length,
    statsQuery.data,
    marketStatsFreshForPage,
    visibleListings,
  ]);
  const activeMarketApiUnavailable =
    marketQueryEnabled &&
    marketApiUnavailable({
      statusError: statusQuery.error,
      statsError: statsQuery.error,
      listingsError: listingsQuery.error,
    });
  const marketStatsLoading = walletTabDisconnected
    ? false
    : activeMarketApiUnavailable
      ? false
      : marketScopePending ||
      (activeTab === "all"
        ? !marketStatsFreshForPage &&
          statsQuery.isPending &&
          serverListings.length === 0
        : marketQueryEnabled &&
          (listingsQuery.isPending || listingsQuery.isPlaceholderData));
  const volumeMetricLoading = walletTabDisconnected
    ? false
    : activeMarketApiUnavailable
      ? false
      : activeTab === "all"
        ? !marketStatsFreshForPage
        : marketStatsLoading;
  const volumeMetricValue = activeMarketApiUnavailable
    ? "-"
    : ethLabel(visibleMarketStats.volumeWei);
  const metrics = [
    {
      label: "Listed",
      value: activeMarketApiUnavailable
        ? "-"
        : visibleMarketStats.listed.toLocaleString(),
      loading: marketStatsLoading,
    },
    {
      label: "Floor",
      value: activeMarketApiUnavailable ? "-" : ethLabel(visibleMarketStats.floorWei),
      loading: marketStatsLoading,
    },
    {
      label: "Volume",
      value: volumeMetricValue,
      loading: volumeMetricLoading,
    },
  ];
  const ownedKitties = useMemo(() => {
    const ownerData = ownedKittiesQuery.data;
    if (!ownerData) {
      return [] as ListingKittyCandidate[];
    }
    if (!reservedKittyIdsReady) {
      return [] as ListingKittyCandidate[];
    }
    return buildSelectableListingCandidates(
      ownerData.kitties,
      ownerData.ownerIds,
      reservedKittyIdsQuery.data ?? new Set<number>(),
    );
  }, [
    ownedKittiesQuery.data,
    reservedKittyIdsQuery.data,
    reservedKittyIdsReady,
  ]);
  const ownedKittiesLoading =
    Boolean(address && listOpen) &&
    ((!ownedKittiesQuery.data &&
      (ownedKittiesQuery.isPending || ownedKittiesQuery.isFetching)) ||
      (!reservedKittyIdsReady && !reservedKittyIdsQuery.isError));
  const ownedKittiesLoadError =
    Boolean(address && listOpen) &&
    ((!ownedKittiesQuery.data && ownedKittiesQuery.isError) ||
      reservedKittyIdsQuery.isError);
  useEffect(() => {
    if (!listOpen || !ownedKittiesQuery.data || !reservedKittyIdsReady) return;
    const selectableIds = new Set(ownedKitties.map((kitty) => kitty.id));
    setSelectedIds((current) =>
      current.every((kittyId) => selectableIds.has(kittyId))
        ? current
        : current.filter((kittyId) => selectableIds.has(kittyId)),
    );
  }, [listOpen, ownedKitties, ownedKittiesQuery.data, reservedKittyIdsReady]);
  const currentInitialLoading =
    marketScopePending ||
    (marketQueryEnabled &&
      listingsQuery.isPending &&
      visibleListings.length === 0);
  const sortRefetching =
    !marketScopePending &&
    listingsQuery.isPlaceholderData &&
    listingsQuery.isFetching;
  const reorderToken = useStableSortReorderToken({
    scopeKey: marketScopeKey,
    sortKey: sort,
    isPlaceholderData: walletTabDisconnected
      ? false
      : listingsQuery.isPlaceholderData,
  });
  const metallicResyncToken = useMemo(
    () =>
      buildMetallicResyncToken({
        scope: marketScopeKey,
        ids: visibleListings.map((listing) => listing.tradeId),
        extra: `${sort}|${searchValue.trim()}|${marketScopePending ? "pending" : "ready"}`,
      }),
    [
      activeTab,
      marketScopeKey,
      marketScopePending,
      searchValue,
      sort,
      visibleListings,
    ],
  );
  useMetallicResyncOnChange(metallicResyncToken);
  const currentPaneSnapshot = useMemo<MarketPaneSnapshot>(
    () => ({
      tab: activeTab,
      reorderToken,
      listings: visibleListings,
      marketQueryEnabled,
      hasMore: Boolean(listingsQuery.hasNextPage) && !sortRefetching,
      fetchingMore: listingsQuery.isFetchingNextPage,
    }),
    [
      activeTab,
      reorderToken,
      visibleListings,
      listingsQuery.hasNextPage,
      listingsQuery.isFetchingNextPage,
      marketQueryEnabled,
      sortRefetching,
    ],
  );
  const needsWalletConnection = marketScopeNeedsWalletConnection({
    marketQueryEnabled,
  });
  const renderedEmptyMessage = needsWalletConnection ? (
    <ConnectWalletTabPrompt />
  ) : (
    marketEmptyStateMessage({
      activeTab,
      apiUnavailable: activeMarketApiUnavailable,
      backfillActive,
      searchValue,
      knownListed: statsQuery.data?.listed ?? 0,
    })
  );
  const listingsPaneContent = (
    <MarketListingsPane
      snapshot={currentPaneSnapshot}
      initialLoading={currentInitialLoading}
      initialSkeletonCount={initialLimit}
      address={address}
      detailQueryScope={{
        chainId: targetChainId,
        tokenAddress: tokenAddress ?? null,
      }}
      canLoadMore={!currentInitialLoading}
      animateReorder
      emptyMessage={renderedEmptyMessage}
      onLoadMore={() => {
        if (
          !sortRefetching &&
          !listingsQuery.isFetchingNextPage &&
          listingsQuery.hasNextPage
        ) {
          void listingsQuery.fetchNextPage();
        }
      }}
      onOpenListing={openDetailModal}
      onCancelListing={(listing) => void cancelListing(listing)}
      onUpdateListing={(listing) => openDetailModal(listing.tradeId, true)}
    />
  );

  const selectedListing =
    openedTradeId === null
      ? null
      : (mergedOptimisticListings[openedTradeId] ??
        visibleListings.find((listing) => listing.tradeId === openedTradeId) ??
        openedListingQuery.data ??
        null);
  useEffect(() => {
    if (!selectedListing || detailClosing) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setDetailVisible(true));
    });
  }, [detailClosing, selectedListing?.tradeId]);
  const marketPageRefetchKey = `market:${activeTab}`;
  const refetchMarketPageFreshness = useCallback(() => {
    void statusQuery.refetch();
    void statsQuery.refetch();
    if (marketQueryEnabled) {
      void listingsQuery.refetch();
    }
    if (openedTradeId !== null) {
      void openedListingQuery.refetch();
    }
    if (!listOpen || !address) {
      return;
    }
    if (!ownedKittiesQuery.data && !walletOwnerKittiesCachedSnapshot) {
      void ownedKittiesQuery.refetch();
    }
    void reservedKittyIdsQuery.refetch();
    if (selectedIds.length > 0) {
      void selectedKittyApprovalQuery.refetch();
    }
  }, [
    address,
    listOpen,
    listingsQuery,
    marketQueryEnabled,
    openedListingQuery,
    openedTradeId,
    ownedKittiesQuery,
    reservedKittyIdsQuery,
    selectedIds.length,
    selectedKittyApprovalQuery,
    statsQuery,
    statusQuery,
    walletOwnerKittiesCachedSnapshot,
  ]);
  usePageFreshnessRefetch({
    pageKey: marketPageRefetchKey,
    forceToken: isPostTradeRefreshActive(postTradeRefreshUntil)
      ? postTradeRefreshUntil
      : 0,
    onRefetch: refetchMarketPageFreshness,
  });

  return (
    <main className="relative z-10 mx-auto max-w-[var(--page-max)] pt-10 max-[640px]:pt-4">
      <section className="grid gap-4 pb-4">
        <div className="flex items-end justify-between gap-6">
          <div className="w-full">
            <p className="m-0 font-mono text-[0.75rem] font-extrabold tracking-[0.28em] text-[var(--accent-cool)] max-[640px]:hidden">
              MARKET
            </p>
            <h1
              id="nav-surface-trigger-kitty-bazaar"
              className="mt-[0.45rem] mb-0 text-[3.6rem] leading-[0.96] tracking-[-0.08em] max-[640px]:text-[1.5rem]"
            >
              Kitty Bazaar
            </h1>
            <div className="flex justify-between items-end gap-4 text-[1rem] max-md:flex-col max-md:items-start max-md:mt-3">
              <p className="mt-3 max-w-[28rem] text-[0.88rem] leading-[1.5] text-[var(--fg-muted)] max-[640px]:hidden">
                List exact onchain kPEGs, bundle a few together, or bring home a
                listed kitty from another wallet.
              </p>
              <button
                className="flex gap-2 cursor-pointer justify-center rounded-[6px] border border-[var(--line)] bg-[var(--fg)] px-[1rem] py-[0.4rem] text-[var(--bg)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 max-md:w-full max-[640px]:text-[0.8rem]"
                type="button"
                onClick={() => void openListModal()}
              >
                <i className="nf nf-cod-tag text-[1rem] max-[640px]:text-[0.8rem] self-center" />
                LIST kPEG
              </button>
            </div>
          </div>
        </div>
        <div className="flex gap-24 max-[480px]:gap-8">
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
      </section>
      <section className="mt-2 flex gap-6 max-sm:gap-4">
        {MARKET_TABS.map((tab) => (
          <button
            key={tab.id}
            className={
              activeTab === tab.id
                ? "mb-[-1px] cursor-pointer border-0 border-b-2 border-[var(--fg)] bg-transparent pb-2 text-[0.8rem] font-bold text-[var(--fg)] max-[480px]:text-[0.6rem]"
                : "mb-[-1px] cursor-pointer border-0 border-b-2 border-transparent bg-transparent pb-2 text-[0.8rem] font-bold text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] max-[480px]:text-[0.6rem]"
            }
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
            }}
          >
            {tab.label}
          </button>
        ))}
      </section>
      <section>
        <SearchField
          value={searchInput}
          placeholder="Search seller, #id, or traits"
          onChange={setSearchInput}
          sort={sort}
          sortDisabled={sortDisabled}
          onSortChange={setSort}
        />
      </section>
      <SlidingPaneSwap
        contentKey={activeTab}
        content={listingsPaneContent}
        offsetPx={28}
        suppressNestedTransitions
      />
      {listOpen ? (
        <ListingModal
          kitties={ownedKitties}
          loading={ownedKittiesLoading}
          loadError={ownedKittiesLoadError}
          selectedIds={selectedIds}
          priceInput={priceInput}
          feeBps={feeBps}
          listAction={listModalAction}
          selectedApproved={selectedKittyApproved}
          approvalChecking={approvalChecking}
          open={listVisible && !listClosing}
          maxBundleSize={MAX_MARKET_BUNDLE_SIZE}
          onClose={closeListModal}
          onToggle={onToggleSelectedId}
          onPriceChange={setPriceInput}
          onSubmit={() => void submitListing()}
        />
      ) : null}
      {selectedListing ? (
        <ListingDetail
          listing={selectedListing}
          isSeller={Boolean(
            address &&
              selectedListing.seller.toLowerCase() === address.toLowerCase(),
          )}
          canManage={canManageMarketListing(selectedListing, address)}
          canBuy={canBuyMarketListing(selectedListing, address)}
          walletConnected={Boolean(address)}
          showSoldTo={activeTab === "sold"}
          ethBalance={ethBalanceQuery.data?.value ?? null}
          actionBusy={listingActionBusy(selectedListing.tradeId)}
          copied={copied}
          focusPriceInput={focusUpdateTradeId === selectedListing.tradeId}
          open={detailVisible && !detailClosing}
          onClose={closeDetailModal}
          onCopy={(key, value) => void copyValue(key, value)}
          onOpenPortfolio={openPortfolio}
          onOpenKitty={openKittyDetail}
          onBuy={() => void buyListing(selectedListing)}
          onCancel={() => void cancelListing(selectedListing)}
          onUpdatePrice={(value) =>
            void updateListingPrice(selectedListing, value)
          }
          detailQueryScope={{
            chainId: targetChainId,
            tokenAddress: tokenAddress ?? null,
          }}
        />
      ) : null}
    </main>
  );
}
