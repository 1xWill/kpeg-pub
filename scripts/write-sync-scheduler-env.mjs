#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const NETWORK_DEFAULTS = {
  "base-sepolia": {
    jobName: "kpeg-sync-base-sepolia"
  },
  "base-mainnet": {
    jobName: "kpeg-sync-base-mainnet"
  }
};

const DEFAULT_INTERVAL_MINUTES = 1;
const DEFAULT_TIMEZONE = "Etc/UTC";
const DEFAULT_LOCATION = "us-central1";
const DEFAULT_SCHEDULER_ENV_PATH = ".env.scheduler";

const USAGE = [
  "Usage:",
  "  node scripts/write-sync-scheduler-env.mjs <base-sepolia|base-mainnet> [options]",
  "",
  "Options:",
  "  --app-url <url>             Base app URL; script writes <url>/api/sync.",
  "  --target-url <url>          Full scheduler target URL (overrides --app-url).",
  "  --interval-minutes <1-59>   Sync interval in minutes (default: 1).",
  "  --timezone <tz>             Scheduler timezone (default: Etc/UTC).",
  "  --location <region>         Cloud Scheduler location (default: us-central1).",
  "  --job-name <name>           Scheduler job name (network default if omitted).",
  "  --env-path <path>           Target scheduler env file (default: .env.scheduler).",
  "  --help                      Show this help."
].join("\n");

export function parseSchedulerArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }

  const network = argv[0];
  if (!NETWORK_DEFAULTS[network]) {
    throw new Error(`Missing or invalid network. Expected one of: ${Object.keys(NETWORK_DEFAULTS).join(", ")}`);
  }

  const args = {
    network,
    appUrl: undefined,
    targetUrl: undefined,
    intervalMinutes: undefined,
    timezone: undefined,
    location: undefined,
    jobName: undefined,
    envPath: undefined
  };

  const withValue = new Set([
    "--app-url",
    "--target-url",
    "--interval-minutes",
    "--timezone",
    "--location",
    "--job-name",
    "--env-path"
  ]);

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!withValue.has(token)) {
      throw new Error(`Unknown option: ${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    index += 1;
    if (token === "--app-url") args.appUrl = value;
    else if (token === "--target-url") args.targetUrl = value;
    else if (token === "--interval-minutes") args.intervalMinutes = value;
    else if (token === "--timezone") args.timezone = value;
    else if (token === "--location") args.location = value;
    else if (token === "--job-name") args.jobName = value;
    else if (token === "--env-path") args.envPath = value;
  }

  return args;
}

export function parseEnvText(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const splitAt = line.indexOf("=");
        return [line.slice(0, splitAt), line.slice(splitAt + 1)];
      })
  );
}

function stripTrailingSlash(input) {
  return input.replace(/\/+$/, "");
}

function normalizeTargetUrl(input) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Scheduler target must use https:// (got ${input})`);
  }
  return stripTrailingSlash(parsed.toString());
}

function parseIntervalMinutes(input) {
  const value = Number(input);
  if (!Number.isInteger(value) || value < 1 || value > 59) {
    throw new Error(`interval-minutes must be an integer between 1 and 59 (got ${input})`);
  }
  return value;
}

export function cronFromIntervalMinutes(intervalMinutes) {
  return intervalMinutes === 1 ? "* * * * *" : `*/${intervalMinutes} * * * *`;
}

function resolveValue(name, processEnv, existingEnv) {
  const value = processEnv[name]?.trim() || existingEnv[name]?.trim();
  return value ? value : undefined;
}

export function buildSchedulerEntries(input) {
  const defaults = NETWORK_DEFAULTS[input.network];

  const intervalMinutes = parseIntervalMinutes(
    input.intervalMinutes ??
      resolveValue("KPEG_SYNC_INTERVAL_MINUTES", input.processEnv, input.existingEnv) ??
      input.baseEnv.KPEG_SYNC_INTERVAL_MINUTES?.trim() ??
      String(DEFAULT_INTERVAL_MINUTES)
  );
  const timezone =
    input.timezone ??
    resolveValue("KPEG_SYNC_TIMEZONE", input.processEnv, input.existingEnv) ??
    input.baseEnv.KPEG_SYNC_TIMEZONE?.trim() ??
    DEFAULT_TIMEZONE;
  const location =
    input.location ??
    resolveValue("KPEG_SYNC_SCHEDULER_LOCATION", input.processEnv, input.existingEnv) ??
    input.baseEnv.KPEG_SYNC_SCHEDULER_LOCATION?.trim() ??
    DEFAULT_LOCATION;
  const jobName =
    input.jobName ??
    resolveValue("KPEG_SYNC_SCHEDULER_JOB_NAME", input.processEnv, input.existingEnv) ??
    defaults.jobName;
  const explicitTarget =
    input.targetUrl ??
    (input.appUrl ? `${stripTrailingSlash(normalizeTargetUrl(input.appUrl))}/api/sync` : undefined);
  const targetUrl = explicitTarget
    ? normalizeTargetUrl(explicitTarget)
    : resolveValue("KPEG_SYNC_SCHEDULER_TARGET_URL", input.processEnv, input.existingEnv) ?? "";

  const secret =
    input.processEnv.KPEG_SYNC_SECRET?.trim() ||
    input.baseEnv.KPEG_SYNC_SECRET?.trim() ||
    input.existingEnv.KPEG_SYNC_SECRET?.trim() ||
    randomBytes(32).toString("hex");

  return [
    ["KPEG_SYNC_SECRET", secret],
    ["KPEG_SYNC_INTERVAL_MINUTES", String(intervalMinutes)],
    ["KPEG_SYNC_TIMEZONE", timezone],
    ["KPEG_SYNC_SCHEDULER_LOCATION", location],
    ["KPEG_SYNC_SCHEDULER_JOB_NAME", jobName],
    ["KPEG_SYNC_SCHEDULER_TARGET_URL", targetUrl]
  ];
}

export function mergeEnvText(existingText, entries) {
  const managed = new Set(entries.map(([key]) => key));
  const lines = existingText.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      return true;
    }
    return !managed.has(trimmed.slice(0, trimmed.indexOf("=")));
  });
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  if (lines.length > 0) {
    lines.push("");
  }
  for (const [key, value] of entries) {
    lines.push(`${key}=${value}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatGcloudCreateCommand(envPath, schedule) {
  const lines = [
    `source ${envPath}`,
    `gcloud scheduler jobs create http "$KPEG_SYNC_SCHEDULER_JOB_NAME" \\`,
    `  --location="$KPEG_SYNC_SCHEDULER_LOCATION" \\`,
    `  --schedule="${schedule}" \\`,
    `  --time-zone="$KPEG_SYNC_TIMEZONE" \\`,
    `  --uri="$KPEG_SYNC_SCHEDULER_TARGET_URL" \\`,
    `  --http-method=GET \\`,
    `  --headers="Authorization=Bearer $KPEG_SYNC_SECRET" \\`,
    `  --attempt-deadline=30s \\`,
    `  --max-retry-attempts=5 \\`,
    `  --min-backoff=10s \\`,
    `  --max-backoff=120s \\`,
    `  --max-retry-duration=300s`
  ].filter(Boolean);
  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2), processEnv = process.env) {
  const parsed = parseSchedulerArgs(argv);
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const envPath = resolve(parsed.envPath ?? processEnv.KPEG_SYNC_SCHEDULER_ENV_PATH ?? DEFAULT_SCHEDULER_ENV_PATH);
  const appEnvPath = resolve(processEnv.KPEG_ENV_PATH ?? ".env");
  const existingText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const appEnvText = existsSync(appEnvPath) ? readFileSync(appEnvPath, "utf8") : "";
  const existingEnv = parseEnvText(existingText);
  const baseEnv = parseEnvText(appEnvText);
  const hadSyncSecretBefore =
    Boolean(processEnv.KPEG_SYNC_SECRET?.trim()) ||
    Boolean(existingEnv.KPEG_SYNC_SECRET?.trim()) ||
    Boolean(baseEnv.KPEG_SYNC_SECRET?.trim());
  const entries = buildSchedulerEntries({
    ...parsed,
    processEnv,
    existingEnv,
    baseEnv
  });

  writeFileSync(envPath, mergeEnvText(existingText, entries));
  const entriesMap = Object.fromEntries(entries);
  const schedule = cronFromIntervalMinutes(Number(entriesMap.KPEG_SYNC_INTERVAL_MINUTES));

  console.log(`Updated scheduler envs in ${envPath}`);
  if (!hadSyncSecretBefore) {
    console.log(`Generated KPEG_SYNC_SECRET in ${envPath}. Copy the same value to your app runtime env (Vercel).`);
  }
  if (!entries.find(([key]) => key === "KPEG_SYNC_SCHEDULER_TARGET_URL")?.[1]) {
    console.log("Set KPEG_SYNC_SCHEDULER_TARGET_URL (or pass --app-url) before creating the scheduler job.");
  }
  console.log("");
  console.log("Create scheduler job (or update it if already created):");
  console.log(formatGcloudCreateCommand(envPath, schedule));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    console.error("");
    console.error(USAGE);
    process.exit(1);
  });
}
