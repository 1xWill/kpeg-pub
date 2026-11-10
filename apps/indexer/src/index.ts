import { buildServer } from "./server.js";
import {
  getRuntimeContext,
  getRuntimeSyncStatus,
  repairRuntimeGlobalKitties,
  repairRuntimeKittyById,
  repairRuntimeMarketListings,
  repairRuntimeOwnerKitties,
  repairRuntimeOwnerStats,
  repairRuntimeStats,
  runServerlessSync
} from "./runtime.js";
import { devAutoSyncEnabled, devAutoSyncIntervalMs, startDevAutoSync } from "./dev-sync.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

const context = await getRuntimeContext();
const requestRepairOptions = {
  repairStats: repairRuntimeStats,
  repairGlobalKitties: repairRuntimeGlobalKitties,
  repairOwnerKitties: repairRuntimeOwnerKitties,
  repairOwnerStats: repairRuntimeOwnerStats,
  repairKittyById: repairRuntimeKittyById,
  repairMarketListings: repairRuntimeMarketListings
};
const app = buildServer(context.repo, context.runtimeConfig, {
  runSync: runServerlessSync,
  syncSecret: context.syncSecret,
  getStatus: getRuntimeSyncStatus,
  ...requestRepairOptions
});

try {
  await app.listen({ port, host });
  startDevAutoSync({
    enabled: devAutoSyncEnabled() && Boolean(context.syncConfig),
    intervalMs: devAutoSyncIntervalMs(),
    runSync: runServerlessSync,
    log: app.log
  });
  app.log.info(`kPEG API listening on ${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
