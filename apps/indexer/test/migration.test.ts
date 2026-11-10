import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { migrateSqliteToLibsql } from "../src/migration.js";
import { KPEGRepository } from "../src/repository.js";

describe("sqlite to libsql migration", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("copies kitties, mint batches, and chain cursor into libsql", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kpeg-migrate-"));
    cleanupDirs.push(dir);
    const sourcePath = join(dir, "source.sqlite");
    const targetPath = join(dir, "target.db");
    const owner = "0x0000000000000000000000000000000000000abc";

    const sourceDb = await openDb({
      mode: "sqlite",
      sqlitePath: sourcePath,
      libsqlUrl: undefined,
      libsqlAuthToken: undefined
    });
    const sourceRepo = new KPEGRepository(sourceDb);
    await sourceRepo.mintKitties({ owner, wholeBought: 3, blockNumber: 123 });
    await sourceRepo.burnFromOwner({ owner, count: 1, blockNumber: 124 });
    await sourceDb.close();

    const result = await migrateSqliteToLibsql({
      sqlitePath: sourcePath,
      libsqlUrl: `file:${targetPath}`
    });
    expect(result.copiedRowsByTable.kitties).toBe(3);
    expect(result.copiedRowsByTable.mint_batches).toBe(1);
    expect(result.copiedRowsByTable.chain_state).toBe(1);
    expect(result.copiedRowsByTable.owner_kitty_history).toBe(3);
    expect(result.copiedRowsByTable.born_lineage).toBe(3);
    expect(result.copiedRowsByTable.breeding_pools).toBe(0);
    expect(result.copiedRowsByTable.breeding_claims).toBe(0);
    expect(result.copiedRowsByTable.breeding_events).toBe(0);
    expect(result.copiedRowsByTable.owner_stats).toBe(1);
    expect(result.copiedRowsByTable.global_stats).toBe(1);
    expect(result.copiedRowsByTable.aggregate_meta).toBe(1);
    expect(result.copiedRowsByTable.market_stats).toBe(1);
    expect(result.copiedRowsByTable.indexer_identity).toBe(0);
    expect(result.totalRows).toBe(16);

    const targetDb = await openDb({
      mode: "libsql",
      sqlitePath: undefined,
      libsqlUrl: `file:${targetPath}`,
      libsqlAuthToken: undefined
    });
    const targetRepo = new KPEGRepository(targetDb);
    const stats = await targetRepo.getStats();
    expect(stats.kittiesEverMinted).toBe(3);
    expect(stats.kittiesLive).toBe(2);
    expect(stats.latestIndexedBlock).toBe(124);
    await targetDb.close();
  });
});
