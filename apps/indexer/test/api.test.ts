import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { KPEGRepository } from "../src/repository.js";
import { buildServer } from "../src/server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("indexer api", () => {
  let app: ReturnType<typeof buildServer>;
  let closeDb: () => Promise<void>;
  let db: Awaited<ReturnType<typeof openDb>>;
  let repo: KPEGRepository;

  beforeEach(async () => {
    db = await openDb({
      mode: "sqlite",
      sqlitePath: ":memory:",
      libsqlUrl: undefined,
      libsqlAuthToken: undefined
    });
    closeDb = () => db.close();
    repo = new KPEGRepository(db);
    app = buildServer(repo);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await closeDb();
  });

  it("exposes health and base config", async () => {
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });

    const config = await app.inject({ method: "GET", url: "/api/config" });
    expect(config.statusCode).toBe(200);
    const payload = config.json() as { fixedTokenSupply: number };
    expect(payload.fixedTokenSupply).toBe(9_999);
  });

  it("answers browser CORS preflight requests", async () => {
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/stats",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET"
      }
    });

    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("*");
    expect(preflight.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("emits edge cache headers for hot public GET endpoints", async () => {
    const status = await app.inject({ method: "GET", url: "/api/status" });
    expect(status.statusCode).toBe(200);
    expect(status.headers["cache-control"]).toContain("s-maxage=10");

    const stats = await app.inject({ method: "GET", url: "/api/stats" });
    expect(stats.statusCode).toBe(200);
    expect(stats.headers["cache-control"]).toContain("s-maxage=30");
    expect(stats.headers["cdn-cache-control"]).toContain("s-maxage=30");
    expect(stats.headers["vercel-cdn-cache-control"]).toContain("s-maxage=30");

    const global = await app.inject({
      method: "GET",
      url: "/api/kitties/global?page=0&pageSize=24&sort=latest",
    });
    expect(global.statusCode).toBe(200);
    expect(global.headers["cache-control"]).toContain("s-maxage=30");
    expect(global.headers["cdn-cache-control"]).toContain("s-maxage=30");
    expect(global.headers["vercel-cdn-cache-control"]).toContain("s-maxage=30");

    const market = await app.inject({
      method: "GET",
      url: "/api/market/listings?tab=all&sort=latest&page=0&pageSize=24&offset=0",
    });
    expect(market.statusCode).toBe(200);
    expect(market.headers["cache-control"]).toContain("s-maxage=15");
    expect(market.headers["cdn-cache-control"]).toContain("s-maxage=15");
    expect(market.headers["vercel-cdn-cache-control"]).toContain("s-maxage=15");
  });

  it("returns extended sync status fields from /api/status when provided by runtime", async () => {
    const now = Date.now();
    const statusApp = buildServer(repo, undefined, {
      getStatus: async () => ({
        latestIndexedBlock: 100,
        tokenBalanceIndexedBlock: 120,
        headBlock: 150,
        blocksBehind: 50,
        caughtUp: false,
        syncing: true,
        maxKittyId: 6_900,
        dbLiveKitties: 6_850,
        onchainKittiesEverMinted: 7_000,
        onchainKittiesLive: 6_900,
        kittyIndexedBehind: 100,
        lastSyncSuccessAtMs: now - 1_000,
        lastSyncFailedAtMs: now,
        lastSyncPhase: "main-event-ingest",
        lastSyncFromBlock: 99,
        lastSyncToBlock: 100,
        lastSyncEventKind: "breeding-lineage",
        lastSyncTxHash: `0x${"1".repeat(64)}`,
        lastSyncLogIndex: 4,
        lastSyncError: "synthetic failure"
      })
    });
    await statusApp.ready();
    try {
      const response = await statusApp.inject({ method: "GET", url: "/api/status" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        latestIndexedBlock: 100,
        tokenBalanceIndexedBlock: 120,
        headBlock: 150,
        blocksBehind: 50,
        caughtUp: false,
        syncing: true,
        maxKittyId: 6_900,
        dbLiveKitties: 6_850,
        onchainKittiesEverMinted: 7_000,
        onchainKittiesLive: 6_900,
        kittyIndexedBehind: 100,
        lastSyncSuccessAtMs: now - 1_000,
        lastSyncFailedAtMs: now,
        lastSyncPhase: "main-event-ingest",
        lastSyncFromBlock: 99,
        lastSyncToBlock: 100,
        lastSyncEventKind: "breeding-lineage",
        lastSyncTxHash: `0x${"1".repeat(64)}`,
        lastSyncLogIndex: 4,
        lastSyncError: "synthetic failure"
      });
    } finally {
      await statusApp.close();
    }
  });

  it("does not expose breeding API endpoints on main", async () => {
    const owner = "0x0000000000000000000000000000000000000001";
    const stats = await app.inject({ method: "GET", url: "/api/breeding/stats" });
    const pools = await app.inject({ method: "GET", url: "/api/breeding/pools?page=0&pageSize=10&status=ALL" });
    const claims = await app.inject({ method: "GET", url: `/api/breeding/claims/${owner}?page=0&pageSize=10` });
    const events = await app.inject({ method: "GET", url: "/api/breeding/events?limit=5" });
    expect(stats.statusCode).toBe(404);
    expect(pools.statusCode).toBe(404);
    expect(claims.statusCode).toBe(404);
    expect(events.statusCode).toBe(404);
  });

  it("applies BornKPEGMinted trait overrides to indexed kitty traits", async () => {
    const owner = "0x00000000000000000000000000000000000000a1";
    await repo.ingestMintEvents([
      {
        kittyId: 1,
        owner,
        mintedBy: owner,
        tier: 0,
        batchSizeWhole: 1,
        seed: `0x${"1".repeat(64)}`,
        blockNumber: 100,
        txHash: `0x${"2".repeat(64)}`
      }
    ]);

    await repo.applyBornMintTraits({
      kittyId: 1,
      blockNumber: 100,
      txHash: `0x${"2".repeat(64)}`,
      traits: {
        background: "Midnight",
        breed: "Alien Cat",
        clothes: "Wizard Hat",
        mood: "Moonlit",
        marks: "Tiny Scar",
        mouth: "Tiny Fang",
        eyes: "Glassy Eyes",
        accessory: "Magic Wand"
      }
    });

    const detail = await app.inject({ method: "GET", url: "/api/kitties/1" });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: 1,
      traits: {
        background: "Midnight",
        breed: "Alien Cat",
        clothes: "Wizard Hat",
        mood: "Moonlit",
        marks: "Tiny Scar",
        mouth: "Tiny Fang",
        eyes: "Glassy Eyes",
        accessory: "Magic Wand"
      }
    });
  });

  it("requires a secret for cron sync and accepts tx-hash sync requests", async () => {
    const calls: unknown[] = [];
    const syncApp = buildServer(
      repo,
      { chainId: 31337, tokenAddress: null, marketAddress: null, routerAddress: null, quoterAddress: null },
      {
        syncSecret: "secret",
        runSync: async (input) => {
          calls.push(input);
          return { ok: true, skipped: false, latestIndexedBlock: 123 };
        }
      }
    );

    const cronWithoutSecret = await syncApp.inject({ method: "GET", url: "/api/sync" });
    expect(cronWithoutSecret.statusCode).toBe(401);

    const cronWithSecret = await syncApp.inject({
      method: "GET",
      url: "/api/sync",
      headers: { authorization: "Bearer secret" }
    });
    expect(cronWithSecret.statusCode).toBe(200);
    expect(calls.at(-1)).toEqual({ authorizedBySecret: true, txHash: undefined });

    const txHash = `0x${"1".repeat(64)}` as const;
    const txTriggered = await syncApp.inject({
      method: "POST",
      url: "/api/sync",
      payload: { txHash }
    });
    expect(txTriggered.statusCode).toBe(200);
    expect(calls.at(-1)).toEqual({ authorizedBySecret: false, txHash });

    await syncApp.close();
  });

  it("lets runtime repair owner stats from onchain fallback", async () => {
    const owner = "0x0000000000000000000000000000000000000001";
    const repairedApp = buildServer(
      repo,
      { chainId: 31337, tokenAddress: null, marketAddress: null, routerAddress: null, quoterAddress: null },
      {
        repairOwnerStats: async (_owner, indexed) => ({
          currentKitties: indexed.currentKitties,
          everKitties: 90
        })
      }
    );
    await repairedApp.ready();

    const response = await repairedApp.inject({
      method: "GET",
      url: `/api/kitties/owner/${owner}/stats`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ currentKitties: 0, everKitties: 90 });
    await repairedApp.close();
  });

  it("lets runtime repair owner kitty pages from onchain fallback", async () => {
    const owner = "0x0000000000000000000000000000000000000001";
    const repairedApp = buildServer(
      repo,
      { chainId: 31337, tokenAddress: null, marketAddress: null, routerAddress: null, quoterAddress: null },
      {
        repairOwnerKitties: async (_owner, _input, indexed) => ({
          ...indexed,
          total: 1,
          items: [
            {
              id: 51,
              seed: "0x1",
              tier: 1,
              tierLabel: "Uncommon",
              mintTier: 1,
              mintTierLabel: "Uncommon",
              owner,
              mintedBy: owner,
              mintBatchSize: 1,
              mintedAt: 0,
              blockNumber: 0,
              txHash: `0x${"0".repeat(64)}`,
              gasUsed: null,
              baseFeeWei: null,
              rarityScore: 1,
              traits: {
                background: "Sky",
                breed: "Persian",
                clothes: "None",
                mood: "None",
                marks: "None",
                mouth: "Stoic",
                eyes: "Happy ^_^",
                accessory: "None"
              },
              traitOdds: {},
              kpegRarity: {
                label: "RARITY",
                percentage: 1,
                oneInN: 1,
                basis: "Rarity Probability"
              }
            }
          ]
        })
      }
    );
    await repairedApp.ready();

    const response = await repairedApp.inject({
      method: "GET",
      url: `/api/kitties/owner/${owner}?page=0&pageSize=100&sort=latest`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((item: { id: number }) => item.id)).toEqual([51]);
    await repairedApp.close();
  });

  it("lets runtime repair empty market tabs from onchain fallback", async () => {
    const repairedApp = buildServer(
      repo,
      { chainId: 31337, tokenAddress: null, marketAddress: null, routerAddress: null, quoterAddress: null },
      {
        repairMarketListings: async (_input, indexed) => ({
          ...indexed,
          total: 1,
          items: [
            {
              tradeId: 7,
              escrowAddress: "0x0000000000000000000000000000000000000007",
              seller: "0x0000000000000000000000000000000000000001",
              buyer: null,
              paymentToken: "0x0000000000000000000000000000000000000000",
              priceWei: "1000000000000000000",
              feeBps: 200,
              kittyIds: [1, 2, 3],
              kittyCount: 3,
              status: "OPEN",
              createdBlock: 0,
              createdTxHash: `0x${"0".repeat(64)}`,
              createdAt: 0,
              updatedAt: 0,
              closedBlock: null,
              closedTxHash: null,
              closedAt: null,
              kitties: []
            }
          ]
        })
      }
    );
    await repairedApp.ready();

    const response = await repairedApp.inject({
      method: "GET",
      url: "/api/market/listings?page=0&pageSize=10&tab=all"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ total: 1, items: [{ tradeId: 7, kittyCount: 3, status: "OPEN" }] });
    await repairedApp.close();
  });

  it("lets runtime repair global kitty pages from onchain fallback", async () => {
    const owner = "0x0000000000000000000000000000000000000001";
    const repairedApp = buildServer(
      repo,
      { chainId: 31337, tokenAddress: null, marketAddress: null, routerAddress: null, quoterAddress: null },
      {
        repairGlobalKitties: async (_input, indexed) => ({
          ...indexed,
          total: 1,
          items: [
            {
              id: 120,
              seed: "0x1",
              tier: 1,
              tierLabel: "Uncommon",
              mintTier: 1,
              mintTierLabel: "Uncommon",
              owner,
              mintedBy: owner,
              mintBatchSize: 1,
              mintedAt: 0,
              blockNumber: 0,
              txHash: `0x${"0".repeat(64)}`,
              gasUsed: null,
              baseFeeWei: null,
              rarityScore: 1,
              traits: {
                background: "Sky",
                breed: "Persian",
                clothes: "None",
                mood: "None",
                marks: "None",
                mouth: "Stoic",
                eyes: "Happy ^_^",
                accessory: "None"
              },
              traitOdds: {},
              kpegRarity: {
                label: "RARITY",
                percentage: 1,
                oneInN: 1,
                basis: "Rarity Probability"
              }
            }
          ]
        })
      }
    );
    await repairedApp.ready();

    const response = await repairedApp.inject({
      method: "GET",
      url: "/api/kitties/global?page=0&pageSize=25&sort=latest"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 1,
      items: [{ id: 120 }]
    });
    await repairedApp.close();
  });

  it("lets runtime repair missing kitty detail rows from onchain fallback", async () => {
    const owner = "0x0000000000000000000000000000000000000001";
    const repairedApp = buildServer(
      repo,
      { chainId: 31337, tokenAddress: null, marketAddress: null, routerAddress: null, quoterAddress: null },
      {
        repairKittyById: async (id, indexed) =>
          indexed ?? {
            id,
            seed: "0x1",
            tier: 1,
            tierLabel: "Uncommon",
            mintTier: 1,
            mintTierLabel: "Uncommon",
            owner,
            mintedBy: owner,
            mintBatchSize: 1,
            mintedAt: 0,
            blockNumber: 0,
            txHash: `0x${"0".repeat(64)}`,
            gasUsed: null,
            baseFeeWei: null,
            rarityScore: 1,
            traits: {
              background: "Sky",
              breed: "Persian",
              clothes: "None",
              mood: "None",
              marks: "None",
              mouth: "Stoic",
              eyes: "Happy ^_^",
              accessory: "None"
            },
            traitOdds: {},
            kpegRarity: {
              label: "RARITY",
              percentage: 1,
              oneInN: 1,
              basis: "Rarity Probability"
            }
          }
      }
    );
    await repairedApp.ready();

    const response = await repairedApp.inject({
      method: "GET",
      url: "/api/kitties/999"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 999, owner });
    await repairedApp.close();
  });

  it("uses detail repair for owner metadata lookups when DB rows are missing", async () => {
    const owner = "0x0000000000000000000000000000000000000062";
    const repairedApp = buildServer(
      repo,
      { chainId: 31337, tokenAddress: null, marketAddress: null, routerAddress: null, quoterAddress: null },
      {
        repairKittyById: async (id, indexed) =>
          indexed ?? {
            id,
            seed: "0x62",
            tier: 0,
            tierLabel: "Common",
            mintTier: 0,
            mintTierLabel: "Common",
            owner,
            mintedBy: owner,
            mintBatchSize: 1,
            mintedAt: 0,
            blockNumber: 0,
            txHash: `0x${"0".repeat(64)}`,
            gasUsed: null,
            baseFeeWei: null,
            rarityScore: 1,
            traits: {
              background: "Sky",
              breed: "Persian",
              clothes: "None",
              mood: "None",
              marks: "None",
              mouth: "Stoic",
              eyes: "Happy ^_^",
              accessory: "None"
            },
            traitOdds: {},
            kpegRarity: {
              label: "RARITY",
              percentage: 1,
              oneInN: 1,
              basis: "Rarity Probability"
            }
          }
      }
    );
    await repairedApp.ready();

    const ownerPage = await repairedApp.inject({
      method: "GET",
      url: `/api/kitties/owner/${owner}?page=0&pageSize=100&sort=latest`
    });
    const detail = await repairedApp.inject({ method: "GET", url: "/api/kitties/62" });

    expect(ownerPage.statusCode).toBe(200);
    expect(ownerPage.json()).toMatchObject({ total: 0, items: [] });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: 62, owner });
    await repairedApp.close();
  });

  it("lets runtime repair market stats from onchain fallback", async () => {
    const repairedApp = buildServer(
      repo,
      { chainId: 31337, tokenAddress: null, marketAddress: null, routerAddress: null, quoterAddress: null },
      {
        repairMarketStats: async (indexed) => ({
          ...indexed,
          listed: 3,
          floorWei: "500000000000000000",
          volumeWei: "1000000000000000000"
        })
      }
    );
    await repairedApp.ready();

    const response = await repairedApp.inject({
      method: "GET",
      url: "/api/market/stats"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      listed: 3,
      floorWei: "500000000000000000",
      volumeWei: "1000000000000000000"
    });
    await repairedApp.close();
  });

  it("reads market volume from the market_stats aggregate row", async () => {
    await db.run(
      `INSERT INTO market_sales (trade_id, seller, buyer, price_wei, fee_wei, sold_block, sold_tx_hash, sold_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        1,
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002",
        "1000000000000000000",
        "0",
        10,
        `0x${"1".repeat(64)}`,
        10
      ]
    );
    await db.run(
      `UPDATE market_stats SET volume_wei = ?, updated_at = ? WHERE id = 1`,
      ["3000000000000000000", Date.now()]
    );

    await expect(repo.getMarketStats()).resolves.toMatchObject({
      volumeWei: "3000000000000000000"
    });
  });

  it("reads owner stats from owner_stats aggregates", async () => {
    const owner = "0x0000000000000000000000000000000000000abc";
    await db.run(
      `INSERT INTO owner_stats (owner, current_kitties, ever_kitties)
       VALUES (?, ?, ?)`,
      [owner, 2, 9]
    );

    await expect(repo.ownerStats(owner)).resolves.toEqual({
      currentKitties: 2,
      everKitties: 9
    });
  });

  it("mints kitties and keeps holders on the ERC20 transfer index", async () => {
    const owner = "0x0000000000000000000000000000000000000001";

    await repo.mintKitties({ owner, wholeBought: 3 });

    const statsAfterMint = await app.inject({ method: "GET", url: "/api/stats" });
    expect(statsAfterMint.statusCode).toBe(200);
    expect(statsAfterMint.json()).toMatchObject({
      tokenSupplyFixed: 9_999,
      kittiesLive: 3,
      kittiesEverMinted: 3,
      holdersLive: 0
    });

    await repo.burnFromOwner({ owner, count: 2 });

    const statsAfterBurn = await app.inject({ method: "GET", url: "/api/stats" });
    expect(statsAfterBurn.statusCode).toBe(200);
    expect(statsAfterBurn.json()).toMatchObject({
      kittiesLive: 1,
      kittiesEverMinted: 3
    });
  });

  it("uses indexed ERC20 balances for token holder stats when transfer events are available", async () => {
    const deployer = "0x0000000000000000000000000000000000000001";
    const buyer = "0x0000000000000000000000000000000000000002";
    const pool = "0x0000000000000000000000000000000000000003";

    await repo.ingestTokenTransferEvents([
      {
        from: "0x0000000000000000000000000000000000000000",
        to: deployer,
        amountWei: "9999000000000000000000",
        blockNumber: 1,
      },
      {
        from: deployer,
        to: pool,
        amountWei: "9000000000000000000000",
        blockNumber: 2,
      },
      {
        from: pool,
        to: buyer,
        amountWei: "1000000000000000000",
        blockNumber: 3,
      },
    ]);

    const stats = await app.inject({ method: "GET", url: "/api/stats" });
    expect(stats.statusCode).toBe(200);
    expect(stats.json()).toMatchObject({
      holdersLive: 3,
      holdersEver: 3,
    });
  });

  it("prefers global_stats holder aggregates over token balance row scans", async () => {
    await db.run(
      `UPDATE global_stats SET kitties_live = ?, kitties_ever_minted = ?, holders_live = ?, holders_ever = ? WHERE id = 1`,
      [9, 9, 7, 8]
    );
    await db.run(
      `INSERT INTO token_balances (address, balance_wei, ever_held) VALUES (?, ?, ?), (?, ?, ?)`,
      [
        "0x00000000000000000000000000000000000000aa",
        "0",
        0,
        "0x00000000000000000000000000000000000000bb",
        "1",
        1,
      ]
    );

    const stats = await app.inject({ method: "GET", url: "/api/stats" });
    expect(stats.statusCode).toBe(200);
    expect(stats.json()).toMatchObject({
      holdersLive: 7,
      holdersEver: 8,
    });
  });

  it("resets indexed kitties when the configured chain token changes", async () => {
    const owner = "0x0000000000000000000000000000000000000001";

    expect(
      await repo.ensureChainIdentity({
        chainId: 84532,
        tokenAddress: "0x00000000000000000000000000000000000000a1"
      })
    ).toEqual({ reset: false });
    await repo.mintKitties({ owner, wholeBought: 20, blockNumber: 100 });
    expect(await repo.getStats()).toMatchObject({ kittiesLive: 20, kittiesEverMinted: 20, latestIndexedBlock: 100 });

    expect(
      await repo.ensureChainIdentity({
        chainId: 84532,
        tokenAddress: "0x00000000000000000000000000000000000000b2"
      })
    ).toEqual({ reset: true });

    expect(await repo.getStats()).toMatchObject({ kittiesLive: 0, kittiesEverMinted: 0, latestIndexedBlock: 0 });
  });

  it("supports search by kitty id, holder, and trait text", async () => {
    const owner = "0x0000000000000000000000000000000000000aaa";
    await repo.mintKitties({ owner, wholeBought: 2 });

    const global = await app.inject({
      method: "GET",
      url: "/api/kitties/global?page=0&pageSize=10&sort=latest"
    });
    expect(global.statusCode).toBe(200);
    const globalPayload = global.json() as { items: Array<{ id: number; traits: { breed: string } }> };
    expect(globalPayload.items.length).toBeGreaterThan(0);
    const first = globalPayload.items[0];
    if (!first) {
      throw new Error("expected at least one kitty");
    }

    const byId = await app.inject({
      method: "GET",
      url: `/api/kitties/search?q=%23${first.id}&scope=explore&page=0&pageSize=10`
    });
    expect(byId.statusCode).toBe(200);
    expect((byId.json() as { type: string; total: number }).type).toBe("kitty");

    const byOwner = await app.inject({
      method: "GET",
      url: `/api/kitties/search?q=${owner}&scope=explore&page=0&pageSize=10`
    });
    expect(byOwner.statusCode).toBe(200);
    expect((byOwner.json() as { type: string }).type).toBe("holder");

    const byTrait = await app.inject({
      method: "GET",
      url: `/api/kitties/search?q=${encodeURIComponent(first.traits.breed)}&scope=explore&page=0&pageSize=10`
    });
    expect(byTrait.statusCode).toBe(200);
    expect((byTrait.json() as { type: string }).type).toBe("traitResults");
  });

  it("keeps owner-scoped numeric and address search limited to live owned kitties", async () => {
    const ownerA = "0x0000000000000000000000000000000000000aaa";
    const ownerB = "0x0000000000000000000000000000000000000bbb";

    await repo.mintKitties({ owner: ownerA, wholeBought: 1 });
    await repo.mintKitties({ owner: ownerB, wholeBought: 1 });
    await repo.burnFromOwner({ owner: ownerA, count: 1 });

    const wrongOwner = await app.inject({
      method: "GET",
      url: `/api/kitties/search?q=2&scope=my-collections&owner=${ownerA}`
    });
    expect(wrongOwner.statusCode).toBe(200);
    expect(wrongOwner.json()).toMatchObject({ total: 0, items: [] });

    const burned = await app.inject({
      method: "GET",
      url: "/api/kitties/search?q=1&scope=explore"
    });
    expect(burned.statusCode).toBe(200);
    expect(burned.json()).toMatchObject({ total: 0, items: [] });

    const foreignAddress = await app.inject({
      method: "GET",
      url: `/api/kitties/search?q=${ownerB}&scope=my-collections&owner=${ownerA}`
    });
    expect(foreignAddress.statusCode).toBe(200);
    expect(foreignAddress.json()).toMatchObject({ total: 0, items: [] });
  });

  it("respects offset-based pagination for kitty listings", async () => {
    const owner = "0x0000000000000000000000000000000000000aaa";
    await repo.mintKitties({ owner, wholeBought: 6 });

    const first = await app.inject({
      method: "GET",
      url: "/api/kitties/global?page=0&pageSize=2&offset=0&sort=latest"
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/kitties/global?page=1&pageSize=2&offset=2&sort=latest"
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const firstIds = (first.json() as { items: Array<{ id: number }> }).items.map((item) => item.id);
    const secondIds = (second.json() as { items: Array<{ id: number }> }).items.map((item) => item.id);

    expect(firstIds).toHaveLength(2);
    expect(secondIds).toHaveLength(2);
    expect(firstIds[0]).not.toBe(secondIds[0]);
  });

  it("returns detail payload with TRAIT RARITY and RARITY data", async () => {
    const owner = "0x0000000000000000000000000000000000000bbb";
    const minted = await repo.mintKitties({ owner, wholeBought: 1 });
    const id = minted.mintedIds[0];

    const detail = await app.inject({ method: "GET", url: `/api/kitties/${id}` });
    expect(detail.statusCode).toBe(200);
    const payload = detail.json() as {
      traitOdds: Record<string, { probabilityPct: number }>;
      kpegRarity: { label: string; basis: string; percentage: number };
      born: { way: string; parentIds: number[] };
    };
    expect(payload.kpegRarity.label).toBe("RARITY");
    expect(payload.kpegRarity.basis).toBe("Rarity Probability");
    expect(payload.kpegRarity.percentage).toBeGreaterThan(0);
    expect(Object.keys(payload.traitOdds).length).toBe(8);
    expect(payload.traitOdds.background?.probabilityPct ?? 0).toBeGreaterThan(0);
    expect(payload.traitOdds.breed?.probabilityPct ?? 0).toBeGreaterThan(0);
    expect(payload.traitOdds.mood?.probabilityPct ?? 0).toBeGreaterThan(0);
    expect(payload.traitOdds.marks?.probabilityPct ?? 0).toBeGreaterThan(0);
    expect(payload.born.way).toBe("BUY");
    expect(payload.born.parentIds).toEqual([]);
  });

  it("keeps list payload compact while detail endpoint stays complete", async () => {
    const owner = "0x0000000000000000000000000000000000000abc";
    await repo.mintKitties({ owner, wholeBought: 1 });

    const list = await app.inject({
      method: "GET",
      url: "/api/kitties/global?page=0&pageSize=10&sort=latest"
    });
    expect(list.statusCode).toBe(200);
    const listItem = (list.json() as { items: Array<Record<string, unknown>> }).items[0];
    if (!listItem) {
      throw new Error("expected at least one kitty in list payload");
    }
    expect(listItem).not.toHaveProperty("traitOdds");
    expect(listItem).not.toHaveProperty("txHash");
    expect(listItem).not.toHaveProperty("gasUsed");
    expect(listItem).not.toHaveProperty("baseFeeWei");

    const detail = await app.inject({
      method: "GET",
      url: `/api/kitties/${listItem.id as number}`
    });
    expect(detail.statusCode).toBe(200);
    const detailPayload = detail.json() as {
      txHash: string;
      traitOdds: Record<string, unknown>;
    };
    expect(detailPayload.txHash.startsWith("0x")).toBe(true);
    expect(Object.keys(detailPayload.traitOdds).length).toBe(8);
  });

  it("moves ownership with direct transfer", async () => {
    const from = "0x0000000000000000000000000000000000000ccc";
    const to = "0x0000000000000000000000000000000000000ddd";

    const minted = await repo.mintKitties({ owner: from, wholeBought: 1 });
    const id = minted.mintedIds[0];
    await repo.transferKitty({ kittyId: id, to });

    const fromKitties = await app.inject({
      method: "GET",
      url: `/api/kitties/owner/${from}?page=0&pageSize=10&sort=latest`
    });
    expect((fromKitties.json() as { total: number }).total).toBe(0);

    const toKitties = await app.inject({
      method: "GET",
      url: `/api/kitties/owner/${to}?page=0&pageSize=10&sort=latest`
    });
    expect((toKitties.json() as { total: number }).total).toBe(1);

    const fromStats = await app.inject({
      method: "GET",
      url: `/api/kitties/owner/${from}/stats`
    });
    expect(fromStats.json()).toMatchObject({ currentKitties: 0, everKitties: 1 });

    const toStats = await app.inject({
      method: "GET",
      url: `/api/kitties/owner/${to}/stats`
    });
    expect(toStats.json()).toMatchObject({ currentKitties: 1, everKitties: 1 });
  });

  it("tracks atomic market listings, floor, sale, and owner tabs", async () => {
    const seller = "0x0000000000000000000000000000000000000e11";
    const buyer = "0x0000000000000000000000000000000000000b0b";
    const position = "0x0000000000000000000000000000000000000f00";
    const minted = await repo.mintKitties({ owner: seller, wholeBought: 2, blockNumber: 10 });

    await repo.ingestMarketPositionCreated({
      tradeId: 1,
      seller,
      escrowAddress: position,
      paymentToken: "0x0000000000000000000000000000000000000000",
      priceWei: "1000000000000000000",
      feeBps: 200,
      kittyIds: minted.mintedIds,
      blockNumber: 11,
      txHash: "0x1111111111111111111111111111111111111111111111111111111111111111"
    });

    await repo.ingestMoveEvent({ kittyId: minted.mintedIds[0], from: seller, to: position, blockNumber: 12 });
    await repo.ingestMoveEvent({ kittyId: minted.mintedIds[1], from: seller, to: position, blockNumber: 13 });
    const sellerOpen = await app.inject({
      method: "GET",
      url: `/api/market/listings?page=0&pageSize=10&tab=my-listings&owner=${seller}`
    });
    expect((sellerOpen.json() as { total: number; items: Array<{ escrowAddress: string; status: string }> }).items[0]).toMatchObject({
      escrowAddress: position,
      status: "OPEN"
    });
    expect(await repo.getMarketStats()).toMatchObject({
      listed: 1,
      floorWei: "1000000000000000000"
    });

    const batchPosition = "0x0000000000000000000000000000000000000f01";
    const batchMinted = await repo.mintKitties({ owner: seller, wholeBought: 3, blockNumber: 15 });
    await repo.ingestMarketPositionCreated({
      tradeId: 2,
      seller,
      escrowAddress: batchPosition,
      paymentToken: "0x0000000000000000000000000000000000000000",
      priceWei: "2000000000000000000",
      feeBps: 200,
      kittyIds: batchMinted.mintedIds,
      blockNumber: 16,
      txHash: "0x3333333333333333333333333333333333333333333333333333333333333333"
    });
    expect((await repo.getMarketStats()).listed).toBe(2);
    await repo.ingestMoveRange({
      startKittyId: batchMinted.mintedIds[0],
      count: batchMinted.mintedIds.length,
      from: seller,
      to: batchPosition,
      blockNumber: 17
    });
    expect((await repo.getMarketStats()).listed).toBe(2);

    const open = await app.inject({ method: "GET", url: "/api/market/listings?page=0&pageSize=10&tab=all" });
    expect(open.statusCode).toBe(200);
    expect((open.json() as { total: number }).total).toBe(2);
    expect((open.json() as { items: Array<{ tradeId: number; kittyCount: number }> }).items.find((item) => item.tradeId === 1)?.kittyCount).toBe(2);
    const openBody = open.json() as {
      items: Array<{
        tradeId: number;
        kitties: Array<{
          traits: Record<string, string>;
          traitOdds?: Record<string, unknown>;
        }>;
      }>;
    };
    const firstListingKitty = openBody.items.find((item) => item.tradeId === 1)?.kitties[0];
    expect(firstListingKitty?.traitOdds).toBeUndefined();
    const firstKittyTraits = openBody.items.find((item) => item.tradeId === 1)?.kitties[0]?.traits;
    const uniqueKittyQuery = firstKittyTraits ? Object.values(firstKittyTraits).join(" ") : "";
    const searched = await app.inject({
      method: "GET",
      url: `/api/market/listings?page=0&pageSize=10&tab=all&q=${encodeURIComponent(uniqueKittyQuery)}`
    });
    expect((searched.json() as { total: number }).total).toBe(1);

    await repo.ingestMarketPositionBought({
      tradeId: 1,
      seller,
      buyer,
      priceWei: "1000000000000000000",
      feeWei: "20000000000000000",
      blockNumber: 14,
      txHash: "0x2222222222222222222222222222222222222222222222222222222222222222"
    });
    expect(await repo.getMarketStats()).toMatchObject({
      listed: 1,
      volumeWei: "1000000000000000000"
    });
    await repo.ingestMarketPositionBought({
      tradeId: 1,
      seller,
      buyer,
      priceWei: "1000000000000000000",
      feeWei: "20000000000000000",
      blockNumber: 15,
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });
    expect(await repo.getMarketStats()).toMatchObject({
      listed: 1,
      volumeWei: "1000000000000000000"
    });
    await repo.ingestMarketPositionBought({
      tradeId: 1,
      seller,
      buyer,
      priceWei: "1500000000000000000",
      feeWei: "30000000000000000",
      blockNumber: 16,
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    });
    expect(await repo.getMarketStats()).toMatchObject({
      listed: 1,
      volumeWei: "1500000000000000000"
    });

    const bought = await app.inject({ method: "GET", url: `/api/market/listings?page=0&pageSize=10&tab=bought&owner=${buyer}` });
    expect((bought.json() as { total: number }).total).toBe(1);
  });

});

describe("indexer sqlite path", () => {
  it("resolves relative sqlite paths from the configured base path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kpeg-db-path-"));
    const dbName = `relative-${Date.now()}.sqlite`;
    const db = await openDb({
      mode: "sqlite",
      sqlitePath: `./${dbName}`,
      sqliteBasePath: dir,
      libsqlUrl: undefined,
      libsqlAuthToken: undefined
    });

    await db.close();
    expect(existsSync(join(dir, dbName))).toBe(true);
    expect(existsSync(join(process.cwd(), dbName))).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});
