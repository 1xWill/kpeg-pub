import { resolve } from "node:path";
import { openDb, type DbAdapter } from "./db.js";

const TABLES = [
  "kitties",
  "mint_batches",
  "chain_state",
  "owner_kitty_history",
  "born_lineage",
  "breeding_pools",
  "breeding_claims",
  "breeding_events",
  "owner_stats",
  "global_stats",
  "aggregate_meta",
  "sync_status",
  "indexer_identity",
  "market_listings",
  "market_sales",
  "market_stats"
] as const;
type TableName = (typeof TABLES)[number];
type Row = Record<string, unknown>;
type SqlParam = string | number | bigint | Uint8Array | null;

export interface SqliteToLibsqlMigrationOptions {
  sqlitePath: string;
  sqliteBasePath?: string;
  libsqlUrl: string;
  libsqlAuthToken?: string;
}

export interface SqliteToLibsqlMigrationResult {
  sqlitePath: string;
  libsqlUrl: string;
  copiedRowsByTable: Record<TableName, number>;
  totalRows: number;
}

function normalizeSqlParam(value: unknown): SqlParam {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return String(value);
}

async function copyTable(table: TableName, source: DbAdapter, target: DbAdapter): Promise<number> {
  const rows = await source.all<Row>(`SELECT * FROM ${table}`);
  await target.run(`DELETE FROM ${table}`);
  if (rows.length === 0) {
    return 0;
  }

  const first = rows[0];
  if (!first) {
    return 0;
  }
  const columns = Object.keys(first);
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;

  for (const row of rows) {
    const values = columns.map((column) => normalizeSqlParam(row[column]));
    await target.run(sql, values);
  }

  return rows.length;
}

export async function migrateSqliteToLibsql(
  options: SqliteToLibsqlMigrationOptions
): Promise<SqliteToLibsqlMigrationResult> {
  const sqlitePath = resolve(options.sqliteBasePath ?? process.cwd(), options.sqlitePath);
  const source = await openDb({
    mode: "sqlite",
    sqlitePath,
    libsqlUrl: undefined,
    libsqlAuthToken: undefined
  });
  const target = await openDb({
    mode: "libsql",
    sqlitePath: undefined,
    libsqlUrl: options.libsqlUrl,
    libsqlAuthToken: options.libsqlAuthToken
  });

  try {
      const copiedRowsByTable: Record<TableName, number> = {
        kitties: 0,
        mint_batches: 0,
        chain_state: 0,
        owner_kitty_history: 0,
        born_lineage: 0,
        breeding_pools: 0,
        breeding_claims: 0,
        breeding_events: 0,
        owner_stats: 0,
        global_stats: 0,
        aggregate_meta: 0,
        sync_status: 0,
        indexer_identity: 0,
        market_listings: 0,
        market_sales: 0,
        market_stats: 0
      };

    await target.transaction(async () => {
      for (const table of TABLES) {
        copiedRowsByTable[table] = await copyTable(table, source, target);
      }
    });

    const totalRows = Object.values(copiedRowsByTable).reduce((sum, count) => sum + count, 0);
    return {
      sqlitePath,
      libsqlUrl: options.libsqlUrl,
      copiedRowsByTable,
      totalRows
    };
  } finally {
    await source.close();
    await target.close();
  }
}
