import { createClient as createLibsqlClient, type Row } from "@libsql/client";
import { isAbsolute, resolve } from "node:path";

type DbPrimitive = string | number | bigint | Uint8Array | null;
type SQLInputValue = string | number | bigint | Uint8Array | null;

export interface DbAdapter {
  mode: "sqlite" | "libsql";
  exec(sql: string): Promise<void>;
  run(sql: string, params?: DbPrimitive[]): Promise<{ lastInsertRowid?: number; rowsAffected?: number }>;
  get<T extends Record<string, unknown>>(sql: string, params?: DbPrimitive[]): Promise<T | undefined>;
  all<T extends Record<string, unknown>>(sql: string, params?: DbPrimitive[]): Promise<T[]>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type OpenDbOptions = {
  mode: "sqlite" | "libsql";
  sqlitePath: string | undefined;
  sqliteBasePath?: string;
  libsqlUrl: string | undefined;
  libsqlAuthToken: string | undefined;
  applySchema?: boolean;
};

class NodeSqliteAdapter implements DbAdapter {
  mode: "sqlite" = "sqlite";
  constructor(private readonly db: {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: SQLInputValue[]): { lastInsertRowid?: number | bigint; changes?: number | bigint };
      get(...params: SQLInputValue[]): unknown;
      all(...params: SQLInputValue[]): unknown[];
    };
    close(): void;
  }) {}

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async run(sql: string, params: DbPrimitive[] = []): Promise<{ lastInsertRowid?: number; rowsAffected?: number }> {
    const statement = this.db.prepare(sql);
    const result = statement.run(...(params as SQLInputValue[])) as { lastInsertRowid?: number | bigint };
    const rowsAffected = "changes" in result && result.changes !== undefined ? Number(result.changes) : undefined;
    const output = rowsAffected === undefined ? {} : { rowsAffected };
    if (result.lastInsertRowid !== undefined) {
      return { ...output, lastInsertRowid: Number(result.lastInsertRowid) };
    }
    return output;
  }

  async get<T extends Record<string, unknown>>(sql: string, params: DbPrimitive[] = []): Promise<T | undefined> {
    const row = this.db.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined;
    return row;
  }

  async all<T extends Record<string, unknown>>(sql: string, params: DbPrimitive[] = []): Promise<T[]> {
    const rows = this.db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
    return rows;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const value = await fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the original query error when transaction state already closed.
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class LibsqlAdapter implements DbAdapter {
  mode: "libsql" = "libsql";
  private activeTx:
    | (Awaited<ReturnType<ReturnType<typeof createLibsqlClient>["transaction"]>> & {
        close?: () => void;
      })
    | null = null;
  private txDepth = 0;

  constructor(
    private readonly client: ReturnType<typeof createLibsqlClient>
  ) {}

  async exec(sql: string): Promise<void> {
    await this.executeStatement(sql);
  }

  async run(sql: string, params: DbPrimitive[] = []): Promise<{ lastInsertRowid?: number; rowsAffected?: number }> {
    const result = await this.executeStatement(sql, params);
    const rowsAffected = Number(result.rowsAffected ?? 0);
    if (result.lastInsertRowid !== undefined) {
      return { lastInsertRowid: Number(result.lastInsertRowid), rowsAffected };
    }
    return { rowsAffected };
  }

  async get<T extends Record<string, unknown>>(sql: string, params: DbPrimitive[] = []): Promise<T | undefined> {
    const result = await this.executeStatement(sql, params);
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return toObject<T>(row);
  }

  async all<T extends Record<string, unknown>>(sql: string, params: DbPrimitive[] = []): Promise<T[]> {
    const result = await this.executeStatement(sql, params);
    return result.rows.map((row) => toObject<T>(row));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeTx) {
      this.txDepth += 1;
      try {
        return await fn();
      } finally {
        this.txDepth -= 1;
      }
    }
    const tx = await this.client.transaction("write");
    this.activeTx = tx;
    this.txDepth = 1;
    try {
      const value = await fn();
      await tx.commit();
      return value;
    } catch (error) {
      try {
        await tx.rollback();
      } catch {
        // Preserve the original query error when transaction state already closed.
      }
      throw error;
    } finally {
      this.txDepth = 0;
      this.activeTx = null;
      try {
        tx.close?.();
      } catch {
        // Ignore close errors from already-closed transaction handles.
      }
    }
  }

  async close(): Promise<void> {
    this.client.close();
  }

  private async executeStatement(sql: string, params: DbPrimitive[] = []) {
    if (this.activeTx) {
      return this.activeTx.execute({
        sql,
        args: params as never[]
      });
    }
    return this.client.execute(sql, params as never[]);
  }
}

function toObject<T extends Record<string, unknown>>(row: Row): T {
  return Object.fromEntries(Object.entries(row)) as T;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const STATS_SCHEMA_VERSION = 5;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS kitties (
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
    kpeg_rarity_pct REAL NOT NULL,
    kpeg_rarity_one_in_n REAL NOT NULL,
    traits_json TEXT NOT NULL,
    trait_odds_json TEXT NOT NULL,
    search_text TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_kitties_owner_live ON kitties(owner, burned_at, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_kitties_live_latest ON kitties(burned_at, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_kitties_live_scarcity ON kitties(burned_at, rarity_score DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_kitties_search ON kitties(search_text)`,
  `CREATE TABLE IF NOT EXISTS mint_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    whole_bought INTEGER NOT NULL,
    minted_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chain_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    latest_indexed_block INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS indexer_identity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    chain_id INTEGER NOT NULL,
    token_address TEXT NOT NULL,
    market_address TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS owner_kitty_history (
    owner TEXT NOT NULL,
    kitty_id INTEGER NOT NULL,
    first_seen_at INTEGER NOT NULL,
    PRIMARY KEY (owner, kitty_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_owner_kitty_history_owner ON owner_kitty_history(owner)`,
  `CREATE TABLE IF NOT EXISTS born_lineage (
    child_kitty_id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    parent_a_kitty_id INTEGER,
    parent_b_kitty_id INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_born_lineage_source ON born_lineage(source)`,
  `CREATE TABLE IF NOT EXISTS breeding_pools (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_breeding_pools_status ON breeding_pools(status, pool_id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_breeding_pools_host ON breeding_pools(host, pool_id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_breeding_pools_joiner ON breeding_pools(joiner, pool_id DESC)`,
  `CREATE TABLE IF NOT EXISTS breeding_claims (
    child_kitty_id INTEGER PRIMARY KEY,
    claim_id INTEGER UNIQUE,
    pool_id INTEGER NOT NULL,
    child_owner TEXT NOT NULL,
    claimed INTEGER NOT NULL DEFAULT 0,
    created_block INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    claimed_block INTEGER,
    claimed_at INTEGER,
    claimed_tx_hash TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_breeding_claims_owner ON breeding_claims(child_owner, claimed, created_block DESC)`,
  `CREATE TABLE IF NOT EXISTS breeding_events (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_breeding_events_pool ON breeding_events(pool_id, block_number DESC, log_index DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_breeding_events_kind ON breeding_events(event_kind, block_number DESC, log_index DESC)`,
  `CREATE TABLE IF NOT EXISTS owner_stats (
    owner TEXT PRIMARY KEY,
    current_kitties INTEGER NOT NULL DEFAULT 0,
    ever_kitties INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS global_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    kitties_live INTEGER NOT NULL DEFAULT 0,
    kitties_ever_minted INTEGER NOT NULL DEFAULT 0,
    holders_live INTEGER NOT NULL DEFAULT 0,
    holders_ever INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS token_balances (
    address TEXT PRIMARY KEY,
    balance_wei TEXT NOT NULL,
    ever_held INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_token_balances_live ON token_balances(balance_wei)`,
  `CREATE INDEX IF NOT EXISTS idx_token_balances_ever ON token_balances(ever_held)`,
  `CREATE TABLE IF NOT EXISTS token_balance_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    latest_indexed_block INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS aggregate_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    stats_schema_version INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS market_listings (
    trade_id INTEGER PRIMARY KEY,
    escrow_address TEXT NOT NULL,
    seller TEXT NOT NULL,
    buyer TEXT,
    payment_token TEXT NOT NULL,
    price_wei TEXT NOT NULL,
    fee_bps INTEGER NOT NULL,
    kitty_ids_json TEXT NOT NULL,
    kitty_count INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_block INTEGER NOT NULL,
    created_tx_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_block INTEGER,
    closed_tx_hash TEXT,
    closed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_listings_status_price ON market_listings(status, price_wei)`,
  `CREATE INDEX IF NOT EXISTS idx_market_listings_seller ON market_listings(seller, status, trade_id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_market_listings_buyer ON market_listings(buyer, trade_id DESC)`,
  `CREATE TABLE IF NOT EXISTS market_sales (
    trade_id INTEGER PRIMARY KEY,
    seller TEXT NOT NULL,
    buyer TEXT NOT NULL,
    price_wei TEXT NOT NULL,
    fee_wei TEXT NOT NULL,
    sold_block INTEGER NOT NULL,
    sold_tx_hash TEXT NOT NULL,
    sold_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS market_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    volume_wei TEXT NOT NULL DEFAULT '0',
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS sync_locks (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    owner TEXT NOT NULL,
    locked_until_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sync_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_sync_success_at_ms INTEGER,
    last_sync_failed_at_ms INTEGER,
    last_sync_phase TEXT,
    last_sync_from_block INTEGER,
    last_sync_to_block INTEGER,
    last_sync_event_kind TEXT,
    last_sync_tx_hash TEXT,
    last_sync_log_index INTEGER,
    last_sync_error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sync_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    head_block INTEGER,
    onchain_kitties_live INTEGER,
    onchain_kitties_ever_minted INTEGER,
    updated_at_ms INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS repair_jobs (
    job_name TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    status TEXT NOT NULL,
    from_block INTEGER NOT NULL,
    next_block INTEGER NOT NULL,
    target_block INTEGER,
    updated_at_ms INTEGER NOT NULL,
    last_error TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_repair_jobs_status ON repair_jobs(status, updated_at_ms DESC)`,
  `CREATE TABLE IF NOT EXISTS owner_kitty_history_repair (
    owner TEXT NOT NULL,
    kitty_id INTEGER NOT NULL,
    first_seen_at INTEGER NOT NULL,
    PRIMARY KEY (owner, kitty_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_owner_kitty_history_repair_owner ON owner_kitty_history_repair(owner)`,
  `CREATE TABLE IF NOT EXISTS market_sales_repair (
    trade_id INTEGER PRIMARY KEY,
    seller TEXT NOT NULL,
    buyer TEXT NOT NULL,
    price_wei TEXT NOT NULL,
    fee_wei TEXT NOT NULL,
    sold_block INTEGER NOT NULL,
    sold_tx_hash TEXT NOT NULL,
    sold_at INTEGER NOT NULL
  )`,
  `INSERT INTO chain_state (id, latest_indexed_block)
   VALUES (1, 0)
   ON CONFLICT(id) DO NOTHING`,
  `INSERT INTO global_stats (id, kitties_live, kitties_ever_minted, holders_live, holders_ever)
   VALUES (1, 0, 0, 0, 0)
   ON CONFLICT(id) DO NOTHING`,
  `INSERT INTO aggregate_meta (id, stats_schema_version)
   VALUES (1, 0)
   ON CONFLICT(id) DO NOTHING`,
  `INSERT INTO market_stats (id, volume_wei, updated_at)
   VALUES (1, '0', 0)
   ON CONFLICT(id) DO NOTHING`,
  `INSERT INTO token_balance_state (id, latest_indexed_block)
   VALUES (1, 0)
   ON CONFLICT(id) DO NOTHING`,
  `INSERT INTO sync_status (
     id,
     last_sync_success_at_ms,
     last_sync_failed_at_ms,
     last_sync_phase,
     last_sync_from_block,
     last_sync_to_block,
     last_sync_event_kind,
     last_sync_tx_hash,
     last_sync_log_index,
     last_sync_error
   )
   VALUES (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
   ON CONFLICT(id) DO NOTHING`,
  `INSERT INTO sync_snapshot (
     id,
     head_block,
     onchain_kitties_live,
     onchain_kitties_ever_minted,
     updated_at_ms
   )
   VALUES (1, NULL, NULL, NULL, 0)
   ON CONFLICT(id) DO NOTHING`
];

async function rebuildAggregateStats(db: DbAdapter): Promise<void> {
  await db.run(`DELETE FROM owner_stats`);
  await db.run(`
    INSERT INTO owner_stats (owner, current_kitties, ever_kitties)
    SELECT owner, COUNT(*), 0
    FROM kitties
    WHERE burned_at IS NULL
      AND owner != ?
    GROUP BY owner
  `, [ZERO_ADDRESS]);
  await db.run(`
    INSERT INTO owner_stats (owner, current_kitties, ever_kitties)
    SELECT owner, 0, COUNT(*)
    FROM owner_kitty_history
    WHERE owner != ?
    GROUP BY owner
    ON CONFLICT(owner) DO UPDATE SET
      ever_kitties = excluded.ever_kitties
  `, [ZERO_ADDRESS]);
  await db.run(`
    UPDATE owner_stats
    SET ever_kitties = CASE
      WHEN ever_kitties < current_kitties THEN current_kitties
      ELSE ever_kitties
    END
  `);

  const kittiesLive = Number(
    (
      await db.get<{ value: number }>(
        `SELECT COUNT(*) AS value FROM kitties WHERE burned_at IS NULL`
      )
    )?.value ?? 0
  );
  const kittiesEverMinted = Number(
    (await db.get<{ value: number }>(`SELECT COUNT(*) AS value FROM kitties`))
      ?.value ?? 0
  );
  const holdersLive = Number(
    (
      await db.get<{ value: number }>(
        `SELECT COUNT(*) AS value
         FROM token_balances
         WHERE address != ?
           AND balance_wei != '0'`,
        [ZERO_ADDRESS]
      )
    )?.value ?? 0
  );
  const holdersEver = Number(
    (
      await db.get<{ value: number }>(
        `SELECT COUNT(*) AS value
         FROM token_balances
         WHERE address != ?
           AND ever_held = 1`,
        [ZERO_ADDRESS]
      )
    )?.value ?? 0
  );
  const sales = await db.all<{ price_wei: string }>(`SELECT price_wei FROM market_sales`);
  const volumeWei = sales.reduce((total, row) => total + BigInt(row.price_wei), 0n).toString();
  const now = Date.now();

  await db.run(
    `UPDATE global_stats
     SET kitties_live = ?, kitties_ever_minted = ?, holders_live = ?, holders_ever = ?
     WHERE id = 1`,
    [kittiesLive, kittiesEverMinted, holdersLive, holdersEver]
  );
  await db.run(
    `INSERT INTO market_stats (id, volume_wei, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
      volume_wei = excluded.volume_wei,
      updated_at = excluded.updated_at`,
    [volumeWei, now]
  );
}

async function rebuildKittiesWithoutLegacyRarityColumns(db: DbAdapter): Promise<void> {
  const columns = await db.all<{ name: string }>(`PRAGMA table_info('kitties')`);
  const columnNames = new Set(columns.map((column) => String(column.name)));
  if (!columnNames.has("ukit_rarity_pct") && !columnNames.has("ukit_rarity_one_in_n")) {
    return;
  }

  await db.transaction(async () => {
    await db.exec(`
      CREATE TABLE kitties_next (
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
        kpeg_rarity_pct REAL NOT NULL,
        kpeg_rarity_one_in_n REAL NOT NULL,
        traits_json TEXT NOT NULL,
        trait_odds_json TEXT NOT NULL,
        search_text TEXT NOT NULL
      )
    `);
    await db.exec(`
      INSERT INTO kitties_next (
        id, seed, tier, tier_label, owner, minted_by, mint_batch_size, created_at, updated_at,
        block_number, tx_hash, gas_used, base_fee_wei, burned_at, rarity_score,
        kpeg_rarity_pct, kpeg_rarity_one_in_n, traits_json, trait_odds_json, search_text
      )
      SELECT
        id, seed, tier, tier_label, owner, minted_by, mint_batch_size, created_at, updated_at,
        block_number, tx_hash, gas_used, base_fee_wei, burned_at, rarity_score,
        CASE
          WHEN kpeg_rarity_pct != 0 OR kpeg_rarity_one_in_n != 0 THEN kpeg_rarity_pct
          ELSE ukit_rarity_pct
        END,
        CASE
          WHEN kpeg_rarity_pct != 0 OR kpeg_rarity_one_in_n != 0 THEN kpeg_rarity_one_in_n
          ELSE ukit_rarity_one_in_n
        END,
        traits_json, trait_odds_json, search_text
      FROM kitties
    `);
    await db.exec(`DROP TABLE kitties`);
    await db.exec(`ALTER TABLE kitties_next RENAME TO kitties`);
  });
}

async function ensureKittiesIndexes(db: DbAdapter): Promise<void> {
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_kitties_owner_live ON kitties(owner, burned_at, id DESC)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_kitties_live_latest ON kitties(burned_at, id DESC)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_kitties_live_scarcity ON kitties(burned_at, rarity_score DESC, id DESC)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_kitties_search ON kitties(search_text)`);
}

async function ensureBreedingEventReplayIndex(db: DbAdapter): Promise<void> {
  try {
    await db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_breeding_events_tx_log ON breeding_events(tx_hash, log_index)`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/unique|constraint failed/i.test(message)) {
      throw error;
    }

    // Older DB snapshots can contain duplicated replayed events from before
    // cursor+event idempotency hardening. Keep the earliest row per tx/log.
    await db.transaction(async () => {
      await db.exec(`
        DELETE FROM breeding_events
        WHERE id NOT IN (
          SELECT MIN(id)
          FROM breeding_events
          GROUP BY tx_hash, log_index
        )
      `);
      await db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_breeding_events_tx_log ON breeding_events(tx_hash, log_index)`
      );
    });
  }
}

async function renameMarketListingColumnIfNeeded(
  db: DbAdapter,
  fromColumn: string,
  toColumn: string
): Promise<void> {
  const rows = await db.all<{ name: string }>(`PRAGMA table_info('market_listings')`);
  const columns = new Set(rows.map((row) => String(row.name).toLowerCase()));
  const from = fromColumn.toLowerCase();
  const to = toColumn.toLowerCase();
  if (!columns.has(from) || columns.has(to)) {
    return;
  }
  await db.exec(`ALTER TABLE market_listings RENAME COLUMN ${fromColumn} TO ${toColumn}`);
}

async function applySchema(db: DbAdapter): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.exec(statement);
  }
  try {
    await db.exec(`ALTER TABLE kitties ADD COLUMN gas_used INTEGER`);
  } catch {
    // Existing databases already have this column.
  }
  try {
    await db.exec(`ALTER TABLE kitties ADD COLUMN base_fee_wei TEXT`);
  } catch {
    // Existing databases already have this column.
  }
  try {
    await db.exec(`ALTER TABLE kitties ADD COLUMN kpeg_rarity_pct REAL NOT NULL DEFAULT 0`);
  } catch {
    // Existing databases already have this column.
  }
  try {
    await db.exec(`ALTER TABLE kitties ADD COLUMN kpeg_rarity_one_in_n REAL NOT NULL DEFAULT 0`);
  } catch {
    // Existing databases already have this column.
  }
  await rebuildKittiesWithoutLegacyRarityColumns(db);
  await ensureKittiesIndexes(db);
  await ensureBreedingEventReplayIndex(db);
  try {
    await db.exec(`ALTER TABLE indexer_identity ADD COLUMN market_address TEXT`);
  } catch {
    // Existing databases already have this column.
  }
  try {
    await db.exec(`ALTER TABLE market_listings RENAME COLUMN position_contract TO escrow_address`);
  } catch {
    // Fresh databases and already-renamed databases use escrow_address.
  }
  await renameMarketListingColumnIfNeeded(db, "cat_ids_json", "kitty_ids_json");
  await renameMarketListingColumnIfNeeded(db, "cat_count", "kitty_count");
  await db.exec(`
    INSERT OR IGNORE INTO owner_kitty_history (owner, kitty_id, first_seen_at)
    SELECT owner, id, created_at
    FROM kitties
    WHERE owner != '0x0000000000000000000000000000000000000000'
  `);
  await db.exec(`
    INSERT OR IGNORE INTO owner_kitty_history (owner, kitty_id, first_seen_at)
    SELECT minted_by, id, created_at
    FROM kitties
    WHERE minted_by != '0x0000000000000000000000000000000000000000'
  `);

  const aggregateMeta = await db.get<{ stats_schema_version: number }>(
    `SELECT stats_schema_version FROM aggregate_meta WHERE id = 1`
  );
  if (Number(aggregateMeta?.stats_schema_version ?? 0) < STATS_SCHEMA_VERSION) {
    await db.transaction(async () => {
      await rebuildAggregateStats(db);
      await db.run(
        `UPDATE aggregate_meta SET stats_schema_version = ? WHERE id = 1`,
        [STATS_SCHEMA_VERSION]
      );
    });
  }

  const breedingPoolColumns = await db.all<{ name: string }>(`PRAGMA table_info('breeding_pools')`);
  const breedingPoolColumnSet = new Set(breedingPoolColumns.map((row) => String(row.name).toLowerCase()));
  const legacyBreedingColumns = ["request_block", "request_seed"].filter((name) => breedingPoolColumnSet.has(name));
  if (legacyBreedingColumns.length > 0) {
    throw new Error(
      `Legacy breeding index schema detected (${legacyBreedingColumns.join(", ")}). ` +
        "Reset and reindex the indexer database before running this version."
    );
  }
}

export async function openDb(options: OpenDbOptions): Promise<DbAdapter> {
  let db: DbAdapter;

  if (options.mode === "libsql") {
    if (!options.libsqlUrl) {
      throw new Error("KPEG_LIBSQL_URL is required when KPEG_DB_MODE=libsql");
    }
    db = new LibsqlAdapter(
      createLibsqlClient({
        url: options.libsqlUrl,
        ...(options.libsqlAuthToken ? { authToken: options.libsqlAuthToken } : {})
      })
    );
  } else {
    const { DatabaseSync } = await import("node:sqlite");
    const sqlitePath =
      !options.sqlitePath || options.sqlitePath === ":memory:" || isAbsolute(options.sqlitePath)
        ? (options.sqlitePath ?? ":memory:")
        : resolve(options.sqliteBasePath ?? process.cwd(), options.sqlitePath);
    const raw = new DatabaseSync(sqlitePath);
    raw.exec("PRAGMA journal_mode = WAL;");
    raw.exec("PRAGMA foreign_keys = ON;");
    db = new NodeSqliteAdapter(raw);
  }

  if (options.applySchema !== false) {
    await applySchema(db);
  }
  return db;
}
