import { cleanup, screen, waitFor, within } from "@testing-library/react";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type KittyItem, type MarketListing } from "../lib/api.js";
import { upsertWalletOwnerKittiesOwnedIds } from "../lib/walletOwnerKitties.js";
import {
  buildUserFlowApiMocks,
  buildUserFlowWagmiActionsMocks,
  buildUserFlowWagmiMocks,
  cancelListingAndWaitRemoved,
  createUserFlowQueryClient,
  createUserFlowHarnessController,
  expectNoConfirmingLock,
  expectNoListingDuplicates,
  listSelectedKittiesAndWaitConfirmed,
  openListKpegModal,
  relistSameKittiesAndWaitSingleConfirmed,
  renderUserFlowRoute,
  switchMarketTab,
  type UserFlowHarnessController,
} from "./helpers/userFlowHarness.js";

const WALLET_A = "0x1111111111111111111111111111111111111111";

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

function listing(patch: Partial<MarketListing> = {}): MarketListing {
  return {
    tradeId: 1,
    escrowAddress: controller.marketAddress,
    seller: WALLET_A,
    buyer: null,
    paymentToken: controller.tokenAddress,
    priceWei: "10000000000000000",
    feeBps: 200,
    kittyIds: [101],
    kittyCount: 1,
    status: "OPEN",
    createdBlock: 1,
    createdTxHash: `0x${"1".repeat(64)}`,
    createdAt: 1,
    updatedAt: 1,
    closedBlock: null,
    closedTxHash: null,
    closedAt: null,
    kitties: [kitty(101, WALLET_A)],
    ...patch,
  };
}

function invokeMock<T>(fn: unknown, ...args: unknown[]): T {
  return (fn as (...inner: unknown[]) => T)(...args);
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function metricAriaValue(label: string): string | null {
  const labelNode = screen.getByText(label);
  const metric = labelNode.closest("div");
  if (!metric) {
    return null;
  }
  return metric.querySelector("strong [aria-label]")?.getAttribute("aria-label") ?? null;
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
  class MockIntersectionObserver {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds = [0];
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
    takeRecords = () => [];
    constructor(_callback: IntersectionObserverCallback) {}
  }
  vi.stubGlobal(
    "IntersectionObserver",
    MockIntersectionObserver as unknown as typeof IntersectionObserver,
  );

  controller = createUserFlowHarnessController();
  apiMocks = buildUserFlowApiMocks(controller);
  wagmiMocks = buildUserFlowWagmiMocks(controller);
  wagmiActionsMocks = buildUserFlowWagmiActionsMocks(controller);

  controller.walletAddress = WALLET_A;
  controller.walletConnector = { id: "mock-connector" };
  controller.ethBalanceWei = 5_000_000_000_000_000n;

  controller.setOwnerItems(WALLET_A, [kitty(101, WALLET_A), kitty(102, WALLET_A)]);
  controller.setOwnerKitties(WALLET_A, [101, 102]);
  controller.setOwnerKittiesLive(WALLET_A, 2);
  controller.setOwnerStats(WALLET_A, { currentKitties: 2, everKitties: 2 });
  controller.globalItems = [];
  controller.setMarketListings([]);
  controller.publicClient.waitForTransactionReceipt = async () => ({
    status: "success",
    blockNumber: BigInt(controller.status.latestIndexedBlock + 1),
  });
  controller.publicClient.getTransactionReceipt = async () => ({
    blockNumber: BigInt(controller.status.latestIndexedBlock + 1),
    logs: [],
  });

  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe("market listing lifecycle flow", () => {
  it("keeps market volume loading until fresh stats arrive for this page entry", async () => {
    controller.setMarketListings([listing()]);

    const queryClient = createUserFlowQueryClient();
    queryClient.setQueryData(
      ["market-stats", controller.config.marketAddress],
      {
        listed: 1,
        floorWei: "10000000000000000",
        volumeWei: "40000000000000000",
      },
      { updatedAt: Date.now() - 60_000 },
    );

    const freshStats = {
      listed: 1,
      floorWei: "10000000000000000",
      volumeWei: "195000000000000000",
    };
    const deferredFreshStats = createDeferred<typeof freshStats>();
    apiMocks.getMarketStats.mockImplementation(async () => deferredFreshStats.promise);

    renderUserFlowRoute({ route: "/market", queryClient });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /1 KPEG/i })).not.toBeNull();
    });
    expect(metricAriaValue("Volume")).toBe("loading");
    deferredFreshStats.resolve(freshStats);
    await waitFor(() => {
      expect(metricAriaValue("Volume")).toBe("0.195 ETH");
    });
  });

  it("scopes market volume to owner history tabs instead of keeping global volume", async () => {
    const otherWallet = "0x2222222222222222222222222222222222222222";
    controller.setMarketListings([
      listing({
        tradeId: 1,
        status: "OPEN",
        priceWei: "10000000000000000",
      }),
      listing({
        tradeId: 2,
        seller: WALLET_A,
        buyer: otherWallet,
        status: "SOLD",
        priceWei: "3000000000000000",
        closedBlock: 2,
        closedTxHash: `0x${"2".repeat(64)}`,
        closedAt: 2,
      }),
      listing({
        tradeId: 3,
        seller: otherWallet,
        buyer: WALLET_A,
        status: "SOLD",
        priceWei: "4000000000000000",
        closedBlock: 3,
        closedTxHash: `0x${"3".repeat(64)}`,
        closedAt: 3,
      }),
    ]);
    apiMocks.getMarketStats.mockResolvedValue({
      listed: 1,
      floorWei: "10000000000000000",
      volumeWei: "195000000000000000",
    });

    renderUserFlowRoute({ route: "/market" });

    await waitFor(() => {
      expect(metricAriaValue("Volume")).toBe("0.195 ETH");
    });

    switchMarketTab("SOLD");
    await waitFor(() => {
      expect(metricAriaValue("Volume")).toBe("0.003 ETH");
    });

    switchMarketTab("BOUGHT");
    await waitFor(() => {
      expect(metricAriaValue("Volume")).toBe("0.004 ETH");
    });

    switchMarketTab("MY LISTINGS");
    await waitFor(() => {
      expect(metricAriaValue("Volume")).toBe("0 ETH");
    });
  });

  it("shows API unavailable state and '-' market metrics when market reads fail", async () => {
    apiMocks.getMarketStats.mockRejectedValue(
      new ApiRequestError({
        status: 503,
        path: "/api/market/stats",
        message: "api unavailable",
      }),
    );
    apiMocks.listMarketListings.mockRejectedValue(
      new ApiRequestError({
        status: 503,
        path: "/api/market/listings",
        message: "api unavailable",
      }),
    );

    renderUserFlowRoute({ route: "/market" });

    await waitFor(() => {
      expect(
        screen.queryByText(
          "Indexer API is unavailable. Market listings cannot load right now.",
        ),
      ).not.toBeNull();
    });
    expect(screen.queryByText("No market listings here yet.")).toBeNull();
    expect(metricAriaValue("Listed")).toBe("-");
    expect(metricAriaValue("Floor")).toBe("-");
    expect(metricAriaValue("Volume")).toBe("-");
  });

  it(
    "lists, cancels, and relists the same bundle without duplicates, stale resurrected cards, or confirming lock",
    async () => {
      const approvalHash = `0x${"9".repeat(64)}` as `0x${string}`;
      const delayedApprovalReceipt = createDeferred<{
        status: "success" | "reverted";
        blockNumber: bigint;
      }>();
      let approvalReceiptResolved = false;
      void delayedApprovalReceipt.promise.then(() => {
        approvalReceiptResolved = true;
      });
      controller.setNextWrite("setKittyTransferApproval", {
        hash: approvalHash,
        mode: "success",
      });
      controller.publicClient.waitForTransactionReceipt = async ({ hash }) => {
        if (hash === approvalHash) {
          return delayedApprovalReceipt.promise;
        }
        return {
          status: "success",
          blockNumber: BigInt(controller.status.latestIndexedBlock + 1),
        };
      };

      const rendered = renderUserFlowRoute({ route: "/market" });

      await listSelectedKittiesAndWaitConfirmed({
        kittyIds: [101, 102],
        priceEth: "0.002",
        kittyCount: 2,
        controller,
      });
      const approvalCallIndex = controller.writeCalls.findIndex(
        (call) => call.functionName === "setKittyTransferApproval",
      );
      const listingCallIndex = controller.writeCalls.findIndex(
        (call) => call.functionName === "createTradeAndFund",
      );
      expect(approvalCallIndex).toBeGreaterThanOrEqual(0);
      expect(listingCallIndex).toBeGreaterThan(approvalCallIndex);
      expect(approvalReceiptResolved).toBe(false);
      await expectNoListingDuplicates(2);

      await cancelListingAndWaitRemoved({
        kittyCount: 2,
        controller,
      });
      const ownedAfterCancel = controller.ownerKittiesByOwner.get(
        WALLET_A.toLowerCase(),
      );
      expect(ownedAfterCancel).toBeDefined();
      expect(ownedAfterCancel).toEqual(expect.arrayContaining([101, 102]));
      const ownerItemsAfterCancel = controller.ownerItemsByOwner.get(
        WALLET_A.toLowerCase(),
      );
      expect(ownerItemsAfterCancel?.map((item) => item.id).sort((a, b) => a - b)).toEqual([
        101,
        102,
      ]);
      expect(
        controller.marketListings.filter((listing) => listing.status === "OPEN")
          .length,
      ).toBe(0);
      upsertWalletOwnerKittiesOwnedIds({
        queryClient: rendered.queryClient,
        chainId: controller.chainId,
        tokenAddress: controller.tokenAddress,
        owner: WALLET_A as Address,
        ownerIds: [101, 102],
        kitties: ownerItemsAfterCancel ?? [],
        verified: true,
      });

      openListKpegModal();
      await expectNoConfirmingLock();

      await relistSameKittiesAndWaitSingleConfirmed({
        kittyIds: [101, 102],
        priceEth: "0.002",
        kittyCount: 2,
        controller,
      });

      await expectNoListingDuplicates(2);
      switchMarketTab("ALL");
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: /2 KPEGS/i })).toHaveLength(1);
      });
      switchMarketTab("MY LISTINGS");
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: /2 KPEGS/i })).toHaveLength(1);
      });

      delayedApprovalReceipt.resolve({
        status: "success",
        blockNumber: BigInt(controller.status.latestIndexedBlock + 2),
      });
      await Promise.resolve();
    },
    20_000,
  );

  it("streams dense LIST modal candidates and keeps reserved ids excluded with unchanged CTA behavior", async () => {
    const ownedIds = Array.from({ length: 50 }, (_, index) => index + 101);
    const reservedIds = [108, 121, 149];
    controller.setOwnerItems(WALLET_A, ownedIds.map((id) => kitty(id, WALLET_A)));
    controller.setOwnerKitties(WALLET_A, ownedIds);
    controller.setOwnerKittiesLive(WALLET_A, ownedIds.length);
    controller.setOwnerStats(WALLET_A, {
      currentKitties: ownedIds.length,
      everKitties: ownedIds.length,
    });
    controller.setMarketListings([
      {
        tradeId: 909,
        escrowAddress: controller.marketAddress,
        seller: WALLET_A,
        buyer: null,
        paymentToken: controller.tokenAddress,
        priceWei: "1000000000000000",
        feeBps: 200,
        kittyIds: reservedIds,
        kittyCount: reservedIds.length,
        status: "OPEN",
        createdBlock: 1,
        createdTxHash: `0x${"1".repeat(64)}`,
        createdAt: 1,
        updatedAt: 1,
        closedBlock: null,
        closedTxHash: null,
        closedAt: null,
        kitties: reservedIds.map((id) => kitty(id, WALLET_A)),
      },
    ]);
    controller.setMarketPosition(909, {
      tradeId: 909n,
      seller: WALLET_A as Address,
      buyer: "0x0000000000000000000000000000000000000000" as Address,
      escrowAddress: controller.marketAddress,
      paymentToken: controller.tokenAddress,
      price: 1_000_000_000_000_000n,
      feeBps: 200n,
      kittyIds: reservedIds.map((id) => BigInt(id)),
      status: 0n,
      ready: true,
    });

    renderUserFlowRoute({ route: "/market" });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /LIST kPEG/i })).not.toBeNull();
    });

    openListKpegModal();
    expect(screen.queryByText("Pick kitties for listing")).not.toBeNull();

    const modalHeading = screen.getByRole("heading", {
      name: "Pick kitties for listing",
    });
    const modal = modalHeading.closest("section");
    expect(modal).not.toBeNull();
    const modalScope = within(modal as HTMLElement);
    const expectedSelectableCount = ownedIds.length - reservedIds.length;
    let firstWaveCount = 0;
    await waitFor(() => {
      firstWaveCount = modalScope.queryAllByRole("button", {
        name: /KPEG #/i,
      }).length;
      expect(firstWaveCount).toBeGreaterThan(0);
      expect(firstWaveCount).toBeLessThan(expectedSelectableCount);
    });
    for (const reservedId of reservedIds) {
      expect(
        modalScope.queryByRole("button", {
          name: new RegExp(`KPEG #${reservedId}`, "i"),
        }),
      ).toBeNull();
    }
    await waitFor(() => {
      expect(
        modalScope.queryAllByRole("button", { name: /KPEG #/i }).length,
      ).toBeGreaterThan(firstWaveCount);
    });
    await waitFor(() => {
      expect(
        modalScope.queryAllByRole("button", { name: /KPEG #/i }).length,
      ).toBe(expectedSelectableCount);
    });
    for (const reservedId of reservedIds) {
      expect(
        modalScope.queryByRole("button", {
          name: new RegExp(`KPEG #${reservedId}`, "i"),
        }),
      ).toBeNull();
    }

    modalScope.getByRole("button", { name: /KPEG #101/i }).click();
    expect(
      modalScope.queryByRole("button", { name: "APPROVE SELECTED KPEGS" }),
    ).not.toBeNull();
  });
});
