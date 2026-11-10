import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";

function envUrl(name, fallbackPort) {
  const value = process.env[name];
  if (value) {
    return new URL(value);
  }
  return new URL(`http://${HOST}:${fallbackPort}`);
}

async function canListenOn(port) {
  return new Promise((resolveCanListen) => {
    const server = createServer();
    server.once("error", () => {
      resolveCanListen(false);
    });
    server.listen(port, HOST, () => {
      server.close(() => resolveCanListen(true));
    });
  });
}

async function findAvailablePort(preferredPort) {
  if (await canListenOn(preferredPort)) {
    return preferredPort;
  }

  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => rejectPort(new Error("failed to allocate ephemeral port")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          rejectPort(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

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
    if (options.echoStdout) {
      process.stdout.write(chunk);
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    if (options.echoStderr) {
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

async function waitFor(task, config) {
  const timeoutMs = config.timeoutMs ?? 60_000;
  const intervalMs = config.intervalMs ?? 500;
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
  throw new Error(`Timed out waiting for ${config.label}.${tail}`);
}

async function waitForRpc() {
  await waitFor(
    async () => {
      const response = await fetch(runtime.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: []
        })
      });
      if (!response.ok) {
        return null;
      }
      const payload = await response.json();
      return payload.result ? payload.result : null;
    },
    { label: `rpc ${runtime.rpcUrl}` }
  );
}

async function waitForHealth() {
  await waitFor(
    async () => {
      const response = await fetch(`${runtime.apiUrl}/api/health`);
      if (!response.ok) {
        return null;
      }
      const payload = await response.json();
      return payload.ok ? payload : null;
    },
    { label: `indexer health ${runtime.apiUrl}/api/health` }
  );
}

async function stopProcess(handle, label) {
  if (!handle) {
    return;
  }
  if (handle.child.exitCode !== null) {
    return;
  }
  handle.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => handle.child.once("exit", resolveExit)),
    sleep(5_000).then(() => {
      handle.child.kill("SIGKILL");
    })
  ]);
  const stderrTail = handle.readStderr().trim();
  if (stderrTail) {
    console.error(`[${label}] stderr:\n${stderrTail.split("\n").slice(-20).join("\n")}`);
  }
}

async function getJson(path) {
  const response = await fetch(`${runtime.apiUrl}${path}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path}`);
  }
  return response.json();
}

function parseFlowResult(stdout) {
  const marker = stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("E2E_FLOW_RESULT="));
  if (!marker) {
    throw new Error("Missing E2E_FLOW_RESULT marker from contracts flow script output");
  }
  return JSON.parse(marker.slice("E2E_FLOW_RESULT=".length));
}

let nodeProcess;
let indexerProcess;
let tempDir;
const runtime = {
  rpcUrl: "",
  apiUrl: "",
  rpcPort: 0,
  apiPort: 0
};

async function main() {
  tempDir = await mkdtemp(join(tmpdir(), "kpeg-e2e-"));
  const dbPath = join(tempDir, "kpeg-e2e.sqlite");

  const requestedRpcUrl = envUrl("KPEG_E2E_RPC_URL", 18545);
  const requestedApiUrl = envUrl("KPEG_E2E_API_URL", 18787);

  runtime.rpcPort = process.env.KPEG_E2E_RPC_URL
    ? Number(requestedRpcUrl.port || "8545")
    : await findAvailablePort(Number(requestedRpcUrl.port || "18545"));
  runtime.apiPort = process.env.KPEG_E2E_API_URL
    ? Number(requestedApiUrl.port || "8787")
    : await findAvailablePort(Number(requestedApiUrl.port || "18787"));
  runtime.rpcUrl = `${requestedRpcUrl.protocol}//${HOST}:${runtime.rpcPort}`;
  runtime.apiUrl = `${requestedApiUrl.protocol}//${HOST}:${runtime.apiPort}`;

  console.log(`[e2e] starting hardhat node on ${HOST}:${runtime.rpcPort}`);
  nodeProcess = startProcess(
    "pnpm",
    ["--filter", "@kpeg/contracts", "exec", "hardhat", "node", "--hostname", HOST, "--port", String(runtime.rpcPort)],
    { echoStdout: false, echoStderr: false }
  );
  await waitForRpc();

  console.log("[e2e] deploying contracts to localhost");
  await runCommand("pnpm", ["--filter", "@kpeg/contracts", "deploy:localhost"], {
    env: {
      KPEG_LOCAL_RPC_URL: runtime.rpcUrl
    }
  });

  console.log("[e2e] bootstrapping real Uniswap v4 liquidity");
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
    {
      env: {
        KPEG_LOCAL_RPC_URL: runtime.rpcUrl
      }
    }
  );

  const deploymentRaw = await readFile(join(ROOT, "deployments", "localhost.json"), "utf8");
  const deployment = JSON.parse(deploymentRaw);
  const tokenAddress = deployment.token;
  const marketAddress = deployment.market;
  const routerAddress = deployment.router;
  const quoterAddress = deployment.quoter;
  assert(typeof tokenAddress === "string" && tokenAddress.startsWith("0x"), "Invalid token address after deploy");
  assert(typeof marketAddress === "string" && marketAddress.startsWith("0x"), "Invalid market address after deploy");

  console.log("[e2e] building core + indexer");
  await runCommand("pnpm", ["--filter", "@kpeg/core", "build"]);
  await runCommand("pnpm", ["--filter", "@kpeg/indexer", "build"]);

  console.log(`[e2e] starting indexer on ${HOST}:${runtime.apiPort}`);
  indexerProcess = startProcess("pnpm", ["--filter", "@kpeg/indexer", "start"], {
    env: {
      NODE_ENV: "development",
      HOST,
      PORT: String(runtime.apiPort),
      KPEG_DB_MODE: "sqlite",
      KPEG_DB_PATH: dbPath,
      KPEG_CHAIN_SYNC_ENABLED: "true",
      KPEG_CHAIN_RPC_URL: runtime.rpcUrl,
      KPEG_CHAIN_ID: "31337",
      KPEG_CHAIN_SYNC_POLL_MS: "500",
      KPEG_TOKEN_ADDRESS: tokenAddress,
      KPEG_MARKET_ADDRESS: marketAddress,
      KPEG_ROUTER_ADDRESS: routerAddress,
      KPEG_QUOTER_ADDRESS: quoterAddress
    }
  });
  await waitForHealth();

  console.log("[e2e] executing real add-liquidity -> swap -> transfer -> sell flow");
  const flow = await runCommand("pnpm", ["--filter", "@kpeg/contracts", "flow:localhost"], {
    env: {
      KPEG_LOCAL_RPC_URL: runtime.rpcUrl,
      KPEG_E2E_BUY_WHOLE: process.env.KPEG_E2E_BUY_WHOLE ?? "20"
    }
  });
  const flowResult = parseFlowResult(flow.stdout);

  console.log("[e2e] waiting for indexer to ingest final state");
  const indexingStartedAt = Date.now();
  const finalStats = await waitFor(
    async () => {
      const stats = await getJson("/api/stats");
      if (stats.kittiesEverMinted === flowResult.buyWhole && stats.kittiesLive === 0 && stats.holdersLive === 0) {
        return stats;
      }
      return null;
    },
    { label: "expected /api/stats state", timeoutMs: 90_000, intervalMs: 750 }
  );
  const indexedCatchUpMs = Date.now() - indexingStartedAt;

  const aliceKitties = await getJson(
    `/api/kitties/owner/${flowResult.alice}?page=0&pageSize=24&sort=latest`
  );
  const bobKitties = await getJson(`/api/kitties/owner/${flowResult.bob}?page=0&pageSize=24&sort=latest`);
  assert(aliceKitties.total === 0, `Expected alice to hold 0 live kitties after sell-all, got ${aliceKitties.total}`);
  assert(bobKitties.total === 0, `Expected bob to hold 0 live kitties after sell, got ${bobKitties.total}`);

  const movedDetail = await getJson(`/api/kitties/${flowResult.movedKittyId}`);
  assert(
    movedDetail.owner === "0x0000000000000000000000000000000000000000",
    `Expected moved kitty #${flowResult.movedKittyId} to be burned`
  );
  const marketListing = await getJson(`/api/market/listings/${flowResult.marketTradeId}`);
  assert(marketListing.status === "SOLD", `Expected market trade #${flowResult.marketTradeId} to be SOLD`);
  assert(
    marketListing.buyer === flowResult.bob,
    `Expected market trade buyer ${flowResult.bob}, got ${marketListing.buyer}`
  );

  console.log("[e2e] verification summary");
  console.log(
    JSON.stringify(
      {
        rpcUrl: runtime.rpcUrl,
        apiUrl: runtime.apiUrl,
        tokenAddress,
        marketAddress,
        routerAddress,
        quoterAddress,
        flowResult,
        finalStats,
        indexedCatchUpMs
      },
      null,
      2
    )
  );
}

main()
  .then(async () => {
    await stopProcess(indexerProcess, "indexer");
    await stopProcess(nodeProcess, "hardhat-node");
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  })
  .catch(async (error) => {
    console.error(`[e2e] failed: ${(error && error.message) || error}`);
    if (indexerProcess) {
      const out = indexerProcess.readStdout().trim();
      if (out) {
        console.error(`[indexer] stdout tail:\n${out.split("\n").slice(-30).join("\n")}`);
      }
    }
    if (nodeProcess) {
      const out = nodeProcess.readStdout().trim();
      if (out) {
        console.error(`[hardhat-node] stdout tail:\n${out.split("\n").slice(-30).join("\n")}`);
      }
    }
    await stopProcess(indexerProcess, "indexer");
    await stopProcess(nodeProcess, "hardhat-node");
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    process.exit(1);
  });
