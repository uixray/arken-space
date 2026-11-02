#!/usr/bin/env node
// Offline projection of an explicitly supplied capture. No app imports, DB,
// network, environment changes, file writes or automatic log discovery.
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Deliberately duplicated: this script must not load the server or its config.
// Keep equal to SNAPSHOT_TRIGGER_DOMAINS in apps/server/src/snapshot-metrics.ts.
const domains = new Set([
  "world-map", "progression", "character-extras", "awards",
  "character-archive", "encounter", "economy", "asset-lifecycle",
  "campaign-pause", "membership-rename", "character", "scene", "token",
  "canvas", "sticker", "campaign", "character-play", "asset",
  "drawing-fallback", "unattributed",
]);
const marker = "[snapshot-metrics]";
// Raw Node stdout or `docker logs --timestamps`, not arbitrary logger prefixes.
const prefix = /^(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z\s+)?\[snapshot-metrics\]\s+/;
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isDuration = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

function addCount(left, right) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("REPORT_COUNT_OVERFLOW");
  return result;
}

function parseMeasurement(value) {
  if (!isObject(value) || !isCount(value.sockets) || !isCount(value.queries) ||
      value.queryCountScope !== "PROCESS_WINDOW_ESTIMATE" ||
      !isCount(value.totalBytes) || !isDuration(value.totalMs)) return null;
  // A missing version is the old format, not evidence of a specific domain.
  if (value.schemaVersion !== undefined && value.schemaVersion !== 2) return null;
  if (value.schemaVersion === undefined && value.triggers !== undefined) return null;
  if (!Array.isArray(value.perSocket) || value.perSocket.length !== value.sockets) return null;
  let socketBytes = 0;
  for (const socket of value.perSocket) {
    if (!isObject(socket) || !isCount(socket.bytes) || !isDuration(socket.ms)) return null;
    socketBytes += socket.bytes;
    if (!Number.isSafeInteger(socketBytes)) return null;
  }
  if (socketBytes !== value.totalBytes) return null;

  let category = "legacy";
  let domain = null;
  let recordedAt = null;
  let counts = {};
  if (value.schemaVersion === 2) {
    if (typeof value.recordedAt !== "string" || !isoTimestamp.test(value.recordedAt) ||
        !Number.isFinite(Date.parse(value.recordedAt)) ||
        new Date(value.recordedAt).toISOString() !== value.recordedAt) return null;
    recordedAt = value.recordedAt;
    if (value.triggers === null) {
      category = "unattributed";
    } else {
      const batch = value.triggers;
      if (!isObject(batch) || batch.scope !== "ROUTE_MODULE" ||
          !isObject(batch.counts) || !isCount(batch.requestedCalls) ||
          batch.requestedCalls < 1 || batch.requestedCalls > 1_000_000 ||
          typeof batch.truncated !== "boolean") return null;
      const entries = Object.entries(batch.counts);
      let calls = 0;
      for (const [label, count] of entries) {
        if (!domains.has(label) || !isCount(count) || count < 1) return null;
        calls += count;
      }
      if (calls !== batch.requestedCalls) return null;
      counts = Object.fromEntries(entries);
      // Unknown or truncated attribution must not masquerade as a single domain.
      if (batch.truncated) category = "truncated";
      else if (Object.hasOwn(counts, "unattributed")) category = "unattributed";
      else if (entries.length > 1) category = "mixed";
      else {
        category = "single-domain";
        domain = entries[0][0];
      }
    }
  }
  // Whitelist projection: never retain campaign IDs, role values, fields, errors,
  // file paths or arbitrary strings from the source record in the report.
  return {
    category, domain, recordedAt, counts,
    sockets: value.sockets,
    bytes: value.totalBytes,
    ms: value.totalMs,
  };
}

const emptyTotals = () => ({
  broadcasts: 0,
  socketProjections: 0,
  serializedBytes: 0,
  serverWorkMsSum: 0,
  maxBroadcastMs: 0,
});

function addMeasurement(target, item) {
  target.broadcasts = addCount(target.broadcasts, 1);
  target.socketProjections = addCount(target.socketProjections, item.sockets);
  target.serializedBytes = addCount(target.serializedBytes, item.bytes);
  target.serverWorkMsSum += item.ms;
  if (!Number.isFinite(target.serverWorkMsSum)) throw new Error("REPORT_DURATION_OVERFLOW");
  target.maxBroadcastMs = Math.max(target.maxBroadcastMs, item.ms);
}

function presentTotals(totals) {
  return {
    ...totals,
    meanBroadcastMs: totals.broadcasts ? totals.serverWorkMsSum / totals.broadcasts : null,
  };
}

export async function summarizeSnapshotLines(lines) {
  const input = { lines: 0, unrelated: 0, rejected: 0, unsupportedPrefix: 0 };
  const totals = emptyTotals();
  const groups = new Map();
  const requestsByDomain = new Map();
  let firstRecordAt = null;
  let lastRecordAt = null;
  for await (const rawLine of lines) {
    input.lines += 1;
    const line = input.lines === 1 ? rawLine.replace(/^\uFEFF/, "") : rawLine;
    if (!line.includes(marker)) {
      input.unrelated += 1;
      continue;
    }
    if (!prefix.test(line)) {
      input.unsupportedPrefix += 1;
      continue;
    }
    if (line.length > 65_536) {
      input.rejected += 1;
      continue;
    }
    let measurement;
    try {
      measurement = parseMeasurement(JSON.parse(line.replace(prefix, "")));
    } catch {
      // No raw malformed lines or parse messages are echoed.
      measurement = null;
    }
    if (!measurement) {
      input.rejected += 1;
      continue;
    }
    addMeasurement(totals, measurement);
    const key = measurement.domain ?? measurement.category;
    const group = groups.get(key) ?? { category: measurement.category, domain: measurement.domain, totals: emptyTotals() };
    addMeasurement(group.totals, measurement);
    groups.set(key, group);
    for (const [domain, calls] of Object.entries(measurement.counts)) {
      requestsByDomain.set(domain, addCount(requestsByDomain.get(domain) ?? 0, calls));
    }
    if (measurement.recordedAt) {
      if (firstRecordAt === null || measurement.recordedAt < firstRecordAt) firstRecordAt = measurement.recordedAt;
      if (lastRecordAt === null || measurement.recordedAt > lastRecordAt) lastRecordAt = measurement.recordedAt;
    }
  }
  return {
    schemaVersion: 1,
    evidence: totals.broadcasts === 0 ? "no-usable-snapshot-records" :
      input.rejected || input.unsupportedPrefix ? "observed-with-rejected-lines" : "observed-snapshot-records",
    input,
    observedRecordRange: { firstRecordAt, lastRecordAt },
    totals: presentTotals(totals),
    // Exclusive buckets: every accepted record contributes cost exactly once.
    groups: [...groups.values()]
      .sort((a, b) => b.totals.serializedBytes - a.totals.serializedBytes)
      .map(({ category, domain, totals: values }) => ({ category, domain, ...presentTotals(values) })),
    // Request COUNTS only. Never multiply/apportion shared bytes or time by them.
    observedTriggerRequestsByDomain: Object.fromEntries([...requestsByDomain].sort(([a], [b]) => a.localeCompare(b))),
    limitations: [
      "Route modules are coarse request sources, not field-level causes or proof that their state dominates snapshot size.",
      "Mixed, legacy, unattributed and truncated batches are separate cost buckets; truncated request counts are lower bounds.",
      "Coverage is successful measured broadcasts with recipients, not all commands, empty rooms, failures, initial connections or reconnects.",
      "Serialized bytes are JSON payload size before transport encoding/compression, not wire traffic or acknowledged delivery.",
      "Work time includes instrumentation and may overlap across campaigns. Its sum is not elapsed wall time, CPU time or end-user latency; queue and socket discovery are excluded.",
      "Process-window query estimates can overlap, so this report deliberately does not sum or attribute them.",
      "Record range is not a continuous observation window. No records is no evidence, not a healthy game or zero load.",
      "Use one non-overlapping capture for one explicitly recorded revision and scenario. This report does not verify provenance, deduplicate logs or authorize optimization.",
    ],
  };
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2].startsWith("--")) {
    console.error("Usage: node scripts/report-snapshot-metrics.mjs <captured-server-log>");
    process.exitCode = 1;
    return;
  }
  const input = createReadStream(resolve(process.argv[2]), { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  input.on("error", (error) => lines.emit("error", error));
  try {
    const report = await summarizeSnapshotLines(lines);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    // Exit 0 means parsed evidence only, never a performance/acceptance PASS.
    if (!report.totals.broadcasts || report.input.rejected || report.input.unsupportedPrefix) process.exitCode = 2;
  } finally {
    lines.close();
    input.destroy();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error("SNAPSHOT_REPORT_FAILED: unable to read or safely aggregate the capture; no report produced.");
    process.exitCode = 1;
  });
}
