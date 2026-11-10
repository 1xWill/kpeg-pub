import type { MarketListing, MarketTab } from "./api.js";

export type MarketListingPhase =
  | "listing"
  | "listed"
  | "canceling"
  | "canceled"
  | "buying"
  | "bought"
  | "updating"
  | "updated";

export type MarketListingView = MarketListing & {
  optimisticPhase?: MarketListingPhase;
  optimisticLabelId?: number;
};

function isInFlightPhase(phase: MarketListingPhase | undefined): boolean {
  return (
    phase === "listing" ||
    phase === "canceling" ||
    phase === "buying" ||
    phase === "updating"
  );
}

function isConfirmedPhase(phase: MarketListingPhase | undefined): boolean {
  return (
    phase === "listed" ||
    phase === "canceled" ||
    phase === "bought" ||
    phase === "updated"
  );
}

function listingMatchesServer(
  listing: Pick<MarketListing, "status" | "priceWei" | "buyer">,
  server: Pick<MarketListing, "status" | "priceWei" | "buyer"> | undefined,
): boolean {
  if (!server) {
    return false;
  }
  if (listing.status !== server.status) {
    return false;
  }
  if (listing.status === "OPEN") {
    return listing.priceWei === server.priceWei;
  }
  if (listing.status === "SOLD") {
    return (
      (listing.buyer ?? "").toLowerCase() ===
      (server.buyer ?? "").toLowerCase()
    );
  }
  return true;
}

function confirmedPhaseSettled(
  listing: MarketListingView,
  server: MarketListing | undefined,
): boolean {
  switch (listing.optimisticPhase) {
    case "listed":
    case "updated":
      return Boolean(
        server && server.status === "OPEN" && server.priceWei === listing.priceWei,
      );
    case "canceled":
      return !server || server.status === "DELETED";
    case "bought":
      return Boolean(server && server.status === "SOLD");
    default:
      return listingMatchesServer(listing, server);
  }
}

export function displayListingId(listing: MarketListingView): number {
  return (
    listing.optimisticLabelId ??
    listing.kitties[0]?.id ??
    listing.kittyIds[0] ??
    listing.tradeId
  );
}

export function withoutMarketListingPhase(
  listing: MarketListingView,
): MarketListingView {
  const { optimisticPhase: _phase, ...settled } = listing;
  void _phase;
  return settled;
}

export function canManageMarketListing(
  listing: MarketListing,
  address: string | undefined,
): boolean {
  return Boolean(
    address &&
      listing.seller.toLowerCase() === address.toLowerCase() &&
      listing.status !== "SOLD" &&
      listing.status !== "DELETED",
  );
}

export function canBuyMarketListing(
  listing: MarketListing,
  address: string | undefined,
): boolean {
  return Boolean(
    listing.status === "OPEN" &&
      (!address || listing.seller.toLowerCase() !== address.toLowerCase()),
  );
}

export function pruneMarketListingOverrides(
  current: Record<number, MarketListingView>,
  serverListings: MarketListing[],
): Record<number, MarketListingView> {
  const serverByTradeId = new Map(
    serverListings.map((listing) => [listing.tradeId, listing]),
  );
  return Object.fromEntries(
    Object.entries(current).filter(([tradeId, listing]) => {
      if (isInFlightPhase(listing.optimisticPhase)) return true;
      const server = serverByTradeId.get(Number(tradeId));
      if (isConfirmedPhase(listing.optimisticPhase)) {
        return !confirmedPhaseSettled(listing, server);
      }
      if (listing.status === "DELETED") {
        if (!server) return true;
        return server.status !== "DELETED";
      }
      if (!server) return true;
      return (
        server.status !== listing.status || server.priceWei !== listing.priceWei
      );
    }),
  );
}

export function reconcileTemporaryListingsByCreatedTxHash(
  current: Record<number, MarketListingView>,
  serverListings: MarketListing[],
): Record<number, MarketListingView> {
  if (serverListings.length === 0) {
    return current;
  }
  const tradeByCreatedTxHash = new Map<string, MarketListing>();
  for (const item of serverListings) {
    tradeByCreatedTxHash.set(item.createdTxHash.toLowerCase(), item);
  }

  let changed = false;
  let next = current;
  for (const optimistic of Object.values(current)) {
    if (optimistic.tradeId >= 0) {
      continue;
    }
    const matched = tradeByCreatedTxHash.get(
      optimistic.createdTxHash.toLowerCase(),
    );
    if (!matched) {
      continue;
    }
    if (!changed) {
      next = { ...current };
      changed = true;
    }
    delete next[optimistic.tradeId];
    if (!next[matched.tradeId]) {
      next[matched.tradeId] = {
        ...matched,
        optimisticPhase: "listed",
        optimisticLabelId: displayListingId(optimistic),
        updatedAt: Math.max(optimistic.updatedAt, matched.updatedAt),
      };
    }
  }
  return changed ? next : current;
}

export function mergeMarketListingViews({
  activeTab,
  address,
  searchValue,
  serverListings,
  localListings,
}: {
  activeTab: MarketTab;
  address: string | undefined;
  searchValue: string;
  serverListings: MarketListing[];
  localListings: Record<number, MarketListingView>;
}): MarketListingView[] {
  const searching = searchValue.trim().length > 0;
  const scopedServerListings = serverListings.filter((listing) =>
    matchesMarketTab(listing, activeTab, address),
  );
  const serverByTradeId = new Map(
    scopedServerListings.map((listing) => [listing.tradeId, listing]),
  );
  const merged = new Map<number, MarketListingView>(
    scopedServerListings.map((listing) => [listing.tradeId, listing]),
  );
  const localOnly: MarketListingView[] = [];
  Object.values(localListings).forEach((listing) => {
    const server = serverByTradeId.get(listing.tradeId);
    const inFlight = isInFlightPhase(listing.optimisticPhase);
    const confirmed = isConfirmedPhase(listing.optimisticPhase);
    if (!matchesMarketTab(listing, activeTab, address)) {
      if (listing.status === "DELETED" && server) {
        merged.set(listing.tradeId, listing);
      }
      return;
    }
    if (searching) {
      if (!server && !inFlight) {
        return;
      }
      if (
        inFlight ||
        (confirmed && !confirmedPhaseSettled(listing, server)) ||
        (server !== undefined &&
          (listing.status !== server.status ||
            listing.priceWei !== server.priceWei))
      ) {
        merged.set(listing.tradeId, listing);
      }
      return;
    }
    if (inFlight || !server) {
      if (!server) {
        localOnly.push(listing);
        return;
      }
      merged.set(listing.tradeId, listing);
      return;
    }
    if (confirmed) {
      if (!confirmedPhaseSettled(listing, server)) {
        merged.set(listing.tradeId, listing);
      }
      return;
    }
    if (
      listing.status !== server?.status ||
      listing.priceWei !== server?.priceWei
    ) {
      merged.set(listing.tradeId, listing);
    }
  });
  return [
    ...(searching ? [] : localOnly.sort((a, b) => b.updatedAt - a.updatedAt)),
    ...Array.from(merged.values()),
  ].filter((listing) => listing.status !== "DELETED");
}

function matchesMarketTab(
  listing: MarketListingView,
  activeTab: MarketTab,
  address: string | undefined,
): boolean {
  if (activeTab === "all") {
    return listing.status === "OPEN";
  }
  if (!address) return false;
  const normalized = address.toLowerCase();
  if (activeTab === "my-listings") {
    return listing.seller.toLowerCase() === normalized && listing.status !== "SOLD";
  }
  if (activeTab === "bought") {
    return listing.buyer?.toLowerCase() === normalized;
  }
  return listing.seller.toLowerCase() === normalized && listing.status === "SOLD";
}
