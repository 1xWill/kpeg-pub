import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransferModal } from "../pages/GalleryPage.js";
import type { KittyItem } from "../lib/api.js";

const renderKPEGSvgDataUriMock = vi.fn(
  (_traits: unknown) => "data:image/svg+xml;utf8,mock",
);
vi.mock("@kpeg/core", () => ({
  renderKPEGSvgDataUri: (traits: unknown) =>
    renderKPEGSvgDataUriMock(traits),
}));

afterEach(() => {
  cleanup();
  renderKPEGSvgDataUriMock.mockClear();
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

function kitty(id: number): KittyItem {
  return {
    id,
    seed: "0x1",
    tier: 1,
    tierLabel: "Uncommon",
    mintTier: 1,
    mintTierLabel: "Uncommon",
    owner: "0x1111111111111111111111111111111111111111",
    mintedBy: "0x2222222222222222222222222222222222222222",
    mintBatchSize: 1,
    mintedAt: 1,
    blockNumber: 1,
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

function modalPanel(): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2 });
  return heading.closest("section") as HTMLElement;
}

describe("TransferModal", () => {
  it("uses the same shell sizing and slide classes as listing modal", () => {
    render(
      <TransferModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[]}
        recipientInput=""
        transferAction="idle"
        open
        maxBundleSize={100}
        senderAddress="0x1111111111111111111111111111111111111111"
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onRecipientChange={vi.fn()}
        onPasteRecipient={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const transferPanel = modalPanel();
    expect(transferPanel.className).toContain("max-h-[80vh]");
    expect(transferPanel.className).toContain("max-w-[900px]");
    expect(transferPanel.className).toContain("translate-y-0");
    expect(transferPanel.className).toContain("duration-[200ms]");
    expect(transferPanel.className).toContain("max-[980px]:h-[92svh]");
    expect(transferPanel.className).toContain("max-[980px]:max-w-[min(92vw,720px)]");
  });

  it("shows transfer copy and allows card toggling while idle", () => {
    const onToggle = vi.fn();
    render(
      <TransferModal
        kitties={[
          { id: 64, kitty: kitty(64) },
          { id: 65, kitty: kitty(65) },
        ]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        recipientInput=""
        transferAction="idle"
        open
        maxBundleSize={100}
        senderAddress="0x1111111111111111111111111111111111111111"
        onClose={vi.fn()}
        onToggle={onToggle}
        onRecipientChange={vi.fn()}
        onPasteRecipient={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByText("TRANSFER kPEG")).not.toBeNull();
    expect(screen.queryByText("Pick kitties to transfer")).not.toBeNull();

    screen.getByRole("button", { name: /KPEG #64/i }).click();
    screen.getByRole("button", { name: /KPEG #65/i }).click();
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("locks cards while transferring", () => {
    const onToggle = vi.fn();
    render(
      <TransferModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        recipientInput="0x2222222222222222222222222222222222222222"
        transferAction="transferring"
        open
        maxBundleSize={100}
        senderAddress="0x1111111111111111111111111111111111111111"
        onClose={vi.fn()}
        onToggle={onToggle}
        onRecipientChange={vi.fn()}
        onPasteRecipient={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const card = screen.getByRole("button", { name: /KPEG #64/i });
    expect((card as HTMLButtonElement).disabled).toBe(true);
    card.click();
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.queryByText("CONFIRMING...")).not.toBeNull();
  });

  it("shows load error and empty wallet states from the shared modal path", () => {
    const { rerender } = render(
      <TransferModal
        kitties={[]}
        loading={false}
        loadError
        selectedIds={[]}
        recipientInput=""
        transferAction="idle"
        open
        maxBundleSize={100}
        senderAddress="0x1111111111111111111111111111111111111111"
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onRecipientChange={vi.fn()}
        onPasteRecipient={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByText("Could not verify wallet kPEGs from chain.")).not.toBeNull();

    rerender(
      <TransferModal
        kitties={[]}
        loading={false}
        loadError={false}
        selectedIds={[]}
        recipientInput=""
        transferAction="idle"
        open
        maxBundleSize={100}
        senderAddress="0x1111111111111111111111111111111111111111"
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onRecipientChange={vi.fn()}
        onPasteRecipient={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByText("You don't have any kPEG yet.")).not.toBeNull();
  });

  it("renders INDEXING placeholders when wallet ids exist but kitty metadata is missing", () => {
    render(
      <TransferModal
        kitties={[{ id: 64, kitty: null }]}
        loading={false}
        loadError={false}
        selectedIds={[]}
        recipientInput=""
        transferAction="idle"
        open
        maxBundleSize={100}
        senderAddress="0x1111111111111111111111111111111111111111"
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onRecipientChange={vi.fn()}
        onPasteRecipient={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByText("INDEXING")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /KPEG #64/i })).not.toBeNull();
  });

  it("keeps static art render count stable when selection state does not change", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <TransferModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        recipientInput=""
        transferAction="idle"
        open
        maxBundleSize={100}
        senderAddress="0x1111111111111111111111111111111111111111"
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onRecipientChange={vi.fn()}
        onPasteRecipient={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(renderKPEGSvgDataUriMock).toHaveBeenCalledTimes(1);

    rerender(
      <TransferModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        recipientInput="0x2222222222222222222222222222222222222222"
        transferAction="idle"
        open
        maxBundleSize={100}
        senderAddress="0x1111111111111111111111111111111111111111"
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onRecipientChange={vi.fn()}
        onPasteRecipient={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(renderKPEGSvgDataUriMock).toHaveBeenCalledTimes(1);
  });

  it("mounts the shell before rendering card art so opening does not block on SVGs", () => {
    vi.useFakeTimers();
    const props = {
      kitties: [
        { id: 64, kitty: kitty(64) },
        { id: 65, kitty: kitty(65) },
      ],
      loading: false,
      loadError: false,
      selectedIds: [],
      recipientInput: "",
      transferAction: "idle" as const,
      maxBundleSize: 100,
      senderAddress: "0x1111111111111111111111111111111111111111",
      onClose: vi.fn(),
      onToggle: vi.fn(),
      onRecipientChange: vi.fn(),
      onPasteRecipient: vi.fn(),
      onSubmit: vi.fn(),
    };
    const { rerender } = render(
      <TransferModal
        {...props}
        open={false}
      />,
    );
    rerender(<TransferModal {...props} open />);

    expect(screen.queryByText("TRANSFER kPEG")).not.toBeNull();
    expect(screen.queryByText("Loading wallet kPEGs...")).not.toBeNull();
    expect(renderKPEGSvgDataUriMock).not.toHaveBeenCalled();

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(screen.queryByRole("button", { name: /KPEG #64/i })).not.toBeNull();
    expect(renderKPEGSvgDataUriMock).toHaveBeenCalledTimes(2);
  });

  it("progressively mounts transfer cards for dense wallet sets", () => {
    vi.useFakeTimers();
    const denseKitties = Array.from({ length: 50 }, (_, index) => ({
      id: index + 64,
      kitty: kitty(index + 64),
    }));
    render(
      <TransferModal
        kitties={denseKitties}
        loading={false}
        loadError={false}
        selectedIds={[]}
        recipientInput=""
        transferAction="idle"
        open
        maxBundleSize={100}
        senderAddress="0x1111111111111111111111111111111111111111"
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onRecipientChange={vi.fn()}
        onPasteRecipient={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    act(() => {
      vi.runOnlyPendingTimers();
    });

    const firstWaveCount = screen.queryAllByRole("button", {
      name: /KPEG #/i,
    }).length;
    expect(firstWaveCount).toBeGreaterThan(0);
    expect(firstWaveCount).toBeLessThan(denseKitties.length);
    expect(renderKPEGSvgDataUriMock).toHaveBeenCalledTimes(firstWaveCount);
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    for (let iteration = 0; iteration < 8; iteration += 1) {
      act(() => {
        vi.runOnlyPendingTimers();
      });
    }

    expect(
      screen.queryAllByRole("button", { name: /KPEG #/i }).length,
    ).toBe(denseKitties.length);
    expect(renderKPEGSvgDataUriMock).toHaveBeenCalledTimes(denseKitties.length);
  });

  it("blocks adding beyond max bundle but allows deselecting selected items", () => {
    const onToggle = vi.fn();
    render(
      <TransferModal
        kitties={[
          { id: 64, kitty: kitty(64) },
          { id: 65, kitty: kitty(65) },
        ]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        recipientInput="0x2222222222222222222222222222222222222222"
        transferAction="idle"
        open
        maxBundleSize={1}
        senderAddress="0x1111111111111111111111111111111111111111"
        onClose={vi.fn()}
        onToggle={onToggle}
        onRecipientChange={vi.fn()}
        onPasteRecipient={vi.fn()}
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

  it("keeps selected cards visible and deselectable when outside the first progressive batch", () => {
    const onToggle = vi.fn();
    const denseKitties = Array.from({ length: 30 }, (_, index) => ({
      id: index + 64,
      kitty: kitty(index + 64),
    }));
    render(
      <TransferModal
        kitties={denseKitties}
        loading={false}
        loadError={false}
        selectedIds={[90]}
        recipientInput="0x2222222222222222222222222222222222222222"
        transferAction="idle"
        open
        maxBundleSize={1}
        senderAddress="0x1111111111111111111111111111111111111111"
        onClose={vi.fn()}
        onToggle={onToggle}
        onRecipientChange={vi.fn()}
        onPasteRecipient={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const selectedButton = screen.getByRole("button", { name: /KPEG #90/i });
    expect((selectedButton as HTMLButtonElement).disabled).toBe(false);
    selectedButton.click();
    expect(onToggle).toHaveBeenCalledWith(90);
  });

  it("calls paste handler and disables submit for invalid or self recipient", () => {
    const onPasteRecipient = vi.fn();
    render(
      <TransferModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        recipientInput="not-address"
        transferAction="idle"
        open
        maxBundleSize={100}
        senderAddress="0x1111111111111111111111111111111111111111"
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onRecipientChange={vi.fn()}
        onPasteRecipient={onPasteRecipient}
        onSubmit={vi.fn()}
      />,
    );
    screen.getByRole("button", { name: "PASTE" }).click();
    expect(onPasteRecipient).toHaveBeenCalledTimes(1);
    const invalidCta = screen.getByRole("button", { name: "ENTER RECIPIENT" });
    expect((invalidCta as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.queryByText("Enter a valid recipient wallet address."),
    ).not.toBeNull();
    cleanup();

    render(
      <TransferModal
        kitties={[{ id: 64, kitty: kitty(64) }]}
        loading={false}
        loadError={false}
        selectedIds={[64]}
        recipientInput="0x1111111111111111111111111111111111111111"
        transferAction="idle"
        open
        maxBundleSize={100}
        senderAddress="0x1111111111111111111111111111111111111111"
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onRecipientChange={vi.fn()}
        onPasteRecipient={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByText("Recipient wallet must be different from your wallet.")).not.toBeNull();
    const selfCta = screen.getByRole("button", { name: "ENTER RECIPIENT" });
    expect((selfCta as HTMLButtonElement).disabled).toBe(true);
  });
});
