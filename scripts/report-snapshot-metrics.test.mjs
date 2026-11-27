import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { summarizeSnapshotLines } from "./report-snapshot-metrics.mjs";

const marker = "[snapshot-metrics] ";
const sensitive = "synthetic-private-campaign-123";
const legacy = {
  campaignId: sensitive,
  sockets: 1,
  queries: 9,
  queryCountScope: "PROCESS_WINDOW_ESTIMATE",
  totalBytes: 112,
  totalMs: 4,
  perSocket: [{ bytes: 112, ms: 3, role: sensitive }],
};
const batch = (counts, truncated = false) => ({
  scope: "ROUTE_MODULE",
  counts,
  requestedCalls: Object.values(counts).reduce((sum, count) => sum + count, 0),
  truncated,
});
const line = (record) => marker + JSON.stringify(record);
const current = (triggers, recordedAt = "2026-11-18T10:00:00.000Z") => ({
  ...legacy,
  schemaVersion: 2,
  recordedAt,
  triggers,
});
const accepted = [
  "\uFEFF" + line(legacy),
  "2026-11-18T10:00:00.011123456Z " + line(current(batch({ "world-map": 2 }))),
  line(current(batch({ "world-map": 1, encounter: 1 }), "2026-11-18T09:00:00.000Z")),
  line(current(batch({ awards: 1 }, true))),
  line(current(null)),
];
const mixed = [
  ...accepted,
  "unrelated " + sensitive,
  "server | " + line(current(null)),
  marker + "{ " + sensitive,
  line({ ...current(null), schemaVersion: 3 }),
  line({ ...current(null), totalBytes: 111 }),
  line(current(batch({ [sensitive]: 1 }))),
  marker + "x".repeat(65_536),
];

test("mixed capture accounts for each broadcast once without echoing source metadata", async () => {
  const report = await summarizeSnapshotLines(mixed);
  assert.equal(report.evidence, "observed-with-rejected-lines");
  assert.deepEqual(report.input, { lines: 12, unrelated: 1, rejected: 5, unsupportedPrefix: 1 });
  assert.deepEqual(report.observedRecordRange, {
    firstRecordAt: "2026-11-18T09:00:00.000Z",
    lastRecordAt: "2026-11-18T10:00:00.000Z",
  });
  assert.deepEqual(report.totals, {
    broadcasts: 5, socketProjections: 5, serializedBytes: 560,
    serverWorkMsSum: 20, maxBroadcastMs: 4, meanBroadcastMs: 4,
  });
  assert.deepEqual(report.observedTriggerRequestsByDomain, { awards: 1, encounter: 1, "world-map": 3 });
  assert.deepEqual(
    Object.fromEntries(report.groups.map(({ category, domain, serializedBytes }) => [domain ?? category, serializedBytes])),
    { legacy: 112, "world-map": 112, mixed: 112, truncated: 112, unattributed: 112 },
  );
  assert.equal(JSON.stringify(report).includes(sensitive), false);
});

test("CLI exit codes distinguish clean evidence, unusable inputs, and I/O errors", () => {
  const scratch = mkdtempSync(join(tmpdir(), "arken-snapshot-report-"));
  const input = join(scratch, "capture.log");
  const cli = fileURLToPath(new URL("./report-snapshot-metrics.mjs", import.meta.url));
  const run = () => spawnSync(process.execPath, [cli, input], { encoding: "utf8" });
  try {
    assert.equal(run().status, 1);
    for (const [lines, status, evidence] of [
      [accepted, 0, "observed-snapshot-records"],
      [mixed, 2, "observed-with-rejected-lines"],
      [[sensitive], 2, "no-usable-snapshot-records"],
    ]) {
      writeFileSync(input, lines.join("\r\n") + "\r\n");
      const result = run();
      assert.equal(result.status, status, result.stderr);
      assert.equal(JSON.parse(result.stdout).evidence, evidence);
      assert.equal((result.stderr + result.stdout).includes(sensitive), false);
    }
  } finally {
    rmSync(input, { force: true });
    rmdirSync(scratch);
  }
});
