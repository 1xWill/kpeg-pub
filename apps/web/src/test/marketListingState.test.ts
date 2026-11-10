import { describe, expect, it } from "vitest";
import {
  canBuyMarketListing,
  canManageMarketListing,
  mergeMarketListingViews,
  pruneMarketListingOverrides,
  reconcileTemporaryListingsByCreatedTxHash,
  type MarketListingView,
} from "../lib/marketListingState.js";

function listing(
  tradeId: number,
  patch: Partial<MarketListingView> = {},
): MarketListingView {
  return {
    tradeId,
    escrowAddress: `0x${tradeId.toString().padStart(40, "0")}`,
    seller: "0x1111111111111111111111111111111111111111",
    buyer: null,
    paymentToken: "0x0000000000000000000000000000000000000000",
    priceWei: "1000000000000000000",
    feeBps: 200,
    kittyIds: [tradeId],
    kittyCount: 1,
    status: "OPEN",
    createdBlock: 1,
    createdTxHash: `0x${tradeId.toString().padStart(64, "0")}`,
    createdAt: 1,
    updatedAt: tradeId,
    closedBlock: null,
    closedTxHash: null,
    closedAt: null,
    kitties: [],
    ...patch,
  };
}

describe("market listing state", () => {
  it("hides a canceling listing immediately while the server is still stale", () => {
    const seller = "0x1111111111111111111111111111111111111111";
    const server = listing(1, { seller });
    const local = listing(1, {
      seller,
      status: "DELETED",
      optimisticPhase: "canceling",
    });

    expect(
      mergeMarketListingViews({
        activeTab: "my-listings",
        address: seller,
        searchValue: "",
        serverListings: [server],
        localListings: { 1: local },
      }),
    ).toHaveLength(0);
    expect(
      mergeMarketListingViews({
        activeTab: "all",
        address: seller,
        searchValue: "kpeg",
        serverListings: [server],
        localListings: { 1: local },
      }),
    ).toHaveLength(0);
    expect(pruneMarketListingOverrides({ 1: local }, [server])).toEqual({
      1: local,
    });
  });

  it("keeps a locally deleted listing when the current server scope omits it", () => {
    const server = listing(1);
    const local = listing(1, { status: "DELETED" });

    expect(
      mergeMarketListingViews({
        activeTab: "my-listings",
        address: server.seller,
        searchValue: "",
        serverListings: [server],
        localListings: { 1: local },
      }),
    ).toHaveLength(0);
    expect(pruneMarketListingOverrides({ 1: local }, [])).toEqual({
      1: local,
    });
  });

  it("drops deleted overrides once server confirms deleted status", () => {
    const local = listing(1, { status: "DELETED" });
    const serverDeleted = listing(1, { status: "DELETED" });

    expect(pruneMarketListingOverrides({ 1: local }, [serverDeleted])).toEqual(
      {},
    );
  });

  it("keeps local delete override hidden even if stale server row is open", () => {
    const seller = "0x1111111111111111111111111111111111111111";
    const staleServerOpen = listing(1, {
      seller,
      status: "OPEN",
    });
    const localDeleted = listing(1, {
      seller,
      status: "DELETED",
      closedTxHash: `0x${"f".repeat(64)}`,
    });

    const afterAllTabPrune = pruneMarketListingOverrides({ 1: localDeleted }, []);
    expect(afterAllTabPrune).toEqual({ 1: localDeleted });
    expect(
      mergeMarketListingViews({
        activeTab: "my-listings",
        address: seller,
        searchValue: "",
        serverListings: [staleServerOpen],
        localListings: afterAllTabPrune,
      }),
    ).toHaveLength(0);
  });

  it("keeps an updated price override until the server matches it", () => {
    const server = listing(1, { priceWei: "100" });
    const local = listing(1, { priceWei: "200" });

    expect(pruneMarketListingOverrides({ 1: local }, [server])).toEqual({
      1: local,
    });
    expect(
      pruneMarketListingOverrides({ 1: local }, [
        listing(1, { priceWei: "200" }),
      ]),
    ).toEqual({});
  });

  it("shows a buying override in bought but not all", () => {
    const buyer = "0x2222222222222222222222222222222222222222";
    const local = listing(1, {
      buyer,
      status: "SOLD",
      optimisticPhase: "buying",
    });

    expect(
      mergeMarketListingViews({
        activeTab: "bought",
        address: buyer,
        searchValue: "",
        serverListings: [],
        localListings: { 1: local },
      })[0]?.optimisticPhase,
    ).toBe("buying");
    expect(
      mergeMarketListingViews({
        activeTab: "all",
        address: buyer,
        searchValue: "",
        serverListings: [],
        localListings: { 1: local },
      }),
    ).toHaveLength(0);
  });

  it("keeps in-flight listing overlay visible while status stays OPEN", () => {
    const seller = "0x1111111111111111111111111111111111111111";
    const pending = listing(1, {
      seller,
      status: "OPEN",
      optimisticPhase: "listing",
    });

    expect(
      mergeMarketListingViews({
        activeTab: "all",
        address: seller,
        searchValue: "",
        serverListings: [],
        localListings: { 1: pending },
      }),
    ).toHaveLength(1);
    expect(
      mergeMarketListingViews({
        activeTab: "my-listings",
        address: seller,
        searchValue: "",
        serverListings: [],
        localListings: { 1: pending },
      })[0]?.status,
    ).toBe("OPEN");
  });

  it("filters stale server rows by active tab before merging", () => {
    const seller = "0x1111111111111111111111111111111111111111";
    const openListing = listing(1, { seller, status: "OPEN" });

    expect(
      mergeMarketListingViews({
        activeTab: "bought",
        address: seller,
        searchValue: "",
        serverListings: [openListing],
        localListings: {},
      }),
    ).toHaveLength(0);
    expect(
      mergeMarketListingViews({
        activeTab: "sold",
        address: seller,
        searchValue: "",
        serverListings: [openListing],
        localListings: {},
      }),
    ).toHaveLength(0);
  });

  it("does not expose buy or seller controls for sold listings", () => {
    const seller = "0x1111111111111111111111111111111111111111";
    const buyer = "0x2222222222222222222222222222222222222222";
    const sold = listing(1, { buyer, seller, status: "SOLD" });

    expect(canManageMarketListing(sold, seller)).toBe(false);
    expect(canBuyMarketListing(sold, buyer)).toBe(false);
    expect(canBuyMarketListing(sold, undefined)).toBe(false);
  });

  it("allows active seller controls only before sale", () => {
    const seller = "0x1111111111111111111111111111111111111111";
    const buyer = "0x2222222222222222222222222222222222222222";
    const open = listing(1, { seller, status: "OPEN" });

    expect(canManageMarketListing(open, seller)).toBe(true);
    expect(canBuyMarketListing(open, seller)).toBe(false);
    expect(canBuyMarketListing(open, buyer)).toBe(true);
  });

  it("reconciles a temporary negative listing when server listing matches createdTxHash", () => {
    const txHash = `0x${"a".repeat(64)}`;
    const temporary = listing(-1, {
      createdTxHash: txHash,
      kittyIds: [777],
      optimisticPhase: "listing",
      updatedAt: 1000,
    });
    const server = listing(9, {
      createdTxHash: txHash,
      priceWei: "300",
      updatedAt: 2000,
    });

    const reconciled = reconcileTemporaryListingsByCreatedTxHash(
      { [-1]: temporary },
      [server],
    );

    expect(reconciled[-1]).toBeUndefined();
    expect(reconciled[9]?.optimisticPhase).toBe("listed");
    expect(reconciled[9]?.optimisticLabelId).toBe(777);
    expect(reconciled[9]?.priceWei).toBe("300");
  });

  it("keeps reference when no temporary listing matches createdTxHash", () => {
    const current = {
      [-1]: listing(-1, {
        createdTxHash: `0x${"a".repeat(64)}`,
        optimisticPhase: "listing",
      }),
    };
    const server = listing(9, {
      createdTxHash: `0x${"b".repeat(64)}`,
    });

    const reconciled = reconcileTemporaryListingsByCreatedTxHash(current, [
      server,
    ]);
    expect(reconciled).toBe(current);
  });
});
