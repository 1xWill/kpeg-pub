#!/usr/bin/env node

const baseArg = process.argv[2]?.trim();
if (!baseArg) {
  console.error("Usage: node scripts/smoke-api-routes.mjs <https://your-domain>");
  process.exit(1);
}

const baseUrl = baseArg.replace(/\/+$/, "");
const zeroAddress = "0x0000000000000000000000000000000000000000";
const seed = `0x${"1".repeat(64)}`;

const checks = [
  { name: "config", path: "/api/config", statuses: [200] },
  { name: "status", path: "/api/status", statuses: [200] },
  {
    name: "kitties-global",
    path: "/api/kitties/global?page=0&pageSize=1&sort=latest",
    statuses: [200],
  },
  {
    name: "kitties-owner",
    path: `/api/kitties/owner/${zeroAddress}?page=0&pageSize=1&sort=latest`,
    statuses: [200],
  },
  {
    name: "kitties-owner-stats",
    path: `/api/kitties/owner/${zeroAddress}/stats`,
    statuses: [200],
  },
  {
    name: "market-listings",
    path: "/api/market/listings?page=0&pageSize=1&tab=all&sort=latest",
    statuses: [200],
  },
  {
    name: "market-listing-detail",
    path: "/api/market/listings/1",
    statuses: [200, 404],
  },
  {
    name: "market-owner",
    path: `/api/market/owner/${zeroAddress}`,
    statuses: [200],
  },
  {
    name: "market-purchased",
    path: `/api/market/purchased/${zeroAddress}`,
    statuses: [200],
  },
  {
    name: "art-seed",
    path: `/api/art/${seed}?tier=1`,
    statuses: [200],
  },
];

let failures = 0;

for (const check of checks) {
  const url = `${baseUrl}${check.path}`;
  let response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch (error) {
    failures += 1;
    console.error(`[FAIL] ${check.name}: request failed for ${url}`);
    console.error(String(error));
    continue;
  }

  const body = await response.text();
  const vercelError = response.headers.get("x-vercel-error")?.trim();
  const bodySignalsNotFound = /\bNOT_FOUND\b/.test(body) || /The page could not be found/i.test(body);

  if (vercelError === "NOT_FOUND" || bodySignalsNotFound) {
    failures += 1;
    console.error(`[FAIL] ${check.name}: unresolved route (NOT_FOUND) at ${url}`);
    continue;
  }

  if (!check.statuses.includes(response.status)) {
    failures += 1;
    console.error(
      `[FAIL] ${check.name}: status ${response.status} not in [${check.statuses.join(", "
      )}] at ${url}`
    );
    continue;
  }

  console.log(`[OK] ${check.name}: ${response.status}`);
}

if (failures > 0) {
  console.error(`\nAPI smoke check failed (${failures} issue${failures === 1 ? "" : "s"}).`);
  process.exit(1);
}

console.log("\nAPI smoke check passed.");
