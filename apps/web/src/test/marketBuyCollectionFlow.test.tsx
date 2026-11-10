import { cleanup, screen, waitFor } from "@testing-library/react";
import { zeroAddress, type Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KittyItem,
  MarketListing,
  OwnerStatsResponse,
  PagedResponse,
  SortMode,
} from "../lib/api.js";
import {
  appendOptimisticOwnerTransfer,
  clearOptimisticOwnerTransfers,
  readOptimisticOwnerTransfers,
} from "../lib/optimisticOwnerTransfers.js";
import type { MarketPositionViewOnChain } from "../lib/marketReadBack.js";
import {
  buildUserFlowApiMocks,
  buildUserFlowWagmiActionsMocks,
  buildUserFlowWagmiMocks,
  buyListingAndWaitBoughtTab,
  createUserFlowHarnessController,
  goToCollections,
  renderUserFlowRoute,
  switchMarketTab,
  type UserFlowHarnessController,
} from "./helpers/userFlowHarness.js";

const WALLET_A = "0x1111111111111111111111111111111111111111";
const WALLET_B = "0x3D9B395abD62ACa770A8279Ac4bA035B00FED9AB";
const TOKEN = "0x00000000000000000000000000000000000000aa";
const MARKET = "0x00000000000000000000000000000000000000bb";
const SCOPE = { chainId: 84532, tokenAddress: TOKEN };

const traits: KittyItem["traits"] = {
  background: "Sky",
  breed: "Persian",
  clothes: "Pink Scarf",
  mood: "Purple Moon",
  marks: "Blush",
  mouth: "Stoic",
  eyes: "Happy ^_^",
  accessory: "None",
};

function invokeMock<T>(fn: unknown, ...args: unknown[]): T {
  return (fn as (...inner: unknown[]) => T)(...args);
}

function normalizeOwner(owner: string | null | undefined): string {
  return owner?.trim().toLowerCase() ?? "";
}

function paginate<T>(items: readonly T[], page: number, pageSize: number, offset?: number) {
  const start = Math.max(0, offset ?? page * pageSize);
  const end = start + pageSize;
  return {
    total: items.length,
    pageItems: items.slice(start, end),
  };
}

function kitty(id: number, owner: string): KittyItem {
  return {
    id,
    seed: "0x1",
    tier: 1,
    tierLabel: "UNCOMMON",
    mintTier: 1,
    mintTierLabel: "UNCOMMON",
    owner,
    mintedBy: owner,
    mintBatchSize: 1,
    mintedAt: 1,
    blockNumber: 1,
    rarityScore: 1,
    traits,
    kpegRarity: {
      label: "RARITY",
      percentage: 1,
      oneInN: 1,
      basis: "Rarity Probability",
    },
  };
}

function buildListing(tradeId: number, kittyIds: number[]): MarketListing {
  const kitties = kittyIds.map((id) => kitty(id, WALLET_A));
  return {
    tradeId,
    escrowAddress: MARKET,
    seller: WALLET_A,
    buyer: null,
    paymentToken: zeroAddress,
    priceWei: "1000000000000000",
    feeBps: 200,
    kittyIds,
    kittyCount: kittyIds.length,
    status: "OPEN",
    createdBlock: 120,
    createdTxHash: `0x${"1".repeat(64)}`,
    createdAt: 1,
    updatedAt: 1,
    closedBlock: null,
    closedTxHash: null,
    closedAt: null,
    kitties,
  };
}

function buildOpenPosition(listing: MarketListing): MarketPositionViewOnChain {
  return {
    tradeId: BigInt(listing.tradeId),
    seller: listing.seller as Address,
    buyer: zeroAddress,
    escrowAddress: listing.escrowAddress as Address,
    paymentToken: zeroAddress,
    price: BigInt(listing.priceWei),
    feeBps: BigInt(listing.feeBps),
    kittyIds: listing.kittyIds.map((id) => BigInt(id)),
    status: 0n,
    ready: true,
  };
}

function metricAriaValue(label: string): string | null {
  const labelNode = screen.getByText(label);
  const metric = labelNode.closest("div");
  if (!metric) {
    return null;
  }
  return (
    metric.querySelector("strong [aria-label]")?.getAttribute("aria-label") ?? null
  );
}

function marketCardCount(): number {
  return document.querySelectorAll('article[role="button"]').length;
}

let controller: UserFlowHarnessController = createUserFlowHarnessController();
let apiMocks = buildUserFlowApiMocks(controller);
let wagmiMocks = buildUserFlowWagmiMocks(controller);
let wagmiActionsMocks = buildUserFlowWagmiActionsMocks(controller);

vi.mock("../lib/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api.js")>();
  return {
    ...actual,
    getConfig: (...args: unknown[]) => invokeMock(apiMocks.getConfig, ...args),
    getStatus: (...args: unknown[]) => invokeMock(apiMocks.getStatus, ...args),
    getStats: (...args: unknown[]) => invokeMock(apiMocks.getStats, ...args),
    getOwnerStats: (...args: unknown[]) =>
      invokeMock(apiMocks.getOwnerStats, ...args),
    listOwner: (...args: unknown[]) => invokeMock(apiMocks.listOwner, ...args),
    listGlobal: (...args: unknown[]) => invokeMock(apiMocks.listGlobal, ...args),
    searchKitties: (...args: unknown[]) =>
      invokeMock(apiMocks.searchKitties, ...args),
    getKittyOrNull: (...args: unknown[]) =>
      invokeMock(apiMocks.getKittyOrNull, ...args),
    getKitty: (...args: unknown[]) => invokeMock(apiMocks.getKitty, ...args),
    getMarketStats: (...args: unknown[]) =>
      invokeMock(apiMocks.getMarketStats, ...args),
    listMarketListings: (...args: unknown[]) =>
      invokeMock(apiMocks.listMarketListings, ...args),
    getMarketListing: (...args: unknown[]) =>
      invokeMock(apiMocks.getMarketListing, ...args),
    getMarketListingOrNull: (...args: unknown[]) =>
      invokeMock(apiMocks.getMarketListingOrNull, ...args),
    triggerSync: (...args: unknown[]) => invokeMock(apiMocks.triggerSync, ...args),
  };
});

vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi")>();
  return {
    ...actual,
    useAccount: (...args: unknown[]) => invokeMock(wagmiMocks.useAccount, ...args),
    useConnect: (...args: unknown[]) => invokeMock(wagmiMocks.useConnect, ...args),
    usePublicClient: (...args: unknown[]) =>
      invokeMock(wagmiMocks.usePublicClient, ...args),
    useWriteContract: (...args: unknown[]) =>
      invokeMock(wagmiMocks.useWriteContract, ...args),
    useBalance: (...args: unknown[]) => invokeMock(wagmiMocks.useBalance, ...args),
    useReadContract: (...args: unknown[]) =>
      invokeMock(wagmiMocks.useReadContract, ...args),
  };
});

vi.mock("wagmi/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi/actions")>();
  return {
    ...actual,
    getConnectorClient: (...args: unknown[]) =>
      invokeMock(wagmiActionsMocks.getConnectorClient, ...args),
  };
});

beforeEach(() => {
  controller = createUserFlowHarnessController();
  apiMocks = buildUserFlowApiMocks(controller);
  wagmiMocks = buildUserFlowWagmiMocks(controller);
  wagmiActionsMocks = buildUserFlowWagmiActionsMocks(controller);

  controller.walletAddress = WALLET_B;
  controller.walletConnector = { id: "mock-connector" };
  controller.ethBalanceWei = 5_000_000_000_000_000n;

  const listing = buildListing(77, [1, 2, 3]);
  const sellerKitties = listing.kitties.map((item) => ({ ...item }));
  controller.setOwnerItems(WALLET_A, sellerKitties);
  controller.setOwnerStats(WALLET_A, { currentKitties: 3, everKitties: 3 });
  controller.setOwnerKitties(WALLET_A, [1, 2, 3]);
  controller.setOwnerKittiesLive(WALLET_A, 3);

  controller.setOwnerItems(WALLET_B, []);
  controller.setOwnerStats(WALLET_B, { currentKitties: 0, everKitties: 0 });
  controller.setOwnerKitties(WALLET_B, []);
  controller.setOwnerKittiesLive(WALLET_B, 0);

  controller.setMarketListings([listing]);
  controller.setMarketListingDetail(listing.tradeId, listing);
  controller.setMarketPosition(listing.tradeId, buildOpenPosition(listing));

  clearOptimisticOwnerTransfers(SCOPE);
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  clearOptimisticOwnerTransfers(SCOPE);
  window.sessionStorage.clear();
});

describe("market buy to collections flow", () => {
  it("shows bought listing in BOUGHT, removes it from ALL, and shows KITTIES AT HOME=3 with exact cards", async () => {
    renderUserFlowRoute({ route: "/market" });
    await buyListingAndWaitBoughtTab({ tradeId: 77, kittyCount: 3 });

    switchMarketTab("ALL");
    await waitFor(() => {
      expect(marketCardCount()).toBe(0);
    });

    switchMarketTab("BOUGHT");
    await waitFor(() => {
      expect(marketCardCount()).toBe(1);
    });

    await goToCollections();
    await waitFor(() => {
      expect(metricAriaValue("KITTIES AT HOME")).toBe("3");
    });
    await waitFor(() => {
      expect(screen.getByRole("img", { name: /kPEG #1/i })).toBeTruthy();
      expect(screen.getByRole("img", { name: /kPEG #2/i })).toBeTruthy();
      expect(screen.getByRole("img", { name: /kPEG #3/i })).toBeTruthy();
    });
  }, 20_000);

  it("keeps collections current count from verified owner ids even when owner API summary/list are stale", async () => {
    const staleSummary: OwnerStatsResponse = { currentKitties: 0, everKitties: 0 };
    (apiMocks.getOwnerStats as ReturnType<typeof vi.fn>).mockImplementation(
      async (owner: string) => {
        const normalized = normalizeOwner(owner);
        if (normalized === normalizeOwner(WALLET_B)) {
          return staleSummary;
        }
        return controller.ownerStatsByOwner.get(normalized) ?? staleSummary;
      },
    );
    (apiMocks.listOwner as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        owner: string,
        page: number,
        pageSize: number,
        _sort: SortMode,
        offset?: number,
      ): Promise<PagedResponse> => {
        const normalized = normalizeOwner(owner);
        if (normalized === normalizeOwner(WALLET_B)) {
          return { page, pageSize, total: 0, items: [] };
        }
        const items = controller.ownerItemsByOwner.get(normalized) ?? [];
        const { total, pageItems } = paginate(items, page, pageSize, offset);
        return { page, pageSize, total, items: pageItems };
      },
    );

    renderUserFlowRoute({ route: "/market" });
    await buyListingAndWaitBoughtTab({ tradeId: 77, kittyCount: 3 });
    await goToCollections();
    await waitFor(() => {
      expect(metricAriaValue("KITTIES AT HOME")).toBe("3");
    });
  }, 20_000);

  it("renders bought kitty cards even when owner list API is empty by using listing metadata path", async () => {
    (apiMocks.getOwnerStats as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentKitties: 0,
      everKitties: 0,
    } satisfies OwnerStatsResponse);
    (apiMocks.listOwner as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _owner: string,
        page: number,
        pageSize: number,
      ): Promise<PagedResponse> => ({
        page,
        pageSize,
        total: 0,
        items: [],
      }),
    );

    renderUserFlowRoute({ route: "/market" });
    await buyListingAndWaitBoughtTab({ tradeId: 77, kittyCount: 3 });
    controller.setOwnerItems(WALLET_B, []);
    await goToCollections();
    await waitFor(() => {
      expect(screen.getByRole("img", { name: /kPEG #1/i })).toBeTruthy();
      expect(screen.getByRole("img", { name: /kPEG #2/i })).toBeTruthy();
      expect(screen.getByRole("img", { name: /kPEG #3/i })).toBeTruthy();
    });
  }, 20_000);

  it("bypasses cooldown on quick revisit via post-trade refresh and still updates to 3", async () => {
    const firstCollections = renderUserFlowRoute({ route: "/collections" });
    await waitFor(() => {
      expect(metricAriaValue("KITTIES AT HOME")).toBe("0");
    });
    const sharedQueryClient = firstCollections.queryClient;
    firstCollections.unmount();

    const marketView = renderUserFlowRoute({
      route: "/market",
      queryClient: sharedQueryClient,
    });
    await buyListingAndWaitBoughtTab({ tradeId: 77, kittyCount: 3 });
    marketView.unmount();

    renderUserFlowRoute({
      route: "/collections",
      queryClient: sharedQueryClient,
    });
    await waitFor(() => {
      expect(metricAriaValue("KITTIES AT HOME")).toBe("3");
    });
  }, 20_000);

  it("retains LISTING_BOUGHT overlay until buyer owner source confirms ids, then prunes it", async () => {
    appendOptimisticOwnerTransfer(SCOPE, {
      txHash: `0x${"7".repeat(64)}`,
      blockNumber: 120,
      from: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      to: WALLET_B,
      kittyIds: [1, 2, 3],
      kitties: [kitty(1, WALLET_B), kitty(2, WALLET_B), kitty(3, WALLET_B)],
      reason: "LISTING_BOUGHT",
    });

    const first = renderUserFlowRoute({ route: "/collections" });
    await waitFor(() => {
      expect(readOptimisticOwnerTransfers(SCOPE)).toHaveLength(1);
    });
    first.unmount();

    controller.setOwnerKitties(WALLET_B, [1, 2, 3]);
    controller.setOwnerKittiesLive(WALLET_B, 3);
    renderUserFlowRoute({
      route: "/collections",
      queryClient: first.queryClient,
    });
    await waitFor(() => {
      expect(readOptimisticOwnerTransfers(SCOPE)).toHaveLength(0);
    });
  }, 20_000);
});
