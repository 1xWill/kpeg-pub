import { config as loadEnv } from "dotenv";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { KPEGRepository } from "./repository.js";
import { validateRuntimeSyncEnv } from "./runtime.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = resolve(repoRoot, ".env");

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function main() {
  loadEnv({ path: envPath });
  const runtimeEnv = validateRuntimeSyncEnv(process.env);
  if (runtimeEnv.missing.length > 0 || runtimeEnv.invalid.length > 0) {
    throw new Error(
      [
        "Cannot initialize indexer DB because runtime env is incomplete.",
        runtimeEnv.missing.length > 0 ? `Missing: ${runtimeEnv.missing.join(", ")}` : "",
        runtimeEnv.invalid.length > 0 ? `Invalid: ${runtimeEnv.invalid.join(", ")}` : ""
      ].filter(Boolean).join(" ")
    );
  }

  const productionMode = process.env.NODE_ENV === "production";
  const mode = (process.env.KPEG_DB_MODE ?? (productionMode ? "libsql" : "sqlite")) as "sqlite" | "libsql";
  const sqlitePath = process.env.KPEG_DB_PATH ?? "./data/kpeg.sqlite";
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
      chainId: numberEnv("KPEG_CHAIN_ID", 84532),
      tokenAddress: process.env.KPEG_TOKEN_ADDRESS as `0x${string}`,
      marketAddress: (process.env.KPEG_MARKET_ADDRESS as `0x${string}` | undefined) ?? null
    });
    console.log("Indexer DB initialized.");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
