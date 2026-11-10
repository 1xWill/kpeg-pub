#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const baseUrl = (process.argv[2] ?? "").trim();
const runs = Number(process.argv[3] ?? "8");

if (!baseUrl) {
  console.error("Usage: node scripts/measure-kpis.mjs https://<domain> [runs=8]");
  process.exit(1);
}

const sampleRuns = Number.isFinite(runs) && runs > 0 ? Math.floor(runs) : 8;

const endpoints = [
  { id: "status", path: "/api/status" },
  { id: "stats", path: "/api/stats" },
  { id: "global24", path: "/api/kitties/global?page=0&pageSize=24&sort=latest" },
  { id: "market24", path: "/api/market/listings?page=0&pageSize=24&tab=all&sort=latest" },
];

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}

function avg(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function runCurl(url) {
  const output = execFileSync(
    "curl",
    [
      "-sS",
      "-o",
      "/dev/null",
      "-D",
      "-",
      "-w",
      "\nMETRICS %{http_code} %{time_starttransfer} %{time_total} %{size_download}\n",
      url,
    ],
    { encoding: "utf8" },
  );
  const lines = output.split("\n");
  const metricsLine = lines.find((line) => line.startsWith("METRICS "));
  if (!metricsLine) {
    throw new Error(`Missing curl metrics line for ${url}`);
  }
  const [, statusCodeRaw, ttfbRaw, totalRaw, sizeRaw] = metricsLine.split(/\s+/);
  const headersRaw = lines
    .filter((line) => line && !line.startsWith("METRICS "))
    .join("\n");
  const getHeader = (name) =>
    (headersRaw.match(new RegExp(`^${name}:\\s*(.+)$`, "im")) ?? [])[1] ?? "";
  return {
    statusCode: Number(statusCodeRaw),
    ttfbMs: Number(ttfbRaw) * 1000,
    totalMs: Number(totalRaw) * 1000,
    sizeBytes: Number(sizeRaw),
    cacheControl: getHeader("cache-control"),
    xVercelCache: getHeader("x-vercel-cache"),
    xVercelId: getHeader("x-vercel-id"),
  };
}

const rows = [];
for (const endpoint of endpoints) {
  const samples = [];
  for (let index = 0; index < sampleRuns; index += 1) {
    samples.push(runCurl(new URL(endpoint.path, baseUrl).toString()));
  }
  const ttfbValues = samples.map((sample) => sample.ttfbMs);
  const totalValues = samples.map((sample) => sample.totalMs);
  const first = samples[0];
  rows.push({
    id: endpoint.id,
    endpoint: endpoint.path,
    statusCode: first.statusCode,
    sizeBytes: first.sizeBytes,
    avgTtfbMs: Math.round(avg(ttfbValues)),
    p95TtfbMs: Math.round(percentile(ttfbValues, 0.95)),
    avgTotalMs: Math.round(avg(totalValues)),
    p95TotalMs: Math.round(percentile(totalValues, 0.95)),
    cacheControl: first.cacheControl,
    xVercelCache: first.xVercelCache,
    xVercelId: first.xVercelId,
  });
}

const timestamp = new Date().toISOString();
const output = {
  capturedAt: timestamp,
  baseUrl,
  runs: sampleRuns,
  rows,
};

console.log(JSON.stringify(output, null, 2));
console.log("");
console.log("| KPI | Value |");
console.log("| --- | --- |");
for (const row of rows) {
  console.log(
    `| ${row.id} total avg/p95 (ms) | ${row.avgTotalMs} / ${row.p95TotalMs} |`,
  );
  console.log(
    `| ${row.id} ttfb avg/p95 (ms) | ${row.avgTtfbMs} / ${row.p95TtfbMs} |`,
  );
  console.log(`| ${row.id} size (bytes) | ${row.sizeBytes} |`);
  console.log(`| ${row.id} cache | ${row.cacheControl} |`);
}
