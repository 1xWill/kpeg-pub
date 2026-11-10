import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { useToast } from "../context/toast.js";
import { listMarketListings } from "../lib/api.js";
import type { MarketListing } from "../lib/api.js";
import { formatFixedDecimals, shortAddress } from "../lib/format.js";

function soldKittyLabel(listing: MarketListing): string {
  if (listing.kittyCount === 1) {
    return `kPEG #${(listing.kitties[0]?.id ?? listing.kittyIds[0] ?? listing.tradeId).toLocaleString()}`;
  }
  return `${listing.kittyCount.toLocaleString()} kPEGs`;
}

function soldEthLabel(priceWei: string): string {
  try {
    return formatFixedDecimals(Number(formatEther(BigInt(priceWei))), "ETH", 4);
  } catch {
    return "ETH";
  }
}

export function MarketSaleWatcher() {
  const { address } = useAccount();
  const { pushToast } = useToast();
  const initializedFor = useRef<string | null>(null);
  const seenTradeIds = useRef(new Set<number>());
  const salesQuery = useQuery({
    queryKey: ["market-sale-watch", address],
    queryFn: () => listMarketListings(0, 100, "sold", "latest", address),
    enabled: Boolean(address),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!address) {
      initializedFor.current = null;
      seenTradeIds.current.clear();
      return;
    }
    const listings = salesQuery.data?.items;
    if (!listings) return;
    if (initializedFor.current !== address) {
      initializedFor.current = address;
      seenTradeIds.current = new Set(listings.map((listing) => listing.tradeId));
      return;
    }
    listings.forEach((listing) => {
      if (seenTradeIds.current.has(listing.tradeId)) return;
      seenTradeIds.current.add(listing.tradeId);
      pushToast({
        kind: "success",
        title: "kPEG Sold",
        message: `Your ${soldKittyLabel(listing)} just sold to ${shortAddress(listing.buyer ?? "")} at ${soldEthLabel(listing.priceWei)}`,
        dedupKey: `market-sale-${listing.tradeId}`,
      });
    });
  }, [address, pushToast, salesQuery.data]);

  return null;
}
