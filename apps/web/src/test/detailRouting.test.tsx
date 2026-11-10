import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { GalleryCard } from "../components/GalleryCard.js";
import { DetailPage } from "../pages/DetailPage.js";
import type { ConfigResponse, KittyDetailItem, KittyItem } from "../lib/api.js";

const getKittyMock = vi.fn<(id: number) => Promise<KittyDetailItem>>();
const getConfigMock = vi.fn<() => Promise<ConfigResponse>>();

vi.mock("../lib/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api.js")>();
  return {
    ...actual,
    getKitty: (id: number) => getKittyMock(id),
    getConfig: () => getConfigMock(),
  };
});

vi.mock("../hooks/useKittyDetailPrefetch.js", () => ({
  useKittyDetailPrefetch: () => ({}),
}));

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

const traitOdds = Object.fromEntries(
  Object.keys(traits).map((key) => [
    key,
    {
      trait: traits[key as keyof typeof traits],
      selectedWeight: 1,
      contextTotalWeight: 1,
      probabilityPct: 100,
    },
  ]),
) as KittyDetailItem["traitOdds"];

function detailKitty(
  id = 7,
  tierLabel: KittyDetailItem["tierLabel"] = "Uncommon",
): KittyDetailItem {
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
    seed: "0x01",
    tier,
    tierLabel,
    mintTier: tier,
    mintTierLabel: tierLabel,
    owner: "0x1111111111111111111111111111111111111111",
    mintedBy: "0x2222222222222222222222222222222222222222",
    mintBatchSize: 1,
    mintedAt: 1_700_000_000_000,
    blockNumber: 1234,
    txHash:
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    gasUsed: 21_000,
    baseFeeWei: "1000000000",
    rarityScore: 42,
    traits,
    traitOdds,
    kpegRarity: {
      label: "RARITY",
      percentage: 0.01,
      oneInN: 100,
      basis: "Rarity Probability",
    },
  };
}

function renderDetailPage(initialEntry: string | { pathname: string; state?: unknown }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/kpeg/:id" element={<DetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderModalDetailPage(
  initialEntry: string | { pathname: string; state?: unknown },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/kpeg/:id" element={<DetailPage presentation="modal" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationStateProbe() {
  const location = useLocation();
  return <pre data-testid="detail-location-state">{JSON.stringify(location.state)}</pre>;
}

beforeEach(() => {
  getKittyMock.mockReset();
  getConfigMock.mockReset();
  getKittyMock.mockResolvedValue(detailKitty());
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
    tokenAddress: "0x0000000000000000000000000000000000000001",
    marketAddress: null,
    routerAddress: null,
    quoterAddress: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("DetailPage back link routing", () => {
  it("shows MY COLLECTION back link when opened from collections state", async () => {
    renderDetailPage({
      pathname: "/kpeg/7",
      state: { detailOrigin: "collections" },
    });

    const backLink = await screen.findByRole("link", {
      name: /back to my collection/i,
    });
    expect(backLink.getAttribute("href")).toBe("/collections");
  });

  it("defaults to EXPLORE back link without collections origin", async () => {
    renderDetailPage("/kpeg/7");

    const backLink = await screen.findByRole("link", {
      name: /back to explore/i,
    });
    expect(backLink.getAttribute("href")).toBe("/explore");
  });
});

describe("GalleryCard detail route state", () => {
  it("passes modal routing state and collections origin to detail route", () => {
    render(
      <MemoryRouter initialEntries={["/collections"]}>
        <Routes>
          <Route
            path="/collections"
            element={<GalleryCard kitty={detailKitty()} origin="collections" />}
          />
          <Route path="/kpeg/:id" element={<LocationStateProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link"));
    const stateText = screen.getByTestId("detail-location-state").textContent ?? "";
    expect(stateText).toContain('"detailModal":true');
    expect(stateText).toContain('"detailOrigin":"collections"');
    expect(stateText).toContain('"pathname":"/collections"');
  });

  it("adds metallic card class only for rare and above tiers", () => {
    const { rerender } = render(
      <MemoryRouter>
        <GalleryCard kitty={detailKitty(7, "Rare")} origin="explore" />
      </MemoryRouter>,
    );
    const rareCard = screen.getByRole("link");
    expect(rareCard.className).toContain("tier-metal-card");
    expect(rareCard.getAttribute("data-tier-metal")).toBe("rare");
    expect(rareCard.style.getPropertyValue("--tier-metal-sync-delay")).toBe("");

    rerender(
      <MemoryRouter>
        <GalleryCard kitty={detailKitty(7, "Uncommon")} origin="explore" />
      </MemoryRouter>,
    );
    const uncommonCard = screen.getByRole("link");
    expect(uncommonCard.className).not.toContain("tier-metal-card");
    expect(uncommonCard.getAttribute("data-tier-metal")).toBeNull();
    expect(uncommonCard.style.getPropertyValue("--tier-metal-sync-delay")).toBe("");
  });
});

describe("DetailPage modal layering", () => {
  it("uses desktop-above-mobile-below nav layer classes", async () => {
    renderModalDetailPage("/kpeg/7");

    const closeButtons = await screen.findAllByRole("button", {
      name: /close kitty detail/i,
    });
    const overlay = closeButtons[0]?.parentElement;
    expect(overlay).not.toBeNull();
    expect(overlay?.className).toContain("z-50");
    expect(overlay?.className).toContain("max-[979px]:z-20");
  });

  it("pauses background metallic shimmer and applies metallic tier text in modal", async () => {
    getKittyMock.mockResolvedValue(detailKitty(7, "Rare"));
    const { unmount } = renderModalDetailPage("/kpeg/7");

    const tierValue = await screen.findByText("Rare");
    expect(document.body.dataset.tierMetalModalOpen).toBe("true");
    expect(tierValue.className).toContain("tier-metal-value");
    expect(tierValue.getAttribute("data-tier-metal")).toBe("rare");

    unmount();
    expect(document.body.dataset.tierMetalModalOpen).toBeUndefined();
  });

  it("keeps uncommon tier text without metallic shimmer in modal", async () => {
    getKittyMock.mockResolvedValue(detailKitty(7, "Uncommon"));
    renderModalDetailPage("/kpeg/7");

    const tierValue = await screen.findByText("Uncommon");
    expect(tierValue.className).not.toContain("tier-metal-value");
    expect(tierValue.getAttribute("data-tier-metal")).toBeNull();
  });
});

describe("DetailPage traits row layout", () => {
  it("keeps a fixed percentage column width so trait values start at one anchor", async () => {
    renderDetailPage("/kpeg/7");

    const backgroundRow = await screen.findByRole("button", {
      name: /background/i,
    });
    expect(backgroundRow.className).toContain(
      "grid-cols-[minmax(3.4rem,0.35fr)_minmax(0,1fr)_minmax(6.2rem,6.2rem)]",
    );
  });
});

describe("DetailPage media actions", () => {
  it("renders a primary COPY KPEG button and an icon-only save button on one row", async () => {
    renderDetailPage("/kpeg/7");

    const copyButton = await screen.findByRole("button", {
      name: "COPY KPEG",
    });
    const saveButton = await screen.findByRole("button", {
      name: "Save as JPEG",
    });
    expect(copyButton.className).toContain("bg-[var(--fg)]");
    expect(saveButton.className).toContain("bg-transparent");
    expect(copyButton.parentElement?.className).toContain(
      "grid-cols-[minmax(0,1fr)_2.3rem]",
    );
  });
});
