import Fastify from "fastify";
import { z } from "zod";
import { generateKPEGFromSeed, renderGeneratedKPEGSvg } from "@kpeg/core";
import type { KPEGRepository } from "./repository.js";

const querySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["latest", "scarcity"]).default("latest")
});

const searchSchema = z.object({
  q: z.string().default(""),
  scope: z.enum(["explore", "my-collections"]).default("explore"),
  owner: z.string().optional(),
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).optional()
});

type RuntimeConfig = {
  chainId: number | null;
  tokenAddress: string | null;
  marketAddress: string | null;
  routerAddress: string | null;
  quoterAddress: string | null;
  corsOrigin?: string;
};

export type SyncRunInput = {
  txHash?: `0x${string}` | undefined;
  authorizedBySecret: boolean;
};

export type RepairJobStatusDto = {
  jobName: string;
  version: number;
  status: "pending" | "running" | "done" | "failed";
  fromBlock: number;
  nextBlock: number;
  targetBlock: number | null;
  updatedAtMs: number;
  lastError: string | null;
};

export type SyncRunResult = {
  ok: true;
  skipped: boolean;
  latestIndexedBlock: number;
  headBlock?: number;
  caughtUp?: boolean;
  tokenBalanceIndexedBlock?: number;
  blocksBehind?: number | null;
  maxKittyId?: number;
  dbLiveKitties?: number;
  onchainKittiesEverMinted?: number | null;
  onchainKittiesLive?: number | null;
  kittyIndexedBehind?: number | null;
  lastSyncSuccessAtMs?: number | null;
  lastSyncFailedAtMs?: number | null;
  lastSyncPhase?: string | null;
  lastSyncFromBlock?: number | null;
  lastSyncToBlock?: number | null;
  lastSyncEventKind?: string | null;
  lastSyncTxHash?: string | null;
  lastSyncLogIndex?: number | null;
  lastSyncError?: string | null;
  historyRepair?: RepairJobStatusDto | null;
};

export type SyncStatusResult = {
  latestIndexedBlock: number;
  tokenBalanceIndexedBlock?: number;
  headBlock: number | null;
  blocksBehind?: number | null;
  caughtUp: boolean | null;
  syncing: boolean;
  maxKittyId?: number;
  dbLiveKitties?: number;
  onchainKittiesEverMinted?: number | null;
  onchainKittiesLive?: number | null;
  kittyIndexedBehind?: number | null;
  lastSyncSuccessAtMs?: number | null;
  lastSyncFailedAtMs?: number | null;
  lastSyncPhase?: string | null;
  lastSyncFromBlock?: number | null;
  lastSyncToBlock?: number | null;
  lastSyncEventKind?: string | null;
  lastSyncTxHash?: string | null;
  lastSyncLogIndex?: number | null;
  lastSyncError?: string | null;
  historyRepair?: RepairJobStatusDto | null;
};

type ServerOptions = {
  runSync?: (input: SyncRunInput) => Promise<SyncRunResult>;
  syncSecret?: string | undefined;
  getStatus?: () => Promise<SyncStatusResult>;
  repairStats?: (
    indexed: Awaited<ReturnType<KPEGRepository["getStats"]>>
  ) => Promise<Awaited<ReturnType<KPEGRepository["getStats"]>>>;
  repairOwnerStats?: (
    owner: string,
    indexed: { currentKitties: number; everKitties: number }
  ) => Promise<{ currentKitties: number; everKitties: number }>;
  repairOwnerKitties?: (
    owner: string,
    input: {
      page: number;
      pageSize: number;
      offset?: number;
      sort: "latest" | "scarcity";
    },
    indexed: Awaited<ReturnType<KPEGRepository["listByOwner"]>>
  ) => Promise<Awaited<ReturnType<KPEGRepository["listByOwner"]>>>;
  repairGlobalKitties?: (
    input: {
      page: number;
      pageSize: number;
      offset?: number;
      sort: "latest" | "scarcity";
    },
    indexed: Awaited<ReturnType<KPEGRepository["listGlobal"]>>
  ) => Promise<Awaited<ReturnType<KPEGRepository["listGlobal"]>>>;
  repairMarketListings?: (
    input: {
      page: number;
      pageSize: number;
      offset?: number;
      sort: "latest" | "scarcity";
      tab: "all" | "my-listings" | "bought" | "sold";
      owner?: string;
      search?: string;
    },
    indexed: Awaited<ReturnType<KPEGRepository["listMarketListings"]>>
  ) => Promise<Awaited<ReturnType<KPEGRepository["listMarketListings"]>>>;
  repairMarketStats?: (
    indexed: Awaited<ReturnType<KPEGRepository["getMarketStats"]>>
  ) => Promise<Awaited<ReturnType<KPEGRepository["getMarketStats"]>>>;
  repairKittyById?: (
    id: number,
    indexed: Awaited<ReturnType<KPEGRepository["getKittyById"]>>
  ) => Promise<Awaited<ReturnType<KPEGRepository["getKittyById"]>>>;
};

function cacheControlForRoute(input: { method: string; routePath: string }): string | null {
  if (input.method !== "GET") {
    return null;
  }
  if (input.routePath === "/api/sync") {
    return "no-store";
  }
  if (input.routePath === "/api/config") {
    return "public, max-age=60, s-maxage=600, stale-while-revalidate=1800";
  }
  if (input.routePath === "/api/health") {
    return "public, max-age=10, s-maxage=60, stale-while-revalidate=120";
  }
  if (input.routePath === "/api/status") {
    return "public, max-age=0, s-maxage=10, stale-while-revalidate=30";
  }
  if (input.routePath === "/api/stats" || input.routePath === "/api/market/stats") {
    return "public, max-age=0, s-maxage=30, stale-while-revalidate=120";
  }
  if (input.routePath.startsWith("/api/kitties")) {
    return "public, max-age=0, s-maxage=30, stale-while-revalidate=120";
  }
  if (input.routePath.startsWith("/api/market/listings")) {
    return "public, max-age=0, s-maxage=15, stale-while-revalidate=120";
  }
  if (input.routePath.startsWith("/api/market")) {
    return "public, max-age=0, s-maxage=30, stale-while-revalidate=120";
  }
  if (input.routePath === "/api/activity/recent") {
    return "public, max-age=0, s-maxage=10, stale-while-revalidate=30";
  }
  if (input.routePath.startsWith("/api/art/")) {
    return "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400";
  }
  return null;
}

function hasBearerSecret(header: string | undefined, secret: string): boolean {
  const prefix = "Bearer ";
  return Boolean(header?.startsWith(prefix) && header.slice(prefix.length) === secret);
}

function requestHasSyncSecret(
  headers: { authorization?: string | undefined },
  query: { secret?: string } | undefined,
  secret: string | undefined
): boolean {
  if (!secret) {
    return false;
  }
  return hasBearerSecret(headers.authorization, secret) || query?.secret === secret;
}

function maybeTxHash(input: unknown): `0x${string}` | undefined {
  if (typeof input !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input)) {
    return undefined;
  }
  return input as `0x${string}`;
}

export function buildServer(
  repo: KPEGRepository,
  runtimeConfig: RuntimeConfig = { chainId: null, tokenAddress: null, marketAddress: null, routerAddress: null, quoterAddress: null },
  options: ServerOptions = {},
) {
  const app = Fastify({ logger: false });
  const corsOrigin = runtimeConfig.corsOrigin ?? "*";

  app.addHook("onRequest", async (request, reply) => {
    reply.header("access-control-allow-origin", corsOrigin);
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    reply.header("access-control-allow-headers", "content-type,authorization");
    if (request.method === "OPTIONS") {
      return reply.status(204).send();
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const routePath = request.routeOptions.url;
    if (typeof routePath !== "string") {
      return payload;
    }
    const cacheControl = cacheControlForRoute({
      method: request.method,
      routePath
    });
    if (cacheControl) {
      reply.header("cache-control", cacheControl);
      reply.header("CDN-Cache-Control", cacheControl);
      reply.header("Vercel-CDN-Cache-Control", cacheControl);
    }
    return payload;
  });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/config", async () => ({
    ...(await repo.getConfig()),
    chainId: runtimeConfig.chainId ?? null,
    tokenAddress: runtimeConfig.tokenAddress ?? null,
    marketAddress: runtimeConfig.marketAddress ?? null,
    routerAddress: runtimeConfig.routerAddress ?? null,
    quoterAddress: runtimeConfig.quoterAddress ?? null
  }));
  app.get("/api/stats", async () => {
    const indexed = await repo.getStats();
    return options.repairStats ? options.repairStats(indexed) : indexed;
  });
  app.get("/api/status", async () => {
    if (options.getStatus) {
      return options.getStatus();
    }
    const latestIndexedBlock = await repo.getLatestIndexedBlock();
    return { latestIndexedBlock, headBlock: null, caughtUp: null, syncing: false };
  });
  if (options.runSync) {
    const runSync = options.runSync;
    app.route({
      method: ["GET", "POST"],
      url: "/api/sync",
      handler: async (request, reply) => {
        const query = request.query as { secret?: string } | undefined;
        const body = request.body as { txHash?: unknown } | undefined;
        const authorizedBySecret = requestHasSyncSecret(
          { authorization: request.headers.authorization },
          query,
          options.syncSecret
        );
        const txHash = maybeTxHash(body?.txHash);
        if (request.method !== "POST" && !authorizedBySecret) {
          return reply.status(401).send({ ok: false, error: "sync secret required" });
        }
        try {
          return await runSync({ authorizedBySecret, ...(txHash ? { txHash } : {}) });
        } catch (error) {
          request.log.error(
            {
              route: "/api/sync",
              method: request.method,
              txHash,
              error
            },
            "indexer sync failed"
          );
          const statusCode =
            typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            typeof error.statusCode === "number"
              ? error.statusCode
              : 500;
          return reply.status(statusCode).send({
            ok: false,
            error: error instanceof Error ? error.message : "sync failed"
          });
        }
      }
    });
  }
  app.get("/api/activity/recent", async (request) => {
    const limit = z.coerce.number().int().min(1).max(100).default(20).parse((request.query as { limit?: string }).limit);
    return { items: await repo.recentActivity(limit) };
  });

  app.get("/api/kitties/global", async (request) => {
    const query = querySchema.parse(request.query);
    const indexed = await repo.listGlobal(query.page, query.pageSize, query.sort, query.offset);
    return options.repairGlobalKitties
      ? options.repairGlobalKitties(
          {
            page: query.page,
            pageSize: query.pageSize,
            ...(query.offset !== undefined ? { offset: query.offset } : {}),
            sort: query.sort
          },
          indexed
        )
      : indexed;
  });

  app.get("/api/kitties/owner/:address", async (request) => {
    const query = querySchema.parse(request.query);
    const params = request.params as { address: string };
    const indexed = await repo.listByOwner(params.address, query.page, query.pageSize, query.sort, query.offset);
    return options.repairOwnerKitties
      ? options.repairOwnerKitties(
          params.address,
          {
            page: query.page,
            pageSize: query.pageSize,
            ...(query.offset !== undefined ? { offset: query.offset } : {}),
            sort: query.sort
          },
          indexed
        )
      : indexed;
  });

  app.get("/api/kitties/owner/:address/stats", async (request) => {
    const params = request.params as { address: string };
    const indexed = await repo.ownerStats(params.address);
    return options.repairOwnerStats ? options.repairOwnerStats(params.address, indexed) : indexed;
  });

  app.get("/api/kitties/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const id = Number(params.id);
    if (!Number.isFinite(id) || id < 1) {
      return reply.status(400).send({ error: "invalid id" });
    }
    const indexed = await repo.getKittyById(id);
    const kitty = options.repairKittyById
      ? await options.repairKittyById(id, indexed)
      : indexed;
    if (!kitty) {
      return reply.status(404).send({ error: "kitty not found" });
    }
    return kitty;
  });

  app.get("/api/kitties/search", async (request) => {
    const query = searchSchema.parse(request.query);
    const ownerScopedNumericSearch =
      query.scope === "my-collections" &&
      Boolean(query.owner) &&
      /^#?\d+$/.test(query.q.trim());
    if (ownerScopedNumericSearch && query.owner) {
      const targetId = Number(query.q.trim().replace(/^#/, ""));
      const pageSize = 100;
      let offset = 0;
      while (true) {
        const page = Math.floor(offset / pageSize);
        const indexed = await repo.listByOwner(
          query.owner,
          page,
          pageSize,
          "latest",
          offset
        );
        const repaired = options.repairOwnerKitties
          ? await options.repairOwnerKitties(
              query.owner,
              { page, pageSize, offset, sort: "latest" },
              indexed
            )
          : indexed;
        const found = repaired.items.find((item) => item.id === targetId);
        if (found) {
          return { type: "kitty", items: [found], total: 1 };
        }
        offset += repaired.items.length;
        if (repaired.items.length === 0 || offset >= repaired.total) {
          break;
        }
      }
      return { type: "kitty", items: [], total: 0 };
    }
    return repo.search(query);
  });

  app.get("/api/market/stats", async () => {
    const indexed = await repo.getMarketStats();
    return options.repairMarketStats ? options.repairMarketStats(indexed) : indexed;
  });
  app.get("/api/market/listings", async (request) => {
    const query = querySchema.extend({
      tab: z.enum(["all", "my-listings", "bought", "sold"]).default("all"),
      owner: z.string().optional(),
      q: z.string().default("")
    }).parse(request.query);
    const input = {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
      sort: query.sort,
      tab: query.tab,
      ...(query.owner ? { owner: query.owner } : {}),
      ...(query.q.trim() ? { search: query.q } : {})
    };
    const indexed = await repo.listMarketListings(input);
    return options.repairMarketListings ? options.repairMarketListings(input, indexed) : indexed;
  });
  app.get("/api/market/listings/:tradeId", async (request, reply) => {
    const tradeId = Number((request.params as { tradeId: string }).tradeId);
    if (!Number.isFinite(tradeId) || tradeId < 1) {
      return reply.status(400).send({ error: "invalid trade id" });
    }
    const listing = await repo.getMarketListing(tradeId);
    if (!listing) {
      return reply.status(404).send({ error: "listing not found" });
    }
    return listing;
  });
  app.get("/api/market/owner/:address", async (request) => {
    const params = request.params as { address: string };
    return repo.listMarketOwner(params.address);
  });
  app.get("/api/market/fee", async () => {
    const config = await repo.getMarketStats();
    return { feeBps: 200, listed: config.listed };
  });
  app.get("/api/market/purchased/:address", async (request) => {
    const params = request.params as { address: string };
    return repo.listMarketListings({ page: 0, pageSize: 100, sort: "latest", tab: "bought", owner: params.address });
  });
  app.get("/api/market/sales", async (request) => {
    const query = querySchema.parse(request.query);
    return repo.listMarketSales(query.page, query.pageSize);
  });

  app.get("/api/art/:seed", async (request, reply) => {
    const seed = (request.params as { seed: string }).seed;
    const query = z.object({ tier: z.coerce.number().int().min(0).max(4), id: z.coerce.number().int().min(1).optional() }).safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "tier query is required" });
    }
    const generated = generateKPEGFromSeed({
      seed,
      tier: query.data.tier as 0 | 1 | 2 | 3 | 4
    });
    return {
      seed,
      tier: generated.tier,
      svg:
        query.data.id === undefined
          ? renderGeneratedKPEGSvg({ traits: generated.traits })
          : renderGeneratedKPEGSvg({ traits: generated.traits, id: query.data.id })
    };
  });

  return app;
}
