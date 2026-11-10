import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { KPEG_TOKEN_ABI } from "@kpeg/core";
import type { Address, PublicClient } from "viem";
import { readContract as readContractAction } from "viem/actions";
import { getConnectorClient } from "wagmi/actions";
import { getKitty, listOwner, type KittyItem } from "./api.js";
import { NORMAL_GALLERY_REFETCH_MS } from "./postTradeRefresh.js";
import { getWagmiConfig } from "./wagmi.js";

const OWNER_PAGE_SIZE = 100;
const MISSING_KITTY_BATCH_SIZE = 20;

export const WALLET_OWNER_KITTIES_QUERY_PREFIX = "wallet-owner-kitties";

export type WalletOwnerKittiesQueryData = {
  tokenAddress: Address;
  ownerIds: Set<number>;
  kitties: KittyItem[];
  missingIds: number[];
  verified: boolean;
  updatedAt: number;
};

export type OwnerKittyMaterialization = {
  ownerIds: Set<number>;
  kitties: KittyItem[];
  missingIds: number[];
};

type OwnerPagedResponse = Awaited<ReturnType<typeof listOwner>>;
type GetKittyFn = typeof getKitty;
type ListOwnerFn = typeof listOwner;
type ChainOwnedReadFn = () => Promise<{
  tokenAddress: Address;
  ownerIds: Set<number>;
  verified: boolean;
}>;

export type WalletOwnerKittiesResolveInput = {
  owner: Address;
  tokenAddress: Address;
  chainId: number;
  publicClient: PublicClient | null;
  connector?: unknown;
  seedKitties: KittyItem[];
  readChainOwned?: ChainOwnedReadFn;
  listOwnerFn?: ListOwnerFn;
  getKittyFn?: GetKittyFn;
};

function normalizeOwnerAddress(owner: string): Address {
  return owner.trim().toLowerCase() as Address;
}

function mergeUniqueKitties(kitties: KittyItem[]): KittyItem[] {
  const byId = new Map<number, KittyItem>();
  for (const kitty of kitties) {
    byId.set(kitty.id, kitty);
  }
  return [...byId.values()];
}

function sortedNumbers(values: Iterable<number>): number[] {
  return [...values].sort((a, b) => a - b);
}

function finitePositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function toOwnerIdSet(ids: readonly bigint[]): Set<number> {
  const ownerIds = new Set<number>();
  for (const rawId of ids) {
    const id = Number(rawId);
    if (finitePositiveInt(id)) {
      ownerIds.add(id);
    }
  }
  return ownerIds;
}

function hasAllOwnerKitties(
  kittyById: Map<number, KittyItem>,
  ownerIds: Set<number>,
): boolean {
  for (const ownerId of ownerIds) {
    if (!kittyById.has(ownerId)) {
      return false;
    }
  }
  return true;
}

function flattenGalleryItems(data: unknown): KittyItem[] {
  const pages = (
    data as
      | {
          pages?: Array<{ items?: KittyItem[] }>;
        }
      | undefined
  )?.pages;
  if (!Array.isArray(pages)) {
    return [];
  }
  return pages.flatMap((page) => page.items ?? []);
}

export function walletOwnerKittiesQueryKey(input: {
  chainId: number;
  tokenAddress: Address;
  owner: Address;
}) {
  return [
    WALLET_OWNER_KITTIES_QUERY_PREFIX,
    input.chainId,
    input.tokenAddress.toLowerCase(),
    input.owner.toLowerCase(),
  ] as const;
}

export function readOwnerSeedKittiesFromCache(
  queryClient: QueryClient,
  owner: string,
): KittyItem[] {
  const normalizedOwner = normalizeOwnerAddress(owner);
  const galleryKitties = queryClient
    .getQueriesData({ queryKey: ["gallery"] })
    .flatMap(([queryKey, data]) => {
      if (
        !Array.isArray(queryKey) ||
        queryKey[0] !== "gallery" ||
        (queryKey[1] !== "collections" && queryKey[1] !== "portfolio") ||
        typeof queryKey[2] !== "string" ||
        normalizeOwnerAddress(queryKey[2]) !== normalizedOwner ||
        queryKey[3] !== "latest" ||
        (typeof queryKey[4] === "string" && queryKey[4].trim())
      ) {
        return [];
      }
      return flattenGalleryItems(data);
    });

  const walletQueryKitties = queryClient
    .getQueriesData({ queryKey: [WALLET_OWNER_KITTIES_QUERY_PREFIX] })
    .flatMap(([queryKey, data]) => {
      if (
        !Array.isArray(queryKey) ||
        queryKey[0] !== WALLET_OWNER_KITTIES_QUERY_PREFIX ||
        typeof queryKey[3] !== "string" ||
        normalizeOwnerAddress(queryKey[3]) !== normalizedOwner
      ) {
        return [];
      }
      const kitties = (data as WalletOwnerKittiesQueryData | undefined)?.kitties;
      return Array.isArray(kitties) ? kitties : [];
    });

  return mergeUniqueKitties([...galleryKitties, ...walletQueryKitties]);
}

export function readWalletOwnerKittiesSnapshotFromCache(input: {
  queryClient: QueryClient;
  chainId: number;
  tokenAddress: Address;
  owner: Address;
}): WalletOwnerKittiesQueryData | undefined {
  return input.queryClient.getQueryData<WalletOwnerKittiesQueryData>(
    walletOwnerKittiesQueryKey({
      chainId: input.chainId,
      tokenAddress: input.tokenAddress,
      owner: input.owner,
    }),
  );
}

export function upsertWalletOwnerKittiesMetadata(input: {
  queryClient: QueryClient;
  chainId: number;
  tokenAddress: Address;
  owner: Address;
  kitties: KittyItem[];
}) {
  const key = walletOwnerKittiesQueryKey({
    chainId: input.chainId,
    tokenAddress: input.tokenAddress,
    owner: input.owner,
  });
  input.queryClient.setQueryData<WalletOwnerKittiesQueryData | undefined>(
    key,
    (current) => {
      if (!current) {
        return current;
      }
      const merged = mergeUniqueKitties([...current.kitties, ...input.kitties]).filter(
        (kitty) => current.ownerIds.has(kitty.id),
      );
      const mergedById = new Map(merged.map((kitty) => [kitty.id, kitty]));
      const missingIds = sortedNumbers(current.ownerIds).filter(
        (id) => !mergedById.has(id),
      );
      const unchanged =
        missingIds.length === current.missingIds.length &&
        missingIds.every((id, index) => id === current.missingIds[index]) &&
        merged.length === current.kitties.length;
      if (unchanged) {
        return current;
      }
      return {
        ...current,
        kitties: merged,
        missingIds,
        updatedAt: Date.now(),
      };
    },
  );
}

export function upsertWalletOwnerKittiesOwnedIds(input: {
  queryClient: QueryClient;
  chainId: number;
  tokenAddress: Address;
  owner: Address;
  ownerIds: Iterable<number>;
  kitties: KittyItem[];
  verified: boolean;
}) {
  const key = walletOwnerKittiesQueryKey({
    chainId: input.chainId,
    tokenAddress: input.tokenAddress,
    owner: input.owner,
  });
  const nextOwnerIds = new Set<number>();
  for (const id of input.ownerIds) {
    if (finitePositiveInt(id)) {
      nextOwnerIds.add(id);
    }
  }
  input.queryClient.setQueryData<WalletOwnerKittiesQueryData | undefined>(
    key,
    (current) => {
      const mergedOwnerIds = new Set<number>(current?.ownerIds ?? []);
      for (const id of nextOwnerIds) {
        mergedOwnerIds.add(id);
      }
      const mergedKitties = mergeUniqueKitties([
        ...(current?.kitties ?? []),
        ...input.kitties,
      ]).filter((kitty) => mergedOwnerIds.has(kitty.id));
      const mergedById = new Map(mergedKitties.map((kitty) => [kitty.id, kitty]));
      const missingIds = sortedNumbers(mergedOwnerIds).filter(
        (id) => !mergedById.has(id),
      );
      const verified = Boolean(current?.verified || input.verified);
      if (!current) {
        return {
          tokenAddress: input.tokenAddress,
          ownerIds: mergedOwnerIds,
          kitties: mergedKitties,
          missingIds,
          verified,
          updatedAt: Date.now(),
        };
      }
      const ownerIdsUnchanged =
        mergedOwnerIds.size === current.ownerIds.size &&
        [...mergedOwnerIds].every((id) => current.ownerIds.has(id));
      const missingUnchanged =
        missingIds.length === current.missingIds.length &&
        missingIds.every((id, index) => id === current.missingIds[index]);
      const kittyCountUnchanged = mergedKitties.length === current.kitties.length;
      const verifiedUnchanged = verified === current.verified;
      if (
        ownerIdsUnchanged &&
        missingUnchanged &&
        kittyCountUnchanged &&
        verifiedUnchanged
      ) {
        return current;
      }
      return {
        tokenAddress: input.tokenAddress,
        ownerIds: mergedOwnerIds,
        kitties: mergedKitties,
        missingIds,
        verified,
        updatedAt: Date.now(),
      };
    },
  );
}

export async function materializeOwnerKitties(input: {
  owner: Address;
  ownerIds: Set<number>;
  seedKitties: KittyItem[];
  listOwnerFn?: ListOwnerFn;
  getKittyFn?: GetKittyFn;
}): Promise<OwnerKittyMaterialization> {
  const listOwnerFn = input.listOwnerFn ?? listOwner;
  const getKittyFn = input.getKittyFn ?? getKitty;
  const ownerIds = new Set(input.ownerIds);
  const kittyById = new Map<number, KittyItem>();

  for (const kitty of input.seedKitties) {
    if (ownerIds.has(kitty.id)) {
      kittyById.set(kitty.id, kitty);
    }
  }

  if (ownerIds.size === 0) {
    return { ownerIds, kitties: [], missingIds: [] };
  }

  const maxPages = Math.max(2, Math.ceil(ownerIds.size / OWNER_PAGE_SIZE) + 2);
  let offset = 0;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    if (hasAllOwnerKitties(kittyById, ownerIds)) {
      break;
    }
    const page = (await listOwnerFn(
      input.owner,
      Math.floor(offset / OWNER_PAGE_SIZE),
      OWNER_PAGE_SIZE,
      "latest",
      offset,
    )) as OwnerPagedResponse;
    if (page.items.length === 0) {
      break;
    }
    for (const kitty of page.items) {
      if (ownerIds.has(kitty.id)) {
        kittyById.set(kitty.id, kitty);
      }
    }
    offset += page.items.length;
  }

  const unresolvedIds = sortedNumbers(ownerIds).filter((id) => !kittyById.has(id));
  for (let start = 0; start < unresolvedIds.length; start += MISSING_KITTY_BATCH_SIZE) {
    const batchIds = unresolvedIds.slice(start, start + MISSING_KITTY_BATCH_SIZE);
    await Promise.all(
      batchIds.map(async (kittyId) => {
        try {
          const kitty = await getKittyFn(kittyId);
          if (ownerIds.has(kitty.id)) {
            kittyById.set(kitty.id, kitty);
          }
        } catch {
          // Keep placeholder option for still-missing metadata.
        }
      }),
    );
  }

  const missingIds = sortedNumbers(ownerIds).filter((id) => !kittyById.has(id));
  const kitties = sortedNumbers(ownerIds)
    .map((id) => kittyById.get(id))
    .filter((kitty): kitty is KittyItem => kitty !== undefined);

  return {
    ownerIds,
    kitties,
    missingIds,
  };
}

async function loadOwnerKittiesFromApi(
  owner: Address,
  seedKitties: KittyItem[],
  listOwnerFn: ListOwnerFn,
): Promise<KittyItem[]> {
  const kittyById = new Map(seedKitties.map((kitty) => [kitty.id, kitty]));
  let offset = 0;
  while (true) {
    const page = await listOwnerFn(
      owner,
      Math.floor(offset / OWNER_PAGE_SIZE),
      OWNER_PAGE_SIZE,
      "latest",
      offset,
    );
    if (page.items.length === 0) {
      break;
    }
    for (const kitty of page.items) {
      kittyById.set(kitty.id, kitty);
    }
    offset += page.items.length;
    if (offset >= page.total) {
      break;
    }
  }
  return [...kittyById.values()];
}

async function readOwnerKittiesFromPublicClient(input: {
  publicClient: PublicClient;
  tokenAddress: Address;
  owner: Address;
}): Promise<readonly bigint[]> {
  return input.publicClient.readContract({
    address: input.tokenAddress,
    abi: KPEG_TOKEN_ABI,
    functionName: "getOwnerKitties",
    args: [input.owner],
  }) as Promise<readonly bigint[]>;
}

async function readOwnerKittiesFromConnectedWallet(input: {
  tokenAddress: Address;
  owner: Address;
  chainId: number;
  connector?: unknown;
}): Promise<readonly bigint[]> {
  const connectorClient = await getConnectorClient(getWagmiConfig(), {
    chainId: input.chainId,
    connector: input.connector as never,
    account: input.owner,
  });
  return readContractAction(connectorClient as never, {
    address: input.tokenAddress,
    abi: KPEG_TOKEN_ABI,
    functionName: "getOwnerKitties",
    args: [input.owner],
  } as never) as Promise<readonly bigint[]>;
}

export async function readWalletOwnerKitties(input: {
  publicClient: PublicClient | null;
  owner: Address;
  tokenAddress: Address;
  chainId: number;
  connector?: unknown;
  readWithConnectedWallet?: boolean;
  readFromPublicClient?: () => Promise<readonly bigint[]>;
  readFromConnectedWallet?: () => Promise<readonly bigint[]>;
}): Promise<{
  tokenAddress: Address;
  ownerIds: Set<number>;
  verified: boolean;
}> {
  const readWithConnectedWallet = input.readWithConnectedWallet ?? true;
  let publicError: unknown = null;

  if (input.publicClient) {
    try {
      const ownerKittyIds = input.readFromPublicClient
        ? await input.readFromPublicClient()
        : await readOwnerKittiesFromPublicClient({
            publicClient: input.publicClient,
            tokenAddress: input.tokenAddress,
            owner: input.owner,
          });
      return {
        tokenAddress: input.tokenAddress,
        ownerIds: toOwnerIdSet(ownerKittyIds),
        verified: true,
      };
    } catch (error) {
      publicError = error;
      console.warn(
        "Wallet owner-kitties read via public client failed; trying connected wallet fallback.",
        error,
      );
    }
  }

  if (!readWithConnectedWallet || !input.connector) {
    throw (publicError ?? new Error("Wallet owner-kitties read unavailable"));
  }

  try {
    const ownerKittyIds = input.readFromConnectedWallet
      ? await input.readFromConnectedWallet()
      : await readOwnerKittiesFromConnectedWallet({
          tokenAddress: input.tokenAddress,
          owner: input.owner,
          chainId: input.chainId,
          connector: input.connector,
        });
    return {
      tokenAddress: input.tokenAddress,
      ownerIds: toOwnerIdSet(ownerKittyIds),
      verified: true,
    };
  } catch (error) {
    console.warn(
      "Wallet owner-kitties read via connected wallet fallback failed.",
      error,
    );
    throw error;
  }
}

export async function resolveWalletOwnerKittiesQueryData(
  input: WalletOwnerKittiesResolveInput,
): Promise<WalletOwnerKittiesQueryData> {
  const listOwnerFn = input.listOwnerFn ?? listOwner;
  const getKittyFn = input.getKittyFn ?? getKitty;
  const readChainOwned =
    input.readChainOwned ??
    (() =>
      readWalletOwnerKitties({
        publicClient: input.publicClient,
        owner: input.owner,
        tokenAddress: input.tokenAddress,
        chainId: input.chainId,
        connector: input.connector,
      }));
  const seedKitties = mergeUniqueKitties(input.seedKitties);

  try {
    const chainOwned = await readChainOwned();
    const materialized = await materializeOwnerKitties({
      owner: input.owner,
      ownerIds: chainOwned.ownerIds,
      seedKitties,
      listOwnerFn,
      getKittyFn,
    });
    return {
      tokenAddress: chainOwned.tokenAddress,
      ownerIds: materialized.ownerIds,
      kitties: materialized.kitties,
      missingIds: materialized.missingIds,
      verified: chainOwned.verified,
      updatedAt: Date.now(),
    };
  } catch (error) {
    console.warn(
      "Wallet owner-kitties chain verification failed; using API/cache fallback.",
      error,
    );
  }

  let apiKitties = seedKitties;
  try {
    apiKitties = await loadOwnerKittiesFromApi(
      input.owner,
      seedKitties,
      listOwnerFn,
    );
  } catch (error) {
    console.warn(
      "Wallet owner-kitties API fallback failed; using current owner cache.",
      error,
    );
  }
  const fallbackOwnerIds = new Set(apiKitties.map((kitty) => kitty.id));
  const fallbackMaterialized = await materializeOwnerKitties({
    owner: input.owner,
    ownerIds: fallbackOwnerIds,
    seedKitties: apiKitties,
    listOwnerFn,
    getKittyFn,
  });
  return {
    tokenAddress: input.tokenAddress,
    ownerIds: fallbackMaterialized.ownerIds,
    kitties: fallbackMaterialized.kitties,
    missingIds: fallbackMaterialized.missingIds,
    verified: false,
    updatedAt: Date.now(),
  };
}

export function useWalletOwnerKitties(input: {
  owner: Address | null;
  tokenAddress: Address | null;
  chainId: number;
  publicClient: PublicClient | null;
  connector?: unknown;
  enabled: boolean;
  seedKitties?: KittyItem[];
  readChainOwned?: ChainOwnedReadFn;
}): UseQueryResult<WalletOwnerKittiesQueryData> {
  const queryClient = useQueryClient();
  const owner = input.owner ? normalizeOwnerAddress(input.owner) : null;
  const tokenAddress = input.tokenAddress
    ? (input.tokenAddress.toLowerCase() as Address)
    : null;
  const queryKey =
    owner && tokenAddress
      ? walletOwnerKittiesQueryKey({
          chainId: input.chainId,
          tokenAddress,
          owner,
        })
      : ([WALLET_OWNER_KITTIES_QUERY_PREFIX, "disabled"] as const);

  return useQuery({
    queryKey,
    enabled: Boolean(
      input.enabled &&
        owner &&
        tokenAddress &&
        finitePositiveInt(input.chainId),
    ),
    queryFn: async () => {
      if (!owner || !tokenAddress) {
        throw new Error("Wallet owner query is missing owner/token");
      }
      const cached = queryClient.getQueryData<WalletOwnerKittiesQueryData>(
        walletOwnerKittiesQueryKey({
          chainId: input.chainId,
          tokenAddress,
          owner,
        }),
      );
      const seedKitties = mergeUniqueKitties([
        ...(input.seedKitties ?? []),
        ...(cached?.kitties ?? []),
      ]);
      return resolveWalletOwnerKittiesQueryData({
        owner,
        tokenAddress,
        chainId: input.chainId,
        publicClient: input.publicClient,
        connector: input.connector,
        seedKitties,
        ...(input.readChainOwned
          ? { readChainOwned: input.readChainOwned }
          : {}),
      });
    },
    initialData: () => {
      if (!owner || !tokenAddress) {
        return undefined;
      }
      return readWalletOwnerKittiesSnapshotFromCache({
        queryClient,
        chainId: input.chainId,
        tokenAddress,
        owner,
      });
    },
    staleTime: NORMAL_GALLERY_REFETCH_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: NORMAL_GALLERY_REFETCH_MS,
  });
}
