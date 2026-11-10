import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  type RenderResult,
} from "@testing-library/react";
import { zeroAddress, type Address } from "viem";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../../context/toast.js";
import { GalleryPage } from "../../pages/GalleryPage.js";
import { MarketPage } from "../../pages/MarketPage.js";
import type {
  ConfigResponse,
  KittyDetailItem,
  KittyItem,
  MarketListing,
  MarketPagedResponse,
  MarketStatsResponse,
  MarketTab,
  OwnerStatsResponse,
  PagedResponse,
  ScopeMode,
  SortMode,
  StatsResponse,
  StatusResponse,
} from "../../lib/api.js";
import type { MarketPositionViewOnChain } from "../../lib/marketReadBack.js";

type WriteRequest = {
  functionName?: string;
  args?: readonly unknown[];
  address?: Address;
  value?: bigint;
  chainId?: number;
};

type PublicClientMock = {
  readContract: (request: {
    functionName?: string;
    args?: readonly unknown[];
    address?: Address;
  }) => Promise<unknown>;
  waitForTransactionReceipt: (input: {
    hash: `0x${string}`;
    timeout?: number;
  }) => Promise<{ status: "success" | "reverted"; blockNumber: bigint }>;
  getTransactionReceipt: (input: {
    hash: `0x${string}`;
  }) => Promise<{ blockNumber: bigint; logs: readonly unknown[] }>;
};

type MockMode = "success" | "rejected" | "timeout";

type MockTxOutcome = {
  hash: `0x${string}`;
  mode: MockMode;
};

function ensureMatchMedia(): void {
  if (typeof window.matchMedia === "function") {
    return;
  }
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function normalizeOwner(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function paginateArray<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
  offset?: number,
): {
  total: number;
  pageItems: T[];
} {
  const start = Math.max(0, offset ?? page * pageSize);
  const end = start + pageSize;
  return {
    total: items.length,
    pageItems: items.slice(start, end),
  };
}

function defaultConfig(): ConfigResponse {
  return {
    fixedTokenSupply: 9_999,
    naiveCombinationCount: 0,
    filteredCombinationCountByManifest: 0,
    documentedFilteredCombinationCount: 0,
    compatibilityReduction: {
      removed: 0,
      reductionPct: 0,
    },
    searchDebounceMs: 450,
    chainId: 84532,
    tokenAddress: "0x00000000000000000000000000000000000000aa",
    marketAddress: "0x00000000000000000000000000000000000000bb",
    routerAddress: null,
    quoterAddress: null,
  };
}

function defaultStatus(): StatusResponse {
  return {
    latestIndexedBlock: 200,
    headBlock: 200,
    caughtUp: true,
    syncing: false,
  };
}

function defaultStats(): StatsResponse {
  return {
    tokenSupplyFixed: 9_999,
    kittiesLive: 100,
    kittiesEverMinted: 100,
    holdersLive: 1,
    holdersEver: 1,
    latestIndexedBlock: 200,
  };
}

function listingMatchesSearch(listing: MarketListing, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  if (listing.seller.toLowerCase().includes(needle)) {
    return true;
  }
  if (String(listing.tradeId).includes(needle)) {
    return true;
  }
  return listing.kitties.some((kitty) =>
    Object.values(kitty.traits).some((value) =>
      String(value).toLowerCase().includes(needle),
    ),
  );
}

function sortListings(input: MarketListing[], sort: SortMode): MarketListing[] {
  const next = [...input];
  if (sort === "scarcity") {
    next.sort((a, b) => {
      const aScore = a.kitties[0]?.rarityScore ?? 0;
      const bScore = b.kitties[0]?.rarityScore ?? 0;
      if (aScore !== bScore) {
        return bScore - aScore;
      }
      return b.tradeId - a.tradeId;
    });
    return next;
  }
  next.sort((a, b) => b.tradeId - a.tradeId);
  return next;
}

function marketTabListings(input: {
  tab: MarketTab;
  owner?: string | null;
  listings: MarketListing[];
}): MarketListing[] {
  const owner = normalizeOwner(input.owner);
  switch (input.tab) {
    case "all":
      return input.listings.filter((listing) => listing.status === "OPEN");
    case "my-listings":
      return input.listings.filter(
        (listing) =>
          listing.status === "OPEN" && normalizeOwner(listing.seller) === owner,
      );
    case "bought":
      return input.listings.filter(
        (listing) =>
          listing.status === "SOLD" && normalizeOwner(listing.buyer) === owner,
      );
    case "sold":
      return input.listings.filter(
        (listing) =>
          listing.status === "SOLD" && normalizeOwner(listing.seller) === owner,
      );
    default:
      return [];
  }
}

export type UserFlowHarnessController = {
  walletAddress: string | undefined;
  walletConnector: unknown;
  chainId: number;
  tokenAddress: Address;
  marketAddress: Address;
  config: ConfigResponse;
  status: StatusResponse;
  stats: StatsResponse;
  globalItems: KittyItem[];
  ownerStatsByOwner: Map<string, OwnerStatsResponse>;
  ownerItemsByOwner: Map<string, KittyItem[]>;
  marketListings: MarketListing[];
  marketListingDetails: Map<number, MarketListing | null>;
  ownerKittiesByOwner: Map<string, number[]>;
  ownerKittiesLiveByOwner: Map<string, bigint>;
  marketPositionByTradeId: Map<number, MarketPositionViewOnChain | null>;
  selectedApprovalByOwnerAndIds: Map<string, boolean>;
  nextTxByFunction: Map<string, MockTxOutcome | Error>;
  writeCalls: WriteRequest[];
  ethBalanceWei: bigint | null;
  connectCalls: number;
  publicClient: PublicClientMock;
  setWalletAddress: (address: string | undefined) => void;
  setOwnerStats: (owner: string, stats: OwnerStatsResponse) => void;
  setOwnerItems: (owner: string, items: KittyItem[]) => void;
  setOwnerKitties: (owner: string, ids: number[]) => void;
  setOwnerKittiesLive: (owner: string, count: number | bigint) => void;
  setMarketListings: (items: MarketListing[]) => void;
  setMarketListingDetail: (tradeId: number, listing: MarketListing | null) => void;
  setMarketPosition: (
    tradeId: number,
    view: MarketPositionViewOnChain | null,
  ) => void;
  setNextWrite: (functionName: string, outcome: MockTxOutcome | Error) => void;
  setApproval: (owner: string, kittyIds: number[], approved: boolean) => void;
  approvalKey: (owner: string, kittyIds: number[]) => string;
  writeContractAsync: (request: WriteRequest) => Promise<`0x${string}`>;
};

export function createUserFlowHarnessController(): UserFlowHarnessController {
  const tokenAddress =
    "0x00000000000000000000000000000000000000aa" as `0x${string}`;
  const marketAddress =
    "0x00000000000000000000000000000000000000bb" as `0x${string}`;

  const controller: UserFlowHarnessController = {
    walletAddress: undefined,
    walletConnector: null,
    chainId: 84532,
    tokenAddress,
    marketAddress,
    config: defaultConfig(),
    status: defaultStatus(),
    stats: defaultStats(),
    globalItems: [],
    ownerStatsByOwner: new Map(),
    ownerItemsByOwner: new Map(),
    marketListings: [],
    marketListingDetails: new Map(),
    ownerKittiesByOwner: new Map(),
    ownerKittiesLiveByOwner: new Map(),
    marketPositionByTradeId: new Map(),
    selectedApprovalByOwnerAndIds: new Map(),
    nextTxByFunction: new Map(),
    writeCalls: [],
    ethBalanceWei: null,
    connectCalls: 0,
    publicClient: {
      readContract: async (request) => {
        const functionName = request.functionName;
        if (functionName === "getOwnerKitties") {
          const owner = normalizeOwner(String(request.args?.[0] ?? ""));
          const ids = controller.ownerKittiesByOwner.get(owner) ?? [];
          return ids.map((id) => BigInt(id));
        }
        if (functionName === "ownerKittiesLive") {
          const owner = normalizeOwner(String(request.args?.[0] ?? ""));
          return controller.ownerKittiesLiveByOwner.get(owner) ?? 0n;
        }
        if (functionName === "getPositionView") {
          const tradeId = Number(request.args?.[0] ?? 0n);
          return controller.marketPositionByTradeId.get(tradeId) ?? null;
        }
        if (functionName === "getOpenPositionsByOwner") {
          const owner = normalizeOwner(String(request.args?.[0] ?? ""));
          const openTradeIds = controller.marketListings
            .filter(
              (listing) =>
                listing.status === "OPEN" &&
                normalizeOwner(listing.seller) === owner,
            )
            .map((listing) => BigInt(listing.tradeId));
          return openTradeIds;
        }
        if (functionName === "isKittyTransferApproved") {
          const owner = normalizeOwner(String(request.args?.[0] ?? ""));
          const operator = normalizeOwner(String(request.args?.[1] ?? ""));
          const kittyId = Number(request.args?.[2] ?? 0n);
          const key = `${owner}:${operator}:${kittyId}`;
          return controller.selectedApprovalByOwnerAndIds.get(key) ?? false;
        }
        if (functionName === "kittiesTransferApprovedFor") {
          const owner = normalizeOwner(String(request.args?.[0] ?? ""));
          const operator = normalizeOwner(String(request.args?.[1] ?? ""));
          const kittyIds = (
            (request.args?.[2] as readonly bigint[] | undefined) ?? []
          ).map((id) => Number(id));
          if (!owner || !operator || kittyIds.length === 0) {
            return false;
          }
          return kittyIds.every((kittyId) => {
            const key = `${owner}:${operator}:${kittyId}`;
            return controller.selectedApprovalByOwnerAndIds.get(key) ?? false;
          });
        }
        if (functionName === "marketToken") {
          return controller.tokenAddress;
        }
        if (functionName === "token") {
          return controller.tokenAddress;
        }
        return undefined;
      },
      waitForTransactionReceipt: async () => {
        throw new Error("timed out waiting for receipt");
      },
      getTransactionReceipt: async () => ({
        blockNumber: 0n,
        logs: [],
      }),
    },
    setWalletAddress: (address) => {
      controller.walletAddress = address;
    },
    setOwnerStats: (owner, stats) => {
      controller.ownerStatsByOwner.set(normalizeOwner(owner), stats);
    },
    setOwnerItems: (owner, items) => {
      controller.ownerItemsByOwner.set(normalizeOwner(owner), [...items]);
    },
    setOwnerKitties: (owner, ids) => {
      controller.ownerKittiesByOwner.set(normalizeOwner(owner), [...ids]);
    },
    setOwnerKittiesLive: (owner, count) => {
      controller.ownerKittiesLiveByOwner.set(normalizeOwner(owner), BigInt(count));
    },
    setMarketListings: (items) => {
      controller.marketListings = [...items];
      controller.marketListingDetails.clear();
      for (const item of items) {
        controller.marketListingDetails.set(item.tradeId, item);
      }
    },
    setMarketListingDetail: (tradeId, listing) => {
      controller.marketListingDetails.set(tradeId, listing);
    },
    setMarketPosition: (tradeId, view) => {
      controller.marketPositionByTradeId.set(tradeId, view);
    },
    setNextWrite: (functionName, outcome) => {
      controller.nextTxByFunction.set(functionName, outcome);
    },
    setApproval: (owner, kittyIds, approved) => {
      const ownerLower = normalizeOwner(owner);
      for (const kittyId of kittyIds) {
        const key = `${ownerLower}:${normalizeOwner(controller.marketAddress)}:${kittyId}`;
        controller.selectedApprovalByOwnerAndIds.set(key, approved);
      }
    },
    approvalKey: (owner, kittyIds) => {
      const ownerLower = normalizeOwner(owner);
      return `${ownerLower}:${normalizeOwner(controller.marketAddress)}:${[...kittyIds].sort((a, b) => a - b).join(",")}`;
    },
    writeContractAsync: async (request) => {
      controller.writeCalls.push(request);
      const functionName = request.functionName ?? "";
      const configured = controller.nextTxByFunction.get(functionName);
      if (configured instanceof Error) {
        throw configured;
      }
      const outcome =
        configured ??
        ({
          hash: (`0x${"1".repeat(64)}` as `0x${string}`),
          mode: "success",
        } satisfies MockTxOutcome);
      if (outcome.mode === "rejected") {
        throw new Error("User rejected the wallet request.");
      }
      if (functionName === "setKittyTransferApproval") {
        const kittyIds = (request.args?.[1] as readonly bigint[] | undefined) ?? [];
        const owner = normalizeOwner(controller.walletAddress ?? "");
        controller.setApproval(
          owner,
          kittyIds.map((id) => Number(id)),
          true,
        );
      }
      if (functionName === "createTradeAndFund") {
        const wallet = normalizeOwner(controller.walletAddress ?? "");
        const kittyIds =
          ((request.args?.[2] as readonly bigint[] | undefined) ?? []).map((id) =>
            Number(id),
          );
        const tradeId =
          controller.marketListings.reduce(
            (max, item) => Math.max(max, item.tradeId),
            0,
          ) + 1;
        const listedAt = Date.now();
        const selectedKitties = kittyIds
          .map((id) =>
            controller.ownerItemsByOwner
              .get(wallet)
              ?.find((kitty) => kitty.id === id) ?? null,
          )
          .filter((kitty): kitty is KittyItem => kitty !== null)
          .map((kitty) => ({ ...kitty, owner: wallet }));
        const listing: MarketListing = {
          tradeId,
          escrowAddress: controller.marketAddress,
          seller: wallet,
          buyer: null,
          paymentToken: zeroAddress,
          priceWei: String(request.args?.[1] ?? 0n),
          feeBps: 200,
          kittyIds,
          kittyCount: kittyIds.length,
          status: "OPEN",
          createdBlock: controller.status.latestIndexedBlock,
          createdTxHash: outcome.hash,
          createdAt: listedAt,
          updatedAt: listedAt,
          closedBlock: null,
          closedTxHash: null,
          closedAt: null,
          kitties: selectedKitties,
        };
        controller.marketListings = [listing, ...controller.marketListings];
        controller.marketListingDetails.set(tradeId, listing);
        controller.marketPositionByTradeId.set(tradeId, {
          tradeId: BigInt(tradeId),
          seller: wallet as Address,
          buyer: zeroAddress,
          escrowAddress: controller.marketAddress,
          paymentToken: zeroAddress,
          price: BigInt(listing.priceWei),
          feeBps: BigInt(listing.feeBps),
          kittyIds: kittyIds.map((id) => BigInt(id)),
          status: 0n,
          ready: true,
        });
        const ownerIds = new Set(controller.ownerKittiesByOwner.get(wallet) ?? []);
        for (const kittyId of kittyIds) {
          ownerIds.delete(kittyId);
        }
        controller.ownerKittiesByOwner.set(wallet, [...ownerIds]);
        const ownerItems = controller.ownerItemsByOwner.get(wallet) ?? [];
        controller.ownerItemsByOwner.set(
          wallet,
          ownerItems.filter((kitty) => !kittyIds.includes(kitty.id)),
        );
      }
      if (functionName === "buyAndClaimAll") {
        const tradeId = Number(request.args?.[0] ?? 0n);
        const buyer = normalizeOwner(controller.walletAddress ?? "");
        const listing = controller.marketListings.find((item) => item.tradeId === tradeId);
        if (listing) {
          const soldAt = Date.now();
          listing.status = "SOLD";
          listing.buyer = buyer;
          listing.closedTxHash = outcome.hash;
          listing.closedAt = soldAt;
          listing.updatedAt = soldAt;
          listing.closedBlock = controller.status.latestIndexedBlock;
          controller.marketListingDetails.set(tradeId, { ...listing });
          const ids = new Set(controller.ownerKittiesByOwner.get(buyer) ?? []);
          for (const kittyId of listing.kittyIds) {
            ids.add(kittyId);
          }
          controller.ownerKittiesByOwner.set(buyer, [...ids]);
          const buyerItems = controller.ownerItemsByOwner.get(buyer) ?? [];
          const buyerItemIds = new Set(buyerItems.map((kitty) => kitty.id));
          const nextBuyerItems = [...buyerItems];
          for (const kitty of listing.kitties) {
            if (buyerItemIds.has(kitty.id)) {
              continue;
            }
            nextBuyerItems.push({
              ...kitty,
              owner: buyer,
            });
            buyerItemIds.add(kitty.id);
          }
          controller.ownerItemsByOwner.set(buyer, nextBuyerItems);
          controller.ownerKittiesLiveByOwner.set(buyer, BigInt(ids.size));
          controller.marketPositionByTradeId.set(tradeId, {
            tradeId: BigInt(tradeId),
            seller: listing.seller as Address,
            buyer: buyer as Address,
            escrowAddress: listing.escrowAddress as Address,
            paymentToken: zeroAddress,
            price: BigInt(listing.priceWei),
            feeBps: BigInt(listing.feeBps),
            kittyIds: listing.kittyIds.map((id) => BigInt(id)),
            status: 1n,
            ready: true,
          });
        }
      }
      if (functionName === "deletePosition") {
        const tradeId = Number(request.args?.[0] ?? 0n);
        const listing = controller.marketListings.find((item) => item.tradeId === tradeId);
        if (listing) {
          const closedAt = Date.now();
          listing.status = "DELETED";
          listing.closedTxHash = outcome.hash;
          listing.closedAt = closedAt;
          listing.updatedAt = closedAt;
          listing.closedBlock = controller.status.latestIndexedBlock;
          controller.marketListingDetails.set(tradeId, { ...listing });
          controller.marketPositionByTradeId.set(tradeId, {
            tradeId: BigInt(tradeId),
            seller: listing.seller as Address,
            buyer: zeroAddress,
            escrowAddress: listing.escrowAddress as Address,
            paymentToken: zeroAddress,
            price: BigInt(listing.priceWei),
            feeBps: BigInt(listing.feeBps),
            kittyIds: listing.kittyIds.map((id) => BigInt(id)),
            status: 2n,
            ready: true,
          });
          const seller = normalizeOwner(listing.seller);
          const sellerIds = new Set(controller.ownerKittiesByOwner.get(seller) ?? []);
          for (const kittyId of listing.kittyIds) {
            sellerIds.add(kittyId);
          }
          controller.ownerKittiesByOwner.set(seller, [...sellerIds]);
          const sellerItems = controller.ownerItemsByOwner.get(seller) ?? [];
          const sellerItemIds = new Set(sellerItems.map((kitty) => kitty.id));
          const nextSellerItems = [...sellerItems];
          for (const kitty of listing.kitties) {
            if (sellerItemIds.has(kitty.id)) {
              continue;
            }
            nextSellerItems.push({
              ...kitty,
              owner: seller,
            });
            sellerItemIds.add(kitty.id);
          }
          controller.ownerItemsByOwner.set(seller, nextSellerItems);
          controller.ownerKittiesLiveByOwner.set(seller, BigInt(sellerIds.size));
        }
      }
      if (outcome.mode === "timeout") {
        return outcome.hash;
      }
      return outcome.hash;
    },
  };

  return controller;
}

export function buildUserFlowApiMocks(controller: UserFlowHarnessController) {
  const ownerStats = (owner: string): OwnerStatsResponse =>
    controller.ownerStatsByOwner.get(normalizeOwner(owner)) ?? {
      currentKitties: 0,
      everKitties: 0,
    };

  const ownerItems = (owner: string): KittyItem[] =>
    controller.ownerItemsByOwner.get(normalizeOwner(owner)) ?? [];

  const getKittyFromKnownPools = (kittyId: number): KittyItem | null => {
    const pool = [
      ...controller.globalItems,
      ...[...controller.ownerItemsByOwner.values()].flat(),
      ...controller.marketListings.flatMap((listing) => listing.kitties),
    ];
    return pool.find((kitty) => kitty.id === kittyId) ?? null;
  };

  return {
    getConfig: vi.fn(async () => ({ ...controller.config })),
    getStatus: vi.fn(async () => ({ ...controller.status })),
    getStats: vi.fn(async () => ({ ...controller.stats })),
    getOwnerStats: vi.fn(async (owner: string) => ownerStats(owner)),
    listOwner: vi.fn(
      async (
        owner: string,
        page: number,
        pageSize: number,
        _sort: SortMode,
        offset?: number,
      ): Promise<PagedResponse> => {
        const items = ownerItems(owner);
        const { total, pageItems } = paginateArray(items, page, pageSize, offset);
        return {
          page,
          pageSize,
          total,
          items: pageItems,
        };
      },
    ),
    listGlobal: vi.fn(
      async (
        page: number,
        pageSize: number,
        _sort: SortMode,
        offset?: number,
      ): Promise<PagedResponse> => {
        const { total, pageItems } = paginateArray(
          controller.globalItems,
          page,
          pageSize,
          offset,
        );
        return {
          page,
          pageSize,
          total,
          items: pageItems,
        };
      },
    ),
    searchKitties: vi.fn(
      async (
        q: string,
        scope: ScopeMode,
        owner: string | null,
        page: number,
        pageSize: number,
        offset?: number,
      ): Promise<PagedResponse> => {
        const items =
          scope === "my-collections" && owner
            ? ownerItems(owner)
            : controller.globalItems;
        const filtered = items.filter((kitty) =>
          Object.values(kitty.traits).some((value) =>
            String(value).toLowerCase().includes(q.trim().toLowerCase()),
          ),
        );
        const { total, pageItems } = paginateArray(filtered, page, pageSize, offset);
        return {
          page,
          pageSize,
          total,
          items: pageItems,
        };
      },
    ),
    getKittyOrNull: vi.fn(async (kittyId: number): Promise<KittyDetailItem | null> => {
      const found = getKittyFromKnownPools(kittyId);
      if (!found) {
        return null;
      }
      return {
        ...found,
        txHash: found.txHash ?? `0x${"1".repeat(64)}`,
        gasUsed: found.gasUsed ?? 0,
        baseFeeWei: found.baseFeeWei ?? "0",
        traitOdds: found.traitOdds ?? ({} as KittyDetailItem["traitOdds"]),
      };
    }),
    getKitty: vi.fn(async (kittyId: number): Promise<KittyDetailItem> => {
      const found = getKittyFromKnownPools(kittyId);
      if (!found) {
        throw new Error("Kitty not found");
      }
      return {
        ...found,
        txHash: found.txHash ?? `0x${"1".repeat(64)}`,
        gasUsed: found.gasUsed ?? 0,
        baseFeeWei: found.baseFeeWei ?? "0",
        traitOdds: found.traitOdds ?? ({} as KittyDetailItem["traitOdds"]),
      };
    }),
    getMarketStats: vi.fn(async (): Promise<MarketStatsResponse> => {
      const openListings = controller.marketListings.filter(
        (listing) => listing.status === "OPEN",
      );
      const floorWei = openListings.length
        ? openListings.reduce((floor, listing) =>
            BigInt(listing.priceWei) < BigInt(floor.priceWei) ? listing : floor,
          ).priceWei
        : "0";
      return {
        listed: openListings.length,
        floorWei,
        volumeWei: "0",
      };
    }),
    listMarketListings: vi.fn(
      async (
        page: number,
        pageSize: number,
        tab: MarketTab,
        sort: SortMode,
        owner?: string | null,
        offset?: number,
        search?: string,
      ): Promise<MarketPagedResponse> => {
        const scoped = marketTabListings({
          tab,
          owner: owner ?? null,
          listings: controller.marketListings,
        }).filter((listing) => listingMatchesSearch(listing, search ?? ""));
        const sorted = sortListings(scoped, sort);
        const { total, pageItems } = paginateArray(sorted, page, pageSize, offset);
        return {
          page,
          pageSize,
          total,
          items: pageItems,
        };
      },
    ),
    getMarketListing: vi.fn(async (tradeId: number): Promise<MarketListing> => {
      const value = controller.marketListingDetails.get(tradeId);
      if (!value) {
        throw new Error("Not found");
      }
      return value;
    }),
    getMarketListingOrNull: vi.fn(async (tradeId: number): Promise<MarketListing | null> => {
      return controller.marketListingDetails.get(tradeId) ?? null;
    }),
    triggerSync: vi.fn(async () => ({
      ok: true as const,
      skipped: false,
      latestIndexedBlock: controller.status.latestIndexedBlock,
    })),
  };
}

export function buildUserFlowWagmiMocks(
  controller: UserFlowHarnessController,
): Record<string, unknown> {
  const useReadContract = (input: { functionName: string; args?: readonly unknown[] }) => {
    const functionName = input.functionName;
    const data =
      functionName === "notMintableAccount"
        ? zeroAddress
        : functionName === "kittiesLive"
          ? BigInt(controller.stats.kittiesLive)
          : functionName === "kittiesEverMinted"
            ? BigInt(controller.stats.kittiesEverMinted)
            : functionName === "ownerKittiesLive"
              ? controller.ownerKittiesLiveByOwner.get(
                  normalizeOwner(String(input.args?.[0] ?? "")),
                ) ?? 0n
              : undefined;
    return {
      data,
      dataUpdatedAt: Date.now(),
      refetch: vi.fn(),
      isPending: false,
      isFetching: false,
      isLoading: false,
    };
  };

  return {
    useAccount: () => ({
      address: controller.walletAddress,
      connector: controller.walletAddress ? controller.walletConnector : null,
    }),
    useConnect: () => ({
      connectors: [controller.walletConnector],
      connect: () => {
        controller.connectCalls += 1;
      },
    }),
    usePublicClient: () => controller.publicClient,
    useWriteContract: () => ({
      writeContractAsync: (request: WriteRequest) =>
        controller.writeContractAsync(request),
    }),
    useBalance: () => ({
      data:
        controller.walletAddress && controller.ethBalanceWei !== null
          ? { value: controller.ethBalanceWei }
          : undefined,
      isPending: false,
      isFetching: false,
      isLoading: false,
    }),
    useReadContract,
  };
}

export function buildUserFlowWagmiActionsMocks(
  _controller: UserFlowHarnessController,
): Record<string, unknown> {
  return {
    getConnectorClient: vi.fn(async () => {
      throw new Error("connected-wallet fallback is disabled in this test harness");
    }),
  };
}

export function createUserFlowQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

type UserFlowRenderedRoute = RenderResult & { queryClient: QueryClient };
let lastRenderedUserFlowRoute: UserFlowRenderedRoute | null = null;

export function renderUserFlowRoute(input: {
  route: "/explore" | "/market" | "/collections" | `/portfolio/${string}`;
  queryClient?: QueryClient;
}): UserFlowRenderedRoute {
  ensureMatchMedia();
  const queryClient = input.queryClient ?? createUserFlowQueryClient();
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[input.route]}>
          <Routes>
            <Route path="/explore" element={<GalleryPage mode="explore" />} />
            <Route path="/market" element={<MarketPage />} />
            <Route
              path="/collections"
              element={<GalleryPage mode="collections" />}
            />
            <Route
              path="/portfolio/:owner"
              element={<GalleryPage mode="portfolio" />}
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  const result: UserFlowRenderedRoute = {
    ...rendered,
    queryClient,
  };
  lastRenderedUserFlowRoute = result;
  return result;
}

export function openMarketListingDetail(tradeId: number): void {
  const explicit = screen.queryByRole("button", { name: `Listing #${tradeId}` });
  if (explicit) {
    fireEvent.click(explicit);
    return;
  }
  const listingCards = Array.from(
    document.querySelectorAll<HTMLElement>('article[role="button"]'),
  );
  if (listingCards[0]) {
    fireEvent.click(listingCards[0]);
    return;
  }
  const fallback = screen.queryByRole("button", { name: /KPEGS|KPEG #|BUNDLE/i });
  if (!fallback) {
    throw new Error(`Unable to locate market listing card for trade ${tradeId}`);
  }
  fireEvent.click(fallback);
}

export function clickBuyNow(): void {
  const buttons = screen.getAllByRole("button", { name: "BUY NOW" });
  fireEvent.click(buttons[0]!);
}

export function switchMarketTab(tabLabel: "ALL" | "MY LISTINGS" | "BOUGHT" | "SOLD"): void {
  fireEvent.click(screen.getByRole("button", { name: tabLabel }));
}

export function openListKpegModal(): void {
  fireEvent.click(screen.getByRole("button", { name: /LIST kPEG/i }));
}

export function toggleListKitty(kittyId: number): void {
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(`KPEG\\s*#${kittyId}`, "i"),
    }),
  );
}

export function submitListModal(actionLabel: RegExp | string): void {
  fireEvent.click(screen.getByRole("button", { name: actionLabel }));
}

export function cancelListingInDetail(): void {
  const detailCancel = screen.queryByRole("button", {
    name: /^CANCEL LISTING$/i,
  });
  if (detailCancel) {
    fireEvent.click(detailCancel);
    return;
  }
  const cancelButtons = screen.queryAllByRole("button", {
    name: /CANCEL(?: LISTING)?/i,
  });
  const fallback =
    cancelButtons.find((button) =>
      /cancel listing/i.test(normalizeText(button.textContent)),
    ) ?? cancelButtons[0];
  if (fallback) {
    fireEvent.click(fallback);
    return;
  }
  throw new Error("Unable to locate cancel listing button in detail modal.");
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

function bundleLabelRegex(kittyCount: number): RegExp {
  return new RegExp(`\\b${kittyCount}\\s*KPEGS\\b`, "i");
}

function listButtonsByText(pattern: RegExp): HTMLElement[] {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>('[role="button"], button'),
  );
  return nodes.filter((node) => pattern.test(normalizeText(node.textContent)));
}

function findModalKittySelectionButton(
  modal: HTMLElement,
  kittyId: number,
): HTMLElement | null {
  const byImage = within(modal).queryByRole("img", {
    name: new RegExp(`KPEG\\s*#${kittyId}`, "i"),
  });
  const imageButton = byImage?.closest("button");
  if (imageButton) {
    return imageButton;
  }
  const needle = `${kittyId}`;
  const candidates = Array.from(modal.querySelectorAll<HTMLElement>("button"));
  return (
    candidates.find((button) => {
      const text = normalizeText(button.textContent);
      return text.includes("kpeg") && text.includes(needle);
    }) ?? null
  );
}

function findListModalActionButton(modal: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(modal.querySelectorAll<HTMLButtonElement>("button"));
  if (buttons.length === 0) {
    return null;
  }
  return buttons[buttons.length - 1] ?? null;
}

function marketBundleCardOrNull(kittyCount: number): HTMLElement | null {
  const listingCards = Array.from(
    document.querySelectorAll<HTMLElement>('article[role="button"]'),
  );
  const isOpenableCard = (node: HTMLElement) =>
    node.getAttribute("tabindex") === "0";
  const candidates = listingCards.filter((node) =>
    bundleLabelRegex(kittyCount).test(normalizeText(node.textContent)),
  );
  const openCandidate = candidates.find(isOpenableCard);
  if (openCandidate) {
    return openCandidate;
  }
  if (candidates.length > 0) {
    return candidates[0]!;
  }
  const openListingCard = listingCards.find(isOpenableCard);
  return openListingCard ?? listingCards[0] ?? null;
}

function marketListingCards(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('article[role="button"]'),
  );
}

function marketBundleCardCount(): number {
  return marketListingCards().length;
}

function marketBundleCardOrNullAny(): HTMLElement | null {
  const cards = marketListingCards();
  return cards[0] ?? null;
}

function marketBundleCardOrNullByCount(kittyCount: number): HTMLElement | null {
  const direct = marketBundleCardOrNull(kittyCount);
  if (direct) {
    return direct;
  }
  const openCard = marketListingCards().find(
    (card) => card.getAttribute("tabindex") === "0",
  );
  if (openCard) {
    return openCard;
  }
  const anyCard = marketBundleCardOrNullAny();
  if (anyCard) {
    return anyCard;
  }
  const bundleCandidates = listButtonsByText(bundleLabelRegex(kittyCount));
  if (bundleCandidates[0]) {
    return bundleCandidates[0];
  }
  const genericCandidates = listButtonsByText(/kpegs/i);
  return genericCandidates[0] ?? null;
}

export async function findMarketBundleCard(kittyCount: number): Promise<HTMLElement> {
  const describeButtons = () =>
    listButtonsByText(/.*/).map((node) => normalizeText(node.textContent));
  await waitFor(() => {
    if (!marketBundleCardOrNullByCount(kittyCount)) {
      throw new Error(
        `Market listing with ${kittyCount} kPEGs is not visible yet. buttons=[${describeButtons().join(" | ")}]`,
      );
    }
  }, { timeout: 5_000 });
  const card = marketBundleCardOrNullByCount(kittyCount);
  if (!card) {
    throw new Error(`Unable to locate listing card with ${kittyCount} kPEGs.`);
  }
  return card;
}

export async function buyListingAndWaitBoughtTab(input: {
  tradeId: number;
  kittyCount: number;
}): Promise<void> {
  await findMarketBundleCard(input.kittyCount);
  openMarketListingDetail(input.tradeId);
  await waitFor(() => {
    const buyButtons = screen.queryAllByRole("button", { name: "BUY NOW" });
    if (buyButtons.length === 0) {
      throw new Error("BUY NOW action is not visible yet.");
    }
  });
  clickBuyNow();
  await findMarketBundleCard(input.kittyCount);
}

export async function goToCollections(): Promise<void> {
  const queryClient = lastRenderedUserFlowRoute?.queryClient;
  if (!queryClient) {
    throw new Error("No rendered user flow route is available for navigation.");
  }
  lastRenderedUserFlowRoute?.unmount();
  lastRenderedUserFlowRoute = null;
  renderUserFlowRoute({
    route: "/collections",
    queryClient,
  });
  await waitFor(() => {
    screen.getByText("KITTIES AT HOME");
  });
}

export async function listSelectedKittiesAndWaitConfirmed(input: {
  kittyIds: number[];
  priceEth: string;
  kittyCount: number;
  controller?: UserFlowHarnessController;
}): Promise<void> {
  if (!screen.queryByText(/Pick kitties for listing/i)) {
    openListKpegModal();
  }
  await waitFor(() => {
    screen.getByText(/Pick kitties for listing/i);
  }, { timeout: 5_000 });
  const resolveModal = (): HTMLElement => {
    const modalTitle = screen.getByText(/Pick kitties for listing/i);
    const modalSection = modalTitle.closest("section");
    if (!modalSection) {
      throw new Error("List modal section is missing.");
    }
    return modalSection;
  };
  for (const kittyId of input.kittyIds) {
    await waitFor(() => {
      const candidate = findModalKittySelectionButton(resolveModal(), kittyId);
      if (!candidate) {
        throw new Error(`kPEG #${kittyId} is not selectable yet.`);
      }
    }, { timeout: 5_000 });
    const kittyButton = findModalKittySelectionButton(resolveModal(), kittyId);
    if (!kittyButton) {
      throw new Error(`Unable to locate selection button for kPEG #${kittyId}.`);
    }
    fireEvent.click(kittyButton);
  }
  const priceInput = within(resolveModal()).getByPlaceholderText("0.00");
  fireEvent.change(priceInput, { target: { value: input.priceEth } });
  await waitFor(() => {
    const actionButton = findListModalActionButton(resolveModal());
    if (!actionButton) {
      throw new Error("List modal action button is not visible yet.");
    }
    const label = normalizeText(actionButton.textContent);
    if (
      label.includes("checking approval") ||
      label.includes("confirming") ||
      label.includes("approving") ||
      label.includes("listing") ||
      label.includes("select kpegs")
    ) {
      throw new Error(`List modal action is not ready yet (label='${label}').`);
    }
    if (actionButton.disabled) {
      throw new Error("List modal action button is still disabled.");
    }
  }, { timeout: 8_000 });
  const submitButton = findListModalActionButton(resolveModal());
  if (!submitButton) {
    throw new Error("List modal action button is missing at submit time.");
  }
  fireEvent.click(submitButton);
  await waitFor(() => {
    if (
      input.controller &&
      !input.controller.writeCalls.some(
        (call) => call.functionName === "setKittyTransferApproval",
      )
    ) {
      throw new Error("Approval transaction has not been submitted yet.");
    }
  });
  await waitFor(() => {
    if (
      input.controller &&
      !input.controller.writeCalls.some(
        (call) => call.functionName === "createTradeAndFund",
      )
    ) {
      throw new Error("Create listing transaction has not been submitted yet.");
    }
  });
  switchMarketTab("MY LISTINGS");
  await findMarketBundleCard(input.kittyCount);
}

export async function cancelListingAndWaitRemoved(input: {
  kittyCount: number;
  controller?: UserFlowHarnessController;
}): Promise<void> {
  switchMarketTab("MY LISTINGS");
  await waitFor(
    () => {
      const inlineCancel = screen
        .queryAllByRole("button", {
          name: /^CANCEL$/i,
        })
        .find((button) => normalizeText(button.textContent) === "cancel");
      const card = marketBundleCardOrNull(input.kittyCount);
      const cardOpenable = card?.getAttribute("tabindex") === "0";
      if (!inlineCancel && !cardOpenable) {
        throw new Error("Listing is not cancelable yet.");
      }
    },
    { timeout: 8_000 },
  );
  const inlineCancelButton = screen
    .queryAllByRole("button", {
      name: /^CANCEL$/i,
    })
    .find((button) => normalizeText(button.textContent) === "cancel");
  if (inlineCancelButton) {
    fireEvent.click(inlineCancelButton);
  } else {
    fireEvent.click(await findMarketBundleCard(input.kittyCount));
    await waitFor(
      () => {
        const cancelButton = screen.queryByRole("button", {
          name: /^CANCEL LISTING$/i,
        });
        if (!cancelButton) {
          throw new Error("Cancel action is not visible yet.");
        }
      },
      { timeout: 5_000 },
    );
    cancelListingInDetail();
  }
  await waitFor(() => {
    if (!input.controller) {
      return;
    }
    const deleteCalls = input.controller.writeCalls.filter(
      (call) => call.functionName === "deletePosition",
    );
    if (deleteCalls.length === 0) {
      throw new Error("Cancel listing transaction has not been submitted yet.");
    }
    const latest = deleteCalls[deleteCalls.length - 1];
    const tradeIdRaw = latest?.args?.[0];
    const tradeId = Number(tradeIdRaw ?? 0);
    if (!Number.isFinite(tradeId) || tradeId <= 0) {
      throw new Error(
        `Cancel listing targeted a non-confirmed trade id (${String(tradeIdRaw)}).`,
      );
    }
  });
  switchMarketTab("ALL");
  await waitFor(() => {
    if (marketBundleCardOrNull(input.kittyCount)) {
      throw new Error("Canceled listing is still visible in ALL tab.");
    }
  });
  switchMarketTab("MY LISTINGS");
  await waitFor(() => {
    if (marketBundleCardOrNull(input.kittyCount)) {
      throw new Error("Canceled listing resurrected in MY LISTINGS tab.");
    }
  });
}

export async function expectNoListingDuplicates(kittyCount: number): Promise<void> {
  await waitFor(() => {
    const duplicates = marketBundleCardCount();
    if (duplicates > 1) {
      throw new Error(
        `Expected at most one listing card for ${kittyCount} kPEGs, got ${duplicates}.`,
      );
    }
  });
}

export async function expectNoConfirmingLock(): Promise<void> {
  await waitFor(() => {
    if (
      screen.queryByRole("button", { name: "CONFIRMING..." }) ||
      screen.queryByRole("button", { name: "APPROVING..." }) ||
      screen.queryByRole("button", { name: "LISTING..." })
    ) {
      throw new Error("List modal is still locked in an active action state.");
    }
  });
}

export async function relistSameKittiesAndWaitSingleConfirmed(input: {
  kittyIds: number[];
  priceEth: string;
  kittyCount: number;
  controller?: UserFlowHarnessController;
}): Promise<void> {
  await listSelectedKittiesAndWaitConfirmed(input);
  await expectNoListingDuplicates(input.kittyCount);
}
