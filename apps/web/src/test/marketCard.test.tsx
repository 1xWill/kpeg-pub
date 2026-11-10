import { readFileSync } from "node:fs";
import { createRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSelectableListingCandidates,
  executeMarketBuySubmitFlow,
  executeMarketListingSubmitFlow,
  deriveSelectedKittyApprovalState,
  ListingModal,
  marketEmptyStateMessage,
  marketListingsOwnerScope,
  marketScopeNeedsWalletConnection,
  shouldDisableMarketSortDuringSearch,
  marketStatsFromVisibleListings,
  marketStatsAreFreshForPage,
  readSelectedApprovalForIdsWithFallback,
  runListingApprovalStep,
  marketCardEthLabel,
  listingBuyInsufficientEth,
  shouldClearBuyListingActionAfterError,
  MarketCard,
  marketTxHasOwnershipImpact,
  resolveOwnedKittiesQueryData,
  selectedListingStateError,
  resolveVisibleMarketListings,
  SellerListingControls,
  syncMarketQueriesForAction,
  validateListingPriceInput,
  verifyMarketListingSelection,
  waitForMarketTxOutcome,
  type MarketListingFlowReceipt,
} from "../pages/MarketPage.js";
import type { KittyItem, MarketListing } from "../lib/api.js";
import {
  mergeMarketListingViews,
  type MarketListingView,
} from "../lib/marketListingState.js";
import {
  MARKET_BUY_LISTING_CHANGED_ERROR,
  verifyMarketBuyListing,
} from "../lib/marketReadBack.js";
import {
  clearOptimisticMarketListings,
  readOptimisticMarketListings,
  upsertOptimisticMarketListing,
} from "../lib/optimisticMarketListings.js";

const renderKPEGSvgDataUriMock = vi.fn(
  (_traits: unknown) => "data:image/svg+xml;utf8,mock",
);
vi.mock("@kpeg/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kpeg/core")>();
  return {
    ...actual,
    renderKPEGSvgDataUri: (traits: unknown) =>
      renderKPEGSvgDataUriMock(traits),
  };
});

vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi")>();
  return {
    ...actual,
    useAccount: () => ({ address: undefined }),
    useBalance: () => ({ data: undefined }),
    usePublicClient: () => undefined,
    useWriteContract: () => ({ writeContractAsync: vi.fn() }),
  };
});

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../hooks/useKittyDetailPrefetch.js", () => ({
  useKittyDetailPrefetch: () => ({}),
}));

afterEach(() => {
  cleanup();
  renderKPEGSvgDataUriMock.mockClear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

function kitty(id: number, tierLabel = "Uncommon"): KittyItem {
  const normalizedTier = tierLabel.trim().toUpperCase();
  const tierByLabel: Record<string, number> = {
    COMMON: 0,
    UNCOMMON: 1,
    RARE: 2,
    EPIC: 3,
    LEGENDARY: 4,
  };
  const tier = tierByLabel[normalizedTier] ?? 1;
  return {
    id,
    seed: "0x1",
    tier,
    tierLabel,
    mintTier: tier,
    mintTierLabel: tierLabel,
    owner: "0x1111111111111111111111111111111111111111",
    mintedBy: "0x2222222222222222222222222222222222222222",
    mintBatchSize: 25,
    mintedAt: 1,
    blockNumber: 2,
    txHash: "0x3",
    rarityScore: 1,
    traits,
    traitOdds: Object.fromEntries(
      Object.keys(traits).map((key) => [
        key,
        {
          trait: traits[key as keyof typeof traits],
          selectedWeight: 1,
          contextTotalWeight: 1,
          probabilityPct: 100,
        },
      ]),
    ) as NonNullable<KittyItem["traitOdds"]>,
    kpegRarity: {
      label: "RARITY",
      percentage: 1,
      oneInN: 1,
      basis: "Rarity Probability",
    },
  };
}

function listing(patch: Partial<MarketListing> = {}): MarketListingView {
  return {
    tradeId: 64,
    escrowAddress: "0x3333333333333333333333333333333333333333",
    seller: "0x1111111111111111111111111111111111111111",
    buyer: null,
    paymentToken: "0x0000000000000000000000000000000000000000",
    priceWei: "1000000000000000000",
    feeBps: 200,
    kittyIds: [64],
    kittyCount: 1,
    status: "OPEN",
    createdBlock: 1,
    createdTxHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
    createdAt: 1,
    updatedAt: 1,
    closedBlock: null,
    closedTxHash: null,
    closedAt: null,
    kitties: [kitty(64)],
    ...patch,
  };
}

function hasClassInAncestorChain(
  element: Element | null,
  classNameFragment: string,
): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.className?.toString().includes(classNameFragment)) return true;
    current = current.parentElement;
  }
  return false;
}

describe("MarketCard", () => {
  it("shows in-flight listing state without pending-funding copy", () => {
    const inFlightListing: MarketListingView = {
      ...listing(),
      optimisticPhase: "listing",
    };
    render(
      <MarketCard
        listing={inFlightListing}
        ownerActions
        buyerAction={false}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Listing #64")).not.toBeNull();
    expect(screen.queryByText("FUND")).toBeNull();
    expect(screen.queryByText("ETH")).toBeNull();
    expect(screen.queryByText("UPDATE")).toBeNull();
  });

  it("keeps rolling labels inside CardMetaText sizing wrappers", () => {
    render(
      <MarketCard
        listing={listing()}
        ownerActions={false}
        buyerAction
        onOpen={vi.fn()}
        onCancel={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(
      hasClassInAncestorChain(
        screen.getByLabelText("KPEG #64"),
        "text-[clamp(0.65rem,1.4vw,0.8rem)]",
      ),
    ).toBe(true);

    expect(
      hasClassInAncestorChain(
        screen.getByText("BUY NOW"),
        "text-[clamp(0.6rem,1.1vw,0.7rem)]",
      ),
    ).toBe(true);
  });

  it("renders sold rows without buy or seller action labels", () => {
    render(
      <MarketCard
        listing={listing({ status: "SOLD" })}
        ownerActions={false}
        buyerAction={false}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.queryByText("BUY NOW")).toBeNull();
    expect(screen.queryByText("CANCEL")).toBeNull();
    expect(screen.queryByText("UPDATE")).toBeNull();
  });

  it("uses compact 0.0(n)xx style for tiny non-zero listing prices", () => {
    expect(marketCardEthLabel("1000000000000")).toEqual({
      mode: "compact",
      zeroCount: 5,
      significantText: "1",
    });

    render(
      <MarketCard
        listing={listing({ priceWei: "1000000000000" })}
        ownerActions={false}
        buyerAction
        onOpen={vi.fn()}
        onCancel={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("0.0")).not.toBeNull();
    expect(screen.queryByText("ETH")).not.toBeNull();
  });

  it("applies metallic tier treatment only for rare and above single-kitty cards", () => {
    render(
      <MarketCard
        listing={listing({
          kitties: [kitty(64, "Rare")],
        })}
        ownerActions={false}
        buyerAction
        onOpen={vi.fn()}
        onCancel={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    const rareCard = screen.getByRole("button");
    expect(rareCard.className).toContain("tier-metal-card");
    expect(rareCard.getAttribute("data-tier-metal")).toBe("rare");
    expect(rareCard.style.getPropertyValue("--tier-metal-sync-delay")).toBe("");

    cleanup();

    render(
      <MarketCard
        listing={listing()}
        ownerActions={false}
        buyerAction
        onOpen={vi.fn()}
        onCancel={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    const uncommonCard = screen.getByRole("button");
    expect(uncommonCard.className).not.toContain("tier-metal-card");
    expect(uncommonCard.getAttribute("data-tier-metal")).toBeNull();
    expect(uncommonCard.style.getPropertyValue("--tier-metal-sync-delay")).toBe("");
  });
});

describe("SellerListingControls", () => {
  it("blocks zero as an update price and shows a clear error", () => {
    render(
      <SellerListingControls
        actionBusy={false}
        priceInput="0"
        priceInputRef={createRef<HTMLInputElement>()}
        onPriceInputChange={vi.fn()}
        onCancel={vi.fn()}
        onUpdatePrice={vi.fn()}
      />,
    );

    expect(screen.queryByText("Price must be greater than 0 ETH.")).not.toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "UPDATE PRICE",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe("listingBuyInsufficientEth", () => {
  it("does not show insufficient when wallet is disconnected", () => {
    expect(
      listingBuyInsufficientEth({
        walletConnected: false,
        ethBalance: 0n,
        priceWei: "1000000000000000",
      }),
    ).toBe(false);
  });

  it("does not show insufficient while balance is still unknown", () => {
    expect(
      listingBuyInsufficientEth({
        walletConnected: true,
        ethBalance: null,
        priceWei: "1000000000000000",
      }),
    ).toBe(false);
  });

  it("shows insufficient only when connected balance is lower than price", () => {
    expect(
      listingBuyInsufficientEth({
        walletConnected: true,
        ethBalance: 999999999999999n,
        priceWei: "1000000000000000",
      }),
    ).toBe(true);
    expect(
      listingBuyInsufficientEth({
        walletConnected: true,
        ethBalance: 1000000000000000n,
        priceWei: "1000000000000000",
      }),
    ).toBe(false);
  });
});

describe("shouldClearBuyListingActionAfterError", () => {
  it("clears buy action only when verification passed but wallet tx hash was never submitted", () => {
    expect(
      shouldClearBuyListingActionAfterError({
        buyVerified: true,
        hash: null,
      }),
    ).toBe(true);
    expect(
      shouldClearBuyListingActionAfterError({
        buyVerified: false,
        hash: null,
      }),
    ).toBe(false);
    expect(
      shouldClearBuyListingActionAfterError({
        buyVerified: true,
        hash: `0x${"1".repeat(64)}`,
      }),
    ).toBe(false);
  });
});

describe("ListingModal", () => {
  it("routes approval-required CTA through onSubmit", () => {
    const onSubmit = vi.fn();
    render(
      <ListingModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        priceInput="1"
        feeBps={200}
        listAction="idle"
        selectedApproved={false}
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onPriceChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    screen.getByRole("button", { name: "APPROVE SELECTED KPEGS" }).click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("routes to onSubmit before and after approval-required state flips", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <ListingModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        priceInput="1"
        feeBps={200}
        listAction="idle"
        selectedApproved={false}
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onPriceChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    screen.getByRole("button", { name: "APPROVE SELECTED KPEGS" }).click();
    expect(onSubmit).toHaveBeenCalledTimes(1);

    rerender(
      <ListingModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        priceInput="1"
        feeBps={200}
        listAction="idle"
        selectedApproved
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onPriceChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    screen.getByRole("button", { name: /LIST/i }).click();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("shows wallet loading before empty-wallet copy", () => {
    render(
      <ListingModal
        kitties={[]}
        loading
        loadError={false}
        selectedIds={[]}
        priceInput=""
        feeBps={200}
        listAction="idle"
        selectedApproved
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onPriceChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByText("Loading wallet kPEGs...")).not.toBeNull();
    expect(screen.queryByText("You don't have any kPEG yet.")).toBeNull();
  });

  it("shows shared load error and INDEXING placeholder states", () => {
    const { rerender } = render(
      <ListingModal
        kitties={[]}
        loading={false}
        loadError
        selectedIds={[]}
        priceInput=""
        feeBps={200}
        listAction="idle"
        selectedApproved
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onPriceChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByText("Could not verify wallet kPEGs from chain.")).not.toBeNull();

    rerender(
      <ListingModal
        kitties={[{ id: 64, kitty: null }]}
        loading={false}
        loadError={false}
        selectedIds={[]}
        priceInput=""
        feeBps={200}
        listAction="idle"
        selectedApproved
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onPriceChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByText("INDEXING")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /KPEG #64/i })).not.toBeNull();
  });

  it("blocks zero listing price with inline validation", () => {
    render(
      <ListingModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        priceInput="0"
        feeBps={200}
        listAction="idle"
        selectedApproved
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onPriceChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByText("Price must be greater than 0 ETH.")).not.toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: /LIST/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("keeps CTA spacing and centered rolling count for LIST n KPEG", () => {
    render(
      <ListingModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        priceInput="1"
        feeBps={200}
        listAction="idle"
        selectedApproved
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onPriceChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByText("LIST")).not.toBeNull();
    expect(screen.queryByLabelText("1")).not.toBeNull();
    expect(screen.queryByText("KPEG")).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: /LIST/i })
        .querySelector("span.inline-flex.items-center"),
    ).not.toBeNull();
  });

  it("keeps consistent CTA height class before and after selection", () => {
    const { rerender } = render(
      <ListingModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[]}
        priceInput="1"
        feeBps={200}
        listAction="idle"
        selectedApproved
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onPriceChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const before = screen.getByRole("button", { name: "SELECT KPEGS" });
    expect(before.className.includes("min-h-[2.2rem]")).toBe(true);

    rerender(
      <ListingModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        priceInput="1"
        feeBps={200}
        listAction="idle"
        selectedApproved
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onPriceChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const after = screen.getByRole("button", { name: /LIST/i });
    expect(after.className.includes("min-h-[2.2rem]")).toBe(true);
  });

  it("keeps card selection interactive while approval checking is in background", () => {
    const onToggle = vi.fn();
    render(
      <ListingModal
        kitties={[
          { id: 64, kitty: kitty(64) },
          { id: 65, kitty: kitty(65) },
        ]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        priceInput="1"
        feeBps={200}
        listAction="idle"
        selectedApproved={false}
        approvalChecking
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={onToggle}
        onPriceChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    screen.getByRole("button", { name: /KPEG #64/i }).click();
    screen.getByRole("button", { name: /KPEG #65/i }).click();
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("CHECKING APPROVAL...")).not.toBeNull();
  });

  it("locks card selection during approving and listing actions", () => {
    const onToggleApproving = vi.fn();
    const { rerender } = render(
      <ListingModal
        kitties={[
          { id: 64, kitty: kitty(64) },
          { id: 65, kitty: kitty(65) },
        ]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        priceInput="1"
        feeBps={200}
        listAction="approving"
        selectedApproved={false}
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={onToggleApproving}
        onPriceChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const approvingButton = screen.getByRole("button", { name: /KPEG #64/i });
    expect((approvingButton as HTMLButtonElement).disabled).toBe(true);
    approvingButton.click();
    expect(onToggleApproving).not.toHaveBeenCalled();

    const onToggleListing = vi.fn();
    rerender(
      <ListingModal
        kitties={[
          { id: 64, kitty: kitty(64) },
          { id: 65, kitty: kitty(65) },
        ]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        priceInput="1"
        feeBps={200}
        listAction="listing"
        selectedApproved={true}
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={onToggleListing}
        onPriceChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const listingButton = screen.getByRole("button", { name: /KPEG #64/i });
    expect((listingButton as HTMLButtonElement).disabled).toBe(true);
    listingButton.click();
    expect(onToggleListing).not.toHaveBeenCalled();
  });

  it("still lets selected kPEGs be deselected at max bundle size", () => {
    const onToggle = vi.fn();
    render(
      <ListingModal
        kitties={[
          { id: 64, kitty: kitty(64) },
          { id: 65, kitty: kitty(65) },
        ]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        priceInput="1"
        feeBps={200}
        listAction="idle"
        selectedApproved
        approvalChecking={false}
        open
        maxBundleSize={1}
        onClose={vi.fn()}
        onToggle={onToggle}
        onPriceChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const selectedButton = screen.getByRole("button", { name: /KPEG #64/i });
    const unselectedButton = screen.getByRole("button", { name: /KPEG #65/i });
    expect((selectedButton as HTMLButtonElement).disabled).toBe(false);
    expect((unselectedButton as HTMLButtonElement).disabled).toBe(true);

    selectedButton.click();
    expect(onToggle).toHaveBeenCalledWith(64);
  });

  it("keeps static art render count stable when selection state does not change", () => {
    const { rerender } = render(
      <ListingModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        priceInput="1"
        feeBps={200}
        listAction="idle"
        selectedApproved
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onPriceChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(renderKPEGSvgDataUriMock).toHaveBeenCalledTimes(1);

    rerender(
      <ListingModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        priceInput="1.5"
        feeBps={200}
        listAction="idle"
        selectedApproved
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onPriceChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(renderKPEGSvgDataUriMock).toHaveBeenCalledTimes(1);
  });

  it("progressively mounts dense listing candidates and keeps reserved IDs out", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const allOwned = Array.from({ length: 50 }, (_, index) => kitty(index + 64));
    const ownerIds = new Set(allOwned.map((item) => item.id));
    const reservedIds = new Set([70, 81, 93]);
    const selectableCandidates = buildSelectableListingCandidates(
      allOwned,
      ownerIds,
      reservedIds,
    );

    render(
      <ListingModal
        kitties={selectableCandidates}
        loading={false}
        loadError={false}
        selectedIds={[]}
        priceInput="1"
        feeBps={200}
        listAction="idle"
        selectedApproved
        approvalChecking={false}
        open
        maxBundleSize={100}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onPriceChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const firstWaveCount = screen.queryAllByRole("button", {
      name: /KPEG #/i,
    }).length;
    expect(firstWaveCount).toBeGreaterThan(0);
    expect(firstWaveCount).toBeLessThan(selectableCandidates.length);
    expect(renderKPEGSvgDataUriMock).toHaveBeenCalledTimes(firstWaveCount);
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /KPEG #70/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /KPEG #81/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /KPEG #93/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /SELECT KPEGS/i })).not.toBeNull();

    for (let iteration = 0; iteration < 8; iteration += 1) {
      act(() => {
        vi.runOnlyPendingTimers();
      });
    }

    expect(
      screen.queryAllByRole("button", { name: /KPEG #/i }).length,
    ).toBe(selectableCandidates.length);
    expect(renderKPEGSvgDataUriMock).toHaveBeenCalledTimes(
      selectableCandidates.length,
    );
    expect(screen.queryByRole("button", { name: /KPEG #70/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /KPEG #81/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /KPEG #93/i })).toBeNull();
  });
});

describe("validateListingPriceInput", () => {
  it("rejects zero and accepts positive ETH values", () => {
    expect(validateListingPriceInput("0")).toEqual({
      priceWei: null,
      error: "Price must be greater than 0 ETH.",
    });
    expect(validateListingPriceInput("0.01")).toEqual({
      priceWei: 10_000_000_000_000_000n,
      error: null,
    });
  });
});

describe("readSelectedApprovalForIdsWithFallback", () => {
  it("returns false for empty selected IDs", async () => {
    const readViaPublicClient = vi.fn();
    const readViaConnectedWallet = vi.fn();

    await expect(
      readSelectedApprovalForIdsWithFallback({
        kittyIds: [],
        readViaPublicClient,
        readViaConnectedWallet,
      }),
    ).resolves.toBe(false);

    expect(readViaPublicClient).not.toHaveBeenCalled();
    expect(readViaConnectedWallet).not.toHaveBeenCalled();
  });

  it("accepts public-client approval without connected fallback", async () => {
    const readViaPublicClient = vi.fn().mockResolvedValue(true);
    const readViaConnectedWallet = vi.fn();

    await expect(
      readSelectedApprovalForIdsWithFallback({
        kittyIds: [64],
        readViaPublicClient,
        readViaConnectedWallet,
      }),
    ).resolves.toBe(true);

    expect(readViaPublicClient).toHaveBeenCalledTimes(1);
    expect(readViaConnectedWallet).not.toHaveBeenCalled();
  });

  it("falls back to connected wallet when public client reports false", async () => {
    const readViaPublicClient = vi.fn().mockResolvedValue(false);
    const readViaConnectedWallet = vi.fn().mockResolvedValue(true);

    await expect(
      readSelectedApprovalForIdsWithFallback({
        kittyIds: [64, 65],
        readViaPublicClient,
        readViaConnectedWallet,
      }),
    ).resolves.toBe(true);

    expect(readViaPublicClient).toHaveBeenCalledTimes(1);
    expect(readViaConnectedWallet).toHaveBeenCalledTimes(1);
  });

  it("falls back after public-client throw and returns false when wallet also fails", async () => {
    const onPublicClientFailure = vi.fn();
    const onConnectedWalletFailure = vi.fn();
    const readViaPublicClient = vi
      .fn()
      .mockRejectedValue(new Error("public rpc down"));
    const readViaConnectedWallet = vi
      .fn()
      .mockRejectedValue(new Error("wallet read down"));

    await expect(
      readSelectedApprovalForIdsWithFallback({
        kittyIds: [64],
        readViaPublicClient,
        readViaConnectedWallet,
        onPublicClientFailure,
        onConnectedWalletFailure,
      }),
    ).resolves.toBe(false);

    expect(onPublicClientFailure).toHaveBeenCalledTimes(1);
    expect(onConnectedWalletFailure).toHaveBeenCalledTimes(1);
  });
});

describe("deriveSelectedKittyApprovalState", () => {
  it("does not mark current selection approved when query result belongs to stale selected IDs", () => {
    expect(
      deriveSelectedKittyApprovalState({
        sortedSelectedIds: [64, 65, 66],
        debouncedSortedSelectedIds: [64, 65],
        queryApproved: true,
        queryLoading: false,
        queryFetching: false,
      }),
    ).toEqual({
      selectedApproved: false,
      approvalChecking: true,
    });
  });

  it("marks selected IDs approved only when current and query-selected IDs match", () => {
    expect(
      deriveSelectedKittyApprovalState({
        sortedSelectedIds: [64, 65],
        debouncedSortedSelectedIds: [64, 65],
        queryApproved: true,
        queryLoading: false,
        queryFetching: false,
      }),
    ).toEqual({
      selectedApproved: true,
      approvalChecking: false,
    });
  });
});

describe("runListingApprovalStep", () => {
  it("fresh-reads exact current selected IDs before deciding approval", async () => {
    const readSelectedApprovalForIds = vi.fn().mockResolvedValue(true);
    const approveSelectedKitties = vi.fn().mockResolvedValue("approved");
    const kittyIds = [66, 64, 65];

    await expect(
      runListingApprovalStep({
        kittyIds,
        readSelectedApprovalForIds,
        approveSelectedKitties,
      }),
    ).resolves.toBe("already-approved");

    expect(readSelectedApprovalForIds).toHaveBeenCalledWith(kittyIds);
    expect(approveSelectedKitties).not.toHaveBeenCalled();
  });

  it("runs approval for current selected IDs when fresh read reports not approved", async () => {
    const readSelectedApprovalForIds = vi.fn().mockResolvedValue(false);
    const approveSelectedKitties = vi.fn().mockResolvedValue("approved");
    const onApprovalRequired = vi.fn();
    const kittyIds = [64, 65];

    await expect(
      runListingApprovalStep({
        kittyIds,
        readSelectedApprovalForIds,
        approveSelectedKitties,
        onApprovalRequired,
      }),
    ).resolves.toBe("approved");

    expect(readSelectedApprovalForIds).toHaveBeenCalledWith(kittyIds);
    expect(onApprovalRequired).toHaveBeenCalledTimes(1);
    expect(approveSelectedKitties).toHaveBeenCalledWith(kittyIds);
  });

  it("surfaces pending approval outcome and does not continue as approved", async () => {
    const readSelectedApprovalForIds = vi.fn().mockResolvedValue(false);
    const approveSelectedKitties = vi.fn().mockResolvedValue("pending");
    const kittyIds = [64, 65];

    await expect(
      runListingApprovalStep({
        kittyIds,
        readSelectedApprovalForIds,
        approveSelectedKitties,
      }),
    ).resolves.toBe("pending");

    expect(readSelectedApprovalForIds).toHaveBeenCalledWith(kittyIds);
    expect(approveSelectedKitties).toHaveBeenCalledWith(kittyIds);
  });
});

describe("marketEmptyStateMessage", () => {
  it("shows catch-up guidance while the index is still backfilling", () => {
    expect(
      marketEmptyStateMessage({
        activeTab: "all",
        apiUnavailable: false,
        backfillActive: true,
        searchValue: "",
        knownListed: 2,
      }),
    ).toBe(
      "Market index is catching up. Listings appear as indexing reaches the latest blocks.",
    );
  });

  it("keeps wallet gating for owner-only tabs", () => {
    expect(
      marketScopeNeedsWalletConnection({
        marketQueryEnabled: false,
      }),
    ).toBe(true);
  });

  it("switches to tab and search specific empty copy after loading", () => {
    expect(
      marketEmptyStateMessage({
        activeTab: "sold",
        apiUnavailable: false,
        backfillActive: true,
        searchValue: "",
        knownListed: 0,
      }),
    ).toBe("You haven't sold any kPEG yet.");
    expect(
      marketEmptyStateMessage({
        activeTab: "all",
        apiUnavailable: false,
        backfillActive: true,
        searchValue: "persian",
        knownListed: 4,
      }),
    ).toBe("No listings match this search.");
  });

  it("shows API unavailable copy before empty-market copy", () => {
    expect(
      marketEmptyStateMessage({
        activeTab: "all",
        apiUnavailable: true,
        backfillActive: true,
        searchValue: "",
        knownListed: 4,
      }),
    ).toBe("Indexer API is unavailable. Market listings cannot load right now.");
  });
});

describe("marketListingsOwnerScope", () => {
  it("keeps ALL tab owner scope stable across wallet changes", () => {
    expect(marketListingsOwnerScope("all", undefined)).toBe("");
    expect(
      marketListingsOwnerScope(
        "all",
        "0x1111111111111111111111111111111111111111",
      ),
    ).toBe("");
  });

  it("uses connected address for owner-scoped tabs", () => {
    expect(marketListingsOwnerScope("my-listings", undefined)).toBe("");
    expect(
      marketListingsOwnerScope(
        "my-listings",
        "0x1111111111111111111111111111111111111111",
      ),
    ).toBe("0x1111111111111111111111111111111111111111");
  });
});

describe("buildSelectableListingCandidates", () => {
  it("keeps all wallet-owned ids that are not already reserved in market positions", () => {
    expect(
      buildSelectableListingCandidates(
        [kitty(1), kitty(2), kitty(3)],
        new Set([1, 2, 3, 4]),
        new Set([2]),
      ).map((item) => ({ id: item.id, hasCard: Boolean(item.kitty) })),
    ).toEqual([
      { id: 1, hasCard: true },
      { id: 3, hasCard: true },
      { id: 4, hasCard: false },
    ]);
  });
});

describe("resolveOwnedKittiesQueryData", () => {
  const owner = "0x1111111111111111111111111111111111111111";
  const tokenAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const verifiedTokenAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  it("keeps API-backed candidates when browser verification fails", async () => {
    const verificationError = new Error("verification blocked");
    const onVerificationError = vi.fn();

    const result = await resolveOwnedKittiesQueryData({
      owner,
      tokenAddress,
      seedKitties: [],
      verifyWalletState: async () => {
        throw verificationError;
      },
      loadApiOwnerKitties: async () => [kitty(1), kitty(2), kitty(3)],
      loadApiReservedKittyIds: async () => new Set([2]),
      loadCompleteOwnerKittiesFn: async (_owner, _ownerIds, seedKitties) =>
        seedKitties,
      onVerificationError,
    });

    expect(result.tokenAddress).toBe(tokenAddress);
    expect([...result.ownerIds].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect([...result.reservedIds]).toEqual([2]);
    expect(result.items.map((item) => item.id)).toEqual([1, 3]);
    expect(onVerificationError).toHaveBeenCalledWith(verificationError);
  });

  it("prefers verified owner/reserved ids when verification succeeds", async () => {
    const result = await resolveOwnedKittiesQueryData({
      owner,
      tokenAddress,
      seedKitties: [],
      verifyWalletState: async () => ({
        tokenAddress: verifiedTokenAddress,
        ownerIds: new Set([1, 4]),
        reservedIds: new Set([4]),
      }),
      loadApiOwnerKitties: async () => [kitty(1), kitty(2), kitty(3)],
      loadApiReservedKittyIds: async () => new Set([2]),
      loadCompleteOwnerKittiesFn: async () => [kitty(1), kitty(4)],
    });

    expect(result.tokenAddress).toBe(verifiedTokenAddress);
    expect([...result.ownerIds].sort((a, b) => a - b)).toEqual([1, 4]);
    expect([...result.reservedIds]).toEqual([4]);
    expect(result.items.map((item) => item.id)).toEqual([1]);
  });
});

describe("verifyMarketListingSelection", () => {
  it("falls back to connected-wallet verification when public verification fails", async () => {
    const publicError = new Error("public rpc unavailable");
    const verifyWithPublicClient = vi.fn(async () => {
      throw publicError;
    });
    const tokenAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;
    const walletState = {
      tokenAddress,
      ownerIds: new Set([1, 2]),
      reservedIds: new Set<number>(),
    };
    const verifyWithConnectedWallet = vi.fn(async () => walletState);
    const onPublicClientFailure = vi.fn();
    const onConnectedWalletFailure = vi.fn();

    const result = await verifyMarketListingSelection({
      selectedIds: [1],
      verifyWithPublicClient,
      verifyWithConnectedWallet,
      onPublicClientFailure,
      onConnectedWalletFailure,
    });

    expect(result).toEqual(walletState);
    expect(verifyWithPublicClient).toHaveBeenCalledTimes(1);
    expect(verifyWithConnectedWallet).toHaveBeenCalledTimes(1);
    expect(onPublicClientFailure).toHaveBeenCalledWith(publicError);
    expect(onConnectedWalletFailure).not.toHaveBeenCalled();
  });

  it("throws a verification error when both public and wallet verification fail", async () => {
    await expect(
      verifyMarketListingSelection({
        selectedIds: [1],
        verifyWithPublicClient: async () => {
          throw new Error("public down");
        },
        verifyWithConnectedWallet: async () => {
          throw new Error("wallet down");
        },
      }),
    ).rejects.toThrow("Could not verify selected kPEGs from chain");
  });

  it("does not fall back when public verification proves selected kPEGs are not owned", async () => {
    const tokenAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;
    const verifyWithConnectedWallet = vi.fn(async () => ({
      tokenAddress,
      ownerIds: new Set([1, 2]),
      reservedIds: new Set<number>(),
    }));

    await expect(
      verifyMarketListingSelection({
        selectedIds: [9],
        verifyWithPublicClient: async () => ({
          tokenAddress,
          ownerIds: new Set([1, 2]),
          reservedIds: new Set<number>(),
        }),
        verifyWithConnectedWallet,
      }),
    ).rejects.toThrow("Selected kPEG is no longer in this wallet");
    expect(verifyWithConnectedWallet).not.toHaveBeenCalled();
  });
});

describe("selectedListingStateError", () => {
  it("returns the expected ownership and reserved errors", () => {
    expect(
      selectedListingStateError([1], {
        ownerIds: new Set([2]),
        reservedIds: new Set<number>(),
      }),
    ).toBe("Selected kPEG is no longer in this wallet");

    expect(
      selectedListingStateError([1], {
        ownerIds: new Set([1]),
        reservedIds: new Set([1]),
      }),
    ).toBe("Selected kPEG is already reserved in the market");
  });
});

describe("executeMarketListingSubmitFlow", () => {
  const marketAddress = "0x3333333333333333333333333333333333333333" as `0x${string}`;
  const escrowAddress = "0x4444444444444444444444444444444444444444" as `0x${string}`;
  const verifiedTokenAddress =
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;
  const listingHash = `0x${"1".repeat(64)}` as `0x${string}`;

  it("blocks before createTrade when selection verification fails", async () => {
    const writeContract = vi.fn();
    const waitForReceipt = vi.fn();

    await expect(
      executeMarketListingSubmitFlow({
        selectedIds: [1],
        priceWei: 1n,
        marketAddress,
        chainId: 84532,
        verifyWalletState: async () => {
          throw new Error("Could not verify selected kPEGs from chain. Try again.");
        },
        writeContract,
        waitForReceipt,
      }),
    ).rejects.toThrow("Could not verify selected kPEGs from chain");

    expect(writeContract).not.toHaveBeenCalled();
    expect(waitForReceipt).not.toHaveBeenCalled();
  });

  it("writes createTradeAndFund once after verification", async () => {
    const walletState = {
      tokenAddress: verifiedTokenAddress,
      ownerIds: new Set([11]),
      reservedIds: new Set<number>(),
    };
    const writeContract = vi.fn().mockResolvedValueOnce(listingHash);
    const waitForReceipt = vi.fn().mockResolvedValueOnce({
      blockNumber: 10n,
      logs: [],
    });
    const onListingSubmitted = vi.fn();

    const result = await executeMarketListingSubmitFlow({
      selectedIds: [11],
      priceWei: 1_500_000_000_000_000n,
      marketAddress,
      chainId: 84532,
      verifyWalletState: async () => walletState,
      writeContract,
      waitForReceipt,
      decodeListingReceipt: () => ({
        tradeId: 111,
        escrowAddress,
      }),
      onListingSubmitted,
    });

    expect(onListingSubmitted).toHaveBeenCalledWith(listingHash, walletState);
    expect(writeContract).toHaveBeenCalledTimes(1);
    const listingCall = writeContract.mock.calls[0]?.[0];
    expect(listingCall?.functionName).toBe("createTradeAndFund");
    expect(listingCall?.address).toBe(marketAddress);
    expect(result.listingHash).toBe(listingHash);
    expect(result.tradeId).toBe(111);
  });

  it("rejects when createTradeAndFund write fails and does not wait for receipt", async () => {
    const walletState = {
      tokenAddress: verifiedTokenAddress,
      ownerIds: new Set([11]),
      reservedIds: new Set<number>(),
    };
    const writeContract = vi
      .fn()
      .mockRejectedValueOnce(new Error("User rejected the wallet request."));
    const waitForReceipt = vi.fn();

    await expect(
      executeMarketListingSubmitFlow({
        selectedIds: [11],
        priceWei: 1_500_000_000_000_000n,
        marketAddress,
        chainId: 84532,
        verifyWalletState: async () => walletState,
        writeContract,
        waitForReceipt,
      }),
    ).rejects.toThrow("User rejected the wallet request.");

    expect(waitForReceipt).not.toHaveBeenCalled();
  });

  it("invokes hash-phase callback before receipt resolves", async () => {
    const walletState = {
      tokenAddress: verifiedTokenAddress,
      ownerIds: new Set([11]),
      reservedIds: new Set<number>(),
    };
    const writeContract = vi.fn().mockResolvedValueOnce(listingHash);
    let resolveReceipt:
      | ((value: MarketListingFlowReceipt) => void)
      | undefined;
    const waitForReceipt = vi.fn(
      () =>
        new Promise<MarketListingFlowReceipt>((resolve) => {
          resolveReceipt = resolve;
        }),
    );
    const onListingSubmitted = vi.fn();

    let settled = false;
    const flowPromise = executeMarketListingSubmitFlow({
      selectedIds: [11],
      priceWei: 1_500_000_000_000_000n,
      marketAddress,
      chainId: 84532,
      verifyWalletState: async () => walletState,
      writeContract,
      waitForReceipt,
      decodeListingReceipt: () => ({
        tradeId: 111,
        escrowAddress,
      }),
      onListingSubmitted,
    }).finally(() => {
      settled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onListingSubmitted).toHaveBeenCalledWith(listingHash, walletState);
    expect(settled).toBe(false);

    resolveReceipt?.({ blockNumber: 12n, logs: [] });
    await flowPromise;
  });
});

describe("executeMarketBuySubmitFlow", () => {
  const marketAddress = "0x3333333333333333333333333333333333333333" as `0x${string}`;
  const openView = {
    tradeId: 64n,
    seller: "0x1111111111111111111111111111111111111111" as `0x${string}`,
    buyer: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    escrowAddress: "0x3333333333333333333333333333333333333333" as `0x${string}`,
    paymentToken: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    price: 1_000_000_000_000_000_000n,
    feeBps: 200n,
    kittyIds: [64n],
    status: 0n,
    ready: true,
  };

  function baseListing(): MarketListing {
    return listing();
  }

  it("does not submit wallet tx when on-chain kitty ids differ", async () => {
    const current = baseListing();
    const writeContract = vi.fn();
    const onVerificationPassed = vi.fn();

    await expect(
      executeMarketBuySubmitFlow({
        listing: current,
        marketAddress,
        chainId: 84532,
        verifyListing: async () =>
          verifyMarketBuyListing({
            listing: current,
            readChainPosition: async () => ({ ...openView, kittyIds: [999n] }),
          }),
        onVerificationPassed,
        writeContract,
      }),
    ).rejects.toThrow(MARKET_BUY_LISTING_CHANGED_ERROR);

    expect(onVerificationPassed).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("does not submit wallet tx when on-chain price differs", async () => {
    const current = baseListing();
    const writeContract = vi.fn();
    const onVerificationPassed = vi.fn();

    await expect(
      executeMarketBuySubmitFlow({
        listing: current,
        marketAddress,
        chainId: 84532,
        verifyListing: async () =>
          verifyMarketBuyListing({
            listing: current,
            readChainPosition: async () => ({ ...openView, price: 123n }),
          }),
        onVerificationPassed,
        writeContract,
      }),
    ).rejects.toThrow(MARKET_BUY_LISTING_CHANGED_ERROR);

    expect(onVerificationPassed).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("does not submit wallet tx when on-chain status is not OPEN", async () => {
    const current = baseListing();
    const writeContract = vi.fn();
    const onVerificationPassed = vi.fn();

    await expect(
      executeMarketBuySubmitFlow({
        listing: current,
        marketAddress,
        chainId: 84532,
        verifyListing: async () =>
          verifyMarketBuyListing({
            listing: current,
            readChainPosition: async () => ({ ...openView, status: 1n }),
          }),
        onVerificationPassed,
        writeContract,
      }),
    ).rejects.toThrow(MARKET_BUY_LISTING_CHANGED_ERROR);

    expect(onVerificationPassed).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("does not submit wallet tx when on-chain listing is not ready", async () => {
    const current = baseListing();
    const writeContract = vi.fn();
    const onVerificationPassed = vi.fn();

    await expect(
      executeMarketBuySubmitFlow({
        listing: current,
        marketAddress,
        chainId: 84532,
        verifyListing: async () =>
          verifyMarketBuyListing({
            listing: current,
            readChainPosition: async () => ({ ...openView, ready: false }),
          }),
        onVerificationPassed,
        writeContract,
      }),
    ).rejects.toThrow(MARKET_BUY_LISTING_CHANGED_ERROR);

    expect(onVerificationPassed).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("submits buyAndClaimAll once when listing matches on-chain", async () => {
    const current = baseListing();
    const writeContract = vi
      .fn()
      .mockResolvedValueOnce(`0x${"2".repeat(64)}` as `0x${string}`);
    const onVerificationPassed = vi.fn();

    await executeMarketBuySubmitFlow({
      listing: current,
      marketAddress,
      chainId: 84532,
      verifyListing: async () =>
        verifyMarketBuyListing({
          listing: current,
          readChainPosition: async () => openView,
        }),
      onVerificationPassed,
      writeContract,
    });

    expect(onVerificationPassed).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledWith({
      address: marketAddress,
      abi: expect.anything(),
      functionName: "buyAndClaimAll",
      args: [64n, "0x0000000000000000000000000000000000000000", 1_000_000_000_000_000_000n],
      value: 1_000_000_000_000_000_000n,
      chainId: 84532,
    });
  });
});

describe("market frontend rpc safety", () => {
  it("does not reference backend-only rpc env keys in MarketPage browser code", () => {
    const source = readFileSync("src/pages/MarketPage.tsx", "utf8");
    expect(source).not.toContain("KPEG_CHAIN_RPC_URL");
    expect(source).not.toContain("BASE_SEPOLIA_RPC");
    expect(source).not.toContain("BASE_MAINNET_RPC");
  });
});

describe("syncMarketQueriesForAction", () => {
  const txHash = `0x${"a".repeat(64)}` as `0x${string}`;

  it("marks post-trade refresh and invalidates ownership scopes for ownership-impact actions", async () => {
    const ownershipImpactActions = [
      "list",
      "cancel-listing",
      "buy-listing",
    ] as const;

    for (const action of ownershipImpactActions) {
      const enqueueSync = vi.fn();
      const markPostTradeRefreshFn = vi.fn();

      await syncMarketQueriesForAction({
        txHash,
        action,
        enqueueSync,
        markPostTradeRefreshFn,
      });

      expect(marketTxHasOwnershipImpact(action)).toBe(true);
      expect(enqueueSync).toHaveBeenCalledWith(txHash, { immediate: true });
      expect(markPostTradeRefreshFn).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps price updates market-only without ownership refresh", async () => {
    const enqueueSync = vi.fn();
    const markPostTradeRefreshFn = vi.fn();

    await syncMarketQueriesForAction({
      txHash,
      action: "update-price",
      enqueueSync,
      markPostTradeRefreshFn,
    });

    expect(marketTxHasOwnershipImpact("update-price")).toBe(false);
    expect(enqueueSync).toHaveBeenCalledWith(txHash, { immediate: true });
    expect(markPostTradeRefreshFn).not.toHaveBeenCalled();
  });
});

describe("waitForMarketTxOutcome", () => {
  it("returns success after timeout when read-back confirms state", async () => {
    const publicClient = {
      waitForTransactionReceipt: vi
        .fn()
        .mockRejectedValue(new Error("timed out waiting for receipt")),
    };

    const result = await waitForMarketTxOutcome({
      hash: `0x${"1".repeat(64)}` as `0x${string}`,
      publicClient: publicClient as never,
      readBack: async () => ({ ok: true }),
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.receiptBlock).toBe(0);
      expect(result.value).toEqual({ ok: true });
    }
  });

  it("returns success when connected-wallet fallback read-back confirms state", async () => {
    const publicClient = {
      waitForTransactionReceipt: vi
        .fn()
        .mockRejectedValue(new Error("timed out waiting for receipt")),
    };

    const result = await waitForMarketTxOutcome({
      hash: `0x${"2".repeat(64)}` as `0x${string}`,
      publicClient: publicClient as never,
      readBack: async () => null,
      readBackViaConnectedWallet: async () => ({ ok: true }),
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.value).toEqual({ ok: true });
    }
  });

  it("runs read-back fallback for non-timeout receipt errors", async () => {
    const publicClient = {
      waitForTransactionReceipt: vi
        .fn()
        .mockRejectedValue(new Error("rpc error: execution temporarily unavailable")),
    };
    const readBack = vi.fn().mockResolvedValue(null);
    const readBackViaConnectedWallet = vi.fn().mockResolvedValue({ ok: true });

    const result = await waitForMarketTxOutcome({
      hash: `0x${"9".repeat(64)}` as `0x${string}`,
      publicClient: publicClient as never,
      readBack,
      readBackViaConnectedWallet,
    });

    expect(result.status).toBe("success");
    expect(readBack).toHaveBeenCalledWith({ receiptBlock: null });
    expect(readBackViaConnectedWallet).toHaveBeenCalledWith({
      receiptBlock: null,
    });
  });

  it("returns pending on timeout when read-back cannot confirm state", async () => {
    const publicClient = {
      waitForTransactionReceipt: vi
        .fn()
        .mockRejectedValue(new Error("timed out waiting for receipt")),
    };

    const result = await waitForMarketTxOutcome({
      hash: `0x${"3".repeat(64)}` as `0x${string}`,
      publicClient: publicClient as never,
      readBack: async () => null,
    });

    expect(result.status).toBe("pending");
  });

  it("returns reverted when receipt status is reverted", async () => {
    const publicClient = {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: "reverted",
        blockNumber: 12n,
      }),
    };

    const result = await waitForMarketTxOutcome({
      hash: `0x${"4".repeat(64)}` as `0x${string}`,
      publicClient: publicClient as never,
      readBack: async () => ({ ok: true }),
    });

    expect(result.status).toBe("reverted");
  });

  it("returns reverted for explicit revert-like errors", async () => {
    const publicClient = {
      waitForTransactionReceipt: vi
        .fn()
        .mockRejectedValue(new Error("execution reverted")),
    };

    const result = await waitForMarketTxOutcome({
      hash: `0x${"5".repeat(64)}` as `0x${string}`,
      publicClient: publicClient as never,
      readBack: async () => null,
    });

    expect(result.status).toBe("reverted");
  });

  it("returns success in race mode when read-back confirms before receipt", async () => {
    const pendingReceipt = new Promise<never>(() => undefined);
    const readBack = vi.fn().mockResolvedValue({ ok: true });

    const result = await waitForMarketTxOutcome({
      hash: `0x${"6".repeat(64)}` as `0x${string}`,
      publicClient: {
        waitForTransactionReceipt: vi.fn().mockReturnValue(pendingReceipt),
      } as never,
      readBack,
      raceReadBack: true,
      readBackPollIntervalMs: 500,
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.receiptBlock).toBe(0);
      expect(result.value).toEqual({ ok: true });
    }
    expect(readBack).toHaveBeenCalledWith({ receiptBlock: null });
  });
});

describe("marketStatsFromVisibleListings", () => {
  it("uses the active tab listing page instead of global stats for owner tabs", () => {
    expect(
      marketStatsFromVisibleListings({
        activeTab: "my-listings",
        pageReady: true,
        pageTotal: 2,
        listings: [
          listing({
            tradeId: 1,
            status: "OPEN",
            priceWei: "1000000000000000",
          }),
          listing({
            tradeId: 4,
            status: "OPEN",
            priceWei: "2000000000000000",
          }),
        ],
        serverListingCount: 2,
        globalStats: { listed: 0, floorWei: "0", volumeWei: "0" },
      }),
    ).toEqual({
      listed: 2,
      floorWei: "1000000000000000",
      volumeWei: "0",
    });
  });

  it("uses sold listing volume for owner history tabs instead of global market volume", () => {
    expect(
      marketStatsFromVisibleListings({
        activeTab: "sold",
        pageReady: true,
        pageTotal: 2,
        listings: [
          listing({
            tradeId: 1,
            status: "SOLD",
            priceWei: "1000000000000000",
          }),
          listing({
            tradeId: 4,
            status: "SOLD",
            priceWei: "2000000000000000",
          }),
        ],
        serverListingCount: 2,
        globalStats: {
          listed: 99,
          floorWei: "9000000000000000",
          volumeWei: "195000000000000000",
        },
      }),
    ).toEqual({
      listed: 2,
      floorWei: "1000000000000000",
      volumeWei: "3000000000000000",
    });
  });

  it("keeps global market stats for the all tab without exposing listing-derived volume", () => {
    expect(
      marketStatsFromVisibleListings({
        activeTab: "all",
        pageReady: true,
        pageTotal: 1,
        listings: [
          listing({
            tradeId: 1,
            status: "OPEN",
            priceWei: "1000000000000000",
          }),
        ],
        serverListingCount: 1,
        globalStats: {
          listed: 3,
          floorWei: "2000000000000000",
          volumeWei: "5000000000000000",
        },
      }),
    ).toEqual({
      listed: 3,
      floorWei: "1000000000000000",
      volumeWei: "5000000000000000",
    });
  });

  it("adjusts owner tab totals instantly after optimistic local removals", () => {
    expect(
      marketStatsFromVisibleListings({
        activeTab: "my-listings",
        pageReady: true,
        pageTotal: 2,
        listings: [
          listing({
            tradeId: 1,
            status: "OPEN",
            priceWei: "1000000000000000",
          }),
        ],
        serverListingCount: 2,
        globalStats: undefined,
      }),
    ).toEqual({
      listed: 1,
      floorWei: "1000000000000000",
      volumeWei: "0",
    });
  });

  it("keeps a persisted canceled listing suppressed across remount and listed count stays decremented", () => {
    const seller = "0x1111111111111111111111111111111111111111";
    const tradeId = 777;
    const marketScope = {
      chainId: 84532,
      marketAddress: "0x3333333333333333333333333333333333333333",
    };
    const staleServerOpen = listing({
      tradeId,
      seller,
      status: "OPEN",
      priceWei: "1000000000000000",
      kittyIds: [tradeId],
      kittyCount: 1,
    });

    try {
      upsertOptimisticMarketListing(marketScope, {
        ...staleServerOpen,
        status: "DELETED",
        txHash: `0x${"d".repeat(64)}`,
        blockNumber: 123,
      });
      const persistedLocal = Object.fromEntries(
        readOptimisticMarketListings(marketScope).map((item) => [
          item.tradeId,
          item as MarketListingView,
        ]),
      );

      const merged = mergeMarketListingViews({
        activeTab: "my-listings",
        address: seller,
        searchValue: "",
        serverListings: [staleServerOpen],
        localListings: persistedLocal,
      });
      expect(merged).toHaveLength(0);

      expect(
        marketStatsFromVisibleListings({
          activeTab: "my-listings",
          pageReady: true,
          pageTotal: 1,
          listings: merged,
          serverListingCount: 1,
          globalStats: undefined,
        }),
      ).toEqual({
        listed: 0,
        floorWei: "0",
        volumeWei: "0",
      });
    } finally {
      clearOptimisticMarketListings(marketScope);
    }
  });
});

describe("marketStatsAreFreshForPage", () => {
  it("treats cached stats as stale until they update after page entry", () => {
    const pageEnteredAt = Date.parse("2026-05-29T00:00:00Z");
    expect(
      marketStatsAreFreshForPage({
        hasStats: true,
        dataUpdatedAt: pageEnteredAt - 1,
        pageEnteredAt,
      }),
    ).toBe(false);
    expect(
      marketStatsAreFreshForPage({
        hasStats: true,
        dataUpdatedAt: pageEnteredAt + 1,
        pageEnteredAt,
      }),
    ).toBe(true);
  });
});

describe("resolveVisibleMarketListings", () => {
  it("does not reuse stale listings from a different tab scope while refetching", () => {
    const stale = [listing({ tradeId: 77 })];
    expect(
      resolveVisibleMarketListings({
        marketScopePending: false,
        scopeKey: "market|bought|0xabc|",
        lastStableScopeKey: "market|my-listings|0xabc|",
        listings: [],
        isFetching: true,
        lastStableListings: stale,
      }),
    ).toEqual([]);
  });

  it("can reuse last stable listings for the same scope during in-scope refetch", () => {
    const stable = [listing({ tradeId: 88 })];
    expect(
      resolveVisibleMarketListings({
        marketScopePending: false,
        scopeKey: "market|my-listings|0xabc|",
        lastStableScopeKey: "market|my-listings|0xabc|",
        listings: [],
        isFetching: true,
        lastStableListings: stable,
      }),
    ).toEqual(stable);
  });
});

describe("shouldDisableMarketSortDuringSearch", () => {
  it("disables sort while a non-empty market search query is active", () => {
    expect(shouldDisableMarketSortDuringSearch("seller")).toBe(true);
    expect(shouldDisableMarketSortDuringSearch("  #77 ")).toBe(true);
  });

  it("keeps sort enabled when search is empty", () => {
    expect(shouldDisableMarketSortDuringSearch("")).toBe(false);
    expect(shouldDisableMarketSortDuringSearch("   ")).toBe(false);
  });
});
