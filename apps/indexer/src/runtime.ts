import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  readOnchainKittyCounts,
  runSingleChainSync,
  transactionTouchesIndexedContracts,
  type ChainSyncConfig,
  type IndexedTransactionCheck
} from "./chain.js";
import { openDb } from "./db.js";
import {
  clearOnchainFallbackCaches,
  kittyByIdWithOnchainFallback,
  listGlobalKittiesWithOnchainFallback,
  listOwnerKittiesWithOnchainFallback,
  listMarketListingsWithOnchainFallback,
  globalStatsWithOnchainFallback,
  ownerStatsWithOnchainFallback
} from "./onchain-fallback.js";
import {
  HISTORY_AGGREGATE_REPAIR_JOB_NAME,
  HISTORY_AGGREGATE_REPAIR_VERSION,
  runHistoryAggregateRepairChunk
} from "./history-aggregate-repair.js";
import { KPEGRepository } from "./repository.js";
import type { SyncRunInput, SyncRunResult, SyncStatusResult } from "./server.js";

type DeploymentHint = {
  token?: string;
  market?: string;
  breeding?: string;
  breedingEngine?: string;
  deployedAt?: string;
  tokenDeploymentBlock?: number;
};

type RuntimeContext = {
  repo: KPEGRepository;
  syncConfig: ChainSyncConfig | null;
  forceOnchainPageRepair: boolean;
  runtimeConfig: {
    chainId: number | null;
    tokenAddress: string | null;
    marketAddress: string | null;
    breedingAddress: string | null;
    routerAddress: string | null;
    quoterAddress: string | null;
    corsOrigin?: string;
  };
  syncSecret?: string | undefined;
  syncLockTtlMs: number;
  syncMaxRuntimeMs: number;
  historyRepairMaxBlocksPerRun: number;
  historyRepairMaxRuntimeMs: number;
};

type RuntimeIdentityInput = {
  chainId: number;
  tokenAddress: `0x${string}`;
  marketAddress: `0x${string}` | null;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = resolve(repoRoot, ".env");
let contextPromise: Promise<RuntimeContext> | null = null;
const syncStatus: SyncStatusResult = {
  latestIndexedBlock: 0,
  tokenBalanceIndexedBlock: 0,
  headBlock: null,
  blocksBehind: null,
  caughtUp: null,
  syncing: false,
  maxKittyId: 0,
  dbLiveKitties: 0,
  onchainKittiesEverMinted: null,
  onchainKittiesLive: null,
  kittyIndexedBehind: null,
  lastSyncSuccessAtMs: null,
  lastSyncFailedAtMs: null,
  lastSyncPhase: null,
  lastSyncFromBlock: null,
  lastSyncToBlock: null,
  lastSyncEventKind: null,
  lastSyncTxHash: null,
  lastSyncLogIndex: null,
  lastSyncError: null,
  historyRepair: null
};
const ONCHAIN_KITTY_COUNTS_CACHE_TTL_MS = 12_000;
let onchainKittyCountsCache:
  | {
      key: string;
      expiresAt: number;
      value: {
        blockNumber: number;
        kittiesLive: number;
        kittiesEverMinted: number;
      };
    }
  | null = null;
let onchainKittyCountsRefreshPromise: Promise<{
  blockNumber: number;
  kittiesLive: number;
  kittiesEverMinted: number;
}> | null = null;

const REQUIRED_RUNTIME_KEYS = [
  "KPEG_CHAIN_RPC_URL",
  "KPEG_CHAIN_ID",
  "KPEG_TOKEN_ADDRESS",
  "KPEG_MARKET_ADDRESS",
  "KPEG_ROUTER_ADDRESS",
  "KPEG_QUOTER_ADDRESS"
] as const;

const RUNTIME_ADDRESS_KEYS = [
  "KPEG_TOKEN_ADDRESS",
  "KPEG_MARKET_ADDRESS",
  "KPEG_BREEDING_ADDRESS",
  "KPEG_ROUTER_ADDRESS",
  "KPEG_QUOTER_ADDRESS"
] as const;

type RuntimeEnvValidation = {
  missing: string[];
  invalid: string[];
};

function hasHttpRpcPrefix(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

export function parseRpcFallbackUrls(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ];
}

function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function validateRuntimeSyncEnv(env: NodeJS.ProcessEnv = process.env): RuntimeEnvValidation {
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const key of REQUIRED_RUNTIME_KEYS) {
    if (!env[key]?.trim()) {
      missing.push(key);
    }
  }

  const chainIdRaw = env.KPEG_CHAIN_ID?.trim();
  if (chainIdRaw) {
    const chainId = Number(chainIdRaw);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      invalid.push("KPEG_CHAIN_ID");
    }
  }

  const rpcRaw = env.KPEG_CHAIN_RPC_URL?.trim();
  if (rpcRaw && !hasHttpRpcPrefix(rpcRaw)) {
    invalid.push("KPEG_CHAIN_RPC_URL");
  }
  if (parseRpcFallbackUrls(env.KPEG_CHAIN_RPC_FALLBACK_URLS).some((url) => !hasHttpRpcPrefix(url))) {
    invalid.push("KPEG_CHAIN_RPC_FALLBACK_URLS");
  }

  for (const key of RUNTIME_ADDRESS_KEYS) {
    const value = env[key]?.trim();
    if (value && !isHexAddress(value)) {
      invalid.push(key);
    }
  }

  return { missing, invalid };
}

function runtimeSyncEnvErrorMessage(input: {
  envPath: string;
  missing: string[];
  invalid: string[];
}): string {
  const detailLines: string[] = [
    "Missing trade/indexer runtime config.",
    `Checked env file: ${input.envPath}`
  ];
  if (input.missing.length > 0) {
    detailLines.push(`Missing keys: ${input.missing.join(", ")}`);
  }
  if (input.invalid.length > 0) {
    detailLines.push(`Invalid values: ${input.invalid.join(", ")}`);
  }
  detailLines.push("Run: node scripts/write-app-env.mjs base-sepolia local-sqlite");
  detailLines.push("Then restart: pnpm dev");
  return detailLines.join("\n");
}

export function reportedSyncStatus(
  status: SyncStatusResult,
  _syncConfigured: boolean
): SyncStatusResult {
  return status;
}

function boolEnv(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return value === "1" || value === "true" || value === "yes";
}

function pageOffset(input: { page: number; pageSize: number; offset?: number }): number {
  return input.offset ?? input.page * input.pageSize;
}

function syncConfigCacheKey(config: ChainSyncConfig): string {
  return [
    config.chainId,
    config.tokenAddress.toLowerCase(),
    config.marketAddress?.toLowerCase() ?? "",
    config.rpcUrl,
    ...(config.rpcFallbackUrls ?? [])
  ].join(":");
}

function statusCaughtUp(input: {
  latestIndexedBlock: number;
  tokenBalanceIndexedBlock: number;
  headBlock: number | null;
}): boolean | null {
  if (input.headBlock === null) {
    return null;
  }
  return (
    input.latestIndexedBlock >= input.headBlock &&
    input.tokenBalanceIndexedBlock >= input.headBlock
  );
}

function statusBlocksBehind(input: {
  latestIndexedBlock: number;
  tokenBalanceIndexedBlock: number;
  headBlock: number | null;
}): number | null {
  if (input.headBlock === null) {
    return null;
  }
  return Math.max(
    0,
    input.headBlock - input.latestIndexedBlock,
    input.headBlock - input.tokenBalanceIndexedBlock
  );
}

async function readHistoryRepairStatus(repo: KPEGRepository) {
  return repo.getRepairJob(HISTORY_AGGREGATE_REPAIR_JOB_NAME);
}

function shouldRunHistoryRepair(
  status: Awaited<ReturnType<typeof readHistoryRepairStatus>>
): boolean {
  return (
    !status ||
    status.version !== HISTORY_AGGREGATE_REPAIR_VERSION ||
    status.status !== "done"
  );
}

async function refreshOnchainKittyCounts(
  context: RuntimeContext,
  blockNumber?: number | null
): Promise<{ blockNumber: number; kittiesLive: number; kittiesEverMinted: number }> {
  const key = syncConfigCacheKey(context.syncConfig!);
  const cacheKey = blockNumber && blockNumber > 0 ? `${key}:${blockNumber}` : key;
  const now = Date.now();
  if (
    onchainKittyCountsCache &&
    onchainKittyCountsCache.key === cacheKey &&
    onchainKittyCountsCache.expiresAt > now
  ) {
    return onchainKittyCountsCache.value;
  }
  const value =
    typeof blockNumber === "number" && blockNumber > 0
      ? await readOnchainKittyCounts(context.syncConfig!, BigInt(blockNumber))
      : await (onchainKittyCountsRefreshPromise ??
          (onchainKittyCountsRefreshPromise = readOnchainKittyCounts(context.syncConfig!).finally(() => {
            onchainKittyCountsRefreshPromise = null;
          })));
  onchainKittyCountsCache = {
    key: cacheKey,
    value,
    expiresAt: Date.now() + ONCHAIN_KITTY_COUNTS_CACHE_TTL_MS
  };
  return value;
}

function shouldForceOnchainRepair(input: {
  enabled: boolean;
  indexedTotal: number;
  page: { page: number; pageSize: number; offset?: number };
}): boolean {
  return input.enabled && pageOffset(input.page) === 0 && input.indexedTotal === 0;
}

export function shouldApplyPageCatchUpRepair(input: {
  status: SyncStatusResult;
  syncConfigured: boolean;
  indexedItemCount: number;
  indexedTotal: number;
  page: { page: number; pageSize: number; offset?: number };
}): boolean {
  if (!shouldApplyCatchUpRepair(input.status, input.syncConfigured)) {
    return false;
  }
  if (pageOffset(input.page) !== 0) {
    return false;
  }
  if (typeof input.status.kittyIndexedBehind === "number" && input.status.kittyIndexedBehind > 0) {
    return true;
  }
  return input.indexedTotal === 0 || input.indexedItemCount === 0;
}

export function shouldApplyCatchUpRepair(status: SyncStatusResult, syncConfigured: boolean): boolean {
  if (!syncConfigured) {
    return false;
  }
  if (typeof status.kittyIndexedBehind === "number" && status.kittyIndexedBehind > 0) {
    return true;
  }
  const failedAt = status.lastSyncFailedAtMs ?? 0;
  const succeededAt = status.lastSyncSuccessAtMs ?? 0;
  if (failedAt > succeededAt) {
    return true;
  }
  return status.headBlock === null;
}

function deploymentFileNameFor(chainId: number): string | null {
  if (chainId === 31337) return "localhost";
  if (chainId === 84532) return "baseSepolia";
  if (chainId === 8453) return "baseMainnet";
  return null;
}

function loadDeploymentHint(chainId: number, tokenAddress: string | undefined): DeploymentHint | null {
  const tokenDeploymentBlock = numberEnv("KPEG_TOKEN_DEPLOYMENT_BLOCK", 0);
  const envHint: DeploymentHint = {
    ...(tokenAddress ? { token: tokenAddress } : {}),
    ...(process.env.KPEG_MARKET_ADDRESS ? { market: process.env.KPEG_MARKET_ADDRESS } : {}),
    ...(process.env.KPEG_BREEDING_ADDRESS ? { breeding: process.env.KPEG_BREEDING_ADDRESS } : {}),
    ...(process.env.KPEG_DEPLOYED_AT ? { deployedAt: process.env.KPEG_DEPLOYED_AT } : {}),
    ...(tokenDeploymentBlock > 0 ? { tokenDeploymentBlock } : {})
  };
  if (envHint.deployedAt || envHint.tokenDeploymentBlock) {
    return envHint;
  }

  const fileName = deploymentFileNameFor(chainId);
  if (!fileName || !tokenAddress) {
    return null;
  }

  const deploymentPath = resolve(repoRoot, "deployments", `${fileName}.json`);
  if (!existsSync(deploymentPath)) {
    return null;
  }

  const raw = JSON.parse(readFileSync(deploymentPath, "utf8")) as DeploymentHint;
  const breeding = raw.breeding ?? raw.breedingEngine;
  if (raw.token?.toLowerCase() !== tokenAddress.toLowerCase()) {
    return null;
  }
  return {
    ...raw,
    ...(breeding ? { breeding } : {})
  };
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function shouldApplySchemaOnBoot(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const productionMode = env.NODE_ENV === "production";
  if (!productionMode) {
    return true;
  }
  const value = env.KPEG_DB_APPLY_SCHEMA_ON_BOOT?.trim().toLowerCase();
  if (!value) {
    return false;
  }
  return value === "1" || value === "true" || value === "yes";
}

export async function ensureRuntimeChainIdentity(input: {
  repo: KPEGRepository;
  expected: RuntimeIdentityInput;
  applySchemaOnBoot: boolean;
}): Promise<void> {
  if (input.applySchemaOnBoot) {
    await input.repo.ensureChainIdentity(input.expected);
    return;
  }

  const current = await input.repo.getChainIdentity();
  const expectedMarketAddress = input.expected.marketAddress?.toLowerCase() ?? null;
  if (!current) {
    throw new Error(
      "Indexer database is not initialized for this deployment. Run `pnpm --filter @kpeg/indexer init-db` with the production env before redeploying."
    );
  }
  if (
    current.chainId !== input.expected.chainId ||
    current.tokenAddress !== input.expected.tokenAddress.toLowerCase() ||
    (current.marketAddress ?? null) !== expectedMarketAddress
  ) {
    throw new Error(
      [
        "Indexer database identity does not match runtime config.",
        `Expected chain=${input.expected.chainId} token=${input.expected.tokenAddress.toLowerCase()} market=${expectedMarketAddress ?? ""}.`,
        `Found chain=${current.chainId} token=${current.tokenAddress} market=${current.marketAddress ?? ""}.`,
        "Run `pnpm --filter @kpeg/indexer init-db` only if this deployment should reset/reinitialize that database."
      ].join(" ")
    );
  }
}

async function buildRuntimeContext(): Promise<RuntimeContext> {
  loadEnv({ path: envPath });
  const runtimeEnv = validateRuntimeSyncEnv(process.env);
  if (runtimeEnv.missing.length > 0 || runtimeEnv.invalid.length > 0) {
    throw new Error(
      runtimeSyncEnvErrorMessage({
        envPath,
        missing: runtimeEnv.missing,
        invalid: runtimeEnv.invalid
      })
    );
  }

  const productionMode = process.env.NODE_ENV === "production";
  const dbMode = (process.env.KPEG_DB_MODE ?? (productionMode ? "libsql" : "sqlite")) as "sqlite" | "libsql";
  const sqlitePath = process.env.KPEG_DB_PATH ?? "./data/kpeg.sqlite";
  const libsqlUrl = process.env.KPEG_LIBSQL_URL;
  const libsqlAuthToken = process.env.KPEG_LIBSQL_AUTH_TOKEN;

  if (dbMode === "sqlite" && sqlitePath !== ":memory:") {
    await mkdir(dirname(resolve(repoRoot, sqlitePath)), { recursive: true });
  }
  if (productionMode && dbMode === "sqlite") {
    throw new Error("Use KPEG_DB_MODE=libsql in production to avoid ephemeral local database loss");
  }
  const applySchemaOnBoot = shouldApplySchemaOnBoot(process.env);

  const chainId = numberEnv("KPEG_CHAIN_ID", 84532);
  const tokenAddress = process.env.KPEG_TOKEN_ADDRESS as `0x${string}` | undefined;
  const configuredMarketAddress = process.env.KPEG_MARKET_ADDRESS as `0x${string}` | undefined;
  const configuredBreedingAddress = process.env.KPEG_BREEDING_ADDRESS as `0x${string}` | undefined;
  const deploymentHint = loadDeploymentHint(chainId, tokenAddress);
  const marketAddress = configuredMarketAddress ?? (deploymentHint?.market as `0x${string}` | undefined);
  const breedingAddress = configuredBreedingAddress ?? (deploymentHint?.breeding as `0x${string}` | undefined);
  const routerAddress = process.env.KPEG_ROUTER_ADDRESS ?? null;
  const quoterAddress = process.env.KPEG_QUOTER_ADDRESS ?? null;
  const rpcUrl = process.env.KPEG_CHAIN_RPC_URL;
  const rpcFallbackUrls = parseRpcFallbackUrls(process.env.KPEG_CHAIN_RPC_FALLBACK_URLS);
  const startBlock = numberEnv("KPEG_CHAIN_START_BLOCK", 0);

  const db = await openDb({
    mode: dbMode,
    sqlitePath,
    sqliteBasePath: repoRoot,
    libsqlUrl,
    libsqlAuthToken,
    applySchema: applySchemaOnBoot
  });
  const repo = new KPEGRepository(db);

  if (tokenAddress) {
    await ensureRuntimeChainIdentity({
      repo,
      expected: {
        chainId,
        tokenAddress,
        marketAddress: marketAddress ?? null
      },
      applySchemaOnBoot
    });
  }

  const syncConfig =
    rpcUrl && tokenAddress
      ? {
          rpcUrl,
          ...(rpcFallbackUrls.length > 0 ? { rpcFallbackUrls } : {}),
          tokenAddress,
          ...(marketAddress ? { marketAddress } : {}),
          ...(breedingAddress ? { breedingAddress } : {}),
          chainId,
          ...(startBlock > 0 ? { startBlock } : {}),
          ...(startBlock <= 0 && deploymentHint?.tokenDeploymentBlock ? { startBlock: deploymentHint.tokenDeploymentBlock } : {}),
          ...(deploymentHint?.deployedAt ? { deployedAtHint: deploymentHint.deployedAt } : {}),
          maxBlocksPerRun: numberEnv("KPEG_SYNC_MAX_BLOCKS", 5_000)
        }
      : null;

  return {
    repo,
    syncConfig,
    forceOnchainPageRepair: boolEnv("KPEG_ONCHAIN_FORCE_PAGE_REPAIR", false),
    runtimeConfig: {
      chainId,
      tokenAddress: tokenAddress ?? null,
      marketAddress: marketAddress ?? null,
      breedingAddress: breedingAddress ?? null,
      routerAddress,
      quoterAddress,
      corsOrigin: process.env.KPEG_CORS_ORIGIN ?? "*"
    },
    syncSecret: process.env.KPEG_SYNC_SECRET,
    syncLockTtlMs: numberEnv("KPEG_SYNC_LOCK_TTL_MS", 55_000),
    syncMaxRuntimeMs: numberEnv("KPEG_SYNC_MAX_RUNTIME_MS", productionMode ? 45_000 : 110_000),
    historyRepairMaxBlocksPerRun: numberEnv("KPEG_HISTORY_REPAIR_MAX_BLOCKS", 5_000),
    historyRepairMaxRuntimeMs: numberEnv("KPEG_HISTORY_REPAIR_MAX_RUNTIME_MS", 12_000)
  };
}

export function getRuntimeContext(): Promise<RuntimeContext> {
  contextPromise ??= buildRuntimeContext().catch((error) => {
    contextPromise = null;
    throw error;
  });
  return contextPromise;
}

export class SyncRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

type CatchUpInput = {
  maxRuntimeMs: number;
  syncOnce: () => Promise<{
    latestIndexedBlock: number;
    headBlock: number;
    tokenBalanceIndexedBlock?: number;
    fromBlock?: number;
    toBlock?: number;
    tokenBalanceFromBlock?: number;
    tokenBalanceToBlock?: number;
    targetReached?: boolean;
  }>;
  nowMs?: () => number;
};

export async function runSyncUntilCaughtUp(input: CatchUpInput): Promise<{
  latestIndexedBlock: number;
  headBlock: number;
  tokenBalanceIndexedBlock: number;
  caughtUp: boolean;
}> {
  const nowMs = input.nowMs ?? Date.now;
  const deadline = nowMs() + input.maxRuntimeMs;
  let latestIndexedBlock = 0;
  let headBlock = 0;
  let tokenBalanceIndexedBlock = 0;
  let caughtUp = false;

  do {
    const result = await input.syncOnce();
    latestIndexedBlock = result.latestIndexedBlock;
    headBlock = result.headBlock;
    tokenBalanceIndexedBlock = result.tokenBalanceIndexedBlock ?? latestIndexedBlock;
    caughtUp = latestIndexedBlock >= headBlock && tokenBalanceIndexedBlock >= headBlock;
    if (
      (result.toBlock === undefined && result.tokenBalanceToBlock === undefined) ||
      caughtUp ||
      result.targetReached
    ) {
      break;
    }
  } while (nowMs() < deadline);

  return { latestIndexedBlock, headBlock, tokenBalanceIndexedBlock, caughtUp };
}

export async function getRuntimeSyncStatus(): Promise<SyncStatusResult> {
  const context = await getRuntimeContext();
  const [latestIndexedBlock, tokenBalanceIndexedBlock, maxKittyId, dbLiveKitties, failureStatus, snapshot, historyRepair] =
    await Promise.all([
    context.repo.getLatestIndexedBlock(),
    context.repo.getLatestTokenBalanceIndexedBlock(),
    context.repo.getMaxKittyId(),
    context.repo.getLiveKittyCount(),
    context.repo.getSyncFailureStatus(),
    context.repo.getSyncSnapshot(),
    readHistoryRepairStatus(context.repo)
  ]);
  syncStatus.latestIndexedBlock = latestIndexedBlock;
  syncStatus.tokenBalanceIndexedBlock = tokenBalanceIndexedBlock;
  syncStatus.maxKittyId = maxKittyId;
  syncStatus.dbLiveKitties = dbLiveKitties;
  syncStatus.lastSyncSuccessAtMs = failureStatus.lastSyncSuccessAtMs;
  syncStatus.lastSyncFailedAtMs = failureStatus.lastSyncFailedAtMs;
  syncStatus.lastSyncPhase = failureStatus.lastSyncPhase;
  syncStatus.lastSyncFromBlock = failureStatus.lastSyncFromBlock;
  syncStatus.lastSyncToBlock = failureStatus.lastSyncToBlock;
  syncStatus.lastSyncEventKind = failureStatus.lastSyncEventKind;
  syncStatus.lastSyncTxHash = failureStatus.lastSyncTxHash;
  syncStatus.lastSyncLogIndex = failureStatus.lastSyncLogIndex;
  syncStatus.lastSyncError = failureStatus.lastSyncError;
  syncStatus.historyRepair = historyRepair;
  if (context.syncConfig) {
    syncStatus.headBlock = snapshot.headBlock;
    syncStatus.onchainKittiesEverMinted = snapshot.onchainKittiesEverMinted;
    syncStatus.onchainKittiesLive = snapshot.onchainKittiesLive;
    syncStatus.kittyIndexedBehind =
      typeof snapshot.onchainKittiesEverMinted === "number"
        ? Math.max(0, snapshot.onchainKittiesEverMinted - maxKittyId)
        : null;
  } else {
    syncStatus.headBlock = null;
    syncStatus.onchainKittiesEverMinted = null;
    syncStatus.onchainKittiesLive = null;
    syncStatus.kittyIndexedBehind = null;
  }
  syncStatus.caughtUp = statusCaughtUp({
    latestIndexedBlock,
    tokenBalanceIndexedBlock,
    headBlock: syncStatus.headBlock
  });
  syncStatus.blocksBehind = statusBlocksBehind({
    latestIndexedBlock,
    tokenBalanceIndexedBlock,
    headBlock: syncStatus.headBlock
  });
  return reportedSyncStatus({ ...syncStatus }, Boolean(context.syncConfig));
}

export async function repairRuntimeStats(
  indexed: Awaited<ReturnType<KPEGRepository["getStats"]>>
): Promise<Awaited<ReturnType<KPEGRepository["getStats"]>>> {
  const context = await getRuntimeContext();
  if (!context.syncConfig) {
    return indexed;
  }
  const status = await getRuntimeSyncStatus();
  if (!shouldApplyCatchUpRepair(status, Boolean(context.syncConfig))) {
    return indexed;
  }
  return globalStatsWithOnchainFallback({
    repo: context.repo,
    config: context.syncConfig,
    indexed
  }).catch(() => indexed);
}

export async function repairRuntimeOwnerStats(
  owner: string,
  indexed: { currentKitties: number; everKitties: number }
): Promise<{ currentKitties: number; everKitties: number }> {
  const context = await getRuntimeContext();
  if (!context.syncConfig) {
    return indexed;
  }
  const status = await getRuntimeSyncStatus();
  if (!shouldApplyCatchUpRepair(status, Boolean(context.syncConfig))) {
    return indexed;
  }
  return ownerStatsWithOnchainFallback({
    repo: context.repo,
    config: context.syncConfig,
    owner,
    indexed
  }).catch(() => indexed);
}

export async function repairRuntimeKittyById(
  id: number,
  indexed: Awaited<ReturnType<KPEGRepository["getKittyById"]>>
): Promise<Awaited<ReturnType<KPEGRepository["getKittyById"]>>> {
  const context = await getRuntimeContext();
  if (!context.syncConfig) {
    return indexed;
  }
  if (!indexed) {
    return kittyByIdWithOnchainFallback({
      repo: context.repo,
      config: context.syncConfig,
      id,
      indexed
    }).catch(() => indexed);
  }
  const status = await getRuntimeSyncStatus();
  if (!shouldApplyCatchUpRepair(status, Boolean(context.syncConfig))) {
    return indexed;
  }
  return kittyByIdWithOnchainFallback({
    repo: context.repo,
    config: context.syncConfig,
    id,
    indexed
  }).catch(() => indexed);
}

export async function repairRuntimeOwnerKitties(
  owner: string,
  input: {
    page: number;
    pageSize: number;
    offset?: number;
    sort: "latest" | "scarcity";
  },
  indexed: Awaited<ReturnType<KPEGRepository["listByOwner"]>>
): Promise<Awaited<ReturnType<KPEGRepository["listByOwner"]>>> {
  const context = await getRuntimeContext();
  if (!context.syncConfig) {
    return indexed;
  }
  const status = await getRuntimeSyncStatus();
  const forceRepair = shouldForceOnchainRepair({
    enabled: context.forceOnchainPageRepair,
    indexedTotal: indexed.total,
    page: input
  });
  const catchUpRepair = shouldApplyPageCatchUpRepair({
    status,
    syncConfigured: Boolean(context.syncConfig),
    indexedItemCount: indexed.items.length,
    indexedTotal: indexed.total,
    page: input
  });
  if (!forceRepair && !catchUpRepair) {
    return indexed;
  }
  return listOwnerKittiesWithOnchainFallback({
    repo: context.repo,
    config: context.syncConfig,
    owner,
    input,
    indexed,
    force: forceRepair || catchUpRepair
  }).catch(() => indexed);
}

export async function repairRuntimeGlobalKitties(
  input: {
    page: number;
    pageSize: number;
    offset?: number;
    sort: "latest" | "scarcity";
  },
  indexed: Awaited<ReturnType<KPEGRepository["listGlobal"]>>
): Promise<Awaited<ReturnType<KPEGRepository["listGlobal"]>>> {
  const context = await getRuntimeContext();
  if (!context.syncConfig) {
    return indexed;
  }
  const status = await getRuntimeSyncStatus();
  const forceRepair = shouldForceOnchainRepair({
    enabled: context.forceOnchainPageRepair,
    indexedTotal: indexed.total,
    page: input
  });
  const catchUpRepair = shouldApplyPageCatchUpRepair({
    status,
    syncConfigured: Boolean(context.syncConfig),
    indexedItemCount: indexed.items.length,
    indexedTotal: indexed.total,
    page: input
  });
  if (!forceRepair && !catchUpRepair) {
    return indexed;
  }
  return listGlobalKittiesWithOnchainFallback({
    repo: context.repo,
    config: context.syncConfig,
    input,
    indexed,
    force: forceRepair || catchUpRepair
  }).catch(() => indexed);
}

export async function repairRuntimeMarketListings(
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
): Promise<Awaited<ReturnType<KPEGRepository["listMarketListings"]>>> {
  const context = await getRuntimeContext();
  if (!context.syncConfig?.marketAddress) {
    return indexed;
  }
  const status = await getRuntimeSyncStatus();
  const forceRepair = shouldForceOnchainRepair({
    enabled: context.forceOnchainPageRepair,
    indexedTotal: indexed.total,
    page: input
  });
  const catchUpRepair = shouldApplyPageCatchUpRepair({
    status,
    syncConfigured: Boolean(context.syncConfig),
    indexedItemCount: indexed.items.length,
    indexedTotal: indexed.total,
    page: input
  });
  if (!forceRepair && !catchUpRepair) {
    return indexed;
  }
  const firstPageRepair = pageOffset(input) === 0;
  return listMarketListingsWithOnchainFallback({
    repo: context.repo,
    config: context.syncConfig,
    input,
    indexed,
    force: forceRepair || catchUpRepair
  }).catch((error) => {
    if (firstPageRepair) {
      throw error;
    }
    return indexed;
  });
}

export async function repairRuntimeMarketStats(
  indexed: Awaited<ReturnType<KPEGRepository["getMarketStats"]>>
): Promise<Awaited<ReturnType<KPEGRepository["getMarketStats"]>>> {
  return indexed;
}

export async function runServerlessSync(input: SyncRunInput): Promise<SyncRunResult> {
  const context = await getRuntimeContext();
  if (!context.syncConfig) {
    throw new SyncRequestError("chain sync is not configured", 503);
  }
  let txCheck: IndexedTransactionCheck | null = null;
  if (!input.authorizedBySecret) {
    if (!input.txHash) {
      throw new SyncRequestError("sync txHash or secret required", 401);
    }
    txCheck = await transactionTouchesIndexedContracts(context.syncConfig, input.txHash);
    if (!txCheck.trusted) {
      throw new SyncRequestError("sync transaction does not touch indexed contracts", 403);
    }
  }

  const owner = randomUUID();
  const acquired = await context.repo.tryAcquireSyncLock(owner, Date.now() + context.syncLockTtlMs);
  if (!acquired) {
    const [latestIndexedBlock, tokenBalanceIndexedBlock, maxKittyId, dbLiveKitties, historyRepair] = await Promise.all([
      context.repo.getLatestIndexedBlock(),
      context.repo.getLatestTokenBalanceIndexedBlock(),
      context.repo.getMaxKittyId(),
      context.repo.getLiveKittyCount(),
      readHistoryRepairStatus(context.repo)
    ]);
    return {
      ok: true,
      skipped: true,
      latestIndexedBlock,
      tokenBalanceIndexedBlock,
      maxKittyId,
      dbLiveKitties,
      ...(historyRepair ? { historyRepair } : {}),
      ...(syncStatus.onchainKittiesEverMinted === null
        ? {}
        : { onchainKittiesEverMinted: syncStatus.onchainKittiesEverMinted }),
      ...(syncStatus.onchainKittiesLive === null
        ? {}
        : { onchainKittiesLive: syncStatus.onchainKittiesLive }),
      ...(syncStatus.kittyIndexedBehind === null
        ? {}
        : { kittyIndexedBehind: syncStatus.kittyIndexedBehind }),
      ...(syncStatus.headBlock === null ? {} : { headBlock: syncStatus.headBlock }),
      ...(syncStatus.blocksBehind === null ? {} : { blocksBehind: syncStatus.blocksBehind }),
      ...(syncStatus.caughtUp === null ? {} : { caughtUp: syncStatus.caughtUp }),
      ...(syncStatus.lastSyncSuccessAtMs === null
        ? {}
        : { lastSyncSuccessAtMs: syncStatus.lastSyncSuccessAtMs }),
      ...(syncStatus.lastSyncFailedAtMs === null
        ? {}
        : { lastSyncFailedAtMs: syncStatus.lastSyncFailedAtMs }),
      ...(syncStatus.lastSyncPhase === null ? {} : { lastSyncPhase: syncStatus.lastSyncPhase }),
      ...(syncStatus.lastSyncFromBlock === null
        ? {}
        : { lastSyncFromBlock: syncStatus.lastSyncFromBlock }),
      ...(syncStatus.lastSyncToBlock === null
        ? {}
        : { lastSyncToBlock: syncStatus.lastSyncToBlock }),
      ...(syncStatus.lastSyncEventKind === null
        ? {}
        : { lastSyncEventKind: syncStatus.lastSyncEventKind }),
      ...(syncStatus.lastSyncTxHash === null ? {} : { lastSyncTxHash: syncStatus.lastSyncTxHash }),
      ...(syncStatus.lastSyncLogIndex === null
        ? {}
        : { lastSyncLogIndex: syncStatus.lastSyncLogIndex }),
      ...(syncStatus.lastSyncError === null ? {} : { lastSyncError: syncStatus.lastSyncError })
    };
  }

  try {
    syncStatus.syncing = true;
    const runStartedAtMs = Date.now();
    const syncConfig =
      txCheck?.blockNumber && txCheck.blockNumber > 0
        ? { ...context.syncConfig, targetBlock: txCheck.blockNumber }
        : context.syncConfig;
    const { latestIndexedBlock, headBlock, tokenBalanceIndexedBlock, caughtUp } = await runSyncUntilCaughtUp({
      maxRuntimeMs: context.syncMaxRuntimeMs,
      syncOnce: () =>
        runSingleChainSync(context.repo, syncConfig!, async (failure) => {
          await context.repo.recordSyncFailure({
            failedAtMs: Date.now(),
            phase: failure.phase,
            fromBlock: failure.fromBlock ?? null,
            toBlock: failure.toBlock ?? null,
            eventKind: failure.eventKind ?? null,
            txHash: failure.txHash ?? null,
            logIndex: failure.logIndex ?? null,
            error: failure.error
          });
        })
    });
    const completedAtMs = Date.now();
    await context.repo.markSyncSuccess(completedAtMs);
    const [maxKittyId, dbLiveKitties, failureStatus] = await Promise.all([
      context.repo.getMaxKittyId(),
      context.repo.getLiveKittyCount(),
      context.repo.getSyncFailureStatus()
    ]);
    syncStatus.latestIndexedBlock = latestIndexedBlock;
    syncStatus.tokenBalanceIndexedBlock = tokenBalanceIndexedBlock;
    syncStatus.headBlock = headBlock;
    syncStatus.caughtUp = caughtUp;
    syncStatus.maxKittyId = maxKittyId;
    syncStatus.dbLiveKitties = dbLiveKitties;
    syncStatus.blocksBehind = statusBlocksBehind({
      latestIndexedBlock,
      tokenBalanceIndexedBlock,
      headBlock
    });
    syncStatus.lastSyncSuccessAtMs = failureStatus.lastSyncSuccessAtMs;
    syncStatus.lastSyncFailedAtMs = failureStatus.lastSyncFailedAtMs;
    syncStatus.lastSyncPhase = failureStatus.lastSyncPhase;
    syncStatus.lastSyncFromBlock = failureStatus.lastSyncFromBlock;
    syncStatus.lastSyncToBlock = failureStatus.lastSyncToBlock;
    syncStatus.lastSyncEventKind = failureStatus.lastSyncEventKind;
    syncStatus.lastSyncTxHash = failureStatus.lastSyncTxHash;
    syncStatus.lastSyncLogIndex = failureStatus.lastSyncLogIndex;
    syncStatus.lastSyncError = failureStatus.lastSyncError;
    let historyRepair = await readHistoryRepairStatus(context.repo);
    try {
      const counts = await refreshOnchainKittyCounts(context, headBlock);
      syncStatus.onchainKittiesEverMinted = counts.kittiesEverMinted;
      syncStatus.onchainKittiesLive = counts.kittiesLive;
      syncStatus.kittyIndexedBehind = Math.max(0, counts.kittiesEverMinted - maxKittyId);
      await context.repo.setSyncSnapshot({
        headBlock,
        onchainKittiesEverMinted: counts.kittiesEverMinted,
        onchainKittiesLive: counts.kittiesLive,
        updatedAtMs: completedAtMs
      });
    } catch {
      syncStatus.onchainKittiesEverMinted = null;
      syncStatus.onchainKittiesLive = null;
      syncStatus.kittyIndexedBehind = null;
      await context.repo.setSyncSnapshot({
        headBlock,
        onchainKittiesEverMinted: null,
        onchainKittiesLive: null,
        updatedAtMs: completedAtMs
      });
    }
    if (input.authorizedBySecret && shouldRunHistoryRepair(historyRepair)) {
      const remainingRuntimeMs = Math.max(0, context.syncMaxRuntimeMs - (Date.now() - runStartedAtMs));
      const repairRuntimeMs = Math.min(remainingRuntimeMs, context.historyRepairMaxRuntimeMs);
      if (repairRuntimeMs > 250) {
        try {
          const repairResult = await runHistoryAggregateRepairChunk({
            repo: context.repo,
            syncConfig: syncConfig!,
            maxBlocksPerRun: context.historyRepairMaxBlocksPerRun
          });
          historyRepair = repairResult.job;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          try {
            await context.repo.markRepairJobFailed(HISTORY_AGGREGATE_REPAIR_JOB_NAME, message);
            historyRepair = await readHistoryRepairStatus(context.repo);
          } catch {
            historyRepair = null;
          }
        }
      }
    }
    syncStatus.historyRepair = historyRepair;
    clearOnchainFallbackCaches();
    return {
      ok: true,
      skipped: false,
      latestIndexedBlock,
      headBlock,
      tokenBalanceIndexedBlock,
      blocksBehind: syncStatus.blocksBehind,
      caughtUp,
      maxKittyId,
      dbLiveKitties,
      onchainKittiesEverMinted: syncStatus.onchainKittiesEverMinted,
      onchainKittiesLive: syncStatus.onchainKittiesLive,
      kittyIndexedBehind: syncStatus.kittyIndexedBehind,
      lastSyncSuccessAtMs: syncStatus.lastSyncSuccessAtMs,
      lastSyncFailedAtMs: syncStatus.lastSyncFailedAtMs,
      lastSyncPhase: syncStatus.lastSyncPhase,
      lastSyncFromBlock: syncStatus.lastSyncFromBlock,
      lastSyncToBlock: syncStatus.lastSyncToBlock,
      lastSyncEventKind: syncStatus.lastSyncEventKind,
      lastSyncTxHash: syncStatus.lastSyncTxHash,
      lastSyncLogIndex: syncStatus.lastSyncLogIndex,
      lastSyncError: syncStatus.lastSyncError,
      ...(historyRepair ? { historyRepair } : {})
    };
  } catch (error) {
    if (error instanceof Error && !error.message.includes("chain sync failed during")) {
      await context.repo.recordSyncFailure({
        failedAtMs: Date.now(),
        phase: "cursor-advance",
        error: error.message
      });
    }
    throw error;
  } finally {
    syncStatus.syncing = false;
    await context.repo.releaseSyncLock(owner);
  }
}
