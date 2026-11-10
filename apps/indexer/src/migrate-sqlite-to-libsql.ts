import { migrateSqliteToLibsql } from "./migration.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const sqlitePath = process.env.KPEG_MIGRATE_SQLITE_PATH;
  const libsqlUrl = process.env.KPEG_LIBSQL_URL;
  const libsqlAuthToken = process.env.KPEG_LIBSQL_AUTH_TOKEN;

  if (!sqlitePath) {
    throw new Error("KPEG_MIGRATE_SQLITE_PATH is required");
  }
  if (!libsqlUrl) {
    throw new Error("KPEG_LIBSQL_URL is required");
  }

  const result = await migrateSqliteToLibsql({
    sqlitePath,
    sqliteBasePath: repoRoot,
    libsqlUrl,
    ...(libsqlAuthToken ? { libsqlAuthToken } : {})
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
