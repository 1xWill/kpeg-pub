#!/usr/bin/env node
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const RPC_PORT = Number(process.env.KPEG_DEMO_RPC_PORT ?? "8545");
const API_PORT = Number(process.env.KPEG_DEMO_API_PORT ?? "8787");
const WEB_PORT = Number(process.env.KPEG_DEMO_WEB_PORT ?? "5173");
const RPC_URL = `http://${HOST}:${RPC_PORT}`;
const API_URL = `http://${HOST}:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const ONCE_MODE = process.argv.includes("--once") || process.env.KPEG_DEMO_ONCE === "1";

const DEMO_WALLETS = [
  {
    label: "Alice (Demo Trader #1 — holds 35 live kitties + 2 open market listings)",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
  },
  {
    label: "Bob (Demo Trader #2 — holds 11 live kitties + 1 open market listing)",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
  },
  {
    label: "Carol (Demo Trader #3 — holds 5 live kitties)",
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    privateKey: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
  }
];

function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...options.env
    }
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (options.prefix) {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        process.stdout.write(`[${options.prefix}] ${line}\n`);
      }
    } else if (options.echoStdout) {
      process.stdout.write(chunk);
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    if (options.prefix) {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        process.stderr.write(`[${options.prefix}] ${line}\n`);
      }
    } else if (options.echoStderr) {
      process.stderr.write(chunk);
    }
  });

  return {
    child,
    readStdout: () => stdout,
    readStderr: () => stderr
  };
}

async function runCommand(command, args, options = {}) {
  const handle = startProcess(command, args, options);
  const exitCode = await new Promise((resolveExit) => {
    handle.child.on("exit", (code) => resolveExit(code ?? 1));
  });
  const stdout = handle.readStdout();
  const stderr = handle.readStderr();
  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${command} ${args.join(" ")}):\n${stderr || stdout || `exit code ${exitCode}`}`
    );
  }
  return { stdout, stderr };
}

async function waitFor(task, { label, timeoutMs = 60_000, intervalMs = 400 }) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await task();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const tail = lastError ? ` Last error: ${String(lastError)}` : "";
  throw new Error(`Timed out waiting for ${label}.${tail}`);
}

async function stopProcess(handle) {
  if (!handle || handle.child.exitCode !== null) {
    return;
  }
  handle.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => handle.child.once("exit", resolveExit)),
    sleep(3_000).then(() => handle.child.kill("SIGKILL"))
  ]);
}

function parseSeedSummary(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("DEMO_SEED_RESULT="));
  if (!line) {
    throw new Error("Missing DEMO_SEED_RESULT from seed:localhost output");
  }
  return JSON.parse(line.slice("DEMO_SEED_RESULT=".length));
}

let nodeHandle;
let apiHandle;
let webHandle;
let shuttingDown = false;

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await stopProcess(webHandle);
  await stopProcess(apiHandle);
  await stopProcess(nodeHandle);
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

async function main() {
  const sqliteBase = join(ROOT, "apps", "indexer", "data", "kpeg.sqlite");
  await rm(sqliteBase, { force: true });
  await rm(`${sqliteBase}-shm`, { force: true });
  await rm(`${sqliteBase}-wal`, { force: true });

  console.log(`[demo] 1/6 Starting local Hardhat chain on ${RPC_URL}...`);
  nodeHandle = startProcess(
    "pnpm",
    ["--filter", "@kpeg/contracts", "exec", "hardhat", "node", "--hostname", HOST, "--port", String(RPC_PORT)],
    { echoStdout: false, echoStderr: false }
  );

  await waitFor(
    async () => {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] })
      });
      return res.ok;
    },
    { label: `Hardhat RPC at ${RPC_URL}` }
  );

  console.log("[demo] 2/6 Building @kpeg/core and deploying contracts to localhost...");
  await runCommand("pnpm", ["--filter", "@kpeg/core", "build"]);
  await runCommand("pnpm", ["--filter", "@kpeg/contracts", "deploy:localhost"], {
    env: { KPEG_LOCAL_RPC_URL: RPC_URL }
  });

  console.log("[demo] 3/6 Bootstrapping Uniswap v4 pool liquidity (1,000 kPEG + 1,000 ETH)...");
  await runCommand(
    "pnpm",
    [
      "--filter",
      "@kpeg/contracts",
      "bootstrap:localhost",
      "--",
      "--price-kpeg-per-eth",
      "1",
      "--token-liquidity",
      "1000",
      "--eth-liquidity",
      "1000"
    ],
    { env: { KPEG_LOCAL_RPC_URL: RPC_URL } }
  );

  console.log("[demo] 4/6 Seeding demo kitties, market listings, transfers, and sales...");
  const seedRun = await runCommand("pnpm", ["--filter", "@kpeg/contracts", "seed:localhost"], {
    env: { KPEG_LOCAL_RPC_URL: RPC_URL }
  });
  const seedSummary = parseSeedSummary(seedRun.stdout);

  console.log("[demo] 5/6 Writing root .env for localhost + SQLite...");
  await runCommand("node", ["scripts/write-app-env.mjs", "localhost", "local-sqlite"], {
    env: { KPEG_LOCAL_RPC_URL: RPC_URL, VITE_KPEG_RPC_URL_LOCAL: RPC_URL }
  });

  console.log(`[demo] 6/6 Starting indexer API (${API_URL}) and web app (${WEB_URL})...`);
  apiHandle = startProcess("pnpm", ["--filter", "@kpeg/indexer", "dev"], {
    env: {
      HOST,
      PORT: String(API_PORT),
      KPEG_CHAIN_RPC_URL: RPC_URL,
      KPEG_DEV_SYNC_INTERVAL_MS: "4000"
    }
  });

  await waitFor(
    async () => {
      const res = await fetch(`${API_URL}/api/stats`);
      if (!res.ok) return null;
      const stats = await res.json();
      return stats.kittiesLive === seedSummary.kittiesLive && stats.kittiesEverMinted === seedSummary.kittiesEverMinted
        ? stats
        : null;
    },
    { label: "indexer API to sync seeded demo data", timeoutMs: 60_000, intervalMs: 500 }
  );

  webHandle = startProcess(
    "pnpm",
    ["--filter", "@kpeg/web", "exec", "vite", "--host", "localhost", "--port", String(WEB_PORT), "--strictPort"],
    {
      env: {
        VITE_KPEG_RPC_URL_LOCAL: RPC_URL
      }
    }
  );

  await waitFor(
    async () => {
      const res = await fetch(WEB_URL);
      return res.ok;
    },
    { label: `Vite web server at ${WEB_URL}` }
  );

  console.log("\n======================================================================");
  console.log("  kPEG Local Demo Ready");
  console.log("======================================================================");
  console.log(`  Web App:      ${WEB_URL}`);
  console.log(`  Indexer API:  ${API_URL}/api/stats`);
  console.log(`  Local Chain:  ${RPC_URL} (Chain ID: 31337)`);
  console.log("----------------------------------------------------------------------");
  console.log(
    `  Seeded Data:  ${seedSummary.kittiesLive} live kitties (${seedSummary.kittiesEverMinted} ever minted) | ` +
      `${seedSummary.openTradeIds.length} open market listings | 1 market sale`
  );
  console.log("----------------------------------------------------------------------");
  console.log("  Test Wallets (import into MetaMask / Rabby on Localhost 8545):");
  for (const wallet of DEMO_WALLETS) {
    console.log(`  - ${wallet.label}`);
    console.log(`    Address:     ${wallet.address}`);
    console.log(`    Private Key: ${wallet.privateKey}`);
  }
  console.log("======================================================================\n");

  if (ONCE_MODE) {
    await shutdown(0);
    return;
  }

  console.log("Press Ctrl+C to stop the demo servers.");
  await new Promise(() => {});
}

main().catch(async (error) => {
  console.error(`[demo] failed: ${(error && error.message) || error}`);
  await shutdown(1);
});
