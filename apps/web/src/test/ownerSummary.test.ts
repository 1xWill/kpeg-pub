import { describe, expect, it, vi } from "vitest";
import {
  applyOwnerTransfersToItems,
  canShowTransferButton,
  collectionsMetricsUnavailable,
  executeOwnerTransferSubmitFlow,
  filterItemsByOptimisticRemovalIds,
  mergeOwnerSummary,
  onchainCountIsFresh,
  ownerCurrentTransferOverlayDelta,
  ownerTransferCountForAddress,
  optimisticRemovalCountForOwner,
  optimisticRemovalIdsForScope,
  ownerEmptyStateMessage,
  ownerScopeNeedsWalletConnection,
  ownerWalletDisplayFallback,
  resolveOwnerCurrentKitties,
  resolveOwnerAddressForMode,
  resolveOptimisticSettlementIndexedBlock,
  settledOptimisticKittyIdsByIndexedBlock,
  settledCountOnlyOptimisticRemovalTxHashesByFreshCounter,
  settledOptimisticRemovalTxHashesByIndexedBlock,
  shouldKeepPostTradeRefresh,
  shouldDisableGallerySortDuringSearch,
  sortMergedGalleryItems,
  transferRecipientValidationError,
  transferSelectionStateError,
} from "../pages/GalleryPage.js";

describe("mergeOwnerSummary", () => {
  it("clamps ever-owned to live onchain current when API ever is stale", () => {
    expect(
      mergeOwnerSummary({
        currentFromChain: 20,
        currentFromApi: 11,
        everFromApi: 11,
      }),
    ).toEqual({
      currentKitties: 20,
      everKitties: 20,
    });
  });

  it("keeps historical ever-owned above current after sells", () => {
    expect(
      mergeOwnerSummary({
        currentFromChain: 19,
        currentFromApi: 19,
        everFromApi: 20,
      }),
    ).toEqual({
      currentKitties: 19,
      everKitties: 20,
    });
  });

  it("falls back to current API count for ever-owned when history is absent", () => {
    expect(
      mergeOwnerSummary({
        currentFromChain: null,
        currentFromApi: 7,
        everFromApi: undefined,
      }),
    ).toEqual({
      currentKitties: 7,
      everKitties: 7,
    });
  });

  it("falls back to onchain current count for ever-owned when API stats are unavailable", () => {
    expect(
      mergeOwnerSummary({
        currentFromChain: 100,
        currentFromApi: undefined,
        everFromApi: undefined,
      }),
    ).toEqual({
      currentKitties: 100,
      everKitties: 100,
    });
  });

  it("applies optimistic sell removals to current when onchain current is unavailable", () => {
    expect(
      mergeOwnerSummary({
        currentFromChain: null,
        currentFromApi: 20,
        everFromApi: 23,
        optimisticMintCount: 0,
        optimisticRemovalCount: 3,
      }),
    ).toEqual({
      currentKitties: 17,
      everKitties: 23,
    });
  });

  it("does not lower ever-owned when optimistic sells happen", () => {
    expect(
      mergeOwnerSummary({
        currentFromChain: null,
        currentFromApi: 8,
        everFromApi: 10,
        optimisticMintCount: 0,
        optimisticRemovalCount: 5,
      }),
    ).toEqual({
      currentKitties: 3,
      everKitties: 10,
    });
  });

  it("applies explicit current and ever deltas for market transfer overlays", () => {
    expect(
      mergeOwnerSummary({
        currentFromChain: null,
        currentFromApi: 10,
        everFromApi: 12,
        optimisticCurrentDelta: 2,
        optimisticEverDelta: 1,
      }),
    ).toEqual({
      currentKitties: 12,
      everKitties: 13,
    });
  });

  it("prefers verified wallet owner ids over stale API current", () => {
    expect(
      mergeOwnerSummary({
        currentFromChain: null,
        currentFromApi: 0,
        everFromApi: 0,
        verifiedWalletOwnerIds: new Set([1, 2, 3]),
      }),
    ).toEqual({
      currentKitties: 3,
      everKitties: 3,
    });
  });
});

describe("resolveOwnerCurrentKitties", () => {
  it("prefers fresh chain current over all fallback sources", () => {
    expect(
      resolveOwnerCurrentKitties({
        currentFromFreshChain: 12,
        verifiedWalletOwnerIds: new Set([1, 2, 3]),
        currentFromApi: 0,
        optimisticCurrentDelta: 10,
      }),
    ).toBe(12);
  });

  it("uses verified wallet owner ids when chain current is unavailable", () => {
    expect(
      resolveOwnerCurrentKitties({
        currentFromFreshChain: null,
        verifiedWalletOwnerIds: new Set([1, 2, 3]),
        currentFromApi: 0,
        optimisticCurrentDelta: 3,
      }),
    ).toBe(3);
  });

  it("falls back to api + optimistic delta when no trusted chain owner source exists", () => {
    expect(
      resolveOwnerCurrentKitties({
        currentFromFreshChain: null,
        verifiedWalletOwnerIds: null,
        currentFromApi: 2,
        optimisticCurrentDelta: 3,
      }),
    ).toBe(5);
  });
});

describe("ownerEmptyStateMessage", () => {
  it("keeps the empty-wallet message for owner scopes when no connect requirement applies", () => {
    expect(
      ownerEmptyStateMessage({
        reserveWallet: false,
        apiUnavailable: false,
        indexingMessage: null,
        currentKitties: 0,
      }),
    ).toBe("No kitties are napping in this wallet yet.");
  });

  it("shows API unavailable copy before indexing/backfill copy", () => {
    expect(
      ownerEmptyStateMessage({
        reserveWallet: false,
        apiUnavailable: true,
        indexingMessage:
          "0 / 87 wallet kitties indexed from chain. Backfill is running; cards appear as indexing catches up.",
        currentKitties: 87,
      }),
    ).toBe("Indexer API is unavailable. Cards cannot load right now.");
  });
});

describe("ownerScopeNeedsWalletConnection", () => {
  it("requires wallet for MY COLLECTION when owner is missing", () => {
    expect(
      ownerScopeNeedsWalletConnection({
        isCollections: true,
        ownerAddress: undefined,
      }),
    ).toBe(true);
  });

  it("does not require wallet outside MY COLLECTION scope", () => {
    expect(
      ownerScopeNeedsWalletConnection({
        isCollections: false,
        ownerAddress: undefined,
      }),
    ).toBe(false);
  });
});

describe("collectionsMetricsUnavailable", () => {
  it("hides MY COLLECTION metrics when wallet is disconnected", () => {
    expect(
      collectionsMetricsUnavailable({
        mode: "collections",
        ownerAddress: undefined,
      }),
    ).toBe(true);
    expect(
      collectionsMetricsUnavailable({
        mode: "collections",
        ownerAddress: "0xabc",
      }),
    ).toBe(false);
    expect(
      collectionsMetricsUnavailable({
        mode: "portfolio",
        ownerAddress: undefined,
      }),
    ).toBe(false);
  });
});

describe("ownerCurrentTransferOverlayDelta", () => {
  const owner = "0x1111111111111111111111111111111111111111";

  function transfer(
    patch: Partial<{
      txHash: `0x${string}`;
      from: string;
      to: string;
      kittyIds: number[];
      reason: "WALLET_TRANSFER";
      createdAt: number;
      blockNumber: number;
      expiresAt: number;
    }> = {},
  ): {
    txHash: `0x${string}`;
    from: string;
    to: string;
    kittyIds: number[];
    reason: "WALLET_TRANSFER";
    createdAt: number;
    blockNumber: number;
    expiresAt: number;
    kitties: [];
  } {
    return {
      txHash: `0x${"1".repeat(64)}` as `0x${string}`,
      blockNumber: 0,
      createdAt: 1,
      expiresAt: 999999,
      from: "0x2222222222222222222222222222222222222222",
      to: owner,
      kittyIds: [1, 2, 3],
      kitties: [],
      reason: "WALLET_TRANSFER",
      ...patch,
    };
  }

  it("suppresses incoming wallet transfer delta when API already reflects those IDs", () => {
    expect(
      ownerCurrentTransferOverlayDelta({
        transfers: [transfer()],
        ownerAddress: owner,
        currentFromChain: null,
        currentFromApi: 3,
        hasFreshOwnerLiveCounter: false,
        ownerCurrentIds: new Set([1, 2, 3]),
      }),
    ).toBe(0);
  });

  it("keeps verified owner-id current count when duplicate incoming overlay delta is suppressed", () => {
    const optimisticCurrentDelta = ownerCurrentTransferOverlayDelta({
      transfers: [transfer()],
      ownerAddress: owner,
      currentFromChain: null,
      currentFromApi: 0,
      hasFreshOwnerLiveCounter: false,
      ownerCurrentIds: new Set([1, 2, 3]),
    });
    expect(optimisticCurrentDelta).toBe(0);
    expect(
      mergeOwnerSummary({
        currentFromChain: null,
        currentFromApi: 0,
        everFromApi: 0,
        verifiedWalletOwnerIds: new Set([1, 2, 3]),
        optimisticCurrentDelta,
      }),
    ).toEqual({
      currentKitties: 3,
      everKitties: 3,
    });
  });

  it("returns zero when fresh onchain owner count is available", () => {
    expect(
      ownerCurrentTransferOverlayDelta({
        transfers: [transfer()],
        ownerAddress: owner,
        currentFromChain: 3,
        currentFromApi: 3,
        hasFreshOwnerLiveCounter: true,
        ownerCurrentIds: new Set([1, 2, 3]),
      }),
    ).toBe(0);
  });

  it("keeps outgoing wallet transfer deduction until owner IDs drop from source", () => {
    expect(
      ownerCurrentTransferOverlayDelta({
        transfers: [
          transfer({
            txHash: `0x${"2".repeat(64)}`,
            from: owner,
            to: "0x3333333333333333333333333333333333333333",
          }),
        ],
        ownerAddress: owner,
        currentFromChain: null,
        currentFromApi: 3,
        hasFreshOwnerLiveCounter: false,
        ownerCurrentIds: new Set([1, 2, 3]),
      }),
    ).toBe(-3);
  });
});

describe("transfer visibility and validation", () => {
  it("shows transfer button only for connected non-reserve MY COLLECTIONS", () => {
    expect(
      canShowTransferButton({
        mode: "collections",
        ownerAddress: "0xabc",
        reserveWallet: false,
      }),
    ).toBe(true);
    expect(
      canShowTransferButton({
        mode: "collections",
        ownerAddress: undefined,
        reserveWallet: false,
      }),
    ).toBe(false);
    expect(
      canShowTransferButton({
        mode: "explore",
        ownerAddress: "0xabc",
        reserveWallet: false,
      }),
    ).toBe(false);
    expect(
      canShowTransferButton({
        mode: "portfolio",
        ownerAddress: "0xabc",
        reserveWallet: false,
      }),
    ).toBe(false);
    expect(
      canShowTransferButton({
        mode: "collections",
        ownerAddress: "0xabc",
        reserveWallet: true,
      }),
    ).toBe(false);
  });

  it("validates recipient wallet for transfer modal", () => {
    expect(
      transferRecipientValidationError({
        recipient: "",
        sender: "0x1111111111111111111111111111111111111111",
      }),
    ).toBe("Recipient wallet is required.");
    expect(
      transferRecipientValidationError({
        recipient: "not-address",
        sender: "0x1111111111111111111111111111111111111111",
      }),
    ).toBe("Enter a valid recipient wallet address.");
    expect(
      transferRecipientValidationError({
        recipient: "0x0000000000000000000000000000000000000000",
        sender: "0x1111111111111111111111111111111111111111",
      }),
    ).toBe("Recipient wallet cannot be the zero address.");
    expect(
      transferRecipientValidationError({
        recipient: "0x1111111111111111111111111111111111111111",
        sender: "0x1111111111111111111111111111111111111111",
      }),
    ).toBe("Recipient wallet must be different from your wallet.");
    expect(
      transferRecipientValidationError({
        recipient: "0x2222222222222222222222222222222222222222",
        sender: "0x1111111111111111111111111111111111111111",
      }),
    ).toBeNull();
  });
});

describe("transfer submit flow helpers", () => {
  it("returns error when selected ids are not owned anymore", () => {
    expect(
      transferSelectionStateError({
        selectedIds: [1, 2],
        ownerIds: new Set([1]),
      }),
    ).toBe("Selected kPEG is no longer in this wallet");
  });

  it("writes directTransferKittiesList with sorted selected ids", async () => {
    const writeContract = vi.fn().mockResolvedValue(
      `0x${"1".repeat(64)}` as `0x${string}`,
    );
    const verifyOwnerState = vi.fn().mockResolvedValue({
      ownerIds: new Set([64, 65, 66]),
    });

    await expect(
      executeOwnerTransferSubmitFlow({
        selectedIds: [66, 64, 65],
        recipient: "0x2222222222222222222222222222222222222222",
        tokenAddress: "0x3333333333333333333333333333333333333333",
        chainId: 84532,
        verifyOwnerState,
        writeContract,
      }),
    ).resolves.toEqual({
      kittyIds: [64, 65, 66],
      transferHash: `0x${"1".repeat(64)}`,
    });

    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "directTransferKittiesList",
        args: [
          "0x2222222222222222222222222222222222222222",
          [64n, 65n, 66n],
        ],
      }),
    );
  });

  it("supports immediate outgoing overlay once transfer hash is returned", async () => {
    const ownerAddress = "0x1111111111111111111111111111111111111111";
    const recipientAddress = "0x2222222222222222222222222222222222222222";
    const writeContract = vi.fn().mockResolvedValue(
      `0x${"2".repeat(64)}` as `0x${string}`,
    );

    const flow = await executeOwnerTransferSubmitFlow({
      selectedIds: [65, 64],
      recipient: recipientAddress,
      tokenAddress: "0x3333333333333333333333333333333333333333",
      chainId: 84532,
      verifyOwnerState: async () => ({ ownerIds: new Set([64, 65]) }),
      writeContract,
    });

    const merged = applyOwnerTransfersToItems({
      items: [
        { id: 64, owner: ownerAddress, mintedBy: ownerAddress },
        { id: 65, owner: ownerAddress, mintedBy: ownerAddress },
      ] as any,
      ownerAddress,
      transfers: [
        {
          txHash: flow.transferHash,
          blockNumber: 0,
          createdAt: 1,
          expiresAt: 9_999_999,
          from: ownerAddress,
          to: recipientAddress,
          kittyIds: flow.kittyIds,
          kitties: [],
          reason: "WALLET_TRANSFER",
        },
      ] as any,
    });

    expect(merged).toEqual([]);
  });

  it("throws before hash return when wallet write fails", async () => {
    const writeContract = vi.fn().mockRejectedValue(new Error("wallet rejected"));

    await expect(
      executeOwnerTransferSubmitFlow({
        selectedIds: [64],
        recipient: "0x2222222222222222222222222222222222222222",
        tokenAddress: "0x3333333333333333333333333333333333333333",
        chainId: 84532,
        verifyOwnerState: async () => ({ ownerIds: new Set([64]) }),
        writeContract,
      }),
    ).rejects.toThrow("wallet rejected");
  });
});

describe("resolveOwnerAddressForMode", () => {
  it("keeps explore scope global without wallet-specific owner address", () => {
    expect(
      resolveOwnerAddressForMode({
        mode: "explore",
        accountAddress: "0xabc",
        portfolioOwner: "0xdef",
      }),
    ).toBeUndefined();
  });

  it("uses connected account for collections scope", () => {
    expect(
      resolveOwnerAddressForMode({
        mode: "collections",
        accountAddress: "0xabc",
        portfolioOwner: "0xdef",
      }),
    ).toBe("0xabc");
  });

  it("uses route owner for portfolio scope", () => {
    expect(
      resolveOwnerAddressForMode({
        mode: "portfolio",
        accountAddress: "0xabc",
        portfolioOwner: "0xdef",
      }),
    ).toBe("0xdef");
  });
});

describe("sortMergedGalleryItems", () => {
  it("sorts merged cards by newest id in latest mode", () => {
    const items = [
      { id: 2, rarityScore: 10 },
      { id: 10, rarityScore: 5 },
      { id: 5, rarityScore: 30 },
    ] as Array<{ id: number; rarityScore: number }>;
    expect(
      sortMergedGalleryItems({
        items: items as any,
        sort: "latest",
        searchValue: "",
      }).map((item) => item.id),
    ).toEqual([10, 5, 2]);
  });

  it("sorts merged cards by rarity first in scarcity mode", () => {
    const items = [
      { id: 2, rarityScore: 10 },
      { id: 10, rarityScore: 10 },
      { id: 5, rarityScore: 30 },
    ] as Array<{ id: number; rarityScore: number }>;
    expect(
      sortMergedGalleryItems({
        items: items as any,
        sort: "scarcity",
        searchValue: "",
      }).map((item) => item.id),
    ).toEqual([5, 10, 2]);
  });
});

describe("ownerWalletDisplayFallback", () => {
  it("uses wallet materialized cards when owner API page is still empty", () => {
    const walletKitties = [
      { id: 62, rarityScore: 1 },
      { id: 61, rarityScore: 2 },
    ] as any[];
    expect(
      ownerWalletDisplayFallback({
        mode: "collections",
        ownerAddress: "0x111",
        searchValue: "",
        galleryItems: [],
        walletKitties,
      }).map((item) => item.id),
    ).toEqual([62, 61]);
  });

  it("keeps API cards and search results ahead of wallet fallback", () => {
    const galleryItems = [{ id: 10, rarityScore: 1 }] as any[];
    const walletKitties = [{ id: 62, rarityScore: 1 }] as any[];
    expect(
      ownerWalletDisplayFallback({
        mode: "collections",
        ownerAddress: "0x111",
        searchValue: "",
        galleryItems,
        walletKitties,
      }).map((item) => item.id),
    ).toEqual([10]);
    expect(
      ownerWalletDisplayFallback({
        mode: "collections",
        ownerAddress: "0x111",
        searchValue: "62",
        galleryItems: [],
        walletKitties,
      }),
    ).toEqual([]);
  });

  it("never uses wallet fallback in MY COLLECTION when wallet is disconnected", () => {
    const walletKitties = [{ id: 62, rarityScore: 1 }] as any[];
    expect(
      ownerWalletDisplayFallback({
        mode: "collections",
        ownerAddress: undefined,
        searchValue: "",
        galleryItems: [],
        walletKitties,
      }),
    ).toEqual([]);
  });
});

describe("shouldDisableGallerySortDuringSearch", () => {
  it("disables sort while a non-empty search query is active", () => {
    expect(shouldDisableGallerySortDuringSearch("kitty")).toBe(true);
    expect(shouldDisableGallerySortDuringSearch("  #123  ")).toBe(true);
  });

  it("keeps sort enabled when search is empty", () => {
    expect(shouldDisableGallerySortDuringSearch("")).toBe(false);
    expect(shouldDisableGallerySortDuringSearch("   ")).toBe(false);
  });
});

describe("optimistic removal helpers", () => {
  const removals = [
    {
      txHash: `0x${"1".repeat(64)}`,
      owner: "0xaaa",
      count: 2,
      kittyIds: [10, 11],
      blockNumber: 10,
      createdAt: 1,
      expiresAt: 2,
    },
    {
      txHash: `0x${"2".repeat(64)}`,
      owner: "0xbbb",
      count: 1,
      kittyIds: [25],
      blockNumber: 11,
      createdAt: 1,
      expiresAt: 2,
    },
  ];

  it("counts removals globally and by owner", () => {
    expect(optimisticRemovalCountForOwner(removals as any)).toBe(3);
    expect(optimisticRemovalCountForOwner(removals as any, "0xaaa")).toBe(2);
  });

  it("collects removal ids globally and by owner", () => {
    expect([...optimisticRemovalIdsForScope(removals as any)].sort((a, b) => a - b)).toEqual([10, 11, 25]);
    expect([...optimisticRemovalIdsForScope(removals as any, "0xbbb")]).toEqual([25]);
  });
});

describe("optimistic owner transfer helpers", () => {
  const transfers = [
    {
      txHash: `0x${"1".repeat(64)}`,
      blockNumber: 12,
      createdAt: 1,
      expiresAt: 10,
      from: "0xaaa",
      to: "0xbbb",
      kittyIds: [10, 11],
      kitties: [],
      reason: "LISTING_FUNDED",
    },
    {
      txHash: `0x${"2".repeat(64)}`,
      blockNumber: 13,
      createdAt: 2,
      expiresAt: 10,
      from: "0xmarket",
      to: "0xaaa",
      kittyIds: [11],
      kitties: [
        {
          id: 11,
          owner: "0xmarket",
          mintedBy: "0xaaa",
        },
      ],
      reason: "LISTING_CANCELED",
    },
    {
      txHash: `0x${"3".repeat(64)}`,
      blockNumber: 14,
      createdAt: 3,
      expiresAt: 10,
      from: "0xmarket",
      to: "0xaaa",
      kittyIds: [25],
      kitties: [
        {
          id: 25,
          owner: "0xold",
          mintedBy: "0xold",
        },
      ],
      reason: "LISTING_BOUGHT",
    },
  ] as any;

  it("counts transfer deltas by direction and reason", () => {
    expect(
      ownerTransferCountForAddress({
        transfers,
        ownerAddress: "0xaaa",
        direction: "incoming",
      }),
    ).toBe(2);
    expect(
      ownerTransferCountForAddress({
        transfers,
        ownerAddress: "0xaaa",
        direction: "outgoing",
      }),
    ).toBe(2);
    expect(
      ownerTransferCountForAddress({
        transfers,
        ownerAddress: "0xaaa",
        direction: "incoming",
        reasons: ["LISTING_BOUGHT"],
      }),
    ).toBe(1);
  });

  it("applies owner transfer overlays to visible cards", () => {
    const baseItems = [
      { id: 10, owner: "0xaaa", mintedBy: "0xaaa" },
      { id: 11, owner: "0xaaa", mintedBy: "0xaaa" },
    ] as any[];
    const merged = applyOwnerTransfersToItems({
      items: baseItems as any,
      ownerAddress: "0xaaa",
      transfers,
    });
    expect(merged.map((item) => item.id).sort((a, b) => a - b)).toEqual([
      11, 25,
    ]);
    expect(merged.find((item) => item.id === 25)?.owner).toBe("0xaaa");
  });

  it("applies outgoing transfer overlays before receipt block is known", () => {
    const baseItems = [{ id: 10, owner: "0xaaa", mintedBy: "0xaaa" }] as any[];
    const merged = applyOwnerTransfersToItems({
      items: baseItems as any,
      ownerAddress: "0xaaa",
      transfers: [
        {
          txHash: `0x${"9".repeat(64)}`,
          blockNumber: 0,
          createdAt: 4,
          expiresAt: 10,
          from: "0xaaa",
          to: "0xmarket",
          kittyIds: [10],
          kitties: [],
          reason: "LISTING_FUNDED",
        },
      ] as any,
    });
    expect(merged).toEqual([]);
  });

  it("applies 2-kitty cancel transfer delta immediately (78 -> 80) while overlay is active", () => {
    const ownerAddress = "0xaaa";
    const cancelTransfer = [
      {
        txHash: `0x${"4".repeat(64)}`,
        blockNumber: 20,
        createdAt: 4,
        expiresAt: 9_999_999,
        from: "0xmarket",
        to: ownerAddress,
        kittyIds: [301, 302],
        kitties: [],
        reason: "LISTING_CANCELED",
      },
    ] as any;
    const optimisticCurrentDelta =
      ownerTransferCountForAddress({
        transfers: cancelTransfer,
        ownerAddress,
        direction: "incoming",
      }) -
      ownerTransferCountForAddress({
        transfers: cancelTransfer,
        ownerAddress,
        direction: "outgoing",
      });

    expect(
      mergeOwnerSummary({
        currentFromChain: null,
        currentFromApi: 78,
        everFromApi: 100,
        optimisticCurrentDelta,
        optimisticEverDelta: 0,
      }),
    ).toEqual({
      currentKitties: 80,
      everKitties: 100,
    });
  });
});

describe("freshness and settlement helpers", () => {
  it("treats onchain values as stale when query data predates optimistic updates", () => {
    expect(onchainCountIsFresh(100, 101)).toBe(false);
    expect(onchainCountIsFresh(101, 101)).toBe(true);
  });

  it("returns indexed-block-settled optimistic ids and tx hashes", () => {
    expect(
      settledOptimisticKittyIdsByIndexedBlock(
        [
          { id: 1, blockNumber: 100 },
          { id: 2, blockNumber: 120 },
        ] as any,
        110,
      ),
    ).toEqual([1]);
    expect(
      settledOptimisticRemovalTxHashesByIndexedBlock(
        [
          { txHash: `0x${"a".repeat(64)}`, blockNumber: 100 },
          { txHash: `0x${"b".repeat(64)}`, blockNumber: 120 },
        ] as any,
        110,
      ),
    ).toEqual([`0x${"a".repeat(64)}`]);
  });

  it("uses the freshest indexed block between status and stats for settlement cleanup", () => {
    expect(
      resolveOptimisticSettlementIndexedBlock({
        statusLatestIndexedBlock: 100,
        statsLatestIndexedBlock: 120,
      }),
    ).toBe(120);
    expect(
      resolveOptimisticSettlementIndexedBlock({
        statusLatestIndexedBlock: 140,
        statsLatestIndexedBlock: 120,
      }),
    ).toBe(140);
  });

  it("settles only count-only removals from fresh scoped live counters", () => {
    expect(
      settledCountOnlyOptimisticRemovalTxHashesByFreshCounter(
        [
          {
            txHash: `0x${"a".repeat(64)}`,
            owner: "0x1",
            count: 1,
            kittyIds: [10],
            blockNumber: 20,
            createdAt: 1,
            expiresAt: 2,
          },
          {
            txHash: `0x${"b".repeat(64)}`,
            owner: "0x1",
            count: 1,
            kittyIds: [],
            blockNumber: 21,
            createdAt: 1,
            expiresAt: 2,
          },
        ] as any,
        true,
      ),
    ).toEqual([`0x${"b".repeat(64)}`]);
    expect(
      settledCountOnlyOptimisticRemovalTxHashesByFreshCounter(
        [
          {
            txHash: `0x${"b".repeat(64)}`,
            owner: "0x1",
            count: 1,
            kittyIds: [],
            blockNumber: 21,
            createdAt: 1,
            expiresAt: 2,
          },
        ] as any,
        false,
      ),
    ).toEqual([]);
  });
});

describe("display and refresh helpers", () => {
  it("filters stale fallback cards with optimistic removal ids", () => {
    const visible = filterItemsByOptimisticRemovalIds(
      [
        { id: 10, rarityScore: 1 },
        { id: 11, rarityScore: 1 },
      ] as any,
      new Set([11]),
    );
    expect(visible.map((item) => item.id)).toEqual([10]);
  });

  it("keeps fast refresh only while optimistic buys are visible or sell counters are stale", () => {
    expect(
      shouldKeepPostTradeRefresh({
        pendingOptimisticBuyCount: 1,
        scopedOptimisticSellCount: 0,
        hasFreshScopedLiveCounter: true,
      }),
    ).toBe(true);
    expect(
      shouldKeepPostTradeRefresh({
        pendingOptimisticBuyCount: 0,
        scopedOptimisticSellCount: 1,
        hasFreshScopedLiveCounter: false,
      }),
    ).toBe(true);
    expect(
      shouldKeepPostTradeRefresh({
        pendingOptimisticBuyCount: 0,
        scopedOptimisticSellCount: 1,
        hasFreshScopedLiveCounter: true,
      }),
    ).toBe(false);
  });
});
