#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const NETWORKS = {
  localhost: {
    deploymentFile: "localhost.json",
    chainId: 31337,
    backendRpcEnv: "KPEG_LOCAL_RPC_URL",
    frontendRpcEnv: "VITE_KPEG_RPC_URL_LOCAL",
    contractRpcEnv: "KPEG_LOCAL_RPC_URL",
    defaultRpc: "http://127.0.0.1:8545",
    viteRpcKey: "VITE_KPEG_RPC_URL_LOCAL",
    sqlitePath: "./apps/indexer/data/kpeg.sqlite"
  },
  "base-sepolia": {
    deploymentFile: "baseSepolia.json",
    chainId: 84532,
    backendRpcEnv: "BASE_SEPOLIA_RPC",
    frontendRpcEnv: "BASE_SEPOLIA_RPC_PUBLIC",
    contractRpcEnv: "KPEG_BASE_SEPOLIA_RPC_URL",
    defaultRpc: "https://sepolia.base.org",
    viteRpcKey: "VITE_KPEG_RPC_URL_BASE_SEPOLIA",
    sqlitePath: "./apps/indexer/data/kpeg-base-sepolia.sqlite"
  },
  "base-mainnet": {
    deploymentFile: "baseMainnet.json",
    chainId: 8453,
    backendRpcEnv: "BASE_RPC",
    frontendRpcEnv: "BASE_RPC_PUBLIC",
    contractRpcEnv: "KPEG_BASE_MAINNET_RPC_URL",
    defaultRpc: "https://mainnet.base.org",
    viteRpcKey: "VITE_KPEG_RPC_URL_BASE_MAINNET",
    sqlitePath: "./apps/indexer/data/kpeg-base-mainnet.sqlite"
  }
};

const MODES = new Set(["local-sqlite", "local-turso", "cloud-turso"]);

const USAGE = "Usage: node scripts/write-app-env.mjs <localhost|base-sepolia|base-mainnet> <local-sqlite|local-turso|cloud-turso>";

export function parseAppEnvArgs(argv) {
  const networkName = argv[0];
  const mode = argv[1];
  if (!NETWORKS[networkName] || !MODES.has(mode)) {
    throw new Error(USAGE);
  }
  if (networkName === "localhost" && mode !== "local-sqlite") {
    throw new Error("localhost only supports local-sqlite mode.");
  }
  return { networkName, mode };
}

export function parseEnvText(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

function readExistingText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function resolveValue(name, processEnv, existingEnv) {
  const raw = processEnv[name]?.trim() || existingEnv[name]?.trim();
  return raw ? raw : undefined;
}

export function isPrivateOrLoopbackRpcUrl(input) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return false;
  }
  const hostname = parsed.hostname.trim().toLowerCase();
  if (!hostname) {
    return false;
  }
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "host.docker.internal" ||
    hostname.endsWith(".local")
  ) {
    return true;
  }
  if (hostname.startsWith("127.")) {
    return true;
  }

  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return false;
  }
  const octets = match.slice(1).map((value) => Number(value));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }

  if (octets[0] === 10) {
    return true;
  }
  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }
  if (octets[0] === 169 && octets[1] === 254) {
    return true;
  }

  return false;
}

export function resolveBackendRpcUrlForApp(input) {
  const network = NETWORKS[input.networkName];
  if (!network) {
    throw new Error(`Unknown network: ${input.networkName}`);
  }
  const rpcUrl =
    resolveValue(network.backendRpcEnv, input.processEnv, input.existingEnv) ??
    resolveValue("KPEG_CHAIN_RPC_URL", input.processEnv, input.existingEnv) ??
    resolveValue(network.contractRpcEnv, input.processEnv, input.existingEnv) ??
    network.defaultRpc;

  if (input.mode === "cloud-turso" && isPrivateOrLoopbackRpcUrl(rpcUrl)) {
    throw new Error(
      [
        `Refusing cloud app env with private/loopback RPC URL: ${rpcUrl}`,
        "Serverless hosts (Vercel and similar) cannot reach localhost or private LAN RPC endpoints.",
        `Set ${network.backendRpcEnv} to a public backend RPC URL, then rerun this command.`,
        "Or clear KPEG_CHAIN_RPC_URL if it still points to localhost from .env.example."
      ].join("\n")
    );
  }

  return rpcUrl;
}

export function resolveBackendRpcFallbackUrlsForApp(input, primaryRpcUrl) {
  const network = NETWORKS[input.networkName];
  if (!network) {
    throw new Error(`Unknown network: ${input.networkName}`);
  }
  const configured =
    resolveValue("KPEG_CHAIN_RPC_FALLBACK_URLS", input.processEnv, input.existingEnv) ??
    (input.networkName === "localhost" || primaryRpcUrl === network.defaultRpc ? "" : network.defaultRpc);
  const urls = [
    ...new Set(
      configured
        .split(/[,\s]+/)
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ].filter((url) => url !== primaryRpcUrl);

  if (input.mode === "cloud-turso") {
    const privateUrl = urls.find((url) => isPrivateOrLoopbackRpcUrl(url));
    if (privateUrl) {
      throw new Error(
        [
          `Refusing cloud app env with private/loopback fallback RPC URL: ${privateUrl}`,
          "Serverless hosts (Vercel and similar) cannot reach localhost or private LAN RPC endpoints.",
          "Clear KPEG_CHAIN_RPC_FALLBACK_URLS or set it to public backend RPC URLs."
        ].join("\n")
      );
    }
  }

  return urls.join(",");
}

export function resolveFrontendRpcUrlForApp(input) {
  const network = NETWORKS[input.networkName];
  if (!network) {
    throw new Error(`Unknown network: ${input.networkName}`);
  }

  const rpcUrl =
    resolveValue(network.frontendRpcEnv, input.processEnv, input.existingEnv) ??
    resolveValue(network.viteRpcKey, input.processEnv, input.existingEnv) ??
    resolveValue("KPEG_FRONTEND_RPC_URL", input.processEnv, input.existingEnv) ??
    resolveValue(network.contractRpcEnv, input.processEnv, input.existingEnv) ??
    network.defaultRpc;

  if (input.mode === "cloud-turso" && isPrivateOrLoopbackRpcUrl(rpcUrl)) {
    throw new Error(
      [
        `Refusing cloud app env with private/loopback frontend RPC URL: ${rpcUrl}`,
        "Browsers and serverless hosts cannot use localhost/private LAN RPC endpoints in cloud deployments.",
        `Set ${network.frontendRpcEnv} (or ${network.viteRpcKey}) to a public browser RPC URL, then rerun this command.`
      ].join("\n")
    );
  }

  return rpcUrl;
}

export function resolveRpcUrlForApp(input) {
  return resolveBackendRpcUrlForApp(input);
}

function resolveLibsql(input) {
  const directUrl = resolveValue("KPEG_LIBSQL_URL", input.processEnv, input.existingEnv);
  const directToken = resolveValue("KPEG_LIBSQL_AUTH_TOKEN", input.processEnv, input.existingEnv);
  if (directUrl && directToken) {
    return { url: directUrl, token: directToken };
  }
  if (directUrl || directToken) {
    throw new Error("Set both KPEG_LIBSQL_URL and KPEG_LIBSQL_AUTH_TOKEN, or set neither and use TURSO_DB_NAME with the Turso CLI.");
  }

  const dbName = resolveValue("TURSO_DB_NAME", input.processEnv, input.existingEnv);
  if (!dbName) {
    throw new Error("Set TURSO_DB_NAME, or set KPEG_LIBSQL_URL and KPEG_LIBSQL_AUTH_TOKEN directly.");
  }
  if (!hasTursoCli()) {
    throw new Error(
      [
        "Turso CLI is not installed or not on PATH.",
        "Install/login first:",
        "  curl -sSfL https://get.tur.so/install.sh | bash",
        "  turso auth signup",
        "Then restart your shell if needed and rerun this command.",
        "Alternative: set KPEG_LIBSQL_URL and KPEG_LIBSQL_AUTH_TOKEN directly instead of TURSO_DB_NAME."
      ].join("\n")
    );
  }

  try {
    execFileSync("turso", ["db", "show", dbName], { stdio: "ignore" });
  } catch {
    try {
      execFileSync("turso", ["db", "create", dbName], { stdio: "inherit" });
    } catch {
      throw new Error(`Could not find or create Turso database: ${dbName}. Run \"turso auth signup\" and retry.`);
    }
  }

  try {
    const url = execFileSync("turso", ["db", "show", dbName, "--url"], { encoding: "utf8" }).trim();
    const token = execFileSync("turso", ["db", "tokens", "create", dbName], { encoding: "utf8" }).trim();
    return { url, token };
  } catch {
    throw new Error(`Could not read Turso URL/token for database: ${dbName}. Run \"turso auth signup\" and retry.`);
  }
}

function hasTursoCli() {
  try {
    execFileSync("turso", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function renderEnv(items) {
  return `${items.map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

const MANAGED_KEYS = new Set([
  "NODE_ENV",
  "KPEG_DB_MODE",
  "KPEG_DB_PATH",
  "KPEG_LIBSQL_URL",
  "KPEG_LIBSQL_AUTH_TOKEN",
  "KPEG_DB_APPLY_SCHEMA_ON_BOOT",
  "KPEG_CHAIN_RPC_URL",
  "KPEG_CHAIN_RPC_FALLBACK_URLS",
  "KPEG_CHAIN_ID",
  "KPEG_CHAIN_START_BLOCK",
  "KPEG_DEPLOYED_AT",
  "KPEG_TOKEN_ADDRESS",
  "KPEG_MARKET_ADDRESS",
  "KPEG_BREEDING_ADDRESS",
  "KPEG_ROUTER_ADDRESS",
  "KPEG_QUOTER_ADDRESS",
  "KPEG_SYNC_SECRET",
  "KPEG_ONCHAIN_REQUEST_REPAIR",
  "KPEG_ONCHAIN_FORCE_PAGE_REPAIR",
  "VITE_KPEG_CHAIN_ID",
  "VITE_REOWN_PROJECT_ID",
  "VITE_KPEG_TOKEN_ADDRESS",
  "VITE_KPEG_MARKET_ADDRESS",
  "VITE_KPEG_ROUTER_ADDRESS",
  "VITE_KPEG_QUOTER_ADDRESS",
  "VITE_KPEG_RPC_URL_LOCAL",
  "VITE_KPEG_RPC_URL_BASE_SEPOLIA",
  "VITE_KPEG_RPC_URL_BASE_MAINNET"
]);

export function mergeEnv(existingText, items) {
  const managedEntries = Object.fromEntries(items);
  const lines = existingText.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      return true;
    }
    return !MANAGED_KEYS.has(trimmed.slice(0, trimmed.indexOf("=")));
  });
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  if (lines.length > 0) {
    lines.push("");
  }
  for (const [key, value] of Object.entries(managedEntries)) {
    lines.push(`${key}=${value}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2), processEnv = process.env) {
  const { networkName, mode } = parseAppEnvArgs(argv);
  const network = NETWORKS[networkName];
  const deploymentPath = resolve("deployments", network.deploymentFile);
  if (!existsSync(deploymentPath)) {
    throw new Error(`Missing deployment file: ${deploymentPath}`);
  }

  const envPath = resolve(processEnv.KPEG_ENV_PATH ?? ".env");
  const existingText = readExistingText(envPath);
  const existingEnv = parseEnvText(existingText);
  const reownProjectId =
    resolveValue("REOWN_PROJECT_ID", processEnv, existingEnv) ??
    resolveValue("VITE_REOWN_PROJECT_ID", processEnv, existingEnv) ??
    "";
  if (!reownProjectId && mode !== "local-sqlite") {
    throw new Error("Set VITE_REOWN_PROJECT_ID in .env before running this command.");
  }

  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
  for (const key of ["token", "market", "router", "quoter"]) {
    if (!deployment[key]) {
      throw new Error(`Deployment file is missing ${key}: ${deploymentPath}`);
    }
  }
  const chainStartBlock = Number(deployment.tokenDeploymentBlock);
  if (!Number.isInteger(chainStartBlock) || chainStartBlock <= 0) {
    throw new Error(
      `Deployment file is missing tokenDeploymentBlock (positive integer): ${deploymentPath}`
    );
  }

  const backendRpcUrl = resolveBackendRpcUrlForApp({
    networkName,
    mode,
    processEnv,
    existingEnv
  });
  const backendRpcFallbackUrls = resolveBackendRpcFallbackUrlsForApp(
    {
      networkName,
      mode,
      processEnv,
      existingEnv
    },
    backendRpcUrl
  );
  const frontendRpcUrl = resolveFrontendRpcUrlForApp({
    networkName,
    mode,
    processEnv,
    existingEnv
  });

  const entries = [
    ["NODE_ENV", mode === "cloud-turso" ? "production" : "development"],
    ["KPEG_DB_MODE", mode === "local-sqlite" ? "sqlite" : "libsql"],
    ["KPEG_DB_APPLY_SCHEMA_ON_BOOT", mode === "cloud-turso" ? "false" : "true"]
  ];

  if (mode === "local-sqlite") {
    entries.push(["KPEG_DB_PATH", network.sqlitePath]);
  } else {
    const libsql = resolveLibsql({ processEnv, existingEnv });
    entries.push(["KPEG_LIBSQL_URL", libsql.url], ["KPEG_LIBSQL_AUTH_TOKEN", libsql.token]);
  }

  const breedingEngineAddress = deployment.breeding ?? deployment.breedingEngine ?? "";

  entries.push(
    ["KPEG_CHAIN_RPC_URL", backendRpcUrl],
    ["KPEG_CHAIN_RPC_FALLBACK_URLS", backendRpcFallbackUrls],
    ["KPEG_CHAIN_ID", String(network.chainId)],
    ["KPEG_CHAIN_START_BLOCK", String(chainStartBlock)],
    ["KPEG_DEPLOYED_AT", deployment.deployedAt ?? ""],
    ["KPEG_TOKEN_ADDRESS", deployment.token],
    ["KPEG_MARKET_ADDRESS", deployment.market],
    ["KPEG_BREEDING_ADDRESS", breedingEngineAddress],
    ["KPEG_ROUTER_ADDRESS", deployment.router],
    ["KPEG_QUOTER_ADDRESS", deployment.quoter],
    ["KPEG_ONCHAIN_FORCE_PAGE_REPAIR", "false"]
  );

  const secret = resolveValue("KPEG_SYNC_SECRET", processEnv, existingEnv) ?? randomBytes(32).toString("hex");
  entries.push(["KPEG_SYNC_SECRET", secret]);

  entries.push(
    ["VITE_KPEG_CHAIN_ID", String(network.chainId)],
    ["VITE_REOWN_PROJECT_ID", reownProjectId],
    ["VITE_KPEG_TOKEN_ADDRESS", deployment.token],
    ["VITE_KPEG_MARKET_ADDRESS", deployment.market],
    ["VITE_KPEG_ROUTER_ADDRESS", deployment.router],
    ["VITE_KPEG_QUOTER_ADDRESS", deployment.quoter],
    [network.viteRpcKey, frontendRpcUrl]
  );

  writeFileSync(envPath, mode === "cloud-turso" ? renderEnv(entries) : mergeEnv(existingText, entries));
  console.log(`${mode === "cloud-turso" ? "Wrote" : "Updated"} ${mode} app envs in ${envPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    if (message !== USAGE && message !== "") {
      console.error("");
      console.error(USAGE);
    }
    process.exit(1);
  });
}
