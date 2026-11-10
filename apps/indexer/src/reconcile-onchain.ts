import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readChainHeadBlock, readOnchainKittyCounts, runSingleChainSync, type ChainSyncConfig } from "./chain.js";
import { openDb } from "./db.js";
import { KPEGRepository } from "./repository.js";

type DeploymentHint = {
  token?: string;
  market?: string;
  breeding?: string;
  breedingEngine?: string;
  deployedAt?: string;
  tokenDeploymentBlock?: number;
};

type ReplayAddressResolution = {
  marketAddress?: `0x${string}`;
  breedingAddress?: `0x${string}`;
  includeMarket: boolean;
  includeBreeding: boolean;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = resolve(repoRoot, ".env");

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolEnv(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return value === "1" || value === "true" || value === "yes";
}

function parseRpcFallbackUrls(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ];
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

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function requiresReplayResetConfirmation(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    env.NODE_ENV === "production" ||
    env.KPEG_DB_MODE === "libsql" ||
    Boolean(env.KPEG_LIBSQL_URL?.trim())
  );
}

export function assertReplayResetAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (requiresReplayResetConfirmation(env) && !boolEnv("KPEG_RECONCILE_CONFIRM_RESET", false)) {
    throw new Error(
      "Refusing to reset index data for reconcile:onchain on production-like DB target. " +
      "Set KPEG_RECONCILE_CONFIRM_RESET=1 to continue."
    );
  }
}

export function resolveReplayAddresses(input: {
  marketAddress?: `0x${string}`;
  breedingAddress?: `0x${string}`;
}): ReplayAddressResolution {
  const includeMarket = boolEnv("KPEG_RECONCILE_INCLUDE_MARKET", Boolean(input.marketAddress));
  const includeBreeding = boolEnv("KPEG_RECONCILE_INCLUDE_BREEDING", false);
  return {
    ...(includeMarket && input.marketAddress ? { marketAddress: input.marketAddress } : {}),
    ...(includeBreeding && input.breedingAddress ? { breedingAddress: input.breedingAddress } : {}),
    includeMarket,
    includeBreeding
  };
}

async function runReplayToTarget(input: {
  repo: KPEGRepository;
  syncConfig: ChainSyncConfig;
  targetBlock: number;
}): Promise<{
  latestIndexedBlock: number;
  tokenBalanceIndexedBlock: number;
  headBlock: number;
  runs: number;
}> {
  let runs = 0;
  let latestIndexedBlock = 0;
  let tokenBalanceIndexedBlock = 0;
  let headBlock = input.targetBlock;
  let previousMain = -1;
  let previousToken = -1;

  while (true) {
    runs += 1;
    const result = await runSingleChainSync(
      input.repo,
      {
        ...input.syncConfig,
        targetBlock: input.targetBlock
      },
      async (failure) => {
        await input.repo.recordSyncFailure({
          failedAtMs: Date.now(),
          phase: failure.phase,
          fromBlock: failure.fromBlock ?? null,
          toBlock: failure.toBlock ?? null,
          eventKind: failure.eventKind ?? null,
          txHash: failure.txHash ?? null,
          logIndex: failure.logIndex ?? null,
          error: failure.error
        });
      }
    );
    latestIndexedBlock = result.latestIndexedBlock;
    tokenBalanceIndexedBlock = result.tokenBalanceIndexedBlock ?? result.latestIndexedBlock;
    headBlock = result.headBlock;
    const caughtUp =
      latestIndexedBlock >= input.targetBlock &&
      tokenBalanceIndexedBlock >= input.targetBlock;
    console.log(
      JSON.stringify({
        event: "sync-chunk",
        run: runs,
        fromBlock: result.fromBlock ?? null,
        toBlock: result.toBlock ?? null,
        tokenBalanceFromBlock: result.tokenBalanceFromBlock ?? null,
        tokenBalanceToBlock: result.tokenBalanceToBlock ?? null,
        latestIndexedBlock,
        tokenBalanceIndexedBlock,
        targetBlock: input.targetBlock,
        headBlock,
        caughtUp
      })
    );
    if (caughtUp || result.targetReached) {
      return { latestIndexedBlock, tokenBalanceIndexedBlock, headBlock, runs };
    }
    if (result.toBlock === undefined && result.tokenBalanceToBlock === undefined) {
      throw new Error(
        `Replay ended early before target block ${input.targetBlock}. latest=${latestIndexedBlock} tokenBalance=${tokenBalanceIndexedBlock}`
      );
    }
    if (previousMain === latestIndexedBlock && previousToken === tokenBalanceIndexedBlock) {
      throw new Error(
        `Replay made no progress. latest=${latestIndexedBlock} tokenBalance=${tokenBalanceIndexedBlock} target=${input.targetBlock}`
      );
    }
    previousMain = latestIndexedBlock;
    previousToken = tokenBalanceIndexedBlock;
  }
}

export async function runReconcileOnchainCli() {
  loadEnv({ path: envPath, override: true });

  const chainId = numberEnv("KPEG_CHAIN_ID", 8453);
  const rpcUrl = requiredEnv("KPEG_CHAIN_RPC_URL");
  const tokenAddress = requiredEnv("KPEG_TOKEN_ADDRESS") as `0x${string}`;
  const deploymentHint = loadDeploymentHint(chainId, tokenAddress);
  const configuredMarketAddress = process.env.KPEG_MARKET_ADDRESS as `0x${string}` | undefined;
  const marketAddress = configuredMarketAddress ?? (deploymentHint?.market as `0x${string}` | undefined);
  const configuredBreedingAddress = process.env.KPEG_BREEDING_ADDRESS as `0x${string}` | undefined;
  const breedingAddress = configuredBreedingAddress ?? (deploymentHint?.breeding as `0x${string}` | undefined);
  const replayAddresses = resolveReplayAddresses({
    ...(marketAddress ? { marketAddress } : {}),
    ...(breedingAddress ? { breedingAddress } : {})
  });
  if (replayAddresses.includeMarket && !replayAddresses.marketAddress) {
    throw new Error("KPEG_MARKET_ADDRESS is required when KPEG_RECONCILE_INCLUDE_MARKET=1");
  }
  if (!replayAddresses.includeMarket) {
    console.warn("reconcile:onchain warning: market replay disabled; listings/sales/volume will not be rebuilt.");
  }
  const rpcFallbackUrls = parseRpcFallbackUrls(process.env.KPEG_CHAIN_RPC_FALLBACK_URLS);
  const configuredStartBlock = numberEnv("KPEG_CHAIN_START_BLOCK", 0);
  const startBlock =
    configuredStartBlock > 0
      ? configuredStartBlock
      : (deploymentHint?.tokenDeploymentBlock ?? 0);
  const dryRun = boolEnv("KPEG_RECONCILE_DRY_RUN", false);

  const productionMode = process.env.NODE_ENV === "production";
  const mode = (process.env.KPEG_DB_MODE ?? (productionMode ? "libsql" : "sqlite")) as "sqlite" | "libsql";
  const sqlitePath = process.env.KPEG_DB_PATH ?? "./data/kpeg.sqlite";
  const baseSyncConfig: ChainSyncConfig = {
    rpcUrl,
    ...(rpcFallbackUrls.length > 0 ? { rpcFallbackUrls } : {}),
    tokenAddress,
    ...(replayAddresses.marketAddress ? { marketAddress: replayAddresses.marketAddress } : {}),
    ...(replayAddresses.breedingAddress ? { breedingAddress: replayAddresses.breedingAddress } : {}),
    chainId,
    ...(startBlock > 0 ? { startBlock } : {}),
    ...(startBlock <= 0 && deploymentHint?.deployedAt ? { deployedAtHint: deploymentHint.deployedAt } : {}),
    maxBlocksPerRun: numberEnv("KPEG_SYNC_MAX_BLOCKS", 5_000)
  };
  const targetBlock = numberEnv("KPEG_RECONCILE_TARGET_BLOCK", 0) || (await readChainHeadBlock(baseSyncConfig));
  console.log(
    JSON.stringify({
      event: "start",
      chainId,
      tokenAddress,
      marketAddress: replayAddresses.marketAddress ?? null,
      breedingAddress: replayAddresses.breedingAddress ?? null,
      includeMarket: replayAddresses.includeMarket,
      includeBreeding: replayAddresses.includeBreeding,
      dryRun,
      startBlock: startBlock || null,
      targetBlock,
      maxBlocksPerRun: baseSyncConfig.maxBlocksPerRun
    })
  );
  if (dryRun) {
    return;
  }

  if (mode === "sqlite" && sqlitePath !== ":memory:") {
    await mkdir(dirname(resolve(repoRoot, sqlitePath)), { recursive: true });
  }

  const db = await openDb({
    mode,
    sqlitePath,
    sqliteBasePath: repoRoot,
    libsqlUrl: process.env.KPEG_LIBSQL_URL,
    libsqlAuthToken: process.env.KPEG_LIBSQL_AUTH_TOKEN,
    applySchema: true
  });

  try {
    const repo = new KPEGRepository(db);
    await repo.ensureChainIdentity({
      chainId,
      tokenAddress,
      marketAddress: replayAddresses.marketAddress ?? null
    });

    assertReplayResetAllowed(process.env);
    await repo.resetIndexedStateForReplay();

    const replay = await runReplayToTarget({
      repo,
      syncConfig: baseSyncConfig,
      targetBlock
    });

    const completedAtMs = Date.now();
    await repo.markSyncSuccess(completedAtMs);
    try {
      const counts = await readOnchainKittyCounts(baseSyncConfig, BigInt(targetBlock));
      await repo.setSyncSnapshot({
        headBlock: targetBlock,
        onchainKittiesLive: counts.kittiesLive,
        onchainKittiesEverMinted: counts.kittiesEverMinted,
        updatedAtMs: completedAtMs
      });
    } catch {
      await repo.setSyncSnapshot({
        headBlock: targetBlock,
        onchainKittiesLive: null,
        onchainKittiesEverMinted: null,
        updatedAtMs: completedAtMs
      });
    }

    const [stats, marketStats, maxKittyId, liveKittyCount] = await Promise.all([
      repo.getStats(),
      repo.getMarketStats(),
      repo.getMaxKittyId(),
      repo.getLiveKittyCount()
    ]);
    console.log(
      JSON.stringify(
        {
          event: "done",
          chainId,
          tokenAddress,
          marketAddress: replayAddresses.marketAddress ?? null,
          targetBlock,
          runs: replay.runs,
          latestIndexedBlock: replay.latestIndexedBlock,
          tokenBalanceIndexedBlock: replay.tokenBalanceIndexedBlock,
          headBlock: replay.headBlock,
          maxKittyId,
          liveKittyCount,
          stats,
          marketStats
        },
        null,
        2
      )
    );
  } finally {
    await db.close();
  }
}

const isDirectRun =
  Boolean(process.argv[1]) && resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runReconcileOnchainCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
