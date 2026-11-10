import type { KPEGTraits } from "@kpeg/core";

const API_BASE = import.meta.env.VITE_API_BASE_URL?.trim() ?? "";
export type SortMode = "latest" | "scarcity";
export type ScopeMode = "explore" | "my-collections";
export type Tier = 0 | 1 | 2 | 3 | 4;

export interface StatsResponse {
  tokenSupplyFixed: number;
  kittiesLive: number;
  kittiesEverMinted: number;
  holdersLive: number;
  holdersEver: number;
  latestIndexedBlock: number;
}

export interface StatusResponse {
  latestIndexedBlock: number;
  tokenBalanceIndexedBlock?: number;
  headBlock: number | null;
  blocksBehind?: number | null;
  caughtUp: boolean | null;
  syncing: boolean;
}

export interface KittyTraitChance {
  trait: string;
  selectedWeight: number;
  contextTotalWeight: number;
  probabilityPct: number;
}

export interface KittyItem {
  id: number;
  seed: string;
  // Final rarity tier derived from Rarity Probability.
  tier: number;
  tierLabel: string;
  // Mint tier derived from buy batch size.
  mintTier: number;
  mintTierLabel: string;
  owner: string;
  mintedBy: string;
  mintBatchSize: number;
  mintedAt: number;
  blockNumber: number;
  txHash?: string;
  gasUsed?: number | null;
  baseFeeWei?: string | null;
  rarityScore: number;
  traits: KPEGTraits;
  traitOdds?: Record<keyof KPEGTraits, KittyTraitChance>;
  kpegRarity: {
    label: "RARITY";
    percentage: number;
    oneInN: number;
    basis: "Rarity Probability";
  };
}

export interface KittyDetailItem extends KittyItem {
  txHash: string;
  gasUsed: number | null;
  baseFeeWei: string | null;
  traitOdds: Record<keyof KPEGTraits, KittyTraitChance>;
}

export interface ConfigResponse {
  fixedTokenSupply: number;
  naiveCombinationCount: number;
  filteredCombinationCountByManifest: number;
  documentedFilteredCombinationCount: number;
  compatibilityReduction: {
    removed: number;
    reductionPct: number;
  };
  searchDebounceMs: number;
  chainId: number | null;
  tokenAddress: string | null;
  marketAddress: string | null;
  routerAddress: string | null;
  quoterAddress: string | null;
}

export type MarketTab = "all" | "my-listings" | "bought" | "sold";
export type MarketStatus = "OPEN" | "SOLD" | "DELETED";

export interface MarketStatsResponse {
  floorWei: string;
  volumeWei: string;
  listed: number;
}

export interface MarketListing {
  tradeId: number;
  escrowAddress: string;
  seller: string;
  buyer: string | null;
  paymentToken: string;
  priceWei: string;
  feeBps: number;
  kittyIds: number[];
  kittyCount: number;
  status: MarketStatus;
  createdBlock: number;
  createdTxHash: string;
  createdAt: number;
  updatedAt: number;
  closedBlock: number | null;
  closedTxHash: string | null;
  closedAt: number | null;
  kitties: KittyItem[];
}

export interface MarketPagedResponse {
  page: number;
  pageSize: number;
  total: number;
  items: MarketListing[];
}

export interface PagedResponse {
  page: number;
  pageSize: number;
  total: number;
  items: KittyItem[];
}

export type PageRequest = {
  page?: number;
  pageSize: number;
  offset?: number | undefined;
};

export interface OwnerStatsResponse {
  currentKitties: number;
  everKitties: number;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(input: { status: number; path: string; message: string }) {
    super(input.message);
    this.name = "ApiRequestError";
    this.status = input.status;
    this.path = input.path;
  }
}

function apiErrorMessage(input: {
  status: number;
  fallback: string;
  payload: string;
}): string {
  const trimmed = input.payload.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown; detail?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        const detail =
          typeof parsed.detail === "string" && parsed.detail.trim()
            ? `: ${parsed.detail.trim()}`
            : "";
        return `${parsed.error.trim()}${detail}`;
      }
    } catch {
      if (/FUNCTION_INVOCATION_FAILED/i.test(trimmed)) {
        return "api unavailable: serverless function failed";
      }
    }
  }
  return input.fallback;
}

export function isApiUnavailableError(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    return error.status >= 500 || /api unavailable|function failed/i.test(error.message);
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("api unavailable") ||
    message.includes("function_invocation_failed") ||
    message.includes("request failed: 500") ||
    message.includes("request failed: 503")
  );
}

async function fetchJsonFrom<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers
  });
  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    throw new ApiRequestError({
      status: response.status,
      path,
      message: apiErrorMessage({
        status: response.status,
        fallback: `request failed: ${response.status}`,
        payload
      })
    });
  }
  return response.json() as Promise<T>;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  return fetchJsonFrom(API_BASE, path, init);
}

function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("request failed: 404") || message.includes("not found");
}

export async function getStats(): Promise<StatsResponse> {
  return fetchJson("/api/stats");
}

export async function getConfig(): Promise<ConfigResponse> {
  return fetchJson("/api/config");
}

export async function getStatus(): Promise<StatusResponse> {
  return fetchJson("/api/status");
}

export async function triggerSync(txHash?: `0x${string}`): Promise<{ ok: true; skipped: boolean; latestIndexedBlock: number }> {
  return fetchJson("/api/sync", txHash
    ? { method: "POST", body: JSON.stringify({ txHash }) }
    : { method: "POST" });
}

function pageParams(input: PageRequest): URLSearchParams {
  const params = new URLSearchParams({
    page: String(input.page ?? 0),
    pageSize: String(input.pageSize),
  });
  if (input.offset !== undefined) {
    params.set("offset", String(input.offset));
  }
  return params;
}

export async function listGlobal(page: number, pageSize: number, sort: SortMode, offset?: number): Promise<PagedResponse> {
  const params = pageParams({ page, pageSize, offset });
  params.set("sort", sort);
  return fetchJson(`/api/kitties/global?${params.toString()}`);
}

export async function listOwner(
  owner: string,
  page: number,
  pageSize: number,
  sort: SortMode,
  offset?: number
): Promise<PagedResponse> {
  const params = pageParams({ page, pageSize, offset });
  params.set("sort", sort);
  return fetchJson(`/api/kitties/owner/${owner}?${params.toString()}`);
}

export async function getOwnerStats(owner: string): Promise<OwnerStatsResponse> {
  return fetchJson(`/api/kitties/owner/${owner}/stats`);
}

export async function searchKitties(
  q: string,
  scope: ScopeMode,
  owner: string | null,
  page: number,
  pageSize: number,
  offset?: number
): Promise<{ type: string; page?: number; pageSize?: number; total: number; items: KittyItem[] }> {
  const params = pageParams({
    page,
    pageSize,
    offset,
  });
  params.set("q", q);
  params.set("scope", scope);
  if (owner) {
    params.set("owner", owner);
  }
  return fetchJson(`/api/kitties/search?${params.toString()}`);
}

export async function getKitty(id: number): Promise<KittyDetailItem> {
  return fetchJson(`/api/kitties/${id}`);
}

export async function getKittyOrNull(id: number): Promise<KittyDetailItem | null> {
  try {
    return await getKitty(id);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function getMarketStats(): Promise<MarketStatsResponse> {
  return fetchJson("/api/market/stats");
}

export async function listMarketListings(
  page: number,
  pageSize: number,
  tab: MarketTab,
  sort: SortMode,
  owner?: string | null,
  offset?: number,
  search?: string
): Promise<MarketPagedResponse> {
  const params = pageParams({ page, pageSize, offset });
  params.set("tab", tab);
  params.set("sort", sort);
  if (owner) {
    params.set("owner", owner);
  }
  if (search?.trim()) {
    params.set("q", search.trim());
  }
  return fetchJson(`/api/market/listings?${params.toString()}`);
}

export async function getMarketListing(tradeId: number): Promise<MarketListing> {
  return fetchJson(`/api/market/listings/${tradeId}`);
}

export async function getMarketListingOrNull(
  tradeId: number,
): Promise<MarketListing | null> {
  try {
    return await getMarketListing(tradeId);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}
