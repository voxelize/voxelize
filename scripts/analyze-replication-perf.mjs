#!/usr/bin/env node
// Summarizes entity replication performance from a TOWN_PERF_LOG JSONL
// stream (server side) and optionally a browser console dump with client
// [PERF] lines. Usage:
//   node scripts/analyze-replication-perf.mjs <core.jsonl> [client-console.log]

import { readFileSync } from "node:fs";

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(q * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)];
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function formatStats(label, s, unit = "") {
  console.log(
    `  ${label}: n=${s.count} p50=${s.p50.toFixed(1)}${unit} p95=${s.p95.toFixed(1)}${unit} p99=${s.p99.toFixed(1)}${unit} max=${s.max.toFixed(1)}${unit}`,
  );
}

function parseJsonLines(text, prefix = "") {
  const events = [];
  for (const line of text.split("\n")) {
    const start = prefix ? line.indexOf(prefix) : 0;
    if (start < 0) continue;
    const payload = prefix ? line.slice(start + prefix.length) : line;
    if (!payload.trim().startsWith("{")) continue;
    try {
      events.push(JSON.parse(payload.trim()));
    } catch {
      // Non-JSON console noise.
    }
  }
  return events;
}

const [serverPath, clientPath] = process.argv.slice(2);
if (!serverPath) {
  console.error(
    "usage: analyze-replication-perf.mjs <core.jsonl> [client-console.log]",
  );
  process.exit(1);
}

const serverText = readFileSync(serverPath, "utf8");
const events = serverText.includes("[PERF] ")
  ? parseJsonLines(serverText, "[PERF] ")
  : parseJsonLines(serverText);

const batchSends = events.filter((e) => e.event === "entity_batch_send");
const motionGaps = events.filter((e) => e.event === "entity_motion_gap");
const ticks = events.filter((e) => e.event === "core_tick");

console.log(`server events: ${events.length} from ${serverPath}`);

if (batchSends.length > 0) {
  const firstMs = batchSends[0].monotonicMs;
  const lastMs = batchSends[batchSends.length - 1].monotonicMs;
  const seconds = Math.max((lastMs - firstMs) / 1000, 1e-9);
  const totalBytes = batchSends.reduce((sum, e) => sum + (e.byteSize ?? 0), 0);
  console.log("\nentity_batch_send (actual encoded frames):");
  formatStats("byteSize", stats(batchSends.map((e) => e.byteSize ?? 0)), "B");
  formatStats("itemCount", stats(batchSends.map((e) => e.itemCount ?? 0)));
  if (batchSends.some((e) => e.motionCount !== undefined)) {
    formatStats(
      "motionCount",
      stats(batchSends.map((e) => e.motionCount ?? 0)),
    );
    formatStats(
      "forcedCount",
      stats(batchSends.map((e) => e.forcedCount ?? 0)),
    );
  }
  console.log(
    `  total: ${(totalBytes / 1024).toFixed(1)} KiB over ${seconds.toFixed(1)}s = ${(totalBytes / seconds / 1024).toFixed(1)} KiB/s`,
  );
}

if (motionGaps.length > 0) {
  console.log("\nentity_motion_gap (server send gaps, 5s windows):");
  formatStats("window p50", stats(motionGaps.map((e) => e.p50Ms ?? 0)), "ms");
  formatStats("window p95", stats(motionGaps.map((e) => e.p95Ms ?? 0)), "ms");
  formatStats("window p99", stats(motionGaps.map((e) => e.p99Ms ?? 0)), "ms");
  formatStats("window max", stats(motionGaps.map((e) => e.maxMs ?? 0)), "ms");
}

if (ticks.length > 0) {
  console.log("\ncore_tick:");
  formatStats(
    "tickDurationMs",
    stats(ticks.map((e) => e.tickDurationMs ?? 0)),
    "ms",
  );
  formatStats(
    "stateSlotDepth",
    stats(ticks.map((e) => e.stateSlotDepth ?? 0)),
  );
}

if (clientPath) {
  const clientEvents = parseJsonLines(
    readFileSync(clientPath, "utf8"),
    "[PERF] ",
  );
  const applyGaps = clientEvents.filter(
    (e) => e.event === "entity_motion_apply_gap",
  );
  console.log(`\nclient events: ${clientEvents.length} from ${clientPath}`);
  if (applyGaps.length > 0) {
    console.log(
      "entity_motion_apply_gap (client-side per-entity apply gaps, 5s windows):",
    );
    formatStats("window p50", stats(applyGaps.map((e) => e.p50Ms ?? 0)), "ms");
    formatStats("window p95", stats(applyGaps.map((e) => e.p95Ms ?? 0)), "ms");
    formatStats("window p99", stats(applyGaps.map((e) => e.p99Ms ?? 0)), "ms");
    formatStats("window max", stats(applyGaps.map((e) => e.maxMs ?? 0)), "ms");
    const samples = applyGaps.reduce((sum, e) => sum + (e.count ?? 0), 0);
    console.log(`  total gap samples: ${samples}`);
  }
}
