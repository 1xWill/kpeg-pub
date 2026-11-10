import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";

describe("openDb", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("can open an existing database without applying schema writes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kpeg-indexer-db-"));
    cleanupDirs.push(dir);
    const sqlitePath = join(dir, "readonly-open.sqlite");

    const db = await openDb({
      mode: "sqlite",
      sqlitePath,
      libsqlUrl: undefined,
      libsqlAuthToken: undefined,
      applySchema: false
    });
    await db.close();

    const raw = new DatabaseSync(sqlitePath);
    const tables = raw.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kitties'`
    ).all();
    raw.close();
    expect(tables).toEqual([]);
  });

  it("rejects legacy breeding pool request columns and requires reset/reindex", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kpeg-indexer-db-"));
    cleanupDirs.push(dir);
    const sqlitePath = join(dir, "legacy.sqlite");

    const raw = new DatabaseSync(sqlitePath);
    raw.exec(`
      CREATE TABLE breeding_pools (
        pool_id INTEGER PRIMARY KEY,
        pool_type INTEGER,
        status TEXT NOT NULL,
        host TEXT,
        joiner TEXT,
        parent_a_kitty_id INTEGER,
        parent_b_kitty_id INTEGER,
        cycle_started_at INTEGER,
        cycle_days INTEGER,
        filter_count INTEGER,
        filter_groups_json TEXT,
        filter_traits_json TEXT,
        request_block INTEGER,
        request_seed TEXT,
        current_backing_provider TEXT,
        current_backing_kitty_id INTEGER,
        current_backing_side INTEGER,
        queued_backing_provider TEXT,
        queued_backing_kitty_id INTEGER,
        queued_backing_side INTEGER,
        last_result INTEGER,
        child_tier INTEGER,
        child_kitty_id INTEGER,
        child_owner TEXT,
        child_seed_salt TEXT,
        child_packed_traits TEXT,
        updated_block INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    raw.close();

    await expect(
      openDb({
        mode: "sqlite",
        sqlitePath,
        libsqlUrl: undefined,
        libsqlAuthToken: undefined
      })
    ).rejects.toThrow("Legacy breeding index schema detected");
  });

  it("migrates local sqlite files created before kPEG rarity columns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kpeg-indexer-db-"));
    cleanupDirs.push(dir);
    const sqlitePath = join(dir, "legacy-rarity.sqlite");

    const raw = new DatabaseSync(sqlitePath);
    raw.exec(`
      CREATE TABLE kitties (
        id INTEGER PRIMARY KEY,
        seed TEXT NOT NULL,
        tier INTEGER NOT NULL,
        tier_label TEXT NOT NULL,
        owner TEXT NOT NULL,
        minted_by TEXT NOT NULL,
        mint_batch_size INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        block_number INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        gas_used INTEGER,
        base_fee_wei TEXT,
        burned_at INTEGER,
        rarity_score REAL NOT NULL,
        traits_json TEXT NOT NULL,
        trait_odds_json TEXT NOT NULL,
        search_text TEXT NOT NULL
      );
    `);
    raw.close();

    const db = await openDb({
      mode: "sqlite",
      sqlitePath,
      libsqlUrl: undefined,
      libsqlAuthToken: undefined
    });

    const columns = await db.all<{ name: string }>(`PRAGMA table_info('kitties')`);
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["kpeg_rarity_pct", "kpeg_rarity_one_in_n"])
    );
    await db.close();
  });

  it("removes legacy uKIT rarity columns that block current inserts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kpeg-indexer-db-"));
    cleanupDirs.push(dir);
    const sqlitePath = join(dir, "legacy-ukit-rarity.sqlite");

    const raw = new DatabaseSync(sqlitePath);
    raw.exec(`
      CREATE TABLE kitties (
        id INTEGER PRIMARY KEY,
        seed TEXT NOT NULL,
        tier INTEGER NOT NULL,
        tier_label TEXT NOT NULL,
        owner TEXT NOT NULL,
        minted_by TEXT NOT NULL,
        mint_batch_size INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        block_number INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        gas_used INTEGER,
        base_fee_wei TEXT,
        burned_at INTEGER,
        rarity_score REAL NOT NULL,
        ukit_rarity_pct REAL NOT NULL,
        ukit_rarity_one_in_n REAL NOT NULL,
        traits_json TEXT NOT NULL,
        trait_odds_json TEXT NOT NULL,
        search_text TEXT NOT NULL
      );
    `);
    raw.close();

    const db = await openDb({
      mode: "sqlite",
      sqlitePath,
      libsqlUrl: undefined,
      libsqlAuthToken: undefined
    });

    const columns = await db.all<{ name: string }>(`PRAGMA table_info('kitties')`);
    const names = columns.map((column) => column.name);
    expect(names).toEqual(expect.arrayContaining(["kpeg_rarity_pct", "kpeg_rarity_one_in_n"]));
    expect(names).not.toContain("ukit_rarity_pct");
    expect(names).not.toContain("ukit_rarity_one_in_n");

    await db.run(
      `INSERT INTO kitties (
        id, seed, tier, tier_label, owner, minted_by, mint_batch_size, created_at, updated_at,
        block_number, tx_hash, gas_used, base_fee_wei, burned_at, rarity_score,
        kpeg_rarity_pct, kpeg_rarity_one_in_n, traits_json, trait_odds_json, search_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        1,
        `0x${"1".repeat(64)}`,
        0,
        "Common",
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000001",
        1,
        1,
        1,
        1,
        `0x${"2".repeat(64)}`,
        null,
        null,
        null,
        1,
        10,
        10,
        "{}",
        "{}",
        ""
      ]
    );
    await db.close();
  });

  it("migrates legacy market_listings columns to kitty_* names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kpeg-indexer-db-"));
    cleanupDirs.push(dir);
    const sqlitePath = join(dir, "legacy-market-columns.sqlite");

    const raw = new DatabaseSync(sqlitePath);
    raw.exec(`
      CREATE TABLE market_listings (
        trade_id INTEGER PRIMARY KEY,
        position_contract TEXT NOT NULL,
        seller TEXT NOT NULL,
        buyer TEXT,
        payment_token TEXT NOT NULL,
        price_wei TEXT NOT NULL,
        fee_bps INTEGER NOT NULL,
        cat_ids_json TEXT NOT NULL,
        cat_count INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_block INTEGER NOT NULL,
        created_tx_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        closed_block INTEGER,
        closed_tx_hash TEXT,
        closed_at INTEGER
      );
    `);
    raw.close();

    const db = await openDb({
      mode: "sqlite",
      sqlitePath,
      libsqlUrl: undefined,
      libsqlAuthToken: undefined
    });

    const columns = await db.all<{ name: string }>(`PRAGMA table_info('market_listings')`);
    const names = columns.map((column) => column.name);
    expect(names).toContain("escrow_address");
    expect(names).toContain("kitty_ids_json");
    expect(names).toContain("kitty_count");
    expect(names).not.toContain("position_contract");
    expect(names).not.toContain("cat_ids_json");
    expect(names).not.toContain("cat_count");
    await db.close();
  });

  it("deduplicates legacy replayed breeding events before creating tx/log unique index", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kpeg-indexer-db-"));
    cleanupDirs.push(dir);
    const sqlitePath = join(dir, "legacy-breeding-duplicates.sqlite");

    const raw = new DatabaseSync(sqlitePath);
    raw.exec(`
      CREATE TABLE breeding_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pool_id INTEGER NOT NULL,
        event_kind TEXT NOT NULL,
        result INTEGER,
        parent_a_kitty_id INTEGER,
        parent_b_kitty_id INTEGER,
        child_kitty_id INTEGER,
        tx_hash TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        log_index INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    raw.exec(`
      INSERT INTO breeding_events (
        pool_id, event_kind, result, parent_a_kitty_id, parent_b_kitty_id, child_kitty_id,
        tx_hash, block_number, log_index, payload_json, created_at
      ) VALUES
      (1, 'SETTLED', 0, NULL, NULL, 11, '0xabc', 100, 7, '{}', 1),
      (1, 'SETTLED', 0, NULL, NULL, 11, '0xabc', 100, 7, '{}', 2),
      (2, 'POOL_CREATED', NULL, NULL, NULL, NULL, '0xdef', 101, 9, '{}', 3);
    `);
    raw.close();

    const db = await openDb({
      mode: "sqlite",
      sqlitePath,
      libsqlUrl: undefined,
      libsqlAuthToken: undefined,
    });

    const duplicateRows = await db.all<{ value: number }>(
      `SELECT COUNT(*) AS value FROM breeding_events WHERE tx_hash = ? AND log_index = ?`,
      ["0xabc", 7]
    );
    expect(Number(duplicateRows[0]?.value ?? 0)).toBe(1);

    const indexes = await db.all<{ name: string }>(`PRAGMA index_list('breeding_events')`);
    expect(indexes.map((row) => row.name)).toContain("idx_breeding_events_tx_log");
    await db.close();
  });

  it("rebuilds aggregate stats from indexed market sales and token balances on stats schema upgrade", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kpeg-indexer-db-"));
    cleanupDirs.push(dir);
    const sqlitePath = join(dir, "legacy-market-stats.sqlite");

    const db = await openDb({
      mode: "sqlite",
      sqlitePath,
      libsqlUrl: undefined,
      libsqlAuthToken: undefined
    });
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
      `INSERT INTO market_sales (trade_id, seller, buyer, price_wei, fee_wei, sold_block, sold_tx_hash, sold_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        2,
        "0x0000000000000000000000000000000000000003",
        "0x0000000000000000000000000000000000000004",
        "500000000000000000",
        "0",
        11,
        `0x${"2".repeat(64)}`,
        11
      ]
    );
    await db.run(`UPDATE market_stats SET volume_wei = '0', updated_at = 0 WHERE id = 1`);
    await db.run(
      `INSERT INTO token_balances (address, balance_wei, ever_held)
       VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)`,
      [
        "0x00000000000000000000000000000000000000a1",
        "100",
        1,
        "0x00000000000000000000000000000000000000a2",
        "0",
        1,
        "0x00000000000000000000000000000000000000a3",
        "25",
        1
      ]
    );
    await db.run(`UPDATE global_stats SET holders_live = 99, holders_ever = 99 WHERE id = 1`);
    await db.run(`UPDATE aggregate_meta SET stats_schema_version = 0 WHERE id = 1`);
    await db.close();

    const reopened = await openDb({
      mode: "sqlite",
      sqlitePath,
      libsqlUrl: undefined,
      libsqlAuthToken: undefined
    });
    const marketStats = await reopened.get<{ volume_wei: string; updated_at: number }>(
      `SELECT volume_wei, updated_at FROM market_stats WHERE id = 1`
    );
    expect(marketStats).toMatchObject({
      volume_wei: "1500000000000000000"
    });
    expect(Number(marketStats?.updated_at ?? 0)).toBeGreaterThan(0);
    const globalStats = await reopened.get<{ holders_live: number; holders_ever: number }>(
      `SELECT holders_live, holders_ever FROM global_stats WHERE id = 1`
    );
    expect(globalStats).toMatchObject({
      holders_live: 2,
      holders_ever: 3
    });
    const aggregateMeta = await reopened.get<{ stats_schema_version: number }>(
      `SELECT stats_schema_version FROM aggregate_meta WHERE id = 1`
    );
    expect(Number(aggregateMeta?.stats_schema_version ?? 0)).toBeGreaterThanOrEqual(5);
    await reopened.close();
  });
});
