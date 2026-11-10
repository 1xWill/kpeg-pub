#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function readEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return new Map();
  }
  const entries = new Map();
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 1) continue;
    entries.set(trimmed.slice(0, idx), trimmed.slice(idx + 1));
  }
  return entries;
}

function parseVercelRegion(xVercelId) {
  if (!xVercelId) return null;
  const parts = xVercelId.split("::").filter(Boolean);
  return parts.length >= 2 ? parts[1] : null;
}

function parseTursoRegion(hostname) {
  if (!hostname) return null;
  const awsMatch = hostname.match(/\.aws-([a-z0-9-]+)\.turso\.io$/i);
  if (awsMatch?.[1]) {
    return `aws-${awsMatch[1]}`;
  }
  const gcpMatch = hostname.match(/\.gcp-([a-z0-9-]+)\.turso\.io$/i);
  if (gcpMatch?.[1]) {
    return `gcp-${gcpMatch[1]}`;
  }
  return null;
}

const target = (process.argv[2] ?? "").trim();
if (!target) {
  console.error("Usage: node scripts/inspect-runtime-region.mjs https://<your-domain>");
  process.exit(1);
}

const url = new URL("/api/status", target).toString();
const response = await fetch(url, { method: "GET" });
const xVercelId = response.headers.get("x-vercel-id");
const vercelRegion = parseVercelRegion(xVercelId);

const env = readEnvFile();
const libsqlUrl = env.get("KPEG_LIBSQL_URL") ?? "";
const tursoHost = libsqlUrl ? new URL(libsqlUrl).hostname : null;
const tursoRegion = parseTursoRegion(tursoHost);

const notes = [];
if (!vercelRegion) {
  notes.push("Could not parse Vercel execution region from x-vercel-id.");
}
if (!tursoRegion) {
  notes.push("Could not parse Turso region from KPEG_LIBSQL_URL.");
}
if (vercelRegion && tursoRegion) {
  if (tursoRegion.includes(vercelRegion)) {
    notes.push("Vercel and Turso look co-located.");
  } else {
    notes.push("Vercel and Turso regions differ; cross-region DB latency is likely.");
  }
}

console.log(JSON.stringify({
  statusUrl: url,
  httpStatus: response.status,
  xVercelId,
  vercelRegion,
  tursoHost,
  tursoRegion,
  notes,
}, null, 2));
