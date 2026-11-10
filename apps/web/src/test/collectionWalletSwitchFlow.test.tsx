import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../lib/api.js";
import { createUserFlowQueryClient, renderUserFlowRoute } from "./helpers/userFlowHarness.js";

const WALLET_A = "0x1111111111111111111111111111111111111111";
const WALLET_B = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x00000000000000000000000000000000000000aa";

let connectedWallet: string | undefined = WALLET_A;
let delayWalletBStats = false;
let walletBStatsOverride: { currentKitties: number; everKitties: number } | null =
  null;

const getConfigMock = vi.fn();
const getStatusMock = vi.fn();
const getStatsMock = vi.fn();
const getOwnerStatsMock = vi.fn();
const listOwnerMock = vi.fn();
const listGlobalMock = vi.fn();
const searchKittiesMock = vi.fn();
const getKittyOrNullMock = vi.fn();
const useWalletOwnerKittiesMock = vi.fn();

vi.mock("../lib/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api.js")>();
  return {
    ...actual,
    getConfig: (...args: unknown[]) => getConfigMock(...args),
    getStatus: (...args: unknown[]) => getStatusMock(...args),
    getStats: (...args: unknown[]) => getStatsMock(...args),
    getOwnerStats: (...args: unknown[]) => getOwnerStatsMock(...args),
    listOwner: (...args: unknown[]) => listOwnerMock(...args),
    listGlobal: (...args: unknown[]) => listGlobalMock(...args),
    searchKitties: (...args: unknown[]) => searchKittiesMock(...args),
    getKittyOrNull: (...args: unknown[]) => getKittyOrNullMock(...args),
  };
});

vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi")>();
  const makeReadResult = (data: unknown) => ({
    data,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    isPending: false,
    isFetching: false,
    isLoading: false,
  });
  return {
    ...actual,
    useAccount: () => ({ address: connectedWallet, connector: null }),
    useConnect: () => ({
      connect: vi.fn(),
      connectors: [],
      isPending: false,
    }),
    usePublicClient: () => null,
    useWriteContract: () => ({ writeContractAsync: vi.fn() }),
    useReadContract: (input: { functionName: string }) => {
      if (input.functionName === "notMintableAccount") {
        return makeReadResult("0x0000000000000000000000000000000000000000");
      }
      if (input.functionName === "ownerKittiesLive") {
        return makeReadResult(undefined);
      }
      return makeReadResult(undefined);
    },
  };
});

vi.mock("../lib/walletOwnerKitties.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/walletOwnerKitties.js")>();
  return {
    ...actual,
    useWalletOwnerKitties: (...args: unknown[]) => useWalletOwnerKittiesMock(...args),
    upsertWalletOwnerKittiesMetadata: vi.fn(),
  };
});

function metricAriaValue(label: string): string | null {
  const labelNode = screen.getByText(label);
  const metric = labelNode.closest("div");
  if (!metric) {
    return null;
  }
  return metric.querySelector("strong [aria-label]")?.getAttribute("aria-label") ?? null;
}

function hasKittyCardLabel(id: number): boolean {
  return screen.queryByRole("link", { name: new RegExp(`KPEG\\s*#${id}`, "i") }) !== null;
}

function hasModalKittyButton(id: number): boolean {
  return screen.queryByRole("button", { name: new RegExp(`KPEG\\s*#${id}`, "i") }) !== null;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function parseVisibleKittyIds(): number[] {
  const cards = Array.from(document.querySelectorAll("a[href^=\"/kpeg/\"]"));
  const ids: number[] = [];
  for (const card of cards) {
    let current: HTMLElement | null = card as HTMLElement;
    let hidden = false;
    while (current) {
      if (current.style.opacity === "0") {
        hidden = true;
        break;
      }
      current = current.parentElement;
    }
    if (hidden) {
      continue;
    }
    const match = card.getAttribute("href")?.match(/\/kpeg\/(\d+)/);
    if (!match) continue;
    ids.push(Number(match[1]));
  }
  return ids;
}

function findSortButton(label: "Latest" | "Scarcity"): HTMLButtonElement {
  const exact = screen.queryByRole("button", { name: new RegExp(`^${label}$`, "i") });
  if (exact) return exact as HTMLButtonElement;
  throw new Error(`Sort button '${label}' not found.`);
}

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

  connectedWallet = WALLET_A;
  delayWalletBStats = false;
  walletBStatsOverride = null;
  getConfigMock.mockReset();
  getStatusMock.mockReset();
  getStatsMock.mockReset();
  getOwnerStatsMock.mockReset();
  listOwnerMock.mockReset();
  listGlobalMock.mockReset();
  searchKittiesMock.mockReset();
  getKittyOrNullMock.mockReset();
  useWalletOwnerKittiesMock.mockReset();

  getConfigMock.mockResolvedValue({
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
    tokenAddress: TOKEN,
    marketAddress: "0x00000000000000000000000000000000000000bb",
    routerAddress: null,
    quoterAddress: null,
  });
  getStatusMock.mockResolvedValue({
    latestIndexedBlock: 200,
    headBlock: 200,
    caughtUp: true,
    syncing: false,
  });
  getStatsMock.mockResolvedValue({
    tokenSupplyFixed: 9_999,
    kittiesLive: 100,
    kittiesEverMinted: 100,
    holdersLive: 1,
    holdersEver: 1,
    latestIndexedBlock: 200,
  });
  getOwnerStatsMock.mockImplementation(async (owner: string) => {
    const normalized = owner.toLowerCase();
    if (normalized === WALLET_B.toLowerCase() && delayWalletBStats) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (normalized === WALLET_A.toLowerCase()) {
      return { currentKitties: 5, everKitties: 8 };
    }
    if (normalized === WALLET_B.toLowerCase()) {
      return walletBStatsOverride ?? { currentKitties: 1, everKitties: 2 };
    }
    return { currentKitties: 0, everKitties: 0 };
  });
  listOwnerMock.mockImplementation(async (owner: string) => ({
    page: 0,
    pageSize: 24,
    total: owner.toLowerCase() === WALLET_A.toLowerCase() ? 5 : 1,
    items: [],
  }));
  listGlobalMock.mockResolvedValue({
    page: 0,
    pageSize: 24,
    total: 0,
    items: [],
  });
  searchKittiesMock.mockResolvedValue({
    page: 0,
    pageSize: 24,
    total: 0,
    items: [],
  });
  getKittyOrNullMock.mockResolvedValue(null);
  useWalletOwnerKittiesMock.mockImplementation(() => ({
    data: {
      tokenAddress: TOKEN,
      ownerIds:
        connectedWallet?.toLowerCase() === WALLET_A.toLowerCase()
          ? new Set([1, 2, 3, 4, 5])
          : connectedWallet?.toLowerCase() === WALLET_B.toLowerCase()
            ? new Set([101])
            : new Set<number>(),
      kitties: [],
      missingIds: [],
      verified: true,
      updatedAt: Date.now(),
    },
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("collection wallet switching flow", () => {
  it("shows '-' immediately for disconnected collections metrics", async () => {
    connectedWallet = undefined;
    renderUserFlowRoute({ route: "/collections" });
    await waitFor(() => {
      expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows API unavailable state instead of stale backfill copy when collection reads fail", async () => {
    getOwnerStatsMock.mockRejectedValue(
      new ApiRequestError({
        status: 503,
        path: `/api/kitties/owner/${WALLET_A}/stats`,
        message: "api unavailable",
      }),
    );
    listOwnerMock.mockRejectedValue(
      new ApiRequestError({
        status: 503,
        path: `/api/kitties/owner/${WALLET_A}`,
        message: "api unavailable",
      }),
    );
    useWalletOwnerKittiesMock.mockImplementation(() => ({
      data: {
        tokenAddress: TOKEN,
        ownerIds: new Set<number>(),
        kitties: [],
        missingIds: [],
        verified: false,
        updatedAt: Date.now(),
      },
      isPending: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    }));

    renderUserFlowRoute({ route: "/collections" });

    await waitFor(() => {
      expect(
        screen.queryByText("Indexer API is unavailable. Cards cannot load right now."),
      ).not.toBeNull();
    });
    expect(screen.queryByText(/Backfill is running/i)).toBeNull();
    expect(metricAriaValue("KITTIES AT HOME")).toBe("-");
    expect(metricAriaValue("KITTIES EVER YOURS")).toBe("-");
  });

  it("does not leak wallet A stable metrics into wallet B while wallet B stats are still loading", async () => {
    const queryClient = createUserFlowQueryClient();

    connectedWallet = WALLET_A;
    const first = renderUserFlowRoute({
      route: "/collections",
      queryClient,
    });
    await waitFor(() => {
      expect(metricAriaValue("KITTIES AT HOME")).toBe("5");
    });
    first.unmount();

    connectedWallet = WALLET_B;
    delayWalletBStats = true;
    renderUserFlowRoute({
      route: "/collections",
      queryClient,
    });
    await waitFor(() => {
      expect(metricAriaValue("KITTIES AT HOME")).not.toBe("5");
    });
  });

  it("uses verified wallet owner ids for wallet B when owner stats are stale at zero", async () => {
    connectedWallet = WALLET_B;
    walletBStatsOverride = { currentKitties: 0, everKitties: 0 };
    useWalletOwnerKittiesMock.mockImplementation(() => ({
      data: {
        tokenAddress: TOKEN,
        ownerIds: new Set([201, 202, 203]),
        kitties: [],
        missingIds: [],
        verified: true,
        updatedAt: Date.now(),
      },
      isPending: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    }));

    renderUserFlowRoute({ route: "/collections" });
    await waitFor(() => {
      expect(metricAriaValue("KITTIES AT HOME")).toBe("3");
    });
  });

  it("clears stale collection cards immediately after wallet disconnect without page refresh", async () => {
    const queryClient = createUserFlowQueryClient();

    listOwnerMock.mockImplementation(async (owner: string) => ({
      page: 0,
      pageSize: 24,
      total: owner.toLowerCase() === WALLET_A.toLowerCase() ? 1 : 0,
      items:
        owner.toLowerCase() === WALLET_A.toLowerCase()
          ? [
              {
                id: 64,
                seed: "0x1",
                tier: 1,
                tierLabel: "Uncommon",
                mintTier: 1,
                mintTierLabel: "Uncommon",
                owner: WALLET_A.toLowerCase(),
                mintedBy: WALLET_A.toLowerCase(),
                mintBatchSize: 1,
                mintedAt: 1,
                blockNumber: 1,
                txHash: "0xabc",
                rarityScore: 1,
                traits: {
                  background: "Sky",
                  breed: "Persian",
                  clothes: "Pink Scarf",
                  mood: "Purple Moon",
                  marks: "Blush",
                  mouth: "Stoic",
                  eyes: "Happy ^_^",
                  accessory: "None",
                },
                kpegRarity: {
                  label: "RARITY",
                  percentage: 1,
                  oneInN: 1,
                  basis: "Rarity Probability",
                },
              },
            ]
          : [],
    }));
    useWalletOwnerKittiesMock.mockImplementation(() => ({
      data: {
        tokenAddress: TOKEN,
        ownerIds: new Set([64]),
        kitties: [
          {
            id: 64,
            seed: "0x1",
            tier: 1,
            tierLabel: "Uncommon",
            mintTier: 1,
            mintTierLabel: "Uncommon",
            owner: WALLET_A.toLowerCase(),
            mintedBy: WALLET_A.toLowerCase(),
            mintBatchSize: 1,
            mintedAt: 1,
            blockNumber: 1,
            txHash: "0xabc",
            rarityScore: 1,
            traits: {
              background: "Sky",
              breed: "Persian",
              clothes: "Pink Scarf",
              mood: "Purple Moon",
              marks: "Blush",
              mouth: "Stoic",
              eyes: "Happy ^_^",
              accessory: "None",
            },
            kpegRarity: {
              label: "RARITY",
              percentage: 1,
              oneInN: 1,
              basis: "Rarity Probability",
            },
          },
        ],
        missingIds: [],
        verified: true,
        updatedAt: Date.now(),
      },
      isPending: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    }));

    connectedWallet = WALLET_A;
    const route = renderUserFlowRoute({ route: "/collections", queryClient });
    await waitFor(() => {
      expect(hasKittyCardLabel(64)).toBe(true);
    });

    connectedWallet = undefined;
    route.unmount();
    renderUserFlowRoute({ route: "/collections", queryClient });
    await waitFor(() => {
      expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(2);
      expect(hasKittyCardLabel(64)).toBe(false);
      expect(screen.queryByText("You must")).not.toBeNull();
      expect(screen.queryByRole("button", { name: "connect wallet" })).not.toBeNull();
    });
  });

  it("opens transfer shell immediately, streams dense wallet cards, and clears modal cards after disconnect", async () => {
    const queryClient = createUserFlowQueryClient();
    const denseIds = Array.from({ length: 120 }, (_, index) => index + 64);
    useWalletOwnerKittiesMock.mockImplementation(() => ({
      data: {
        tokenAddress: TOKEN,
        ownerIds: new Set(denseIds),
        kitties: [],
        missingIds: [],
        verified: true,
        updatedAt: Date.now(),
      },
      isPending: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    }));

    connectedWallet = WALLET_A;
    const route = renderUserFlowRoute({ route: "/collections", queryClient });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "TRANSFER" })).not.toBeNull();
    });

    screen.getByRole("button", { name: "TRANSFER" }).click();
    await waitFor(() => {
      expect(screen.queryByText("Pick kitties to transfer")).not.toBeNull();
    });
    const modalHeading = screen.getByRole("heading", {
      name: "Pick kitties to transfer",
    });
    const modal = modalHeading.closest("section");
    expect(modal).not.toBeNull();
    const modalScope = within(modal as HTMLElement);

    let firstWaveCount = 0;
    await waitFor(() => {
      firstWaveCount = modalScope.queryAllByRole("button", { name: /KPEG #/i }).length;
      expect(firstWaveCount).toBeGreaterThan(0);
      expect(firstWaveCount).toBeLessThan(denseIds.length);
    });
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(hasModalKittyButton(64)).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("0x..."), {
      target: { value: WALLET_B },
    });
    modalScope.getByRole("button", { name: /KPEG #64/i }).click();
    modalScope.getByRole("button", { name: /KPEG #65/i }).click();
    await waitFor(() => {
      expect(modalScope.queryByText("TRANSFER")).not.toBeNull();
      expect(modalScope.queryByLabelText("2")).not.toBeNull();
    });

    await waitFor(() => {
      expect(
        modalScope.queryAllByRole("button", { name: /KPEG #/i }).length,
      ).toBeGreaterThan(firstWaveCount);
    });

    connectedWallet = undefined;
    route.unmount();
    renderUserFlowRoute({ route: "/collections", queryClient });
    await waitFor(() => {
      expect(screen.queryByText("Pick kitties to transfer")).toBeNull();
      expect(screen.queryByRole("button", { name: /KPEG #64/i })).toBeNull();
      expect(screen.queryByText("You must")).not.toBeNull();
    });
  });

  it("switches explore latest->scarcity without reusing latest cards and paginates scarcity by loaded-count offset", async () => {
    const latestPage = [
      {
        id: 100,
        seed: "0x1",
        tier: 1,
        tierLabel: "Uncommon",
        mintTier: 1,
        mintTierLabel: "Uncommon",
        owner: WALLET_A.toLowerCase(),
        mintedBy: WALLET_A.toLowerCase(),
        mintBatchSize: 1,
        mintedAt: 1,
        blockNumber: 1,
        txHash: "0xabc1",
        rarityScore: 100,
        traits: {
          background: "Sky",
          breed: "Persian",
          clothes: "Pink Scarf",
          mood: "Purple Moon",
          marks: "Blush",
          mouth: "Stoic",
          eyes: "Happy ^_^",
          accessory: "None",
        },
        kpegRarity: { label: "RARITY", percentage: 1, oneInN: 1, basis: "Rarity Probability" },
      },
      {
        id: 99,
        seed: "0x2",
        tier: 1,
        tierLabel: "Uncommon",
        mintTier: 1,
        mintTierLabel: "Uncommon",
        owner: WALLET_A.toLowerCase(),
        mintedBy: WALLET_A.toLowerCase(),
        mintBatchSize: 1,
        mintedAt: 1,
        blockNumber: 1,
        txHash: "0xabc2",
        rarityScore: 99,
        traits: {
          background: "Sky",
          breed: "Persian",
          clothes: "Pink Scarf",
          mood: "Purple Moon",
          marks: "Blush",
          mouth: "Stoic",
          eyes: "Happy ^_^",
          accessory: "None",
        },
        kpegRarity: { label: "RARITY", percentage: 1, oneInN: 1, basis: "Rarity Probability" },
      },
      {
        id: 98,
        seed: "0x3",
        tier: 1,
        tierLabel: "Uncommon",
        mintTier: 1,
        mintTierLabel: "Uncommon",
        owner: WALLET_A.toLowerCase(),
        mintedBy: WALLET_A.toLowerCase(),
        mintBatchSize: 1,
        mintedAt: 1,
        blockNumber: 1,
        txHash: "0xabc3",
        rarityScore: 98,
        traits: {
          background: "Sky",
          breed: "Persian",
          clothes: "Pink Scarf",
          mood: "Purple Moon",
          marks: "Blush",
          mouth: "Stoic",
          eyes: "Happy ^_^",
          accessory: "None",
        },
        kpegRarity: { label: "RARITY", percentage: 1, oneInN: 1, basis: "Rarity Probability" },
      },
    ];
    const scarcityPage0 = [
      { ...latestPage[2], id: 7, rarityScore: 900, txHash: "0xs07" },
      { ...latestPage[1], id: 44, rarityScore: 800, txHash: "0xs44" },
      { ...latestPage[0], id: 12, rarityScore: 700, txHash: "0xs12" },
    ];
    const scarcityPage1 = [{ ...latestPage[0], id: 5, rarityScore: 600, txHash: "0xs05" }];
    const scarcityDeferred = createDeferred<{
      page: number;
      pageSize: number;
      total: number;
      items: typeof scarcityPage0;
    }>();
    listGlobalMock.mockImplementation(
      async (page: number, pageSize: number, sort: "latest" | "scarcity", offset?: number) => {
        if (sort === "latest") {
          return {
            page,
            pageSize,
            total: latestPage.length,
            items: latestPage,
          };
        }
        if ((offset ?? 0) === 0) {
          return scarcityDeferred.promise;
        }
        return {
          page,
          pageSize,
          total: 4,
          items: scarcityPage1,
        };
      },
    );
    const observeCalls: Element[] = [];
    let observerCallback: IntersectionObserverCallback | null = null;
    class MockIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }
      observe = vi.fn((element: Element) => {
        observeCalls.push(element);
      });
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = () => [];
    }
    vi.stubGlobal(
      "IntersectionObserver",
      MockIntersectionObserver as unknown as typeof IntersectionObserver,
    );

    renderUserFlowRoute({ route: "/explore" });
    await waitFor(() => {
      expect(parseVisibleKittyIds()).toEqual([100, 99, 98]);
    });
    const latestCallCount = listGlobalMock.mock.calls.length;

    fireEvent.click(findSortButton("Scarcity"));
    await waitFor(() => {
      expect(
        listGlobalMock.mock.calls.some(
          (args) => args[2] === "scarcity" && Number(args[3]) === 0,
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(parseVisibleKittyIds()).toEqual([]);
    });
    await act(async () => {
      scarcityDeferred.resolve({
        page: 0,
        pageSize: 12,
        total: 4,
        items: scarcityPage0,
      });
    });
    await waitFor(() => {
      expect(parseVisibleKittyIds()).toEqual([7, 44, 12]);
    });

    const latestIds = new Set(latestPage.map((item) => item.id));
    const visibleAfterScarcity = parseVisibleKittyIds();
    expect(visibleAfterScarcity.some((id) => latestIds.has(id))).toBe(false);

    const sentinel = observeCalls[observeCalls.length - 1];
    expect(sentinel).toBeTruthy();
    await waitFor(() => {
      expect(observerCallback).not.toBeNull();
    });
    const triggerObserver = observerCallback;
    if (!triggerObserver) {
      throw new Error("Intersection observer callback missing.");
    }
    (triggerObserver as IntersectionObserverCallback)(
      [{ isIntersecting: true, target: sentinel } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    await waitFor(() => {
      expect(parseVisibleKittyIds()).toEqual([7, 44, 12, 5]);
    });
    await waitFor(() => {
      expect(
        listGlobalMock.mock.calls.some(
          (args) =>
            args[2] === "scarcity" &&
            Number(args[1]) === 12 &&
            Number(args[3]) === 3,
        ),
      ).toBe(true);
    });
  });

  it("clears the pending scope once first-time scarcity data arrives", async () => {
    const latestPage = [
      {
        id: 1,
        seed: "0x01",
        tier: 1,
        tierLabel: "TIER 1",
        mintTier: 1,
        mintTierLabel: "BUY 1",
        owner: WALLET_A,
        mintedBy: WALLET_A,
        mintBatchSize: 1,
        mintedAt: 1,
        blockNumber: 1,
        rarityScore: 100,
        traits: {
          background: "Sky",
          breed: "Persian",
          clothes: "Pink Scarf",
          mood: "Purple Moon",
          marks: "Blush",
          mouth: "Stoic",
          eyes: "Happy ^_^",
          accessory: "None",
        },
        kpegRarity: {
          label: "RARITY",
          percentage: 1,
          oneInN: 100,
          basis: "Rarity Probability",
        },
      },
      {
        id: 2,
        seed: "0x02",
        tier: 1,
        tierLabel: "TIER 1",
        mintTier: 1,
        mintTierLabel: "BUY 1",
        owner: WALLET_A,
        mintedBy: WALLET_A,
        mintBatchSize: 1,
        mintedAt: 2,
        blockNumber: 2,
        rarityScore: 50,
        traits: {
          background: "Sky",
          breed: "Persian",
          clothes: "Pink Scarf",
          mood: "Purple Moon",
          marks: "Blush",
          mouth: "Stoic",
          eyes: "Happy ^_^",
          accessory: "None",
        },
        kpegRarity: {
          label: "RARITY",
          percentage: 1,
          oneInN: 100,
          basis: "Rarity Probability",
        },
      },
    ];
    const scarcityPage = [...latestPage].reverse();
    let seenScarcityRequest = false;

    listGlobalMock.mockImplementation(
      async (_page: number, _pageSize: number, sort: "latest" | "scarcity") => {
        if (sort === "scarcity") {
          seenScarcityRequest = true;
          await new Promise((resolve) => setTimeout(resolve, 0));
          return {
            page: 0,
            pageSize: 24,
            total: scarcityPage.length,
            items: scarcityPage,
          };
        }
        return {
          page: 0,
          pageSize: 24,
          total: latestPage.length,
          items: latestPage,
        };
      },
    );

    renderUserFlowRoute({ route: "/explore" });

    await waitFor(() => {
      expect(hasKittyCardLabel(1)).toBe(true);
    });

    fireEvent.click(findSortButton("Scarcity"));

    await waitFor(() => {
      expect(seenScarcityRequest).toBe(true);
    });

    await waitFor(() => {
      expect(hasKittyCardLabel(2)).toBe(true);
      expect(screen.queryByText(/calling the kitties/i)).toBeNull();
    });
  });

  it("switches owner/portfolio latest->scarcity without reusing latest cards and paginates owner scarcity by loaded-count offset", async () => {
    const owner = WALLET_A.toLowerCase();
    const latestOwnerItems = [
      {
        id: 80,
        seed: "0x80",
        tier: 1,
        tierLabel: "Uncommon",
        mintTier: 1,
        mintTierLabel: "Uncommon",
        owner,
        mintedBy: owner,
        mintBatchSize: 1,
        mintedAt: 1,
        blockNumber: 1,
        txHash: "0x80",
        rarityScore: 80,
        traits: {
          background: "Sky",
          breed: "Persian",
          clothes: "Pink Scarf",
          mood: "Purple Moon",
          marks: "Blush",
          mouth: "Stoic",
          eyes: "Happy ^_^",
          accessory: "None",
        },
        kpegRarity: { label: "RARITY", percentage: 1, oneInN: 1, basis: "Rarity Probability" },
      },
      {
        id: 79,
        seed: "0x79",
        tier: 1,
        tierLabel: "Uncommon",
        mintTier: 1,
        mintTierLabel: "Uncommon",
        owner,
        mintedBy: owner,
        mintBatchSize: 1,
        mintedAt: 1,
        blockNumber: 1,
        txHash: "0x79",
        rarityScore: 79,
        traits: {
          background: "Sky",
          breed: "Persian",
          clothes: "Pink Scarf",
          mood: "Purple Moon",
          marks: "Blush",
          mouth: "Stoic",
          eyes: "Happy ^_^",
          accessory: "None",
        },
        kpegRarity: { label: "RARITY", percentage: 1, oneInN: 1, basis: "Rarity Probability" },
      },
      {
        id: 78,
        seed: "0x78",
        tier: 1,
        tierLabel: "Uncommon",
        mintTier: 1,
        mintTierLabel: "Uncommon",
        owner,
        mintedBy: owner,
        mintBatchSize: 1,
        mintedAt: 1,
        blockNumber: 1,
        txHash: "0x78",
        rarityScore: 78,
        traits: {
          background: "Sky",
          breed: "Persian",
          clothes: "Pink Scarf",
          mood: "Purple Moon",
          marks: "Blush",
          mouth: "Stoic",
          eyes: "Happy ^_^",
          accessory: "None",
        },
        kpegRarity: { label: "RARITY", percentage: 1, oneInN: 1, basis: "Rarity Probability" },
      },
    ];
    const scarcityOwnerPage0 = [
      { ...latestOwnerItems[0], id: 4, rarityScore: 990, txHash: "0x04" },
      { ...latestOwnerItems[1], id: 22, rarityScore: 970, txHash: "0x22" },
      { ...latestOwnerItems[2], id: 9, rarityScore: 960, txHash: "0x09" },
    ];
    const scarcityOwnerPage1 = [{ ...latestOwnerItems[2], id: 3, rarityScore: 950, txHash: "0x03" }];
    const scarcityDeferred = createDeferred<{
      page: number;
      pageSize: number;
      total: number;
      items: typeof scarcityOwnerPage0;
    }>();
    listOwnerMock.mockImplementation(
      async (
        ownerArg: string,
        page: number,
        pageSize: number,
        sort: "latest" | "scarcity",
        offset?: number,
      ) => {
        expect(ownerArg.toLowerCase()).toBe(owner);
        if (sort === "latest") {
          return {
            page,
            pageSize,
            total: latestOwnerItems.length,
            items: latestOwnerItems,
          };
        }
        if ((offset ?? 0) === 0) {
          return scarcityDeferred.promise;
        }
        return {
          page,
          pageSize,
          total: 4,
          items: scarcityOwnerPage1,
        };
      },
    );
    const observeCalls: Element[] = [];
    let observerCallback: IntersectionObserverCallback | null = null;
    class MockIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }
      observe = vi.fn((element: Element) => {
        observeCalls.push(element);
      });
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = () => [];
    }
    vi.stubGlobal(
      "IntersectionObserver",
      MockIntersectionObserver as unknown as typeof IntersectionObserver,
    );

    renderUserFlowRoute({ route: `/portfolio/${WALLET_A}` });
    await waitFor(() => {
      expect(parseVisibleKittyIds()).toEqual([80, 79, 78]);
    });

    fireEvent.click(findSortButton("Scarcity"));
    await waitFor(() => {
      expect(
        listOwnerMock.mock.calls.some(
          (args) =>
            args[0].toLowerCase() === owner &&
            args[3] === "scarcity" &&
            Number(args[4]) === 0,
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(parseVisibleKittyIds()).toEqual([]);
    });
    await act(async () => {
      scarcityDeferred.resolve({
        page: 0,
        pageSize: 12,
        total: 4,
        items: scarcityOwnerPage0,
      });
    });
    await waitFor(() => {
      expect(parseVisibleKittyIds()).toEqual([4, 22, 9]);
    });
    const latestIds = new Set(latestOwnerItems.map((item) => item.id));
    const visibleAfterScarcity = parseVisibleKittyIds();
    expect(visibleAfterScarcity.some((id) => latestIds.has(id))).toBe(false);

    const sentinel = observeCalls[observeCalls.length - 1];
    expect(sentinel).toBeTruthy();
    await waitFor(() => {
      expect(observerCallback).not.toBeNull();
    });
    const triggerObserver = observerCallback;
    if (!triggerObserver) {
      throw new Error("Intersection observer callback missing.");
    }
    (triggerObserver as IntersectionObserverCallback)(
      [{ isIntersecting: true, target: sentinel } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    await waitFor(() => {
      expect(parseVisibleKittyIds()).toEqual([4, 22, 9, 3]);
    });
    await waitFor(() => {
      expect(
        listOwnerMock.mock.calls.some(
          (args) =>
            args[0].toLowerCase() === owner &&
            Number(args[2]) === 12 &&
            args[3] === "scarcity" &&
            Number(args[4]) === 3,
        ),
      ).toBe(true);
    });
  });
});
